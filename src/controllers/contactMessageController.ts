import { Request, Response } from 'express';
import ContactMessage from '../models/ContactMessage';
import { AuthRequest } from '../middleware/auth';

export const createMessage = async (req: Request, res: Response): Promise<void> => {
    try {
        const { emitterName, email, phone, message, category, broadcasterInfo } = req.body;

        if (!emitterName || !email || !phone || !message) {
            res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
            return;
        }

        const newMessage = new ContactMessage({
            emitterName,
            email,
            phone,
            message,
            ...(category && { category }),
            ...(broadcasterInfo && { broadcasterInfo })
        });

        await newMessage.save();

        res.status(201).json({ message: 'Mensagem enviada com sucesso.', data: newMessage });
    } catch (error) {
        console.error('Erro ao salvar mensagem de contato:', error);
        res.status(500).json({ error: 'Erro interno ao salvar mensagem.' });
    }
};

export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        if (req.user?.userType !== 'admin') {
            res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
            return;
        }

        const messages = await ContactMessage.find().sort({ createdAt: -1 });
        res.status(200).json(messages);
    } catch (error) {
        console.error('Erro ao buscar mensagens de contato:', error);
        res.status(500).json({ error: 'Erro interno ao buscar mensagens.' });
    }
};

export const getMessageById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        if (req.user?.userType !== 'admin') {
            res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
            return;
        }

        const { id } = req.params;
        const message = await ContactMessage.findById(id);

        if (!message) {
            res.status(404).json({ error: 'Mensagem não encontrada.' });
            return;
        }

        // Marca como lida
        if (!message.read) {
            message.read = true;
            await message.save();
        }

        res.status(200).json(message);
    } catch (error) {
        console.error('Erro ao buscar mensagem:', error);
        res.status(500).json({ error: 'Erro interno ao buscar mensagem.' });
    }
};

export const countUnreadMessages = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        if (req.user?.userType !== 'admin') {
            res.status(403).json({ error: 'Acesso negado.' });
            return;
        }

        const count = await ContactMessage.countDocuments({ read: false });
        res.status(200).json({ unreadCount: count });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao contar mensagens.' });
    }
};

export const deleteMessage = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        if (req.user?.userType !== 'admin') {
            res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
            return;
        }

        const { id } = req.params;
        const message = await ContactMessage.findByIdAndDelete(id);

        if (!message) {
            res.status(404).json({ error: 'Mensagem não encontrada.' });
            return;
        }

        res.status(200).json({ message: 'Mensagem excluída com sucesso.' });
    } catch (error) {
        console.error('Erro ao excluir mensagem:', error);
        res.status(500).json({ error: 'Erro interno ao excluir mensagem.' });
    }
};
