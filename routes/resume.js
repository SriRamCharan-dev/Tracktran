const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');

const User = require('../models/User');

const LLM_API_KEY = (process.env.LLM_API_KEY || '').trim();
const ai = LLM_API_KEY ? new GoogleGenAI({ apiKey: LLM_API_KEY }) : null;

const SKILL_PATTERNS = [
    ['JavaScript', /\b(javascript|js|ecmascript)\b/i],
    ['TypeScript', /\btypescript\b/i],
    ['Node.js', /\b(node\.?js|nodejs)\b/i],
    ['Express', /\bexpress(\.js)?\b/i],
    ['React', /\breact(\.js)?\b/i],
    ['Next.js', /\bnext\.?js\b/i],
    ['Angular', /\bangular\b/i],
    ['Vue.js', /\bvue(\.js)?\b/i],
    ['HTML', /\bhtml5?|markup\b/i],
    ['CSS', /\bcss3?|sass|scss|tailwind\b/i],
    ['MongoDB', /\bmongo(db)?\b/i],
    ['MySQL', /\bmysql\b/i],
    ['PostgreSQL', /\bpostgres(ql)?\b/i],
    ['Redis', /\bredis\b/i],
    ['Python', /\bpython\b/i],
    ['Java', /\bjava\b/i],
    ['C++', /\bc\+\+\b/i],
    ['C', /\bc language\b/i],
    ['C#', /\bc#\b/i],
    ['Go', /\bgolang|go language\b/i],
    ['Rust', /\brust\b/i],
    ['Django', /\bdjango\b/i],
    ['Flask', /\bflask\b/i],
    ['FastAPI', /\bfastapi\b/i],
    ['Spring Boot', /\bspring boot|springboot\b/i],
    ['REST APIs', /\brest(ful)? api(s)?\b/i],
    ['GraphQL', /\bgraphql\b/i],
    ['Machine Learning', /\bmachine learning|ml\b/i],
    ['Deep Learning', /\bdeep learning\b/i],
    ['TensorFlow', /\btensorflow\b/i],
    ['PyTorch', /\bpytorch\b/i],
    ['NLP', /\bnlp|natural language processing\b/i],
    ['Data Analysis', /\bdata analysis|analytics\b/i],
    ['Pandas', /\bpandas\b/i],
    ['NumPy', /\bnumpy\b/i],
    ['Scikit-learn', /\bscikit|sklearn\b/i],
    ['Power BI', /\bpower\s*bi\b/i],
    ['Tableau', /\btableau\b/i],
    ['Git', /\bgit\b/i],
    ['GitHub', /\bgithub\b/i],
    ['Docker', /\bdocker\b/i],
    ['Kubernetes', /\bkubernetes|k8s\b/i],
    ['AWS', /\baws|amazon web services\b/i],
    ['Azure', /\bazure\b/i],
    ['GCP', /\bgcp|google cloud\b/i],
    ['CI/CD', /\bci\/?cd|continuous integration|continuous deployment\b/i],
    ['Linux', /\blinux\b/i],
    ['Figma', /\bfigma\b/i],
    ['React Native', /\breact native\b/i],
    ['Flutter', /\bflutter\b/i],
    ['Android', /\bandroid\b/i],
    ['iOS', /\bios\b/i],
    ['Unit Testing', /\bunit test(ing)?|jest|mocha|chai\b/i],
    ['System Design', /\bsystem design\b/i],
    ['DSA', /\bdata structures? and algorithms?|\bdsa\b/i]
];

const IN_DEMAND_SKILLS = [
    'React',
    'Node.js',
    'MongoDB',
    'TypeScript',
    'REST APIs',
    'Docker',
    'AWS',
    'CI/CD',
    'System Design',
    'Unit Testing'
];

function normalizeString(value, maxLen = 1000) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/[<>]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLen);
}

function normalizeMultilineText(value, maxLen = 35000) {
    if (typeof value !== 'string') return '';

    return value
        .replace(/\r/g, '\n')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
        .replace(/[<>]/g, ' ')
        .replace(/[•●▪◦]/g, '-')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim()
        .slice(0, maxLen);
}

