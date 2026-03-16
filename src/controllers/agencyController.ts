import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import AgencyClient from '../models/AgencyClient';
import Order from '../models/Order';

export const getDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId || req.user?._id;
        const userType = req.user?.userType;

        if (userType !== 'agency') {
            res.status(403).json({ message: 'Acesso negado.' });
            return;
        }

        // 1. Busca todos os pedidos da agência
        const orders = await Order.find({ buyerId: userId }).sort({ createdAt: -1 }).lean();

        // 2. Busca todos os clientes da agência
        const clients = await AgencyClient.find({ agencyId: userId }).lean();
        const clientMap = new Map(clients.map(c => [c._id.toString(), c]));

        // 3. Agrupa pedidos por clientId
        const clientStats: Record<string, {
            clientId: string;
            clientName: string;
            clientDocument: string;
            totalOrders: number;
            totalGross: number;
            totalCommission: number;
            lastOrderDate: Date | null;
            statuses: Record<string, number>;
        }> = {};

        const NO_CLIENT = 'no_client';

        let totalGross = 0;
        let totalCommission = 0;
        let totalOrders = orders.length;

        // 4. Dados mensais (últimos 12 meses) e categorias
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        // Inicializa array de 12 meses (do mais antigo ao mais recente)
        const monthlyData: { month: string; year: number; monthIndex: number; gross: number; commission: number; orders: number }[] = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(currentYear, currentMonth - i, 1);
            monthlyData.push({
                month: d.toLocaleString('pt-BR', { month: 'short' }).replace('.', ''),
                year: d.getFullYear(),
                monthIndex: d.getMonth(),
                gross: 0,
                commission: 0,
                orders: 0
            });
        }

        // Categorias baseadas no productName dos itens
        const categoryStats: Record<string, { name: string; totalGross: number; count: number }> = {};

        // Métricas do mês atual vs mês anterior
        let currentMonthGross = 0;
        let previousMonthGross = 0;
        let currentMonthCommission = 0;
        let previousMonthCommission = 0;
        let currentMonthOrders = 0;
        let previousMonthOrders = 0;

        // Campanhas ativas (status de execução)
        const activeStatuses = ['paid', 'pending_approval', 'approved', 'scheduled', 'in_progress'];
        let activeCampaigns = 0;

        orders.forEach((order: any) => {
            const cid = order.clientId ? order.clientId.toString() : NO_CLIENT;
            const client = order.clientId ? clientMap.get(cid) : null;

            if (!clientStats[cid]) {
                clientStats[cid] = {
                    clientId: cid,
                    clientName: client ? (client as any).name : 'Sem cliente atribuído',
                    clientDocument: client ? (client as any).documentNumber : '',
                    totalOrders: 0,
                    totalGross: 0,
                    totalCommission: 0,
                    lastOrderDate: null,
                    statuses: {}
                };
            }

            const stat = clientStats[cid];
            stat.totalOrders++;
            stat.totalGross += order.totalAmount || 0;
            stat.totalCommission += order.agencyCommission || 0;
            stat.statuses[order.status] = (stat.statuses[order.status] || 0) + 1;

            if (!stat.lastOrderDate || order.createdAt > stat.lastOrderDate) {
                stat.lastOrderDate = order.createdAt;
            }

            totalGross += order.totalAmount || 0;
            totalCommission += order.agencyCommission || 0;

            // Campanhas ativas
            if (activeStatuses.includes(order.status)) {
                activeCampaigns++;
            }

            // Dados mensais
            const orderDate = new Date(order.createdAt);
            const orderMonth = orderDate.getMonth();
            const orderYear = orderDate.getFullYear();

            const monthEntry = monthlyData.find(m => m.monthIndex === orderMonth && m.year === orderYear);
            if (monthEntry) {
                monthEntry.gross += order.totalAmount || 0;
                monthEntry.commission += order.agencyCommission || 0;
                monthEntry.orders++;
            }

            // Mês atual vs anterior
            if (orderMonth === currentMonth && orderYear === currentYear) {
                currentMonthGross += order.totalAmount || 0;
                currentMonthCommission += order.agencyCommission || 0;
                currentMonthOrders++;
            }
            const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
            const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
            if (orderMonth === prevMonth && orderYear === prevYear) {
                previousMonthGross += order.totalAmount || 0;
                previousMonthCommission += order.agencyCommission || 0;
                previousMonthOrders++;
            }

            // Categorias por productName dos itens
            if (order.items && Array.isArray(order.items)) {
                order.items.forEach((item: any) => {
                    const productName = item.productName || 'Outros';
                    // Agrupa por tipo base: "Comercial 30s" -> "Comercial", "Testemunhal 60s" -> "Testemunhal"
                    const baseName = productName.split(' ')[0] || 'Outros';
                    if (!categoryStats[baseName]) {
                        categoryStats[baseName] = { name: baseName, totalGross: 0, count: 0 };
                    }
                    categoryStats[baseName].totalGross += item.totalPrice || 0;
                    categoryStats[baseName].count++;
                });
            }
        });

        // Calcula percentuais de mudança
        const calcChange = (current: number, previous: number) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 1000) / 10;
        };

        // Converte categorias em array com percentuais
        const totalCategoryGross = Object.values(categoryStats).reduce((sum, c) => sum + c.totalGross, 0);
        const categories = Object.values(categoryStats)
            .sort((a, b) => b.totalGross - a.totalGross)
            .map(c => ({
                name: c.name,
                totalGross: c.totalGross,
                count: c.count,
                percentage: totalCategoryGross > 0 ? Math.round((c.totalGross / totalCategoryGross) * 100) : 0
            }));

        res.json({
            summary: {
                totalClients: clients.length,
                totalOrders,
                totalGross,
                totalCommission,
                activeCampaigns,
                currentMonthOrders,
                changes: {
                    gross: calcChange(currentMonthGross, previousMonthGross),
                    commission: calcChange(currentMonthCommission, previousMonthCommission),
                    orders: calcChange(currentMonthOrders, previousMonthOrders)
                }
            },
            monthlyData: monthlyData.map(m => ({
                month: m.month.charAt(0).toUpperCase() + m.month.slice(1),
                gross: m.gross,
                commission: m.commission,
                orders: m.orders
            })),
            categories,
            clientBreakdown: Object.values(clientStats).sort((a, b) => b.totalGross - a.totalGross),
            recentOrders: orders.slice(0, 10).map((o: any) => ({
                orderNumber: o.orderNumber,
                status: o.status,
                totalAmount: o.totalAmount,
                grossAmount: o.grossAmount,
                agencyCommission: o.agencyCommission,
                clientId: o.clientId,
                clientName: o.clientId ? (clientMap.get(o.clientId.toString()) as any)?.name || 'Cliente' : 'N/A',
                itemsCount: o.items?.length || 0,
                createdAt: o.createdAt
            }))
        });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao carregar dashboard.', error });
    }
};
export const getClients = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId || req.user?._id;
        const userType = req.user?.userType;

        if (userType !== 'agency') {
            res.status(403).json({ message: 'Acesso negado. Apenas agências podem gerenciar clientes.' });
            return;
        }

        const clients = await AgencyClient.find({ agencyId: userId }).sort({ name: 1 });
        res.json(clients);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar clientes.', error });
    }
};

