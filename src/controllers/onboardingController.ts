import { Response, Request } from 'express';
import { User } from '../models/User';
import { AuthRequest } from '../middleware/auth';

// Obter detalhes completos de uma emissora (público)
export const getBroadcasterDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const { broadcasterId } = req.params;


    const broadcaster = await User.findById(broadcasterId).select('-password');

    if (!broadcaster) {
      res.status(404).json({ error: 'Emissora não encontrada' });
      return;
    }

    if (broadcaster.userType !== 'broadcaster') {
      res.status(400).json({ error: 'Usuário não é uma emissora' });
      return;
    }

    res.json({
      id: broadcaster._id,
      name: broadcaster.companyName,
      dial: broadcaster.broadcasterProfile?.generalInfo?.dialFrequency || 'N/A',
      band: broadcaster.broadcasterProfile?.generalInfo?.band || 'FM',
      location: broadcaster.address?.city || '',
      profile: broadcaster.broadcasterProfile || {}
    });
  } catch (error) {
    console.error('❌ Erro ao buscar detalhes da emissora:', error);
    res.status(500).json({ error: 'Erro ao buscar detalhes da emissora' });
  }
};

// Atualizar perfil da emissora
export const updateBroadcasterProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { broadcasterId } = req.params;

    // Verifica se o usuário logado é o dono do perfil
    if (req.userId !== broadcasterId) {
      res.status(403).json({ error: 'Você não tem permissão para editar este perfil' });
      return;
    }


    const user = await User.findById(broadcasterId);

    if (!user) {
      res.status(404).json({ error: 'Emissora não encontrada' });
      return;
    }

    if (user.userType !== 'broadcaster') {
      res.status(400).json({ error: 'Usuário não é uma emissora' });
      return;
    }

    // Atualiza dados básicos
    if (req.body.name) user.companyName = req.body.name;
    if (req.body.dial) {
      if (!user.broadcasterProfile) user.broadcasterProfile = {};
      if (!user.broadcasterProfile.generalInfo) user.broadcasterProfile.generalInfo = {};
      user.broadcasterProfile.generalInfo.dialFrequency = req.body.dial;
    }
    if (req.body.band) {
      if (!user.broadcasterProfile) user.broadcasterProfile = {};
      if (!user.broadcasterProfile.generalInfo) user.broadcasterProfile.generalInfo = {};
      user.broadcasterProfile.generalInfo.band = req.body.band;
    }
    if (req.body.location) {
      if (!user.address) {
        user.address = {
          cep: '',
          street: '',
          number: '',
          neighborhood: '',
          city: req.body.location,
          state: ''
        };
      } else {
        user.address.city = req.body.location;
      }
    }

    // Atualiza profile (nested)
    if (req.body.profile) {
      if (!user.broadcasterProfile) user.broadcasterProfile = {};

      // Merge dos dados do profile
      if (req.body.profile.categories !== undefined) {
        user.broadcasterProfile.categories = req.body.profile.categories;
      }
      if (req.body.profile.comercialEmail !== undefined) {
        user.broadcasterProfile.comercialEmail = req.body.profile.comercialEmail;
      }
      if (req.body.profile.website !== undefined) {
        user.broadcasterProfile.website = req.body.profile.website;
      }
      if (req.body.profile.socialMedia !== undefined) {
        user.broadcasterProfile.socialMedia = req.body.profile.socialMedia;
      }

      // General Info
      if (req.body.profile.generalInfo) {
        if (!user.broadcasterProfile.generalInfo) user.broadcasterProfile.generalInfo = {};
        if (req.body.profile.generalInfo.foundationYear !== undefined) {
          user.broadcasterProfile.generalInfo.foundationYear = req.body.profile.generalInfo.foundationYear;
        }
        if (req.body.profile.generalInfo.frequency !== undefined) {
          user.broadcasterProfile.generalInfo.frequency = req.body.profile.generalInfo.frequency;
        }
        if (req.body.profile.generalInfo.power !== undefined) {
          user.broadcasterProfile.generalInfo.power = req.body.profile.generalInfo.power;
        }
      }

      // Coverage
      if (req.body.profile.coverage) {
        if (!user.broadcasterProfile.coverage) user.broadcasterProfile.coverage = {};
        if (req.body.profile.coverage.streamingUrl !== undefined) {
          user.broadcasterProfile.coverage.streamingUrl = req.body.profile.coverage.streamingUrl;
        }
      }
    }

    await user.save();


    res.json({
      message: 'Perfil atualizado com sucesso!',
      id: user._id,
      name: user.companyName,
      dial: user.broadcasterProfile?.generalInfo?.dialFrequency || 'N/A',
      band: user.broadcasterProfile?.generalInfo?.band || 'FM',
      location: user.address?.city || '',
      profile: user.broadcasterProfile || {}
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar perfil:', error);
    res.status(500).json({ error: 'Erro ao atualizar perfil da emissora' });
  }
};

