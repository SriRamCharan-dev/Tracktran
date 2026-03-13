require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });

async function listAllModels() {
    try {
        console.log("Fetching and listing models...");
        const response = await ai.models.list();
        // The response usually has a .models property which is an array
        const modelsArr = response.models || response || [];
        
        if (Array.isArray(modelsArr)) {
            console.log("FOUND_MODELS:");
            modelsArr.forEach(m => {
                if (m.name && m.name.includes('gemini')) {
                    console.log(` - ${m.name} (Supported: ${m.supportedGenerationMethods.join(', ')})`);
                }
            });
        } else {
            console.log("Could not find models array in response.");
        }
    } catch (e) {
        console.error("Error:", e.message);
    }
}

listAllModels();
