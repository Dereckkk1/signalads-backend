const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const UserSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.model('User', UserSchema);

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        const filter = {
            userType: 'broadcaster',
            isCatalogOnly: true
        };

        const broadcasters = await User.find(filter)
            .sort({ createdAt: -1 })
            .limit(5000)
            .lean();

        const total = await User.countDocuments(filter);

        console.log(JSON.stringify({
            found: broadcasters.length,
            totalCountInDb: total,
            sample: broadcasters.slice(0, 2).map(b => ({ name: b.companyName, products: b.productCount }))
        }, null, 2));

    } catch (error) {
        console.error(error);
    } finally {
        await mongoose.disconnect();
    }
};

run();
