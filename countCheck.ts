import mongoose from 'mongoose';
import { getCatalogBroadcasters } from './src/controllers/catalogBroadcasterController';
import dotenv from 'dotenv';

dotenv.config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/signalads');

        const req = {
            query: {},
            user: { userType: 'admin' }
        } as any;

        const res = {
            json: (data: any) => {
                console.log('Controller Response Sumary:', {
                    broadcastersLength: data.broadcasters.length,
                    pagination: data.pagination
                });
                if (data.broadcasters.length > 0) {
                    console.log('Sample item:', {
                        name: data.broadcasters[0].companyName,
                        productCount: data.broadcasters[0].productCount
                    });
                }
            },
            status: (code: number) => ({
                json: (err: any) => console.error(`Error ${code}:`, err)
            })
        } as any;

        await getCatalogBroadcasters(req, res);

    } catch (error) {
        console.error(error);
    } finally {
        await mongoose.disconnect();
    }
};

run();
