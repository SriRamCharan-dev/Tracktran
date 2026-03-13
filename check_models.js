require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });

async function listModels() {
    try {
        const result = await ai.getGenerativeModel({ model: "gemini-1.5-flash" }); // arbitrary model to check SDK
        console.log("SDK is working. Now trying to list models via direct fetch if possible or just testing specific names.");
        
        const models = ['gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-2.0-flash', 'gemini-2.0-flash-exp', 'gemini-2.5-flash'];
        
        for (const m of models) {
            try {
                const test = ai.getGenerativeModel({ model: m });
                await test.generateContent('hi');
                console.log(`Model ${m} : WORKING`);
            } catch (e) {
                console.log(`Model ${m} : FAILED (${e.message})`);
            }
        }
    } catch (error) {
        console.error(error);
    }
}

listModels();
