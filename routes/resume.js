const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });
const User = require('../models/User');

router.get('/upload-resume', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.render('upload_resume', { error: null, success: null });
});

router.post('/upload-resume', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { resume_text } = req.body;

    if (!resume_text || !resume_text.trim()) {
        return res.render('upload_resume', { error: 'Please paste your resume text.', success: null });
    }
    
    try {
        const prompt = `Extract the following information from this resume text and return it as a pure JSON object without markdown formatting:
{
"skills": ["skill1", "skill2"],
"technologies": ["tech1", "tech2"],
"branch": "Extracted Branch or empty string"
}
        
Resume text: ${resume_text}`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
            }
        });

        let rawText = response.text;
        if (!rawText) {
            console.error('Gemini returned no text. Candidates:', JSON.stringify(response.candidates));
            return res.render('upload_resume', { error: 'AI returned an empty response. Please try again.', success: null });
        }

        // Strip markdown code fences if present
        rawText = rawText.trim();
        if (rawText.startsWith('```')) {
            rawText = rawText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        }

        const extract = JSON.parse(rawText);
        
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.render('upload_resume', { error: 'User not found. Please log in again.', success: null });
        }
        
        // combine skills and technologies
        const combinedSkills = [...new Set([...(extract.skills || []), ...(extract.technologies || [])])];
        user.skills = combinedSkills;
        if (extract.branch) {
            user.branch = extract.branch;
        }
        await user.save();
        
        res.render('upload_resume', { success: 'Resume parsed and skills updated!', error: null, extracted: extract });

    } catch (error) {
        console.error('Resume parse error:', error.message || error);
        
        let msg = 'Failed to parse resume text. Please try again.';
        if (error instanceof SyntaxError) {
            msg = 'AI returned invalid JSON. Please try again.';
        } else if (error.status === 429 || (error.message && error.message.includes('429'))) {
            msg = '⏳ AI Rate Limit Reached! Please wait one minute and try again.';
        }
        res.render('upload_resume', { error: msg, success: null });
    }
});

module.exports = router;
