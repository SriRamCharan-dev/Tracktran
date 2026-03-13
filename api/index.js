const { connectDB } = require('../config/db');
const { createApp } = require('../server-app');

// Vercel serverless functions handle the application request
let cachedApp = null;

module.exports = async (req, res) => {
    // 1. Ensure DB is connected
    try {
        await connectDB();
    } catch (err) {
        console.error('DB connection error in Vercel function:', err);
    }

    // 2. Initialize App (only once per instance)
    if (!cachedApp) {
        cachedApp = createApp();
    }

    // 3. Handle request
    return cachedApp(req, res);
};
