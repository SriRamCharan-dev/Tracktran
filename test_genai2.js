require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });

async function testApi() {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'Say JSON array of strings: ["hi"]',
        });
        console.log("SUCCESS");
        console.log(response.text);
    } catch (error) {
        console.error("ERROR:");
        console.error(error);
    }
}

testApi();
