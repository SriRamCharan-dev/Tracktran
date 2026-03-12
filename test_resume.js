require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });

async function test() {
    try {
        const prompt = `Extract the following information from this resume text and return it as a pure JSON object without markdown formatting:
{
"skills": ["skill1", "skill2"],
"technologies": ["tech1", "tech2"],
"branch": "Extracted Branch or empty string"
}
        
Resume text: I am a software engineer studying computer science. I know python and java.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
            }
        });

        console.log("Raw Response:");
        console.log(response.text);
    } catch (e) {
        console.error("AI Error:", e);
    }
}
test();
