import { Schema, model, Document, Types } from 'mongoose';

export interface IProfileRequest extends Document {
    broadcasterId: Types.ObjectId;
    status: 'pending' | 'approved' | 'rejected';

    // As informações solicitadas
    requestedData: any;

    rejectionReason?: string;
    reviewedBy?: Types.ObjectId;
    reviewedAt?: Date;

    createdAt: Date;
    updatedAt: Date;
}

const profileRequestSchema = new Schema<IProfileRequest>(
    {
        broadcasterId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        status: {
            type: String,
            required: true,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending'
        },
        requestedData: {
            type: Schema.Types.Mixed,
            required: true
        },
        rejectionReason: {
            type: String
        },
        reviewedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        reviewedAt: {
            type: Date
        }
    },
    {
        timestamps: true
    }
);

profileRequestSchema.index({ broadcasterId: 1, status: 1 });
profileRequestSchema.index({ status: 1 });

export const ProfileRequest = model<IProfileRequest>('ProfileRequest', profileRequestSchema);
