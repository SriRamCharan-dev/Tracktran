require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });

async function listAllModels() {
    try {
        console.log("Fetching models...");
        // Assuming there is a listModels or similar
        if (typeof ai.models.list === 'function') {
            const models = await ai.models.list();
            console.log("Available Models:", JSON.stringify(models, null, 2));
        } else {
            console.log("ai.models.list is not a function");
            console.log("Checking other methods...");
            // Try standard Google Generative AI listModels
            // But this is @google/genai, so let's check keys again
            console.log("Keys in ai.models:", Object.keys(ai.models));
        }
    } catch (e) {
        console.error("Error listing models:", e.message);
    }
}

listAllModels();