function normalizeStringArray(values, maxItems = 25, maxLen = 120) {
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
        .map(part => normalizeString(part && part.text, 6000))
        .filter(Boolean)
        .join('\n')
        .trim();
}

function stripCodeFences(text) {
    const trimmed = normalizeString(text, 20000);
    if (!trimmed.startsWith('```')) return trimmed;
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function normalizeSkillName(skill) {
    const normalized = normalizeString(skill, 60);
    if (!normalized) return '';

    const lower = normalized.toLowerCase();
    const aliases = {
        js: 'JavaScript',
        javascript: 'JavaScript',
        typescript: 'TypeScript',
        nodejs: 'Node.js',
        'node.js': 'Node.js',
        mongo: 'MongoDB',
        mongodb: 'MongoDB',
        reactjs: 'React',
        'react.js': 'React',
        postgresql: 'PostgreSQL',
        postgres: 'PostgreSQL',
        ml: 'Machine Learning',
        nlp: 'NLP',
        dsa: 'DSA'
    };

    return aliases[lower] || normalized;
}

function dedupeSkills(skills, maxItems = 80) {
    const deduped = new Map();
    for (const skill of skills || []) {
        const normalized = normalizeSkillName(skill);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (!deduped.has(key)) {
            deduped.set(key, normalized);
        }
        if (deduped.size >= maxItems) {
            break;
        }
    }
    return Array.from(deduped.values());
}

function extractSkillsHeuristically(cleanText) {
    const detected = [];
    for (const [skill, pattern] of SKILL_PATTERNS) {
        if (pattern.test(cleanText)) {
            detected.push(skill);
        }
    }
    return dedupeSkills(detected);
}

function detectBranch(cleanText) {
    const branchPatterns = [
        /\bcomputer science(?: engineering)?\b/i,
        /\binformation technology\b/i,
        /\belectronics(?: and communication)?\b/i,
        /\belectrical(?: and electronics)?\b/i,
        /\bmechanical engineering\b/i,
        /\bcivil engineering\b/i,
        /\bai(?: and|\/)ml\b/i
    ];

    for (const pattern of branchPatterns) {
        const match = cleanText.match(pattern);
        if (match && match[0]) {
            return normalizeString(match[0], 80);
        }
    }

    return '';
}

function extractCandidateBullets(cleanText) {
    const lines = cleanText
        .split('\n')
        .map(line => normalizeString(line, 280))
        .filter(Boolean)
        .filter(line => /^[-*]/.test(line) || /\b(built|developed|implemented|designed|created|optimized|worked on)\b/i.test(line));

    return lines.slice(0, 8);
}

function buildHeuristicBulletImprovements(cleanText) {
    const bullets = extractCandidateBullets(cleanText);
    const improvements = [];

    for (const bullet of bullets) {
        if (improvements.length >= 4) {
            break;
        }

        const cleanedBullet = bullet.replace(/^[-*]\s*/, '').trim();
        if (!cleanedBullet) continue;

        if (/(\d+%|\d+\+|\d+\s*(users|requests|records|ms|days|hours))/i.test(cleanedBullet)) {
            continue;
        }

        improvements.push({
            original: cleanedBullet,
            improved: `${cleanedBullet} and delivered measurable impact with clear metrics (e.g., reduced latency by 30% or served 1000+ requests/day).`
        });
    }

    if (improvements.length === 0) {
        improvements.push({
            original: 'Worked on a project using Node.js.',
            improved: 'Developed a Node.js backend service handling 1000+ API requests per day with structured logging and error handling.'
        });
    }

    return improvements;
}

function buildHeuristicAnalysis(cleanText, detectedSkills) {
    const normalizedText = cleanText.toLowerCase();
    let score = 45;
    const strengths = [];
    const weaknesses = [];
    const suggestions = [];

    if (detectedSkills.length >= 8) {
        score += 18;
        strengths.push('Strong technical breadth across multiple tools and frameworks.');
    } else {
        weaknesses.push('Technical stack appears limited or not explicitly listed.');
        suggestions.push('Add a dedicated Skills section with relevant technologies.');
    }

    if (/\b(project|projects|experience|internship)\b/.test(normalizedText)) {
        score += 12;
        strengths.push('Resume includes project or experience-oriented content.');
    } else {
        weaknesses.push('Projects and practical experience are not clearly highlighted.');
        suggestions.push('Add 2-3 detailed projects with responsibilities and outcomes.');
    }

    if (/(\d+%|\d+\+|\d+\s*(users|requests|records|ms|days|hours))/i.test(cleanText)) {
        score += 14;
        strengths.push('Contains quantified achievements, improving credibility.');
    } else {
        weaknesses.push('Achievements are not quantified with metrics.');
        suggestions.push('Add measurable outcomes such as latency reduction, users served, or productivity gains.');
    }

    if (/\b(team|collaborat|lead|mentored|organized)\b/.test(normalizedText)) {
        score += 8;
        strengths.push('Shows collaboration or leadership indicators.');
    } else {
        suggestions.push('Include collaboration, ownership, or leadership examples from projects or clubs.');
    }

    if (/\b(github|portfolio|linkedin)\b/.test(normalizedText)) {
        score += 6;
        strengths.push('Includes professional links for verification and demo readiness.');
    } else {
        suggestions.push('Add GitHub, portfolio, or LinkedIn links for better recruiter visibility.');
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    const missingSkills = IN_DEMAND_SKILLS.filter(skill => !detectedSkills.some(ds => ds.toLowerCase() === skill.toLowerCase())).slice(0, 8);

    return {
        resumeScore: score,
        strengths: normalizeStringArray(strengths, 6, 220),
        weaknesses: normalizeStringArray(weaknesses, 6, 220),
        suggestions: normalizeStringArray(suggestions, 8, 240),
        missingSkills,
        improvedBullets: buildHeuristicBulletImprovements(cleanText)
    };
}

async function getAiResumeAnalysis(cleanText) {
    if (!ai) {
        return null;
    }

    const prompt = `Analyze this resume text and return ONLY valid JSON with this exact structure:
{
  "resumeScore": 0,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "suggestions": ["..."],
  "detectedSkills": ["..."],
  "missingSkills": ["..."],
  "branch": "",
  "improvedBullets": [
    {"original": "", "improved": ""}
  ]
}

Rules:
- resumeScore must be a number from 0 to 100.
- strengths, weaknesses, suggestions each should have 3 to 6 concise items.
- improvedBullets should include up to 4 actionable rewrite examples.
- Do not include markdown or extra keys.

Resume text:
${cleanText}`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json'
            }
        });

        const rawText = stripCodeFences(parseAiText(response));
        if (!rawText) {
            return null;
        }

        const parsed = JSON.parse(rawText);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
        console.warn('AI resume analysis failed, using heuristic fallback:', err.message || err);
        return null;
    }
}