export const createClient = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId || req.user?._id;
        const userType = req.user?.userType;

        if (userType !== 'agency') {
            res.status(403).json({ message: 'Acesso negado. Apenas agências podem gerenciar clientes.' });
            return;
        }

        const { name, documentNumber, email, phone, contactName } = req.body;

        if (!name || !documentNumber) {
            res.status(400).json({ message: 'Nome e CPF/CNPJ são obrigatórios.' });
            return;
        }

        // Opcional: Validar se o documento já existe para esta mesma agência
        const existingClient = await AgencyClient.findOne({ agencyId: userId, documentNumber });
        if (existingClient) {
            res.status(400).json({ message: 'Já existe um cliente cadastrado com este documento.' });
            return;
        }

        const newClient = new AgencyClient({
            agencyId: userId,
            name,
            documentNumber,
            email,
            phone,
            contactName,
            status: 'active'
        });

        await newClient.save();
        res.status(201).json(newClient);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao criar cliente.', error });
    }
};

export const updateClient = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId || req.user?._id;
        const { id } = req.params;

        const updatedClient = await AgencyClient.findOneAndUpdate(
            { _id: id, agencyId: userId },
            { $set: req.body },
            { new: true }
        );

        if (!updatedClient) {
            res.status(404).json({ message: 'Cliente não encontrado ou não pertence a esta agência.' });
            return;
        }

        res.json(updatedClient);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar cliente.', error });
    }
};

export const deleteClient = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId || req.user?._id;
        const { id } = req.params;

        // Soft delete ou hard delete? Hard delete por enquanto se não tiver campanhas atreladas.
        // Melhor usar hard delete no inicial, depois mudamos para inativo se der treta de referências
        const deletedClient = await AgencyClient.findOneAndDelete({ _id: id, agencyId: userId });

        if (!deletedClient) {
            res.status(404).json({ message: 'Cliente não encontrado ou não pertence a esta agência.' });
            return;
        }

        res.json({ message: 'Cliente removido com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao deletar cliente.', error });
    }
};
