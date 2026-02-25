import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { User } from '../models/User';
import { Product } from '../models/Product';
import mongoose from 'mongoose';

/**
 * GET /api/admin/directory-report
 * Retorna o relatório para a diretoria, cruzando Emissoras (Users) e seus Produtos
 */
export const getDirectoryReport = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { search, page = 1, limit = 50 } = req.query;

        const pageNum = Math.max(1, Number(page));
        const limitNum = Math.max(1, Number(limit));
        const skip = (pageNum - 1) * limitNum;

        // Pipeline para buscar produtos e popular com dados da emissora (User)
        const matchStage: any = {};
        if (search) {
            matchStage['broadcaster.companyName'] = { $regex: search, $options: 'i' };
        }

        const pipeline: any[] = [
            // Lookup broadcaster
            {
                $lookup: {
                    from: 'users',
                    localField: 'broadcasterId',
                    foreignField: '_id',
                    as: 'broadcaster'
                }
            },
            { $unwind: '$broadcaster' },
            // Only broadcasters
            {
                $match: {
                    'broadcaster.userType': 'broadcaster',
                    ...matchStage
                }
            },
            // Sort by broadcaster name, then product name
            { $sort: { 'broadcaster.companyName': 1, spotType: 1 } },
            // Pagination
            {
                $facet: {
                    metadata: [{ $count: 'total' }],
                    data: [
                        { $skip: skip },
                        { $limit: limitNum }
                    ]
                }
            }
        ];

        const result = await Product.aggregate(pipeline);
        const metadata = result[0].metadata;
        const data = result[0].data;
        const total = metadata.length > 0 ? metadata[0].total : 0;

        // Formatar resultados
        const formattedData = data.map((item: any) => {
            const broadcaster = item.broadcaster;
            const profile = broadcaster.broadcasterProfile || {};
            const generalInfo = profile.generalInfo || {};
            const address = broadcaster.address || {};

            const precoPlataforma = item.pricePerInsertion || 0;
            // Cálculo v1 fornecido: (preço_plataforma - 39.39%) - 20% -> equivalente a (precoPlataforma / 1.65) * 0.8
            // Para aproximar os 39.39%: 1 - 0.39393939 = 0.606060... = 1/1.65
            const precoV1 = (precoPlataforma / 1.65) * 0.8;

            return {
                id: item._id, // Product ID
                broadcasterId: broadcaster._id,
                logo: profile.logo || '',
                emissora: generalInfo.stationName || broadcaster.companyName || '',
                dial: generalInfo.dialFrequency || '',
                cidade: address.city || '',
                produto: item.spotType,
                precoPlataforma: precoPlataforma,
                precoV1: precoV1,
                pmm: profile.pmm || 0,
            };
        });

        res.json({
            items: formattedData,
            total,
            page: pageNum,
            pages: Math.ceil(total / limitNum)
        });

    } catch (error: any) {
        console.error('Erro ao buscar o relatório da diretoria:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório da diretoria' });
    }
};

/**
 * PUT /api/admin/directory-report/:productId
 * Atualiza um registro diretamente pelo relatório
 */
export const updateDirectoryReportRecord = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { productId } = req.params;
        const { precoPlataforma, pmm, cidade, dial, emissora } = req.body;

        const product = await Product.findById(productId);
        if (!product) {
            res.status(404).json({ error: 'Produto não encontrado' });
            return;
        }

        // Atualiza Produto (preço plataforma)
        if (typeof precoPlataforma === 'number') {
            product.pricePerInsertion = precoPlataforma;
            await product.save();
        }

        // Atualiza User (Emissora): PMM, Cidade, Dial, Nome
        const user = await User.findById(product.broadcasterId);
        if (user) {
            if (typeof pmm === 'number') {
                if (!user.broadcasterProfile) user.broadcasterProfile = {} as any;
                user.broadcasterProfile!.pmm = pmm;
            }
            if (typeof cidade === 'string') {
                if (!user.address) user.address = {} as any;
                user.address!.city = cidade;
            }
            if (typeof dial === 'string') {
                if (!user.broadcasterProfile) user.broadcasterProfile = {} as any;
                if (!user.broadcasterProfile!.generalInfo) user.broadcasterProfile!.generalInfo = {} as any;
                user.broadcasterProfile!.generalInfo!.dialFrequency = dial;
            }
            if (typeof emissora === 'string' && emissora.trim() !== '') {
                user.companyName = emissora;
                if (user.broadcasterProfile && user.broadcasterProfile.generalInfo) {
                    user.broadcasterProfile.generalInfo.stationName = emissora;
                }
            }

            // Precisamos garantir que todos os campos modificados sejam detectados se forem objetos
            user.markModified('broadcasterProfile');
            user.markModified('address');
            user.markModified('companyName');

            await user.save();
        }

        res.json({ message: 'Registro atualizado com sucesso' });
    } catch (error: any) {
        console.error('Erro ao atualizar registro do relatório:', error);
        res.status(500).json({ error: 'Erro ao atualizar registro' });
    }
};
