/**
 * Detector de shadow endpoints — item 9.6 do plano de seguranca 2026-07-20.
 *
 * POR QUE ISTO EXISTE
 * A auditoria encontrou ~25% da superficie de API fora do `API_REAL.md`,
 * incluindo o fluxo de reset de senha e o `GET /api/upload/signed-url` (que
 * na epoca assinava qualquer objeto do bucket para qualquer autenticado).
 * O que nao esta inventariado nao passa por revisao de seguranca — foi
 * exatamente o caso.
 *
 * COMO FUNCIONA
 * 1. Varre `src/routes/*.ts` extraindo cada rota registrada.
 * 2. Compara com o que esta documentado em `docs/Platform Optmization/API_REAL.md`.
 * 3. Compara com a BASELINE (`api-inventory-baseline.json`), que congela a
 *    divida existente.
 * 4. Falha (exit 1) apenas quando aparece rota nova NAO documentada.
 *
 * A baseline existe para o gate ser utilizavel desde o primeiro dia: falhar
 * de cara nas ~35 rotas ja existentes faria o time desabilitar a checagem —
 * um gate ignorado nao protege nada. A divida antiga fica visivel no relatorio
 * e diminui conforme for documentada.
 *
 * USO
 *   npm run check:api-inventory              # falha se houver rota nova sem doc
 *   npm run check:api-inventory -- --update  # regrava a baseline (revise o diff!)
 */

import fs from 'fs';
import path from 'path';

const ROUTES_DIR = path.resolve(__dirname, '../routes');
const DOC_PATH = path.resolve(__dirname, '../../../docs/Platform Optmization/API_REAL.md');
const BASELINE_PATH = path.resolve(__dirname, '../../api-inventory-baseline.json');

/** Prefixo de montagem de cada arquivo de rota, espelhando o index.ts. */
const MOUNT_POINTS: Record<string, string> = {
  authRoutes: '/api/auth',
  adminRoutes: '/api/admin',
  productRoutes: '/api/products',
  cartRoutes: '/api/cart',
  uploadRoutes: '/api/upload',
  campaignRoutes: '/api/campaigns',
  materialRoutes: '/api/materials',
  quoteRequestRoutes: '/api/quotes',
  imageRoutes: '/api/image',
  recommendationRoutes: '/api/recommendations',
  agencyRoutes: '/api/agency',
  contactMessageRoutes: '/api/contact-messages',
  blockedDomainRoutes: '/api/blocked-domains',
  productRequestRoutes: '/api/product-requests',
  profileRequestRoutes: '/api/profile-requests',
  paymentRoutes: '/api/payment',
  orderRoutes: '/api/orders',
  proposalRoutes: '/api/proposals',
  broadcasterProposalRoutes: '/api/broadcaster-proposals',
  broadcasterSubUserRoutes: '/api/broadcaster',
  broadcasterGroupRoutes: '/api/broadcaster',
  broadcasterGoalsRoutes: '/api/broadcaster',
  broadcasterReportsRoutes: '/api/broadcaster',
  broadcasterCalendarRoutes: '/api/broadcaster',
  testReportRoutes: '/api/test-reports',
  sponsorshipRoutes: '/api/sponsorships',
  insertionTimeSlotRoutes: '/api/insertion-time-slots',
  kanbanRoutes: '/api/kanban',
  broadcasterComboRoutes: '/api/broadcaster-combos',
  onboardingRoutes: '/api/onboarding',
  healthRoutes: '/api',
};

interface Rota {
  metodo: string;
  caminho: string;
  arquivo: string;
}

/** Normaliza `:param` para `:id` — a doc nem sempre usa o mesmo nome. */
function normalizar(caminho: string): string {
  return caminho
    .replace(/:[A-Za-z0-9_]+/g, ':param')
    .replace(/\/+$/, '')
    .toLowerCase() || '/';
}

