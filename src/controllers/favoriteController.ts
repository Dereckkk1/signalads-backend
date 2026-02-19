import { Request, Response } from 'express';
import { User } from '../models/User';

/**
 * Controller para gerenciar emissoras favoritas
 */

/**
 * Toggle favorito - adiciona ou remove uma emissora dos favoritos
 * POST /api/favorites/toggle/:broadcasterId
 */
export const toggleFavorite = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { broadcasterId } = req.params;


    // Verifica se a emissora existe
    const broadcaster = await User.findById(broadcasterId);
    if (!broadcaster || broadcaster.userType !== 'broadcaster') {
      return res.status(404).json({ message: 'Emissora não encontrada' });
    }

    // Busca o usuário para verificar se já é favorito
    const user = await User.findById(userId).select('favorites');
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Verifica se já é favorito
    const isCurrentlyFavorite = (user.favorites || []).some(
      (fav: any) => fav.toString() === broadcasterId
    );

    let isFavorite: boolean;

    if (isCurrentlyFavorite) {
      // Remove dos favoritos usando $pull (evita validação completa)
      await User.findByIdAndUpdate(userId, {
        $pull: { favorites: broadcasterId }
      });
      isFavorite = false;
    } else {
      // Adiciona aos favoritos usando $addToSet (evita duplicatas e validação completa)
      await User.findByIdAndUpdate(userId, {
        $addToSet: { favorites: broadcasterId }
      });
      isFavorite = true;
    }

    // Busca contagem atualizada
    const updatedUser = await User.findById(userId).select('favorites');
    const favoritesCount = updatedUser?.favorites?.length || 0;

    res.json({
      message: isFavorite ? 'Emissora adicionada aos favoritos' : 'Emissora removida dos favoritos',
      isFavorite,
      favoritesCount
    });

  } catch (error: any) {
    console.error('❌ Erro ao toggle favorito:', error.message);
    res.status(500).json({ message: 'Erro ao atualizar favoritos', error: error.message });
  }
};

/**
 * Lista todas as emissoras favoritas do usuário
 * GET /api/favorites
 */
export const getFavorites = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;


    const user = await User.findById(userId)
      .populate({
        path: 'favorites',
        select: 'fantasyName companyName email phone broadcasterProfile status',
        match: { userType: 'broadcaster', status: 'approved' }
      });

    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Filtra nulos (caso alguma emissora tenha sido removida)
    const favorites = (user.favorites || []).filter(Boolean);


    res.json({
      favorites,
      count: favorites.length
    });

  } catch (error: any) {
    console.error('❌ Erro ao listar favoritos:', error.message);
    res.status(500).json({ message: 'Erro ao buscar favoritos', error: error.message });
  }
};

/**
 * Lista apenas os IDs das emissoras favoritas (mais leve)
 * GET /api/favorites/ids
 */
export const getFavoriteIds = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const user = await User.findById(userId).select('favorites');

    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const favoriteIds = (user.favorites || []).map((fav: any) => fav.toString());

    res.json({
      favoriteIds,
      count: favoriteIds.length
    });

  } catch (error: any) {
    console.error('❌ Erro ao listar IDs de favoritos:', error.message);
    res.status(500).json({ message: 'Erro ao buscar favoritos', error: error.message });
  }
};

/**
 * Verifica se uma emissora específica é favorita
 * GET /api/favorites/check/:broadcasterId
 */
export const checkIsFavorite = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { broadcasterId } = req.params;

    const user = await User.findById(userId).select('favorites');

    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const isFavorite = (user.favorites || []).some(
      (fav: any) => fav.toString() === broadcasterId
    );

    res.json({ isFavorite });

  } catch (error: any) {
    console.error('❌ Erro ao verificar favorito:', error.message);
    res.status(500).json({ message: 'Erro ao verificar favorito', error: error.message });
  }
};
