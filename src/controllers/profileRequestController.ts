import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { ProfileRequest } from '../models/ProfileRequest';
import { User } from '../models/User';

// ─────────────────────────────────────────────
// EMISSORA: Criar solicitação de alteração de perfil
// POST /api/profile-requests
// ─────────────────────────────────────────────
export const createProfileRequest = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;

        if (!user || user.userType !== 'broadcaster') {
            res.status(403).json({ error: 'Acesso restrito a emissoras' });
            return;
        }

        if (user.status !== 'approved') {
            res.status(403).json({ error: 'Emissora não está aprovada na plataforma' });
            return;
        }

        const { requestedData } = req.body;

        if (!requestedData || Object.keys(requestedData).length === 0) {
            res.status(400).json({ error: 'Informe os dados que deseja alterar' });
            return;
        }

        // Verificar se já existe uma solicitação pendente
        const existing = await ProfileRequest.findOne({
            broadcasterId: user._id,
            status: 'pending'
        });

        if (existing) {
            res.status(409).json({ error: 'Você já possui uma solicitação de alteração pendente' });
            return;
        }

        const request = new ProfileRequest({
            broadcasterId: user._id,
            requestedData,
            status: 'pending'
        });

        await request.save();

        res.status(201).json({
            message: 'Solicitação de alteração de perfil enviada com sucesso! Aguarde a aprovação.',
            request
        });
    } catch (error) {
        console.error('Erro ao criar solicitação de perfil:', error);
        res.status(500).json({ error: 'Erro interno ao criar solicitação' });
    }
};

// ─────────────────────────────────────────────
// EMISSORA: Listar minhas solicitações de perfil
// GET /api/profile-requests/my-requests
// ─────────────────────────────────────────────
export const getMyProfileRequests = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;

        if (!user || user.userType !== 'broadcaster') {
            res.status(403).json({ error: 'Acesso restrito a emissoras' });
            return;
        }

        const { status, page = 1, limit = 20 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const filter: any = { broadcasterId: user._id };
        if (status) filter.status = status;

        const [requests, total] = await Promise.all([
            ProfileRequest.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit)),
            ProfileRequest.countDocuments(filter)
        ]);

        res.json({
            requests,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                pages: Math.ceil(total / Number(limit))
            }
        });
    } catch (error) {
        console.error('Erro ao buscar solicitações de perfil:', error);
        res.status(500).json({ error: 'Erro interno ao buscar solicitações' });
    }
};

// ─────────────────────────────────────────────
// ADMIN: Listar todas as solicitações
// GET /api/profile-requests
// ─────────────────────────────────────────────
export const getAllProfileRequests = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;

        if (!user || user.userType !== 'admin') {
            res.status(403).json({ error: 'Acesso restrito ao administrador' });
            return;
        }

        const { status, broadcasterId, page = 1, limit = 20 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const filter: any = {};
        if (status) filter.status = status;
        if (broadcasterId) filter.broadcasterId = broadcasterId;

        const [requests, total] = await Promise.all([
            ProfileRequest.find(filter)
                .populate('broadcasterId', 'companyName fantasyName email phone cnpj address broadcasterProfile')
                .populate('reviewedBy', 'companyName email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit)),
            ProfileRequest.countDocuments(filter)
        ]);

        res.json({
            requests,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                pages: Math.ceil(total / Number(limit))
            }
        });
    } catch (error) {
        console.error('Erro ao buscar solicitações de perfil:', error);
        res.status(500).json({ error: 'Erro interno ao buscar solicitações' });
    }
};

