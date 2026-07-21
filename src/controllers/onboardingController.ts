import { Response } from 'express';
import { AuthRequest, invalidateUserCache } from '../middleware/auth';
import { User } from '../models/User';

// ─────────────────────────────────────────────
// Onboarding self-service de emissoras.
//
// A forma canonica do broadcasterProfile mantem os campos de identificacao
// sob `generalInfo` (stationName/dialFrequency/band) — e o que o Marketplace le.
// O wizard do frontend envia esses campos no topo do `data` da etapa 1; aqui
// normalizamos para `generalInfo` para nao quebrar a vitrine.
// ─────────────────────────────────────────────

const VALID_STEPS = [1, 2, 3, 4];

/**
 * Converte um subdocumento Mongoose (ou undefined) em plain object,
 * removendo chaves com valor `undefined` que quebram o cast do Mongoose.
 */
/**
 * Subcampos de `broadcasterProfile` que a PROPRIA emissora pode editar.
 *
 * Fora da lista, deliberadamente:
 *   - `slug` — URL publica /emissora/:slug, indice unico (sequestro de SEO)
 *   - `pmm`  — alimenta CPM e a ordenacao do marketplace (autodeclarar-se lider)
 * Ambos so mudam por acao de admin.
 */
const BROADCASTER_PROFILE_EDITABLE_FIELDS = new Set([
  'generalInfo',
  'logo',
  'comercialEmail',
  'website',
  'socialMedia',
  'categories',
  'audienceProfile',
  'coverage',
  'businessRules',
]);

function toPlainProfile(profile: any): Record<string, any> {
  const plain = profile?.toObject?.() ?? (profile && typeof profile === 'object' ? { ...profile } : {});
  return JSON.parse(JSON.stringify(plain));
}

/**
 * GET /api/onboarding/progress
 * Retorna o perfil salvo e o status de conclusao do proprio usuario logado.
 */
export const getOnboardingProgress = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user!._id).select('broadcasterProfile onboardingCompleted');
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    res.json({
      broadcasterProfile: user.broadcasterProfile || null,
      onboardingCompleted: user.onboardingCompleted || false,
    });
  } catch (error) {
    console.error('[onboarding] progresso:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * POST /api/onboarding/step
 * Salva os dados de uma etapa no perfil do proprio usuario logado.
 * Body: { step: 1..4, data: {...} }. A etapa 4 conclui o onboarding.
 */
export const saveOnboardingStep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stepNum = Number(req.body?.step);
    const data = req.body?.data;

    if (!VALID_STEPS.includes(stepNum)) {
      res.status(400).json({ error: 'Etapa inválida' });
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      res.status(400).json({ error: 'Dados da etapa ausentes ou inválidos' });
      return;
    }

    const user = await User.findById(req.user!._id);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    const profile = toPlainProfile(user.broadcasterProfile);

    switch (stepNum) {
      case 1:
        // Normaliza identificacao para generalInfo (forma canonica lida pelo Marketplace)
        profile.generalInfo = {
          ...(profile.generalInfo || {}),
          stationName: data.stationName,
          dialFrequency: data.dialFrequency,
          band: data.band,
        };
        if (data.logo !== undefined) profile.logo = data.logo;
        if (data.comercialEmail !== undefined) profile.comercialEmail = data.comercialEmail;
        if (data.website !== undefined) profile.website = data.website;
        if (data.socialMedia !== undefined) profile.socialMedia = data.socialMedia;
        break;

      case 2:
        if (data.categories !== undefined) profile.categories = data.categories;
        break;

      case 3:
        if (data.audienceProfile !== undefined) profile.audienceProfile = data.audienceProfile;
        break;

      case 4:
        if (data.coverage !== undefined) profile.coverage = data.coverage;
        break;
    }

    // Limpa undefineds remanescentes (ex: generalInfo.band nao enviado)
    const cleaned = JSON.parse(JSON.stringify(profile));
    user.broadcasterProfile = cleaned;

    // A etapa 4 e a ultima do wizard — concluir o onboarding.
    if (stepNum === 4) {
      user.onboardingCompleted = true;
    }

    await user.save();
    await invalidateUserCache(user._id.toString());

    res.json({
      message: 'Etapa salva com sucesso',
      broadcasterProfile: user.broadcasterProfile,
      onboardingCompleted: user.onboardingCompleted || false,
    });
  } catch (error) {
    console.error('[onboarding] salvar etapa:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * PUT /api/onboarding/broadcaster/:id
 * Atualiza diretamente o perfil da propria emissora (usado pela pagina de
 * Configuracoes de Perfil). Escopado ao proprio usuario para evitar IDOR.
 * Body: { name?, location?, profile? }.
 */
export const updateBroadcasterProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Guarda IDOR: emissora so pode atualizar o proprio perfil.
    if (id !== req.user!._id.toString()) {
      res.status(403).json({ error: 'Você só pode atualizar o próprio perfil' });
      return;
    }

    const { name, location, profile } = req.body;

    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    if (name) user.companyName = name;

    if (location) {
      user.address = { ...(user.address as any), city: location } as any;
    }

    if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      // SEGURANCA (item 5.4 do plano 2026-07-20): allowlist em vez de merge cego.
      //
      // O spread `{ ...current, ...incoming }` aceitava QUALQUER subcampo do
      // schema, incluindo dois que nao pertencem ao usuario:
      //   - `pmm`: alimenta o calculo de CPM e a ordenacao do /mapa e do
      //     comparador. A emissora se autodeclarava lider do marketplace.
      //   - `slug`: e a URL publica /emissora/:slug (indice unico). Dava para
      //     sequestrar um slug de SEO ainda nao atribuido.
      // Ambos so podem ser alterados pelo admin (reportController).
      const current = toPlainProfile(user.broadcasterProfile);
      const incoming = JSON.parse(JSON.stringify(profile));

      const filtered: Record<string, any> = {};
      for (const key of Object.keys(incoming)) {
        if (BROADCASTER_PROFILE_EDITABLE_FIELDS.has(key)) {
          filtered[key] = incoming[key];
        }
      }

      user.broadcasterProfile = {
        ...current,
        ...filtered,
        // Reafirma os campos derivados/administrativos a partir do valor atual,
        // para que nem um bug futuro na allowlist consiga sobrescreve-los.
        slug: (current as any)?.slug,
        pmm: (current as any)?.pmm,
      } as any;
    }

    user.onboardingCompleted = true;

    await user.save();
    await invalidateUserCache(user._id.toString());

    res.json({
      message: 'Perfil atualizado com sucesso',
      broadcaster: {
        id: user._id,
        companyName: user.companyName,
        broadcasterProfile: user.broadcasterProfile,
        onboardingCompleted: user.onboardingCompleted,
      },
    });
  } catch (error) {
    console.error('[onboarding] atualizar perfil:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};
