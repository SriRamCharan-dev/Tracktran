require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });

async function listAllModels() {
    try {
        const response = await ai.models.list();
        const modelsArr = response.models || response || [];
        let output = "";
        if (Array.isArray(modelsArr)) {
            modelsArr.forEach(m => {
                output += `${m.name}\n`;
            });
        }
        fs.writeFileSync('models_list.txt', output);
        console.log("Written to models_list.txt");
    } catch (e) {
        fs.writeFileSync('models_list.txt', "Error: " + e.message);
    }
}
listAllModels();