function extrairRotas(): Rota[] {
  const rotas: Rota[] = [];
  const arquivos = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'));

  for (const arquivo of arquivos) {
    const nome = arquivo.replace(/\.ts$/, '');
    const mount = MOUNT_POINTS[nome];
    if (!mount) {
      console.warn(`⚠️  ${arquivo}: sem ponto de montagem conhecido. Adicione em MOUNT_POINTS.`);
      continue;
    }

    const conteudo = fs.readFileSync(path.join(ROUTES_DIR, arquivo), 'utf8');

    // router.get('/x', ...)  |  router.post("/x", ...)
    const reDireto = /router\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let m: RegExpExecArray | null;
    while ((m = reDireto.exec(conteudo)) !== null) {
      const verbo = m[1] ?? '';
      const rota = m[2] ?? '/';
      rotas.push({
        metodo: verbo.toUpperCase(),
        caminho: mount + (rota === '/' ? '' : rota),
        arquivo,
      });
    }

    // router.route('/x').get(...).post(...)
    const reRoute = /router\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)([\s\S]*?);/g;
    while ((m = reRoute.exec(conteudo)) !== null) {
      const sub = m[1] ?? '/';
      const corpo = m[2] ?? '';
      const caminho = mount + (sub === '/' ? '' : sub);
      const metodos = corpo.match(/\.(get|post|put|patch|delete)\s*\(/g) || [];
      for (const met of metodos) {
        const verbo = met.replace(/[.(\s]/g, '').toUpperCase();
        rotas.push({ metodo: verbo, caminho, arquivo });
      }
    }
  }

  return rotas;
}

function chave(r: Rota): string {
  return `${r.metodo} ${normalizar(r.caminho)}`;
}

function main(): void {
  const atualizarBaseline = process.argv.includes('--update');

  const rotas = extrairRotas();
  const doc = fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, 'utf8').toLowerCase() : '';
  if (!doc) {
    console.warn(`⚠️  API_REAL.md nao encontrado em ${DOC_PATH} — tratando tudo como nao documentado.`);
  }

  const naoDocumentadas = rotas.filter((r) => {
    const caminho = normalizar(r.caminho);
    // Considera documentada se o caminho (com :param generico ou nao) aparece no doc.
    const semParam = caminho.replace(/\/:param/g, '');
    return !doc.includes(caminho) && !doc.includes(semParam);
  });

  const chavesAtuais = naoDocumentadas.map(chave).sort();

  if (atualizarBaseline) {
    fs.writeFileSync(
      BASELINE_PATH,
      JSON.stringify(
        {
          _comentario:
            'Divida conhecida de documentacao de API. Rotas listadas aqui NAO falham o gate. ' +
            'Ao documentar uma rota no API_REAL.md, remova-a desta lista. ' +
            'Regenerar com: npm run check:api-inventory -- --update (revise o diff antes de commitar).',
          _atualizadoEm: new Date().toISOString().slice(0, 10),
          rotasNaoDocumentadas: chavesAtuais,
        },
        null,
        2
      ) + '\n'
    );
    console.log(`✅ Baseline regravada com ${chavesAtuais.length} rota(s). REVISE O DIFF.`);
    return;
  }

  const baseline: string[] = fs.existsSync(BASELINE_PATH)
    ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')).rotasNaoDocumentadas || []
    : [];

  const baselineSet = new Set(baseline);
  const novas = chavesAtuais.filter((k) => !baselineSet.has(k));
  const resolvidas = baseline.filter((k) => !chavesAtuais.includes(k));

  console.log(`\n📋 Inventario de API`);
  console.log(`   rotas registradas ......... ${rotas.length}`);
  console.log(`   nao documentadas .......... ${chavesAtuais.length}`);
  console.log(`   divida conhecida (baseline) ${baseline.length}`);

  if (resolvidas.length > 0) {
    console.log(`\n✅ ${resolvidas.length} rota(s) da baseline foram documentadas. Rode --update para limpar:`);
    resolvidas.forEach((k) => console.log(`   - ${k}`));
  }

  if (novas.length > 0) {
    console.error(`\n❌ ${novas.length} rota(s) NOVA(s) sem documentacao em API_REAL.md:\n`);
    novas.forEach((k) => console.error(`   ${k}`));
    console.error(
      `\nO que fazer: documente a rota em "docs/Platform Optmization/API_REAL.md".\n` +
        `Rota nao inventariada nao passa por revisao de seguranca — foi assim que o\n` +
        `GET /api/upload/signed-url ficou sem checagem de posse ate a auditoria de 2026-07.\n`
    );
    process.exit(1);
  }

  console.log(`\n✅ Nenhuma rota nova sem documentacao.\n`);
}

main();
