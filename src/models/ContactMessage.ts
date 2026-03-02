import mongoose, { Document, Schema } from 'mongoose';

export interface IContactMessage extends Document {
    emitterName: string;
    email: string;
    phone: string;
    message: string;
    read: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ContactMessageSchema: Schema = new Schema({
    emitterName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model<IContactMessage>('ContactMessage', ContactMessageSchema);
