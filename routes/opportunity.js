const express = require('express');
const router = express.Router();
const Opportunity = require('../models/Opportunity');
const User = require('../models/User');
const { GoogleGenAI } = require('@google/genai');
const { normalizeDeadlineTime, extractDeadlineTime } = require('../lib/deadlineTime');
const { buildGoogleCalendarLink } = require('../lib/googleCalendar');

const LLM_API_KEY = (process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || '').trim();
const ai = LLM_API_KEY ? new GoogleGenAI({ apiKey: LLM_API_KEY }) : null;

const SHORTENER_HOSTS = new Set([
    'bit.ly',
    'tinyurl.com',
    't.co',
    'rebrand.ly',
    'goo.gl',
    'is.gd',
    'cutt.ly',
    'shorturl.at',
    'rb.gy'
]);

const TRUSTED_JOB_HOSTS = [
    'linkedin.com',
    'indeed.com',
    'naukri.com',
    'internshala.com',
    'wellfound.com',
    'greenhouse.io',
    'lever.co',
    'myworkdayjobs.com',
    'smartrecruiters.com'
];

const SUSPICIOUS_PATTERNS = [
    { pattern: /\bregistration fee\b/i, reason: 'Asks for a registration fee' },
    { pattern: /\bpay(?:ment)?\s+(?:to|before|first)\b/i, reason: 'Asks for payment before hiring' },
    { pattern: /\bwhatsapp\b/i, reason: 'Moves application flow to WhatsApp' },
    { pattern: /\btelegram\b/i, reason: 'Moves application flow to Telegram' },
    { pattern: /\bdm me\b/i, reason: 'Requests direct DM instead of official process' },
    { pattern: /\bno interview\b/i, reason: 'Claims hiring without interview' },
    { pattern: /\bguaranteed\s+job\b/i, reason: 'Promises guaranteed job outcomes' },
    { pattern: /\burgent\s+joining\b/i, reason: 'Uses urgency pressure language' },
    { pattern: /\btraining fee\b/i, reason: 'Asks for a training fee' },
    { pattern: /\bsecurity deposit\b/i, reason: 'Asks for a security deposit' }
];

const APPLICATION_STATUSES = ['Applied', 'Interview', 'Rejected', 'Offer'];
const STATUS_SET = new Set(APPLICATION_STATUSES);

const OPPORTUNITY_SKILL_PATTERNS = [
    ['JavaScript', /\bjavascript|\bjs\b/i],
    ['TypeScript', /\btypescript\b/i],
    ['React', /\breact\b/i],
    ['Node.js', /\bnode\.?js\b/i],
    ['Express', /\bexpress\b/i],
    ['MongoDB', /\bmongo(db)?\b/i],
    ['SQL', /\bsql|mysql|postgres\b/i],
    ['Python', /\bpython\b/i],
    ['Java', /\bjava\b/i],
    ['C++', /\bc\+\+\b/i],
    ['Machine Learning', /\bmachine learning|\bml\b/i],
    ['Data Analysis', /\bdata analysis|analytics|pandas\b/i],
    ['Docker', /\bdocker\b/i],
    ['Kubernetes', /\bkubernetes|\bk8s\b/i],
    ['AWS', /\baws|amazon web services\b/i],
    ['Git', /\bgit\b/i],
    ['REST APIs', /\brest(ful)? api\b/i],
    ['GraphQL', /\bgraphql\b/i],
    ['Figma', /\bfigma\b/i],
    ['Flutter', /\bflutter\b/i]
];

function normalizeString(value, maxLen = 6000) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/[<>]/g, ' ')
        .trim()
        .slice(0, maxLen);
}

function normalizeStringArray(values, maxItems = 60, maxLen = 80) {
    if (!Array.isArray(values)) {
        return [];
    }

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

function normalizeSkillName(skill) {
    const normalized = normalizeString(skill, 80);
    if (!normalized) {
        return '';
    }

    const lower = normalized.toLowerCase();
    const aliases = {
        js: 'JavaScript',
        javascript: 'JavaScript',
        ts: 'TypeScript',
        typescript: 'TypeScript',
        nodejs: 'Node.js',
        'node.js': 'Node.js',
        reactjs: 'React',
        mongodb: 'MongoDB',
        postgres: 'SQL',
        postgresql: 'SQL',
        mysql: 'SQL',
        ml: 'Machine Learning'
    };

    return aliases[lower] || normalized;
}

function dedupeSkills(skills, maxItems = 60) {
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
            // Ignore and fall back to candidates.
        }
    }

    const parts = response.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
        return '';
    }

    return parts
        .map(part => normalizeString(part && part.text, 6000))
        .filter(Boolean)
        .join('\n')
        .trim();
}

function stripCodeFences(text) {
    const trimmed = normalizeString(text);
    if (!trimmed.startsWith('```')) return trimmed;
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function extractFirstUrl(text) {
    const match = normalizeString(text).match(/https?:\/\/[^\s)]+/i);
    return match ? match[0] : '';
}

function normalizeUrlInput(value) {
    const rawValue = normalizeString(value);
    if (!rawValue) {
        return '';
    }

    const withProtocol = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
    try {
        return new URL(withProtocol).toString();
    } catch (err) {
        return '';
    }
}

