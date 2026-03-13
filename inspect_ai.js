require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });
console.log("Keys in ai:", Object.keys(ai));
if (ai.models) console.log("Keys in ai.models:", Object.keys(ai.models));
if (ai.getGenerativeModel) console.log("getGenerativeModel exists");