// Obter progresso do onboarding
export const getOnboardingProgress = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.userId).select('-password');

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    res.json({
      onboardingCompleted: user.onboardingCompleted || false,
      broadcasterProfile: user.broadcasterProfile || {}
    });
  } catch (error) {
    console.error('Erro ao buscar progresso do onboarding:', error);
    res.status(500).json({ error: 'Erro ao buscar progresso do onboarding' });
  }
};

// Salvar etapa do onboarding
export const saveOnboardingStep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { step, data } = req.body;



    const user = await User.findById(req.userId);

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    if (user.userType !== 'broadcaster') {
      res.status(403).json({ error: 'Apenas emissoras podem completar o onboarding' });
      return;
    }

    // Inicializa broadcasterProfile se não existir
    if (!user.broadcasterProfile) {
      user.broadcasterProfile = {};
    }

    // Atualiza dados da etapa específica
    switch (step) {
      case 1:
        user.broadcasterProfile.generalInfo = {
          stationName: data.stationName,
          dialFrequency: data.dialFrequency,
          band: data.band
        };
        user.broadcasterProfile.logo = data.logo;
        user.broadcasterProfile.comercialEmail = data.comercialEmail;
        user.broadcasterProfile.website = data.website;
        user.broadcasterProfile.socialMedia = data.socialMedia;

        break;

      case 2:
        user.broadcasterProfile.categories = data.categories;
        break;

      case 3:
        // Atualiza apenas os campos que vieram do frontend
        if (!user.broadcasterProfile.audienceProfile) {
          user.broadcasterProfile.audienceProfile = {};
        }

        if (data.audienceProfile.gender) {
          user.broadcasterProfile.audienceProfile.gender = data.audienceProfile.gender;
        }
        if (data.audienceProfile.ageRange) {
          user.broadcasterProfile.audienceProfile.ageRange = data.audienceProfile.ageRange;
        }
        if (data.audienceProfile.socialClass) {
          user.broadcasterProfile.audienceProfile.socialClass = data.audienceProfile.socialClass;
        }


        break;

      case 4:
        user.broadcasterProfile.coverage = data.coverage;

        break;

      case 5:
        user.broadcasterProfile.businessRules = data.businessRules;
        // Marca onboarding como completo quando salva a última etapa
        user.onboardingCompleted = true;

        break;

      default:
        res.status(400).json({ error: 'Etapa inválida' });
        return;
    }

    await user.save();



    res.json({
      message: step === 5 ? 'Onboarding concluído com sucesso!' : 'Etapa salva com sucesso!',
      onboardingCompleted: user.onboardingCompleted,
      broadcasterProfile: user.broadcasterProfile
    });
  } catch (error) {
    console.error('❌ Erro ao salvar etapa do onboarding:', error);
    res.status(500).json({ error: 'Erro ao salvar etapa do onboarding' });
  }
};

// Marcar onboarding como completo manualmente
export const completeOnboarding = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    user.onboardingCompleted = true;
    await user.save();

    res.json({
      message: 'Onboarding marcado como completo!',
      onboardingCompleted: true
    });
  } catch (error) {
    console.error('Erro ao completar onboarding:', error);
    res.status(500).json({ error: 'Erro ao completar onboarding' });
  }
};
