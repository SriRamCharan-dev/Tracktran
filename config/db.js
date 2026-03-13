const mongoose = require('mongoose');

function normalize(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isAtlasUri(uri) {
    const normalized = normalize(uri).toLowerCase();
    return normalized.startsWith('mongodb+srv://') || normalized.includes('.mongodb.net');
}

const connectDB = async () => {
    try {
        const atlasUri = normalize(process.env.MONGODB_ATLAS_URI);
        const fallbackUri = normalize(process.env.MONGO_URI);
        const mongoUri = atlasUri || fallbackUri;

        if (!mongoUri) {
            throw new Error('Missing Mongo URI. Set MONGODB_ATLAS_URI in .env.');
        }

        if (!isAtlasUri(mongoUri)) {
            console.warn('Warning: non-Atlas Mongo URI detected. Set MONGODB_ATLAS_URI to a MongoDB Atlas connection string.');
        }

        const conn = await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 10000
        });

        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (err) {
        console.error(` [DB] connection failed: ${err.message}`);
        if (process.env.VERCEL) {
            throw err;
        }
        process.exit(1);
    }
};

module.exports = {
    connectDB,
    normalize,
    isAtlasUri,
};
