import mongoose, { Document, Schema } from 'mongoose';

export interface IContactMessage extends Document {
    emitterName: string;
    email: string;
    phone: string;
    message: string;
    category: 'contact' | 'new_broadcaster' | 'existing_broadcaster';
    broadcasterInfo?: {
        stationName?: string;
        dial?: string;
        city?: string;
    };
    read: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ContactMessageSchema: Schema = new Schema({
    emitterName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    message: { type: String, required: true },
    category: {
        type: String,
        enum: ['contact', 'new_broadcaster', 'existing_broadcaster'],
        default: 'contact'
    },
    broadcasterInfo: {
        stationName: { type: String },
        dial: { type: String },
        city: { type: String }
    },
    read: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model<IContactMessage>('ContactMessage', ContactMessageSchema);
