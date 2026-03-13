require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });

async function listAllModels() {
    try {
        const response = await ai.models.list();
        fs.writeFileSync('models_debug.txt', JSON.stringify(response, (k, v) => k === 'requestInternal' ? undefined : v, 2));
    } catch (e) {
        fs.writeFileSync('models_debug.txt', "Error: " + e.message);
    }
}
listAllModels();
