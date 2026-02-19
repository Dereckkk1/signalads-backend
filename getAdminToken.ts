import mongoose from 'mongoose';
import { User } from './src/models/User';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/signalads');

        const admin = await User.findOne({ userType: 'admin' });
        if (!admin) {
            console.error('No admin found');
            return;
        }

        const token = jwt.sign({ userId: admin._id }, process.env.JWT_SECRET || 'secret');
        console.log('TOKEN:', token);

    } catch (error) {
        console.error(error);
    } finally {
        await mongoose.disconnect();
    }
};

run();