function normalizeImprovedBullets(items) {
    if (!Array.isArray(items)) return [];

    return items
        .map(item => ({
            original: normalizeString(item && item.original, 320),
            improved: normalizeString(item && item.improved, 320)
        }))
        .filter(item => item.original && item.improved)
        .slice(0, 6);
}

function mergeResumeAnalysis(heuristic, aiData, fallbackBranch, detectedSkills) {
    const aiScore = Number(aiData && aiData.resumeScore);
    const useAiScore = Number.isFinite(aiScore);
    const blendedScore = useAiScore
        ? Math.round((Math.max(0, Math.min(100, aiScore)) * 0.65) + (heuristic.resumeScore * 0.35))
        : heuristic.resumeScore;

    const strengths = normalizeStringArray(aiData && aiData.strengths, 8, 220);
    const weaknesses = normalizeStringArray(aiData && aiData.weaknesses, 8, 220);
    const suggestions = normalizeStringArray(aiData && aiData.suggestions, 10, 240);
    const aiMissingSkills = dedupeSkills(aiData && aiData.missingSkills);
    const aiImprovedBullets = normalizeImprovedBullets(aiData && aiData.improvedBullets);

    const missingSkills = aiMissingSkills.length > 0 ? aiMissingSkills : heuristic.missingSkills;
    const improvedBullets = aiImprovedBullets.length > 0 ? aiImprovedBullets : heuristic.improvedBullets;
    const branch = normalizeString(aiData && aiData.branch, 80) || fallbackBranch;

    return {
        resumeScore: blendedScore,
        strengths: strengths.length > 0 ? strengths : heuristic.strengths,
        weaknesses: weaknesses.length > 0 ? weaknesses : heuristic.weaknesses,
        suggestions: suggestions.length > 0 ? suggestions : heuristic.suggestions,
        detectedSkills,
        missingSkills,
        improvedBullets,
        branch
    };
}

