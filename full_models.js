require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });

async function listAllModels() {
    try {
        const response = await ai.models.list();
        // Just print everything to be sure
        console.log("FULL_RESPONSE:", JSON.stringify(response, (key, value) => {
            if (key === 'requestInternal') return undefined; // skip potentially large/recursive
            return value;
        }));
    } catch (e) {
        console.error("Error:", e.message);
    }
}

listAllModels();
