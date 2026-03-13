require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });

async function listAllModels() {
    try {
        const response = await ai.models.list();
        console.log("RESPONSE_TYPE:", typeof response);
        console.log("RESPONSE_KEYS:", Object.keys(response));
        
        let models = [];
        if (Array.isArray(response)) models = response;
        else if (response.models) models = response.models;
        else if (response.data) models = response.data;

        if (Array.isArray(models)) {
            models.forEach(m => {
                console.log("MODEL_ID:", m.name || m.id || m);
            });
        } else {
            console.log("Models is not an array");
        }
    } catch (e) {
        console.error("Error:", e.message);
    }
}

listAllModels();