function decodeHtmlEntities(text) {
    const entities = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' '
    };

    return normalizeString(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
        const normalizedEntity = entity.toLowerCase();
        if (normalizedEntity.startsWith('#x')) {
            return String.fromCharCode(parseInt(normalizedEntity.slice(2), 16));
        }
        if (normalizedEntity.startsWith('#')) {
            return String.fromCharCode(parseInt(normalizedEntity.slice(1), 10));
        }
        return entities[normalizedEntity] || _;
    });
}

function extractMetaContent(html, key) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`<meta[^>]+name=["']${escapedKey}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escapedKey}["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+property=["']${escapedKey}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escapedKey}["'][^>]*>`, 'i')
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            return decodeHtmlEntities(match[1]);
        }
    }

    return '';
}

function stripHtmlToText(html) {
    return decodeHtmlEntities(
        html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
    );
}

async function fetchLinkContext(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(url, {
            headers: {
                'user-agent': 'Tracktern/1.0',
                accept: 'text/html,application/xhtml+xml'
            },
            redirect: 'follow',
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = decodeHtmlEntities((titleMatch && titleMatch[1]) || '');
        const headingMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const heading = stripHtmlToText((headingMatch && headingMatch[1]) || '');
        const description = extractMetaContent(html, 'description') || extractMetaContent(html, 'og:description');
        const bodyText = stripHtmlToText(html).slice(0, 8000);

        return [title, heading, description, bodyText].filter(Boolean).join('\n');
    } finally {
        clearTimeout(timeoutId);
    }
}

function cleanExtractedValue(value) {
    return normalizeString(value)
        .replace(/^[\s'"`:,;.!?()\[\]{}\-–—]+/, '')
        .replace(/[\s'"`:,;.!?()\[\]{}\-–—]+$/, '')
        .replace(/\s+/g, ' ');
}

function extractCompanyFromUrl(url) {
    const rawUrl = normalizeString(url);
    if (!rawUrl || rawUrl === 'about:blank') {
        return '';
    }

    try {
        const hostname = new URL(rawUrl).hostname.replace(/^www\./i, '');
        const parts = hostname.split('.').filter(Boolean);
        if (parts.length === 0) {
            return '';
        }

        const ignored = new Set(['com', 'in', 'org', 'net', 'co', 'io', 'ai', 'app']);
        const meaningfulParts = parts.filter(part => !ignored.has(part.toLowerCase()));
        const bestGuess = meaningfulParts.length > 0 ? meaningfulParts[meaningfulParts.length - 1] : parts[0];

        return bestGuess
            .split('-')
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    } catch (err) {
        return '';
    }
}

function extractCompanyFromText(text, applicationLink) {
    const rawText = normalizeString(text);
    const patterns = [
        /\b([A-Z][A-Za-z0-9&.'()\- ]{1,60}?)\s+is hiring\b/i,
        /\b([A-Z][A-Za-z0-9&.'()\- ]{1,60}?)\s+(?:hiring|recruiting|careers?)\b/i,
        /\bat\s+([A-Z][A-Za-z0-9&.'()\- ]{1,60}?)(?=\s+(?:for|as|who|with)\b|[.,]|$)/i
    ];

    for (const pattern of patterns) {
        const match = rawText.match(pattern);
        const value = cleanExtractedValue(match && match[1]);
        if (value) {
            return value;
        }
    }

    return extractCompanyFromUrl(applicationLink);
}

function extractRoleFromText(text) {
    const rawText = normalizeString(text);
    const patterns = [
        /\bis hiring\s+(?:for\s+)?(.+?)(?=\s+(?:who|for|with|eligible)\b|\s*[,.;]|\s+deadline\b|\s+apply\b|$)/i,
        /\bhiring\s+(?:for\s+)?(.+?)(?=\s+(?:who|for|with|eligible)\b|\s*[,.;]|\s+deadline\b|\s+apply\b|$)/i,
        /\b(?:role|position)\s*[:\-]?\s*([^\n.]+)/i
    ];

    for (const pattern of patterns) {
        const match = rawText.match(pattern);
        const value = cleanExtractedValue(match && match[1]);
        if (value) {
            return value;
        }
    }

    return '';
}

function buildSourceText(rawMessageText, sourceLink, linkContext) {
    const sections = [];

    if (normalizeString(rawMessageText)) {
        sections.push(normalizeString(rawMessageText));
    }
    if (sourceLink) {
        sections.push(`Opportunity Link: ${sourceLink}`);
    }
    if (normalizeString(linkContext)) {
        sections.push(`Fetched Link Details: ${normalizeString(linkContext)}`);
    }

    return sections.join('\n\n');
}

function buildFallbackDeadline() {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 30);
    fallback.setHours(23, 59, 0, 0);
    return fallback;
}

function hasDeadlineSignal(text) {
    const normalized = normalizeString(text);
    if (!normalized) {
        return false;
    }

    const hasKeyword = /\b(deadline|last\s*date|apply\s*by|before)\b/i.test(normalized);
    const hasDate = /\b(?:\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i.test(normalized);

    return hasKeyword || hasDate;
}

function parseDeadline(deadlineValue, rawMessageText) {
    const candidates = [];
    const fromExtract = normalizeString(deadlineValue);
    if (fromExtract) {
        candidates.push(fromExtract);
    }

    const deadlineMatch = normalizeString(rawMessageText).match(/deadline\s*[:\-]?\s*([^\.\n]+)/i);
    if (deadlineMatch && deadlineMatch[1]) {
        candidates.push(deadlineMatch[1].trim());
    }

    const anyDateMatch = normalizeString(rawMessageText).match(/\b(?:\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i);
    if (anyDateMatch) {
        candidates.push(anyDateMatch[0]);
    }

    for (const candidate of candidates) {
        const parsed = new Date(candidate);
        if (!Number.isNaN(parsed.getTime())) {
            return {
                deadline: parsed,
                mentioned: true,
                timeMentioned: Boolean(extractDeadlineTime(candidate))
            };
        }
    }

    return { deadline: buildFallbackDeadline(), mentioned: false, timeMentioned: false };
}

function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function hostnameFromUrl(value) {
    const normalized = normalizeString(value);
    if (!normalized || normalized === 'about:blank') {
        return '';
    }

    try {
        return new URL(normalized).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (err) {
        return '';
    }
}

function isShortenerHost(hostname) {
    if (!hostname) return false;

    if (SHORTENER_HOSTS.has(hostname)) {
        return true;
    }

    for (const shortHost of SHORTENER_HOSTS) {
        if (hostname.endsWith(`.${shortHost}`)) {
            return true;
        }
    }

    return false;
}

function isTrustedJobHost(hostname) {
    if (!hostname) return false;

    return TRUSTED_JOB_HOSTS.some(trustedHost => hostname === trustedHost || hostname.endsWith(`.${trustedHost}`));
}

function companyMatchesHostname(company, hostname) {
    const rawCompany = normalizeString(company).toLowerCase();
    if (!rawCompany || !hostname) {
        return false;
    }

    const genericTokens = new Set([
        'inc',
        'llc',
        'ltd',
        'limited',
        'private',
        'technologies',
        'technology',
        'solutions',
        'systems',
        'labs',
        'global',
        'company'
    ]);

    const companyTokens = rawCompany
        .split(/[^a-z0-9]+/)
        .filter(token => token.length >= 4 && !genericTokens.has(token));

    if (companyTokens.length === 0) {
        return false;
    }

    return companyTokens.some(token => hostname.includes(token));
}

function evaluateOpportunityAuthenticity({
    rawMessageText,
    sourceText,
    linkContext,
    company,
    role,
    eligibility,
    requiredSkills,
    applicationLink
}) {
    let score = 50;
    const positives = [];
    const risks = [];

    const normalizedLink = normalizeString(applicationLink);
    const hasDirectLink = Boolean(normalizedLink && normalizedLink !== 'about:blank');
    const hostname = hostnameFromUrl(normalizedLink);

    if (hasDirectLink) {
        score += 15;
        positives.push('Includes a direct application link');
    } else {
        score -= 30;
        risks.push('No direct application link is provided');
    }

    if (hasDirectLink && /^https:\/\//i.test(normalizedLink)) {
        score += 10;
        positives.push('Application link uses HTTPS');
    } else if (hasDirectLink) {
        score -= 15;
        risks.push('Application link is not HTTPS');
    }

    if (hostname) {
        score += 4;
        positives.push('Application domain is visible');

        if (isShortenerHost(hostname)) {
            score -= 20;
            risks.push('Uses a shortened link domain');
        }

        if (isTrustedJobHost(hostname)) {
            score += 12;
            positives.push('Link points to a known jobs platform');
        }

        if (companyMatchesHostname(company, hostname)) {
            score += 10;
            positives.push('Company name aligns with link domain');
        } else if (!isTrustedJobHost(hostname)) {
            score -= 8;
            risks.push('Company name does not clearly align with link domain');
        }
    }

    const hasRole = normalizeString(role).length >= 3;
    const hasEligibility = normalizeString(eligibility) && normalizeString(eligibility).toLowerCase() !== 'not specified in message';
    const hasRequiredSkills = Array.isArray(requiredSkills) && requiredSkills.length > 0;

    if (hasRole && hasEligibility) {
        score += 8;
        positives.push('Role and eligibility are described');
    } else {
        score -= 10;
        risks.push('Role or eligibility details are incomplete');
    }

    if (hasRequiredSkills) {
        score += 5;
        positives.push('Required skills are listed');
    }

    if (normalizeString(linkContext).length > 160) {
        score += 8;
        positives.push('Linked page contains readable job context');
    } else if (hasDirectLink) {
        score -= 6;
        risks.push('Could not validate enough details from linked page content');
    }

    const combinedText = `${normalizeString(rawMessageText)} ${normalizeString(sourceText)} ${normalizeString(linkContext)}`;
    let suspiciousHits = 0;

    for (const signal of SUSPICIOUS_PATTERNS) {
        if (signal.pattern.test(combinedText)) {
            suspiciousHits += 1;
            risks.push(signal.reason);
        }
    }

    if (suspiciousHits > 0) {
        score -= Math.min(suspiciousHits * 12, 36);
    }

    score = clampNumber(Math.round(score), 0, 100);

    let label = 'Needs Verification';
    if (score >= 75) {
        label = 'Likely Authentic';
    } else if (score < 45) {
        label = 'Potential Risk';
    }

    const reasonParts = [];
    if (positives.length > 0) {
        reasonParts.push(`Signals: ${positives.slice(0, 3).join('; ')}`);
    }
    if (risks.length > 0) {
        reasonParts.push(`Risks: ${risks.slice(0, 3).join('; ')}`);
    }
    if (reasonParts.length === 0) {
        reasonParts.push('Insufficient metadata to score authenticity with confidence');
    }

    return {
        score,
        label,
        reason: `${label}. ${reasonParts.join('. ')}.`
    };
}

function normalizeStatus(value) {
    const normalized = normalizeString(value, 40).toLowerCase();
    if (!normalized) {
        return '';
    }

    const map = {
        applied: 'Applied',
        interview: 'Interview',
        rejected: 'Rejected',
        offer: 'Offer'
    };

    return map[normalized] || '';
}

function getOpportunityScopeQuery(userId) {
    return {
        $or: [
            { owner: userId },
            { owner: { $exists: false } }
        ]
    };
}

function inferSkillsFromText(text) {
    const source = normalizeString(text, 12000);
    if (!source) {
        return [];
    }

    const skills = [];
    for (const [skill, pattern] of OPPORTUNITY_SKILL_PATTERNS) {
        if (pattern.test(source)) {
            skills.push(skill);
        }
    }

    return dedupeSkills(skills);
}

function inferOpportunityCategory(role, requiredSkills, eligibility) {
    const combinedText = `${normalizeString(role, 240)} ${normalizeString(eligibility, 240)} ${normalizeString((requiredSkills || []).join(' '), 240)}`.toLowerCase();

    if (/frontend|react|vue|angular|ui\b|css|html/.test(combinedText)) return 'Frontend';
    if (/backend|node|express|spring|api|microservice/.test(combinedText)) return 'Backend';
    if (/full\s*stack|mern/.test(combinedText)) return 'Full Stack';
    if (/data|analytics|machine learning|ml|ai|nlp|python/.test(combinedText)) return 'Data/AI';
    if (/cloud|devops|docker|kubernetes|aws|azure|gcp/.test(combinedText)) return 'DevOps/Cloud';
    if (/mobile|android|ios|flutter|react native/.test(combinedText)) return 'Mobile';
    if (/design|ux|ui\/ux|figma/.test(combinedText)) return 'Design';

    return 'General';
}

function normalizeStatusHistory(statusHistory, fallbackStatus, createdAt) {
    const rows = Array.isArray(statusHistory)
        ? statusHistory
            .map(item => ({
                status: normalizeStatus(item && item.status),
                changedAt: item && item.changedAt ? new Date(item.changedAt) : null,
                note: normalizeString(item && item.note, 220)
            }))
            .filter(item => item.status && item.changedAt && !Number.isNaN(item.changedAt.getTime()))
        : [];

    if (rows.length === 0) {
        const defaultChangedAt = createdAt ? new Date(createdAt) : new Date();
        rows.push({
            status: fallbackStatus || 'Applied',
            changedAt: Number.isNaN(defaultChangedAt.getTime()) ? new Date() : defaultChangedAt,
            note: 'Initial status'
        });
    }

    return rows.sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());
}

function getDeadlineMeta(deadlineValue, deadlineMentioned, now) {
    const parsedDeadline = new Date(deadlineValue);
    const hasValidDeadline = Boolean(deadlineMentioned) && !Number.isNaN(parsedDeadline.getTime());

    if (!hasValidDeadline) {
        return {
            parsedDeadline,
            hasValidDeadline: false,
            daysLeft: null,
            hoursLeft: null,
            totalHours: null,
            urgencyLabel: 'No Deadline'
        };
    }

    const timeDiff = parsedDeadline.getTime() - now.getTime();
    const totalHours = Math.floor(timeDiff / (1000 * 3600));
    const daysLeft = Math.floor(timeDiff / (1000 * 3600 * 24));
    const hoursLeft = totalHours % 24;

    let urgencyLabel = 'Normal';
    if (timeDiff <= 0) urgencyLabel = 'Passed';
    else if (totalHours < 12) urgencyLabel = 'Critical';
    else if (totalHours < 72) urgencyLabel = 'Urgent';
    else if (daysLeft <= 7) urgencyLabel = 'Upcoming';

    return {
        parsedDeadline,
        hasValidDeadline,
        daysLeft,
        hoursLeft,
        totalHours,
        urgencyLabel
    };
}

function computeMatchDetails(userSkills, oppSkills, role, eligibility) {
    const normalizedUserSkills = dedupeSkills(userSkills || []).map(skill => skill.toLowerCase());
    const normalizedOppSkills = dedupeSkills(oppSkills || []);
    const matchedSkills = [];
    const missingSkills = [];

    if (normalizedOppSkills.length > 0) {
        for (const skill of normalizedOppSkills) {
            const lowerSkill = skill.toLowerCase();
            const hasSkill = normalizedUserSkills.some(userSkill => userSkill.includes(lowerSkill) || lowerSkill.includes(userSkill));

            if (hasSkill) matchedSkills.push(skill);
            else missingSkills.push(skill);
        }
    }

    const skillScore = normalizedOppSkills.length > 0
        ? (matchedSkills.length / normalizedOppSkills.length) * 100
        : 0;

    const roleText = `${normalizeString(role, 160)} ${normalizeString(eligibility, 160)}`.toLowerCase();
    const roleKeywordMatches = normalizedUserSkills.filter(skill => roleText.includes(skill)).length;
    const roleBonus = Math.min(roleKeywordMatches * 8, 24);
    const score = clampNumber(Math.round(skillScore + roleBonus), 0, 100);

    let matchLabel = 'Low Match';
    if (score >= 75) matchLabel = 'High Match';
    else if (score >= 45) matchLabel = 'Medium Match';

    const recommendedImprovements = missingSkills.slice(0, 3).map(skill => `Add a project bullet showing impact with ${skill}.`);

    return {
        score,
        matchLabel,
        matchedSkills,
        missingSkills: missingSkills.length > 0 ? missingSkills : ['Your profile already covers the core listed skills.'],
        recommendedImprovements: recommendedImprovements.length > 0
            ? recommendedImprovements
            : ['Quantify outcomes in your resume to increase recruiter confidence.']
    };
}

function buildMonthlyApplicationsSeries(opportunities, monthsBack = 6) {
    const monthKeys = [];
    const counts = {};
    const cursor = new Date();

    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    cursor.setMonth(cursor.getMonth() - (monthsBack - 1));

    for (let i = 0; i < monthsBack; i += 1) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
        monthKeys.push(key);
        counts[key] = 0;
        cursor.setMonth(cursor.getMonth() + 1);
    }

    for (const opp of opportunities) {
        const createdAt = new Date(opp.createdAt);
        if (Number.isNaN(createdAt.getTime())) continue;

        const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
        if (Object.prototype.hasOwnProperty.call(counts, key)) {
            counts[key] += 1;
        }
    }

    return {
        labels: monthKeys.map(key => {
            const [year, month] = key.split('-').map(Number);
            return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short' });
        }),
        values: monthKeys.map(key => counts[key])
    };
}

function countTopValues(values, limit = 6) {
    const map = new Map();
    for (const value of values) {
        const key = normalizeString(value, 120);
        if (!key) continue;
        map.set(key, (map.get(key) || 0) + 1);
    }

    return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([name, count]) => ({ name, count }));
}

// Dashboard
router.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const userLookup = User.findById(req.session.userId);
        const userPromise = userLookup && typeof userLookup.lean === 'function'
            ? userLookup.lean()
            : userLookup;

        const [userDoc, opportunityDocs] = await Promise.all([
            userPromise,
            Opportunity.find(getOpportunityScopeQuery(req.session.userId)).sort({ deadline: 1 })
        ]);

        if (!userDoc) return res.redirect('/login');

        const resumeAnalysis = userDoc.resumeAnalysis && typeof userDoc.resumeAnalysis === 'object'
            ? userDoc.resumeAnalysis
            : {};

        const user = {
            ...userDoc,
            skills: dedupeSkills(userDoc.skills || []),
            resumeAnalysis: {
                score: clampNumber(Number(resumeAnalysis.score) || 0, 0, 100),
                strengths: normalizeStringArray(resumeAnalysis.strengths, 8, 220),
                weaknesses: normalizeStringArray(resumeAnalysis.weaknesses, 8, 220),
                suggestions: normalizeStringArray(resumeAnalysis.suggestions, 8, 240),
                detectedSkills: dedupeSkills(resumeAnalysis.detectedSkills || []),
                missingSkills: dedupeSkills(resumeAnalysis.missingSkills || []),
                improvedBullets: Array.isArray(resumeAnalysis.improvedBullets)
                    ? resumeAnalysis.improvedBullets
                        .map(item => ({
                            original: normalizeString(item && item.original, 320),
                            improved: normalizeString(item && item.improved, 320)
                        }))
                        .filter(item => item.original && item.improved)
                        .slice(0, 6)
                    : [],
                analyzedAt: resumeAnalysis.analyzedAt || null
            }
        };

        const userSkillsForMatching = dedupeSkills([
            ...(user.skills || []),
            ...(user.resumeAnalysis.detectedSkills || [])
        ]);

        const statusFilter = normalizeStatus(req.query.status) || 'All';

        const errorMessages = {
            empty_message: 'Please paste an opportunity message or add a link first.',
            invalid_link: 'Please enter a valid opportunity link.',
            parse_failed: 'Could not parse that message. Please try again with more details.',
            invalid_opp_id: 'Invalid opportunity selected for deletion.',
            delete_failed: 'Could not delete that opportunity. Please try again.',
            opp_exists: 'This opportunity is already in your dashboard.',
            invalid_status: 'Invalid status selected. Please use Applied, Interview, Rejected, or Offer.',
            status_update_failed: 'Could not update opportunity status. Please try again.'
        };
        const successMessages = {
            opp_added: 'Opportunity added successfully!',
            opp_deleted: 'Opportunity deleted successfully!',
            status_updated: 'Opportunity status updated successfully!'
        };

        const error = errorMessages[req.query.error] || null;
        const success = successMessages[req.query.success] || null;

        let totalOpportunities = opportunityDocs.length;
        let highMatchCount = 0;
        let deadlinesThisWeek = 0;
        const now = new Date();

        const displayOpps = opportunityDocs.map(oppDoc => {
            const opp = typeof oppDoc.toObject === 'function' ? oppDoc.toObject() : oppDoc;
            const authenticityScore = clampNumber(Number(opp.authenticity_score) || 0, 0, 100);
            const deadlineMentioned = typeof opp.deadline_mentioned === 'boolean'
                ? opp.deadline_mentioned
                : hasDeadlineSignal(opp.raw_message);
            const deadlineMeta = getDeadlineMeta(opp.deadline, deadlineMentioned, now);

            let authenticityLabel = 'Needs Verification';
            let authenticityClass = 'auth-medium';
            if (authenticityScore >= 75) {
                authenticityLabel = 'Likely Authentic';
                authenticityClass = 'auth-high';
            } else if (authenticityScore < 45) {
                authenticityLabel = 'Potential Risk';
                authenticityClass = 'auth-low';
            }

            const oppSkills = dedupeSkills((opp.required_skills && opp.required_skills.length > 0)
                ? opp.required_skills
                : inferSkillsFromText(`${opp.role} ${opp.eligibility} ${opp.raw_message}`));

            const match = computeMatchDetails(userSkillsForMatching, oppSkills, opp.role, opp.eligibility);

            if (match.score >= 75) {
                highMatchCount += 1;
            }

            if (deadlineMeta.hasValidDeadline && deadlineMeta.totalHours > 0 && deadlineMeta.daysLeft <= 7) {
                deadlinesThisWeek += 1;
            }

            let priority = 'Low Priority';
            if (match.score >= 75 && deadlineMeta.hasValidDeadline && deadlineMeta.daysLeft >= 0 && deadlineMeta.daysLeft <= 7) {
                priority = 'Apply Immediately';
            } else if (match.score >= 45) {
                priority = 'Consider Applying';
            }

            const applicationStatus = normalizeStatus(opp.application_status) || 'Applied';
            const statusHistory = normalizeStatusHistory(opp.status_history, applicationStatus, opp.createdAt);
            const category = normalizeString(opp.category, 80) || inferOpportunityCategory(opp.role, oppSkills, opp.eligibility);

            return {
                ...opp,
                required_skills: oppSkills,
                matchScore: match.score,
                matchLabel: match.matchLabel,
                authenticityScore,
                authenticityLabel,
                authenticityClass,
                deadlineMentioned: deadlineMeta.hasValidDeadline,
                matchedSkills: match.matchedSkills,
                missingSkills: match.missingSkills,
                recommendedImprovements: match.recommendedImprovements,
                daysLeft: deadlineMeta.daysLeft,
                hoursLeft: deadlineMeta.hoursLeft,
                totalHours: deadlineMeta.totalHours,
                urgencyLabel: deadlineMeta.urgencyLabel,
                priority,
                applicationStatus,
                statusHistory,
                category,
                calendarLink: deadlineMeta.hasValidDeadline ? buildGoogleCalendarLink({
                    company:            opp.company,
                    role:               opp.role,
                    deadline:           deadlineMeta.parsedDeadline,
                    application_link:   opp.application_link,
                    eligibility:        opp.eligibility,
                    category:           category,
                    required_skills:    oppSkills,
                    authenticity_score: authenticityScore
                }) : ''
            };
        });

        const filteredOpportunities = statusFilter === 'All'
            ? displayOpps
            : displayOpps.filter(opp => opp.applicationStatus === statusFilter);

        const statusCounts = {
            Applied: 0,
            Interview: 0,
            Rejected: 0,
            Offer: 0
        };
        for (const opp of displayOpps) {
            statusCounts[opp.applicationStatus] = (statusCounts[opp.applicationStatus] || 0) + 1;
        }

        const totalApplications = displayOpps.length;
        const interviewCount = statusCounts.Interview || 0;
        const offerCount = statusCounts.Offer || 0;
        const successRate = totalApplications > 0 ? Math.round((offerCount / totalApplications) * 100) : 0;
        const interviewConversionRate = interviewCount > 0 ? Math.round((offerCount / interviewCount) * 100) : 0;

        const mostAppliedRoles = countTopValues(displayOpps.map(opp => opp.role), 4);
        const mostCommonSkills = countTopValues([
            ...(user.skills || []),
            ...(user.resumeAnalysis.detectedSkills || [])
        ], 8);
        const categoryCounts = countTopValues(displayOpps.map(opp => opp.category), 6);
        const skillDistribution = countTopValues(displayOpps.flatMap(opp => opp.required_skills || []), 8);
        const monthlySeries = buildMonthlyApplicationsSeries(displayOpps, 6);

        const recommendedOpps = displayOpps
            .filter(opp => opp.priority === 'Apply Immediately' || opp.matchScore >= 55)
            .sort((a, b) => {
                if (b.matchScore !== a.matchScore) {
                    return b.matchScore - a.matchScore;
                }
                return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
            })
            .slice(0, 3);

        const analytics = {
            totalApplications,
            interviewCount,
            offerCount,
            resumeScore: user.resumeAnalysis.score || 0,
            detectedSkillsCount: (user.skills || []).length,
            successRate,
            interviewConversionRate,
            mostAppliedRoles,
            mostCommonSkills
        };

        const insights = { totalOpportunities, highMatchCount, deadlinesThisWeek };
        const chartData = {
            statusDistribution: {
                labels: APPLICATION_STATUSES,
                values: APPLICATION_STATUSES.map(status => statusCounts[status] || 0)
            },
            monthlyApplications: monthlySeries,
            categoryDistribution: {
                labels: categoryCounts.map(item => item.name),
                values: categoryCounts.map(item => item.count)
            },
            skillDistribution: {
                labels: skillDistribution.map(item => item.name),
                values: skillDistribution.map(item => item.count)
            }
        };

        res.render('dashboard', {
            user,
            opportunities: filteredOpportunities,
            recommendedOpps,
            insights,
            analytics,
            chartData,
            statusFilter,
            statusOptions: ['All', ...APPLICATION_STATUSES],
            error,
            success
        });
    } catch (err) {
        console.error('Dashboard route error:', err);
        res.status(500).send("Server Error");
    }
});

// Parse Opportunity Form
router.post('/parse-opportunity', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    const rawMessageText = normalizeString(req.body && req.body.raw_message_text, 5000);
    const sourceLinkInput = normalizeString(req.body && req.body.source_link, 700);
    const sourceLink = normalizeUrlInput(sourceLinkInput);

    if (!rawMessageText && !sourceLinkInput) {
        return res.redirect('/dashboard?error=empty_message');
    }
    if (!rawMessageText && sourceLinkInput && !sourceLink) {
        return res.redirect('/dashboard?error=invalid_link');
    }

    try {
        let linkContext = '';
        if (sourceLink) {
            try {
                linkContext = await fetchLinkContext(sourceLink);
            } catch (linkErr) {
                console.warn('Opportunity link fetch failed. Falling back to raw inputs only:', linkErr.message);
            }
        }

            const sourceText = buildSourceText(rawMessageText, sourceLink, linkContext).slice(0, 14000);
        const prompt = `Extract the following information from the opportunity content and return ONLY a valid JSON object with exactly these keys:
{
"company": "Company Name",
"role": "Role Name",
"required_skills": ["C++", "Python", "Machine Learning"],
"eligibility": "Eligibility requirements",
"deadline_date": "YYYY-MM-DD",
"deadline_time": "HH:MM",
"application_link": "URL"
}

Rules:
- Do not include markdown code fences.
- Use empty string for missing values.
- If time is missing, default to "23:59".
- Prefer the direct opportunity/application link when one is present.

Content: ${sourceText}`;
        let extract = {};

        if (ai) {
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: {
                        responseMimeType: 'application/json',
                    }
                });

                const rawText = stripCodeFences(parseAiText(response));
                if (rawText) {
                    try {
                        extract = JSON.parse(rawText);
                    } catch (jsonErr) {
                        console.warn('Invalid JSON from LLM while parsing opportunity:', rawText);
                    }
                } else {
                    console.warn('Empty LLM response while parsing opportunity. Falling back to text extraction.');
                }
            } catch (aiErr) {
                console.warn('LLM opportunity parse failed. Falling back to text extraction:', aiErr.message);
            }
        }

        const applicationLink = normalizeUrlInput(extract.application_link) || sourceLink || normalizeUrlInput(extractFirstUrl(sourceText)) || 'about:blank';
        const company = normalizeString(extract.company, 180) || extractCompanyFromText(sourceText, applicationLink) || 'Unknown Company';
        const role = normalizeString(extract.role, 180) || extractRoleFromText(sourceText) || 'Opportunity';
        const eligibility = normalizeString(extract.eligibility, 1200) || 'Not specified in message';
        const requiredSkills = dedupeSkills(Array.isArray(extract.required_skills) ? extract.required_skills : inferSkillsFromText(`${role} ${eligibility} ${sourceText}`));
        const category = inferOpportunityCategory(role, requiredSkills, eligibility);

        const authenticityCheck = evaluateOpportunityAuthenticity({
            rawMessageText,
            sourceText,
            linkContext,
            company,
            role,
            eligibility,
            requiredSkills,
            applicationLink
        });

        let targetDate = normalizeString(extract.deadline_date, 20);
        let targetTime = normalizeDeadlineTime(normalizeString(extract.deadline_time, 20)) || extractDeadlineTime(sourceText);
        const sourceHasDeadline = hasDeadlineSignal(sourceText);

        let deadline = buildFallbackDeadline();
        let deadlineMentioned = false;

        if (sourceHasDeadline && targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) && targetTime) {
            const directParsedDeadline = new Date(`${targetDate}T${targetTime}:00`);
            if (!Number.isNaN(directParsedDeadline.getTime())) {
                deadline = directParsedDeadline;
                deadlineMentioned = true;
            }
        }

        if (!deadlineMentioned) {
            const parsedDeadlineResult = parseDeadline(targetDate, sourceText);
            deadlineMentioned = sourceHasDeadline && parsedDeadlineResult.mentioned;

            if (deadlineMentioned) {
                deadline = parsedDeadlineResult.deadline;
                if (targetTime) {
                    const hrs = parseInt(targetTime.split(':')[0], 10);
                    const mins = parseInt(targetTime.split(':')[1], 10);
                    deadline.setHours(Number.isInteger(hrs) ? hrs : 23, Number.isInteger(mins) ? mins : 59, 0, 0);
                } else if (!parsedDeadlineResult.timeMentioned) {
                    deadline.setHours(23, 59, 0, 0);
                }
            } else {
                deadline = buildFallbackDeadline();
            }
        }

        // Duplicate check
        const existingOpp = await Opportunity.findOne({
            company,
            role,
            application_link: applicationLink,
            ...getOpportunityScopeQuery(req.session.userId)
        }).select('_id');

        if (existingOpp) {
            return res.redirect('/dashboard?error=opp_exists');
        }

        const newOpp = new Opportunity({
            owner: req.session.userId,
            company,
            role,
            required_skills: requiredSkills,
            eligibility,
            deadline,
            deadline_mentioned: deadlineMentioned,
            application_link: applicationLink,
            raw_message: rawMessageText || `Source link: ${sourceLink}`,
            authenticity_score: authenticityCheck.score,
            authenticity_reason: authenticityCheck.reason,
            category,
            application_status: 'Applied',
            status_history: [{ status: 'Applied', changedAt: new Date(), note: 'Opportunity added' }]
        });

        await newOpp.save();
        res.redirect('/dashboard?success=opp_added');
    } catch (err) {
        console.error('Opportunity save error:', err);
        res.redirect('/dashboard?error=parse_failed');
    }
});

router.post('/update-opportunity-status/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    const { id } = req.params;
    const requestedStatus = normalizeStatus(req.body && req.body.application_status);
    const rawFilter = normalizeString(req.body && req.body.return_status_filter, 20);
    const returnFilter = rawFilter === 'All' ? 'All' : normalizeStatus(rawFilter);
    const filterSuffix = returnFilter ? `&status=${encodeURIComponent(returnFilter)}` : '';

    if (!id || !/^[a-fA-F0-9]{24}$/.test(id)) {
        return res.redirect(`/dashboard?error=invalid_opp_id${filterSuffix}`);
    }
    if (!requestedStatus || !STATUS_SET.has(requestedStatus)) {
        return res.redirect(`/dashboard?error=invalid_status${filterSuffix}`);
    }

    try {
        const opportunity = await Opportunity.findOne({
            _id: id,
            ...getOpportunityScopeQuery(req.session.userId)
        });

        if (!opportunity) {
            return res.redirect(`/dashboard?error=status_update_failed${filterSuffix}`);
        }

        const currentStatus = normalizeStatus(opportunity.application_status) || 'Applied';
        if (currentStatus !== requestedStatus) {
            const statusNote = normalizeString(req.body && req.body.status_note, 220) || `Updated from ${currentStatus} to ${requestedStatus}`;

            opportunity.application_status = requestedStatus;
            opportunity.status_history = Array.isArray(opportunity.status_history) ? opportunity.status_history : [];
            opportunity.status_history.push({
                status: requestedStatus,
                changedAt: new Date(),
                note: statusNote
            });

            if (opportunity.status_history.length > 30) {
                opportunity.status_history = opportunity.status_history.slice(-30);
            }

            await opportunity.save();
        }

        return res.redirect(`/dashboard?success=status_updated${filterSuffix}`);
    } catch (err) {
        console.error('Opportunity status update error:', err);
        return res.redirect(`/dashboard?error=status_update_failed${filterSuffix}`);
    }
});

router.post('/delete-opportunity/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    const { id } = req.params;
    const rawFilter = normalizeString(req.body && req.body.return_status_filter, 20);
    const returnFilter = rawFilter === 'All' ? 'All' : normalizeStatus(rawFilter);
    const filterSuffix = returnFilter ? `&status=${encodeURIComponent(returnFilter)}` : '';

    if (!id || !/^[a-fA-F0-9]{24}$/.test(id)) {
        return res.redirect(`/dashboard?error=invalid_opp_id${filterSuffix}`);
    }

    try {
        const deletedOpp = await Opportunity.findOneAndDelete({
            _id: id,
            ...getOpportunityScopeQuery(req.session.userId)
        });

        if (!deletedOpp) {
            return res.redirect(`/dashboard?error=delete_failed${filterSuffix}`);
        }

        return res.redirect(`/dashboard?success=opp_deleted${filterSuffix}`);
    } catch (err) {
        console.error('Opportunity delete error:', err);
        return res.redirect(`/dashboard?error=delete_failed${filterSuffix}`);
    }
});

module.exports = router;
