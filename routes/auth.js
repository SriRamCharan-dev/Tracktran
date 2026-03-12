const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });

// Register View
router.get('/register', (req, res) => {
    res.render('register', { error: null });
});

// Register Handle
router.post('/register', async (req, res) => {
    const { name, email, password, branch, year } = req.body;
    try {
        let user = await User.findOne({ email });
        if (user) {
            return res.render('register', { error: 'User already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        user = new User({
            name, email, password: hashedPassword, branch, year
        });
        await user.save();
        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.render('register', { error: 'Server error during registration' });
    }
});

// Login View
router.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Login Handle
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.render('login', { error: 'Invalid email or password' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render('login', { error: 'Invalid email or password' });
        }
        req.session.userId = user._id;
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('login', { error: 'Server error during login' });
    }
});

// Logout Handle (GET for backward compatibility, POST for form submission)
router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) throw err;
        res.redirect('/login');
    });
});

router.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) throw err;
        res.redirect('/login');
    });
});

// Static fallback: derive role suggestions directly from the user's stored skills
function getStaticRoleSuggestions(skills) {
    const s = skills.map(sk => sk.toLowerCase());
    const has = (...kws) => kws.some(kw => s.some(sk => sk.includes(kw)));

    const candidates = [
        { title: 'Frontend Developer Intern',      check: () => has('react','vue','angular','html','css','javascript','typescript','next'),  reason: 'Your web/JS skills are a strong match for frontend roles.' },
        { title: 'Backend Developer Intern',        check: () => has('node','express','django','flask','spring','java','python','php','ruby','fastapi'), reason: 'Your server-side skills align well with backend engineering.' },
        { title: 'Full Stack Developer Intern',     check: () => has('react','node','express','mongodb','sql','javascript','typescript'),    reason: 'You have both frontend and backend skills for full‑stack work.' },
        { title: 'Data Science Intern',             check: () => has('python','pandas','numpy','machine learning','ml','tensorflow','pytorch','data analysis','sklearn'), reason: 'Your data and ML skills are core to data science roles.' },
        { title: 'Machine Learning Engineer Intern',check: () => has('machine learning','deep learning','tensorflow','pytorch','ml','neural','nlp','cv'),  reason: 'Your ML/AI skills map directly to ML engineering positions.' },
        { title: 'Software Engineer Intern',        check: () => has('java','c++','c#','golang','rust','algorithms','data structures','python','kotlin'), reason: 'Your strong programming foundation fits general SWE internships.' },
        { title: 'DevOps / Cloud Intern',           check: () => has('docker','kubernetes','aws','azure','gcp','linux','ci/cd','terraform','git','devops'), reason: 'Your cloud and infra skills are a natural fit for DevOps roles.' },
        { title: 'Data Analyst Intern',             check: () => has('sql','excel','tableau','power bi','pandas','r','data','analytics'),   reason: 'Your analytical and data skills align with analyst positions.' },
        { title: 'Mobile Developer Intern',         check: () => has('android','ios','flutter','react native','swift','kotlin','mobile'),   reason: 'Your mobile framework experience suits app development roles.' },
        { title: 'UI/UX Designer Intern',           check: () => has('figma','sketch','ui','ux','design','css','html','wireframe'),         reason: 'Your design and frontend knowledge fits UI/UX roles.' },
        { title: 'Cybersecurity Intern',            check: () => has('security','linux','network','cryptography','ethical hacking','python','nmap','kali'), reason: 'Your security skills are valuable for cybersecurity positions.' },
        { title: 'Database Administrator Intern',   check: () => has('sql','mysql','postgresql','mongodb','oracle','database','redis'),     reason: 'Your database knowledge is a strong fit for DBA internships.' },
    ];

    const matched = candidates.filter(c => c.check());
    if (matched.length === 0) {
        return [{ title: 'Software Engineer Intern', reason: 'A general SWE internship is a great starting point for any CS student.' }];
    }
    return matched.slice(0, 6).map(({ title, reason }) => ({ title, reason }));
}

// Profile Page
router.get('/profile', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.redirect('/login');

        let suggestedRoles = [];
        let rolesSource = 'none'; // 'ai' | 'static' | 'none'

        if (user.skills && user.skills.length > 0) {
            // Try AI first
            try {
                const prompt = `Based on these technical skills: ${user.skills.join(', ')}, suggest exactly 6 specific internship or entry-level job roles that would be a good fit. Return ONLY a valid JSON array with no markdown:
[
  {"title": "Role Title", "reason": "One sentence explaining why this matches their skills."}
]`;
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: { responseMimeType: 'application/json' }
                });

                let rawText = (response.text || '').trim();
                if (rawText.startsWith('```')) {
                    rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                }
                if (rawText) {
                    const parsed = JSON.parse(rawText);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        suggestedRoles = parsed;
                        rolesSource = 'ai';
                    }
                }
            } catch (aiErr) {
                console.warn('Profile AI role suggestion failed, using static fallback:', aiErr.message);
            }

            // Fall back to static matching if AI returned nothing
            if (suggestedRoles.length === 0) {
                suggestedRoles = getStaticRoleSuggestions(user.skills);
                rolesSource = 'static';
            }
        }

        res.render('profile', { user, suggestedRoles, rolesSource });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
