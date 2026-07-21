import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

export interface IAuditLog extends Document {
  userId?: mongoose.Types.ObjectId;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
  /**
   * HMAC-SHA256 do conteudo do registro (tamper-evidence). Ver notas abaixo.
   */
  integrityHash?: string;
}

/**
 * ── Tamper-evidence (FASE 9.4) ────────────────────────────────────────────
 *
 * Cada registro carrega um HMAC-SHA256 do proprio conteudo, assinado com
 * AUDIT_LOG_SECRET (ou JWT_SECRET como fallback). Quem tiver acesso de escrita
 * ao Mongo mas NAO ao segredo da aplicacao nao consegue alterar um registro
 * sem que `verifyAuditLogIntegrity` acuse.
 *
 * Por que HMAC por registro e nao hash-chain estrito:
 * um hash-chain (cada registro guardando o hash do anterior) exige ler o ultimo
 * registro e gravar o novo de forma atomica/serializada. Como o audit log e
 * escrito de forma concorrente e fire-and-forget (`AuditLog.create(...).catch()`)
 * a partir de qualquer requisicao, serializar as escritas criaria contencao e
 * quebraria a trilha na primeira corrida (dois registros apontando para o mesmo
 * antecessor). O HMAC por registro nao tem esse problema.
 *
 * Limitacao conhecida: HMAC por registro detecta ADULTERACAO de um registro,
 * mas nao detecta REMOCAO de registros nem reordenacao — para isso e preciso
 * export periodico para storage externo append-only (pendente no plano).
 */
const AUDIT_SIGNED_FIELDS = [
  'userId',
  'action',
  'resource',
  'resourceId',
  'details',
  'ipAddress',
  'userAgent',
  'timestamp',
] as const;

function getAuditSecret(): string | null {
  const secret = process.env.AUDIT_LOG_SECRET || process.env.JWT_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

/**
 * Serializacao canonica: chaves ordenadas, profundidade limitada.
 * JSON.stringify puro nao serve porque a ordem das chaves de `details` pode
 * variar entre a escrita e a verificacao.
 */
function stableStringify(value: any, depth = 0): string {
  if (value === null || value === undefined) return 'null';
  if (depth > 8) return '"[MAX_DEPTH]"';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item, depth + 1)).join(',')}]`;
  }
  if (typeof value === 'object') {
    // ObjectId e afins: serializa pela representacao textual
    if (typeof value.toHexString === 'function') return JSON.stringify(value.toHexString());
    // IMPORTANTE: descartar chaves com valor `undefined`.
    // O MongoDB NAO persiste chaves undefined, entao assinar `{a: undefined}`
    // na escrita e reler `{}` produziria assinaturas diferentes e todo
    // registro com campo opcional ausente em `details` seria reportado como
    // adulterado. Ignorar undefined nos dois lados mantem a assinatura estavel.
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], depth + 1)}`)
      .join(',')}}`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

export function buildAuditPayload(record: Record<string, any>): string {
  const canonical: Record<string, any> = {};
  for (const field of AUDIT_SIGNED_FIELDS) {
    const value = (record as any)[field];
    canonical[field] = value === undefined ? null : value;
  }
  return stableStringify(canonical);
}

/**
 * Calcula o HMAC do registro. Retorna null quando nao ha segredo configurado
 * (ambiente sem AUDIT_LOG_SECRET nem JWT_SECRET) — nesse caso o registro e
 * gravado sem assinatura e a verificacao o reporta como nao verificavel.
 */
export function computeAuditSignature(record: Record<string, any>): string | null {
  const secret = getAuditSecret();
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(buildAuditPayload(record)).digest('hex');
}

export interface AuditIntegrityResult {
  valid: boolean;
  reason?: 'no-secret' | 'not-signed' | 'tampered';
}

/**
 * Verifica a integridade de um registro (documento Mongoose ou objeto .lean()).
 */
export function verifyAuditLogIntegrity(record: Record<string, any> | null | undefined): AuditIntegrityResult {
  if (!record) return { valid: false, reason: 'not-signed' };
  const stored = (record as any).integrityHash;
  if (!stored) return { valid: false, reason: 'not-signed' };
  const expected = computeAuditSignature(record);
  if (!expected) return { valid: false, reason: 'no-secret' };
  const a = Buffer.from(String(stored), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return { valid: false, reason: 'tampered' };
  return crypto.timingSafeEqual(a, b) ? { valid: true } : { valid: false, reason: 'tampered' };
}

// userId e opcional para suportar eventos pre-autenticacao (ex: auth.login_failed)
const AuditLogSchema = new Schema<IAuditLog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: false, index: true },
  action: { type: String, required: true, index: true },
  resource: { type: String, required: true },
  resourceId: { type: String },
  details: { type: Schema.Types.Mixed },
  ipAddress: { type: String },
  userAgent: { type: String },
  timestamp: { type: Date, default: Date.now, index: true },
  integrityHash: { type: String },
});

// Assina o registro no momento da criacao. Nao reassina em updates: um registro
// alterado depois de gravado DEVE falhar a verificacao (esse e o objetivo).
AuditLogSchema.pre('save', async function () {
  const doc = this as any;
  if (doc.isNew && !doc.integrityHash) {
    const signature = computeAuditSignature({
      userId: doc.userId,
      action: doc.action,
      resource: doc.resource,
      resourceId: doc.resourceId,
      details: doc.details,
      ipAddress: doc.ipAddress,
      userAgent: doc.userAgent,
      timestamp: doc.timestamp,
    });
    if (signature) doc.integrityHash = signature;
  }
});

// TTL: remove logs apos 365 dias automaticamente
AuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });
// Query composta para listagem admin
AuditLogSchema.index({ action: 1, timestamp: -1 });

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