// ─────────────────────────────────────────────
// ADMIN: Aprovar solicitação
// POST /api/profile-requests/:id/approve
// ─────────────────────────────────────────────
export const approveProfileRequest = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;

        if (!user || user.userType !== 'admin') {
            res.status(403).json({ error: 'Acesso restrito ao administrador' });
            return;
        }

        const { id } = req.params;

        const request = await ProfileRequest.findById(id);
        if (!request) {
            res.status(404).json({ error: 'Solicitação não encontrada' });
            return;
        }

        if (request.status !== 'pending') {
            res.status(400).json({ error: 'Esta solicitação já foi processada' });
            return;
        }

        const broadcaster = await User.findById(request.broadcasterId);
        if (!broadcaster) {
            res.status(404).json({ error: 'Emissora não encontrada' });
            return;
        }

        // Função para limpar 'undefined' (tipo ou string literal) que quebram o cast do Mongoose
        const cleanUndefined = (obj: any): any => {
            if (Array.isArray(obj)) {
                return obj.map(cleanUndefined);
            } else if (obj !== null && typeof obj === 'object') {
                const newObj: any = {};
                for (const key of Object.keys(obj)) {
                    if (obj[key] !== 'undefined' && obj[key] !== undefined) {
                        newObj[key] = cleanUndefined(obj[key]);
                    }
                }
                return newObj;
            }
            return obj;
        };

        // Mesclar os dados aprovados no perfil da emissora
        const dataToUpdate = cleanUndefined(request.requestedData);

        // Atualizar os campos necessários
        if (dataToUpdate.companyName) broadcaster.companyName = dataToUpdate.companyName;
        if (dataToUpdate.fantasyName) broadcaster.fantasyName = dataToUpdate.fantasyName;
        if (dataToUpdate.cnpj) broadcaster.cnpj = dataToUpdate.cnpj;
        if (dataToUpdate.phone) broadcaster.phone = dataToUpdate.phone;

        if (dataToUpdate.address) {
            broadcaster.address = {
                ...broadcaster.address,
                ...dataToUpdate.address
            };
        }

        if (dataToUpdate.broadcasterProfile) {
            const currentProfile = broadcaster.broadcasterProfile ? (broadcaster.broadcasterProfile as any).toObject() : {};

            // Limpar undefined explícitos do requestedData que podem quebrar o Mongoose
            const cleanData = JSON.parse(JSON.stringify(dataToUpdate.broadcasterProfile));

            broadcaster.broadcasterProfile = {
                ...currentProfile,
                ...cleanData
            };
        }

        await broadcaster.save();

        request.status = 'approved';
        request.reviewedBy = user._id;
        request.reviewedAt = new Date();
        await request.save();

        res.json({
            message: 'Solicitação aprovada e perfil atualizado com sucesso',
            request
        });
    } catch (error) {
        console.error('Erro ao aprovar solicitação de perfil:', error);
        res.status(500).json({ error: 'Erro interno ao aprovar solicitação' });
    }
};

// ─────────────────────────────────────────────
// ADMIN: Recusar solicitação
// POST /api/profile-requests/:id/reject
// ─────────────────────────────────────────────
export const rejectProfileRequest = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;

        if (!user || user.userType !== 'admin') {
            res.status(403).json({ error: 'Acesso restrito ao administrador' });
            return;
        }

        const { id } = req.params;
        const { rejectionReason } = req.body;

        if (!rejectionReason || rejectionReason.trim().length < 10) {
            res.status(400).json({ error: 'Informe um motivo de recusa com pelo menos 10 caracteres' });
            return;
        }

        const request = await ProfileRequest.findById(id);
        if (!request) {
            res.status(404).json({ error: 'Solicitação não encontrada' });
            return;
        }

        if (request.status !== 'pending') {
            res.status(400).json({ error: 'Esta solicitação já foi processada' });
            return;
        }

        request.status = 'rejected';
        request.rejectionReason = rejectionReason.trim();
        request.reviewedBy = user._id;
        request.reviewedAt = new Date();

        await request.save();

        res.json({
            message: 'Solicitação recusada',
            request
        });
    } catch (error) {
        console.error('Erro ao recusar solicitação de perfil:', error);
        res.status(500).json({ error: 'Erro interno ao recusar solicitação' });
    }
};
// ─────────────────────────────────────────────
// ADMIN: Contar solicitações pendentes
// GET /api/profile-requests/count-pending
// ─────────────────────────────────────────────
export const countPendingProfileRequests = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;
        if (!user || user.userType !== 'admin') {
            res.status(403).json({ error: 'Acesso negado' });
            return;
        }

        const count = await ProfileRequest.countDocuments({ status: 'pending' });
        res.json({ count });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao contar solicitações' });
    }
};