router.get('/upload-resume', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.render('upload_resume', { error: null, success: null });
});

router.post('/upload-resume', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const resumeText = normalizeMultilineText(req.body && req.body.resume_text);

    if (!resumeText) {
        return res.render('upload_resume', { error: 'Please paste your resume text.', success: null });
    }
    if (resumeText.length < 120) {
        return res.render('upload_resume', { error: 'Resume text looks too short. Please paste a fuller resume for accurate analysis.', success: null });
    }
    if (resumeText.length > 32000) {
        return res.render('upload_resume', { error: 'Resume text is too long. Please keep it under 32,000 characters.', success: null });
    }
    
    try {
        const heuristicSkills = extractSkillsHeuristically(resumeText);
        const heuristicAnalysis = buildHeuristicAnalysis(resumeText, heuristicSkills);
        const aiAnalysis = await getAiResumeAnalysis(resumeText);

        const aiSkills = dedupeSkills([
            ...(aiAnalysis && aiAnalysis.detectedSkills ? aiAnalysis.detectedSkills : []),
            ...(aiAnalysis && aiAnalysis.skills ? aiAnalysis.skills : []),
            ...(aiAnalysis && aiAnalysis.technologies ? aiAnalysis.technologies : [])
        ]);
        const detectedSkills = dedupeSkills([...heuristicSkills, ...aiSkills]);
        const fallbackBranch = detectBranch(resumeText);
        const analysis = mergeResumeAnalysis(heuristicAnalysis, aiAnalysis, fallbackBranch, detectedSkills);

        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.render('upload_resume', { error: 'User not found. Please log in again.', success: null });
        }

        user.skills = analysis.detectedSkills;
        if (analysis.branch) {
            user.branch = analysis.branch;
        }
        user.resumeText = resumeText.slice(0, 20000);
        user.resumeAnalysis = {
            score: analysis.resumeScore,
            strengths: analysis.strengths,
            weaknesses: analysis.weaknesses,
            suggestions: analysis.suggestions,
            detectedSkills: analysis.detectedSkills,
            missingSkills: analysis.missingSkills,
            improvedBullets: analysis.improvedBullets,
            analyzedAt: new Date(),
            cleanTextSample: resumeText.slice(0, 12000)
        };

        await user.save();

        const extracted = {
            branch: analysis.branch || user.branch || '',
            skills: analysis.detectedSkills,
            technologies: [],
            resumeScore: analysis.resumeScore,
            strengths: analysis.strengths,
            weaknesses: analysis.weaknesses,
            suggestions: analysis.suggestions,
            missingSkills: analysis.missingSkills,
            improvedBullets: analysis.improvedBullets
        };

        res.render('upload_resume', {
            success: 'Resume analyzed successfully. Skills and AI feedback have been updated!',
            error: null,
            extracted
        });

    } catch (error) {
        console.error('Resume parse error:', error && error.stack ? error.stack : error);
        
        let msg = 'Failed to analyze resume text. Please try again.';
        if (error instanceof SyntaxError) {
            msg = 'AI returned invalid JSON. Please try again.';
        } else if (error && (error.status === 429 || (error.message && error.message.includes('429')))) {
            msg = 'AI rate limit reached. Please wait a minute and try again.';
        }

        res.render('upload_resume', { error: msg, success: null });
    }
});

module.exports = router;
