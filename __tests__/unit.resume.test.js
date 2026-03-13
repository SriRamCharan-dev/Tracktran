/**
 * UNIT TESTS – Resume analysis pure functions (routes/resume.js logic)
 * Tests: normalizeMultilineText, stripCodeFences, extractSkillsHeuristically,
 *        detectBranch, normalizeSkillName, dedupeSkills, mergeResumeAnalysis
 */
'use strict';

// ─── Pure helpers (duplicated from resume.js for isolated testing) ─────────

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
        js: 'JavaScript', javascript: 'JavaScript',
        typescript: 'TypeScript',
        nodejs: 'Node.js', 'node.js': 'Node.js',
        mongo: 'MongoDB', mongodb: 'MongoDB',
        reactjs: 'React', 'react.js': 'React',
        postgresql: 'PostgreSQL', postgres: 'PostgreSQL',
        ml: 'Machine Learning', nlp: 'NLP', dsa: 'DSA',
    };
    return aliases[lower] || normalized;
}

function dedupeSkills(skills, maxItems = 80) {
    const deduped = new Map();
    for (const skill of skills || []) {
        const normalized = normalizeSkillName(skill);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (!deduped.has(key)) deduped.set(key, normalized);
        if (deduped.size >= maxItems) break;
    }
    return Array.from(deduped.values());
}

const SKILL_PATTERNS = [
    ['JavaScript', /\b(javascript|js|ecmascript)\b/i],
    ['TypeScript', /\btypescript\b/i],
    ['Node.js', /\b(node\.?js|nodejs)\b/i],
    ['React', /\breact(\.js)?\b/i],
    ['Python', /\bpython\b/i],
    ['Java', /\bjava\b/i],
    ['Machine Learning', /\bmachine learning|ml\b/i],
    ['Docker', /\bdocker\b/i],
    ['Git', /\bgit\b/i],
    ['AWS', /\baws|amazon web services\b/i],
    ['MongoDB', /\bmongo(db)?\b/i],
    ['HTML', /\bhtml5?|markup\b/i],
    ['CSS', /\bcss3?|sass|scss\b/i],
];

function extractSkillsHeuristically(cleanText) {
    const detected = [];
    for (const [skill, pattern] of SKILL_PATTERNS) {
        if (pattern.test(cleanText)) detected.push(skill);
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
        /\bai(?: and|\/)ml\b/i,
    ];
    for (const pattern of branchPatterns) {
        const match = cleanText.match(pattern);
        if (match && match[0]) return normalizeString(match[0], 80);
    }
    return '';
}

