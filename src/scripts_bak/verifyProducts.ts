
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User';
import { Product } from '../models/Product';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://tatico3:8b990aOzLf7Cp3f8@signalads.edtljjf.mongodb.net/?appName=SignalAds';

const verify = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        // Count products
        const productCount = await Product.countDocuments();
        console.log(`\nTotal Products: ${productCount}`);

        // Find a user with products
        const userWithProducts = await User.findOne({
            'broadcasterProfile.generalInfo.stationName': { $exists: true }
        }).lean();

        if (userWithProducts) {
            const products = await Product.find({
                broadcasterId: userWithProducts._id
            }).lean();

            console.log(`\n--- Sample Broadcaster: ${userWithProducts.broadcasterProfile?.generalInfo?.stationName} ---`);
            console.log(`Products Count: ${products.length}`);

            if (products.length > 0) {
                console.log('\nProducts:');
                products.forEach(p => {
                    console.log(`  - ${p.spotType}: R$ ${p.pricePerInsertion.toFixed(2)} (${p.duration}s, ${p.timeSlot})`);
                });
            }
        }

        // Count by type
        const comercialCount = await Product.countDocuments({ spotType: /^Comercial/ });
        const testemunhalCount = await Product.countDocuments({ spotType: /^Testemunhal/ });

        console.log(`\n--- Product Type Breakdown ---`);
        console.log(`Comercial Products: ${comercialCount}`);
        console.log(`Testemunhal Products: ${testemunhalCount}`);

        // Sample products
        console.log(`\n--- Sample Products ---`);
        const samples = await Product.find().limit(3).lean();
        samples.forEach(p => {
            console.log(JSON.stringify(p, null, 2));
        });

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
};

verify();
