
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://tatico3:8b990aOzLf7Cp3f8@signalads.edtljjf.mongodb.net/?appName=SignalAds';

const verify = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        // Find one user that has latitude
        const user = await User.findOne({
            'address.latitude': { $exists: true, $ne: null }
        }).lean();

        if (user) {
            console.log('--- Sample User with Geo ---');
            console.log(JSON.stringify(user, null, 2));
            console.log('----------------------------');
        } else {
            console.log('No user with geolocation found.');
            // Fallback
            const anyUser = await User.findOne().lean();
            console.log('--- Random User ---');
            console.log(JSON.stringify(anyUser, null, 2));
        }

        const count = await User.countDocuments();
        const geoCount = await User.countDocuments({ 'address.latitude': { $exists: true } });
        console.log(`Total Users: ${count}`);
        console.log(`Users with Geo: ${geoCount}`);

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
};

verify();