// mergeResumeAnalysis – mirrors resume.js logic
function mergeResumeAnalysis(heuristic, ai) {
    const safeArray = (a, b) => {
        const arr = Array.isArray(a) && a.length > 0 ? a : (Array.isArray(b) ? b : []);
        return arr.slice(0, 10);
    };

    const hScore = Number(heuristic.score) || 0;
    const aScore = Number(ai.score) || 0;
    const mergedScore = aScore > 0
        ? Math.round(aScore * 0.7 + hScore * 0.3)
        : hScore;

    return {
        score: Math.max(0, Math.min(100, mergedScore)),
        strengths:      safeArray(ai.strengths,      heuristic.strengths),
        weaknesses:     safeArray(ai.weaknesses,     heuristic.weaknesses),
        suggestions:    safeArray(ai.suggestions,    heuristic.suggestions),
        detectedSkills: dedupeSkills([...(heuristic.detectedSkills || []), ...(ai.detectedSkills || [])]),
        missingSkills:  safeArray(ai.missingSkills,  heuristic.missingSkills),
        improvedBullets: safeArray(ai.improvedBullets, heuristic.improvedBullets),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('normalizeMultilineText', () => {
    test('normalises CRLF to LF', () => {
        const result = normalizeMultilineText('line1\r\nline2');
        expect(result).not.toContain('\r');
        expect(result).toContain('line1');
        expect(result).toContain('line2');
    });
    test('replaces bullet symbols with dashes', () => {
        expect(normalizeMultilineText('• item one\n● item two')).toBe('- item one\n- item two');
    });
    test('collapses triple newlines to double', () => {
        expect(normalizeMultilineText('a\n\n\n\nb')).toBe('a\n\nb');
    });
    test('strips < and >', () => {
        const result = normalizeMultilineText('<b>bold</b>');
        expect(result).not.toContain('<');
        expect(result).not.toContain('>');
        expect(result).toMatch(/bold/);
    });
    test('trims whitespace', () => {
        expect(normalizeMultilineText('  hello  ')).toBe('hello');
    });
    test('returns "" for non-string', () => {
        expect(normalizeMultilineText(null)).toBe('');
        expect(normalizeMultilineText(42)).toBe('');
    });
    test('truncates to maxLen', () => {
        const long = 'a'.repeat(40000);
        expect(normalizeMultilineText(long, 100)).toHaveLength(100);
    });
});

describe('stripCodeFences', () => {
    test('strips ```json ... ``` fences', () => {
        const raw = '```json\n{"key":"value"}\n```';
        expect(stripCodeFences(raw)).toBe('{"key":"value"}');
    });
    test('strips plain ``` ... ``` fences', () => {
        const raw = '```\nsome text\n```';
        expect(stripCodeFences(raw)).toBe('some text');
    });
    test('returns text unchanged when no fences', () => {
        expect(stripCodeFences('{"key":"value"}')).toBe('{"key":"value"}');
    });
    test('returns "" for null', () => {
        expect(stripCodeFences(null)).toBe('');
    });
    test('returns "" for empty string', () => {
        expect(stripCodeFences('')).toBe('');
    });
});

describe('extractSkillsHeuristically', () => {
    test('detects Python from resume text', () => {
        const skills = extractSkillsHeuristically('Experienced in Python and machine learning');
        expect(skills).toContain('Python');
        expect(skills).toContain('Machine Learning');
    });

    test('detects JavaScript (alias js)', () => {
        const skills = extractSkillsHeuristically('Built frontend apps with JS and React');
        expect(skills).toContain('JavaScript');
        expect(skills).toContain('React');
    });

    test('detects Node.js', () => {
        const skills = extractSkillsHeuristically('Used Node.js to build APIs');
        expect(skills).toContain('Node.js');
    });

    test('detects Docker', () => {
        const skills = extractSkillsHeuristically('Containerized apps using Docker and AWS ECS');
        expect(skills).toContain('Docker');
        expect(skills).toContain('AWS');
    });

    test('returns [] for resume text with no detectable skills', () => {
        const skills = extractSkillsHeuristically('I am a hardworking student looking for opportunities');
        expect(skills).toEqual([]);
    });

    test('deduplicates repeated mentions', () => {
        const skills = extractSkillsHeuristically('JavaScript JS ECMAScript javascript');
        const jsCount = skills.filter(s => s === 'JavaScript').length;
        expect(jsCount).toBe(1);
    });
});

describe('detectBranch', () => {
    test('detects "computer science"', () => {
        expect(detectBranch('B.Tech in Computer Science Engineering')).toMatch(/computer science/i);
    });
    test('detects "information technology"', () => {
        expect(detectBranch('Studying Information Technology at JNTU')).toMatch(/information technology/i);
    });
    test('detects "electronics and communication"', () => {
        expect(detectBranch('Electronics and Communication student')).toMatch(/electronics/i);
    });
    test('returns "" for unrecognised branch', () => {
        expect(detectBranch('John Doe – Software Developer resume')).toBe('');
    });
    test('returns "" for empty input', () => {
        expect(detectBranch('')).toBe('');
    });
});

describe('normalizeSkillName (resume)', () => {
    test('"mongo" → "MongoDB"', () => expect(normalizeSkillName('mongo')).toBe('MongoDB'));
    test('"dsa" → "DSA"', () => expect(normalizeSkillName('dsa')).toBe('DSA'));
    test('"nlp" → "NLP"', () => expect(normalizeSkillName('nlp')).toBe('NLP'));
    test('"react.js" → "React"', () => expect(normalizeSkillName('react.js')).toBe('React'));
    test('unknown skill returned unchanged', () => expect(normalizeSkillName('Figma')).toBe('Figma'));
});

describe('mergeResumeAnalysis', () => {
    const heuristic = {
        score: 40,
        strengths: ['Has projects'],
        weaknesses: ['No metrics'],
        suggestions: ['Add numbers'],
        detectedSkills: ['Python'],
        missingSkills: ['Docker'],
        improvedBullets: [],
    };
    const ai = {
        score: 60,
        strengths: ['Strong skills section'],
        weaknesses: ['Weak summary'],
        suggestions: ['Quantify impact'],
        detectedSkills: ['React', 'Python'],
        missingSkills: ['Kubernetes'],
        improvedBullets: [{ original: 'Built app', improved: 'Built app serving 500 users' }],
    };

    test('blends AI score (70%) and heuristic score (30%)', () => {
        const merged = mergeResumeAnalysis(heuristic, ai);
        const expected = Math.round(60 * 0.7 + 40 * 0.3);     // 54
        expect(merged.score).toBe(expected);
    });

    test('prefers AI strengths when available', () => {
        const merged = mergeResumeAnalysis(heuristic, ai);
        expect(merged.strengths).toEqual(ai.strengths);
    });

    test('falls back to heuristic strengths when AI has none', () => {
        const merged = mergeResumeAnalysis(heuristic, { ...ai, strengths: [] });
        expect(merged.strengths).toEqual(heuristic.strengths);
    });

    test('merges and deduplicates detectedSkills', () => {
        const merged = mergeResumeAnalysis(heuristic, ai);
        expect(merged.detectedSkills).toContain('Python');
        expect(merged.detectedSkills).toContain('React');
        const pythonCount = merged.detectedSkills.filter(s => s === 'Python').length;
        expect(pythonCount).toBe(1);
    });

    test('score is clamped to 0-100', () => {
        const merged = mergeResumeAnalysis({ score: 200 }, { score: 150 });
        expect(merged.score).toBe(100);
    });

    test('uses heuristic score when AI score is 0', () => {
        const merged = mergeResumeAnalysis(heuristic, { ...ai, score: 0 });
        expect(merged.score).toBe(heuristic.score);
    });
});
