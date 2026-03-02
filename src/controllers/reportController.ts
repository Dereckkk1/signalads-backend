import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { User } from '../models/User';
import { Product } from '../models/Product';
import mongoose from 'mongoose';
import { toAccentInsensitiveRegex } from '../utils/stringUtils';

/**
 * GET /api/admin/directory-report/spot-types
 * Retorna os tipos de spots (produtos) disponíveis para filtro
 */
export const getDirectoryReportSpotTypes = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const types = await Product.distinct('spotType');
        res.json(types.sort());
    } catch (error) {
        console.error('Erro ao buscar tipos de spot:', error);
        res.status(500).json({ error: 'Erro ao buscar tipos de spot' });
    }
};

/**
 * GET /api/admin/directory-report
 * Retorna o relatório para a diretoria, cruzando Emissoras (Users) e seus Produtos
 */
export const getDirectoryReport = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { search, page = 1, limit = 50, city, materials } = req.query;

        const pageNum = Math.max(1, Number(page));
        const limitNum = Math.max(1, Number(limit));
        const skip = (pageNum - 1) * limitNum;

        // Pipeline para buscar produtos e popular com dados da emissora (User)
        const matchStage: any = {};
        if (search) {
            matchStage['broadcaster.companyName'] = toAccentInsensitiveRegex(search as string);
        }
        if (city) {
            matchStage['broadcaster.address.city'] = city;
        }

        const productMatch: any = {
            isActive: true
        };

        if (materials) {
            const materialsArray = Array.isArray(materials)
                ? materials
                : (materials as string).split(',').filter(Boolean);

            if (materialsArray.length > 0) {
                productMatch.spotType = { $in: materialsArray };
            }
        }

        const pipeline: any[] = [
            // Filter products first for efficiency if we have material filter
            { $match: productMatch },
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
            // Only broadcasters and apply search/city filters
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
 * Atualiza preço plataforma (apenas produtos 30s) e PMM.
 * Ao editar um produto 30s, recalcula automaticamente os demais tempos:
 *   Comercial: 15s = x/2, 30s = x, 45s = x*1.5, 60s = x*2
 *   Testemunhal: 30s = x, 60s = x*2
 */
export const updateDirectoryReportRecord = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { productId } = req.params;
        const { precoPlataforma, pmm } = req.body;

        const product = await Product.findById(productId);
        if (!product) {
            res.status(404).json({ error: 'Produto não encontrado' });
            return;
        }

        // Só permite editar produtos de 30s
        if (product.duration !== 30) {
            res.status(400).json({ error: 'Apenas produtos de 30s podem ser editados' });
            return;
        }

        // Atualiza preço do produto 30s e recalcula os demais
        if (typeof precoPlataforma === 'number' && precoPlataforma >= 0) {
            const basePrice = precoPlataforma; // preço do 30s
            product.pricePerInsertion = basePrice;
            product.manuallyEdited = true;
            await product.save();

            const isComercial = product.spotType.startsWith('Comercial');
            const isTestemunhal = product.spotType.startsWith('Testemunhal');

            if (isComercial) {
                // Atualiza 15s, 45s e 60s
                await Product.findOneAndUpdate(
                    { broadcasterId: product.broadcasterId, spotType: 'Comercial 15s' },
                    { pricePerInsertion: basePrice / 2, manuallyEdited: true }
                );
                await Product.findOneAndUpdate(
                    { broadcasterId: product.broadcasterId, spotType: 'Comercial 45s' },
                    { pricePerInsertion: basePrice * 1.5, manuallyEdited: true }
                );
                await Product.findOneAndUpdate(
                    { broadcasterId: product.broadcasterId, spotType: 'Comercial 60s' },
                    { pricePerInsertion: basePrice * 2, manuallyEdited: true }
                );
            } else if (isTestemunhal) {
                // Atualiza 60s
                await Product.findOneAndUpdate(
                    { broadcasterId: product.broadcasterId, spotType: 'Testemunhal 60s' },
                    { pricePerInsertion: basePrice * 2, manuallyEdited: true }
                );
            }
        }

        // Atualiza PMM no User
        if (typeof pmm === 'number') {
            const user = await User.findById(product.broadcasterId);
            if (user) {
                if (!user.broadcasterProfile) user.broadcasterProfile = {} as any;
                user.broadcasterProfile!.pmm = pmm;
                user.markModified('broadcasterProfile');
                await user.save();
            }
        }

        res.json({ message: 'Registro atualizado com sucesso' });
    } catch (error: any) {
        console.error('Erro ao atualizar registro do relatório:', error);
        res.status(500).json({ error: 'Erro ao atualizar registro' });
    }
};
