const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { GoogleGenAI } = require('@google/genai');

const LLM_API_KEY = (process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || '').trim();
const ai = LLM_API_KEY ? new GoogleGenAI({ apiKey: LLM_API_KEY }) : null;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;

function normalizeString(value, maxLen = 500) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/[<>]/g, '')
        .trim()
        .slice(0, maxLen);
}

function normalizeEmail(value) {
    return normalizeString(value, 254).toLowerCase();
}

function normalizeStringArray(values, maxItems = 100, maxLen = 80) {
    if (!Array.isArray(values)) return [];

    const deduped = new Set();
    for (const value of values) {
        const cleaned = normalizeString(value, maxLen);
        if (cleaned) {
            deduped.add(cleaned);
        }
        if (deduped.size >= maxItems) {
            break;
        }
    }
    return Array.from(deduped);
}

function parseAiText(response) {
    if (!response) {
        return '';
    }

    if (typeof response.text === 'string') {
        return response.text.trim();
    }

    if (typeof response.text === 'function') {
        try {
            const maybeText = response.text();
            if (typeof maybeText === 'string') {
                return maybeText.trim();
            }
        } catch (err) {
            // Ignore and fallback to candidates parsing.
        }
    }

    const candidateParts = response.candidates?.[0]?.content?.parts;
    if (!Array.isArray(candidateParts)) {
        return '';
    }

    return candidateParts
        .map(part => normalizeString(part && part.text, 4000))
        .filter(Boolean)
        .join('\n')
        .trim();
}

function stripCodeFences(text) {
    const trimmed = normalizeString(text, 12000);
    if (!trimmed.startsWith('```')) return trimmed;
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function normalizeResumeAnalysis(analysis) {
    const safe = analysis && typeof analysis === 'object' ? analysis : {};

    return {
        score: Number.isFinite(Number(safe.score)) ? Math.max(0, Math.min(100, Number(safe.score))) : 0,
        strengths: normalizeStringArray(safe.strengths, 8, 220),
        weaknesses: normalizeStringArray(safe.weaknesses, 8, 220),
        suggestions: normalizeStringArray(safe.suggestions, 8, 240),
        detectedSkills: normalizeStringArray(safe.detectedSkills, 80, 60),
        missingSkills: normalizeStringArray(safe.missingSkills, 80, 60),
        improvedBullets: Array.isArray(safe.improvedBullets)
            ? safe.improvedBullets
                .map(item => ({
                    original: normalizeString(item && item.original, 320),
                    improved: normalizeString(item && item.improved, 320)
                }))
                .filter(item => item.original && item.improved)
                .slice(0, 6)
            : [],
        analyzedAt: safe.analyzedAt || null
    };
}

// Register View
router.get('/register', (req, res) => {
    res.render('register', { error: null });
});

// Register Handle
router.post('/register', async (req, res) => {
    const name = normalizeString(req.body && req.body.name, 120);
    const email = normalizeEmail(req.body && req.body.email);
    const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
    const branch = normalizeString(req.body && req.body.branch, 120);
    const year = normalizeString(req.body && req.body.year, 40);

    if (!name || !email || !password) {
        return res.render('register', { error: 'Name, email, and password are required.' });
    }
    if (!EMAIL_REGEX.test(email)) {
        return res.render('register', { error: 'Please enter a valid email address.' });
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
        return res.render('register', { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.` });
    }

    try {
        let user = await User.findOne({ email }).select('_id');
        if (user) {
            return res.render('register', { error: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        user = new User({
            name,
            email,
            password: hashedPassword,
            branch,
            year
        });

        await user.save();
        res.redirect('/login');
    } catch (err) {
        console.error('Registration error:', err);

        if (err && err.code === 11000) {
            return res.render('register', { error: 'User already exists' });
        }
        res.render('register', { error: 'Server error during registration' });
    }
});

// Login View
router.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Login Handle
router.post('/login', async (req, res) => {
    const email = normalizeEmail(req.body && req.body.email);
    const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';

    if (!email || !password) {
        return res.render('login', { error: 'Email and password are required.' });
    }
    if (!EMAIL_REGEX.test(email)) {
        return res.render('login', { error: 'Please enter a valid email address.' });
    }

    try {
        const userLookup = User.findOne({ email });
        const user = userLookup && typeof userLookup.select === 'function'
            ? await userLookup.select('+password')
            : await userLookup;
        if (!user || !user.password) {
            return res.render('login', { error: 'Invalid email or password' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render('login', { error: 'Invalid email or password' });
        }

        // Fix: Use req.session.save to ensure session is persisted before redirect.
        // Also explicitly use string for userId to prevent object serialization issues.
        req.session.userId = String(user._id);
        req.session.save((err) => {
            if (err) {
                console.error('Session save error during login:', err);
                return res.render('login', { error: 'Could not establish session. Please try again.' });
            }
            res.redirect('/dashboard');
        });
    } catch (err) {
        console.error('Login error:', err);
        res.render('login', { error: 'Server error during login' });
    }
});

// Logout Handle (GET for backward compatibility, POST for form submission)
function logoutHandler(req, res) {
    if (!req.session) {
        return res.redirect('/login');
    }

    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).render('login', { error: 'Unable to logout right now. Please try again.' });
        }

        res.clearCookie('connect.sid');
        return res.redirect('/login');
    });
}

router.get('/logout', logoutHandler);
router.post('/logout', logoutHandler);

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
        const dbUser = await User.findById(req.session.userId).lean();
        if (!dbUser) return res.redirect('/login');

        const user = {
            ...dbUser,
            skills: normalizeStringArray(dbUser.skills, 120, 70),
            resumeAnalysis: normalizeResumeAnalysis(dbUser.resumeAnalysis)
        };

        let suggestedRoles = [];
        let rolesSource = 'none'; // 'ai' | 'static' | 'none'

        if (user.skills && user.skills.length > 0) {
            // Try AI first
            if (ai) {
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

                    const rawText = stripCodeFences(parseAiText(response));
                    if (rawText) {
                        const parsed = JSON.parse(rawText);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            suggestedRoles = parsed
                                .map(item => ({
                                    title: normalizeString(item && item.title, 120),
                                    reason: normalizeString(item && item.reason, 220)
                                }))
                                .filter(item => item.title && item.reason)
                                .slice(0, 6);

                            if (suggestedRoles.length > 0) {
                                rolesSource = 'ai';
                            }
                        }
                    }
                } catch (aiErr) {
                    console.warn('Profile AI role suggestion failed, using static fallback:', aiErr.message);
                }
            }

            // Fall back to static matching if AI returned nothing
            if (suggestedRoles.length === 0) {
                suggestedRoles = getStaticRoleSuggestions(user.skills);
                rolesSource = 'static';
            }
        }

        res.render('profile', { user, suggestedRoles, rolesSource });
    } catch (err) {
        console.error('Profile route error:', err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
