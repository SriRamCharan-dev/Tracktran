const express = require('express');
const router = express.Router();
const Opportunity = require('../models/Opportunity');
const User = require('../models/User');
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });

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

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
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
            return { deadline: parsed, mentioned: true };
        }
    }

    return { deadline: buildFallbackDeadline(), mentioned: false };
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

// Dashboard
router.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.redirect('/login');

        const errorMessages = {
            empty_message: 'Please paste an opportunity message or add a link first.',
            invalid_link: 'Please enter a valid opportunity link.',
            parse_failed: 'Could not parse that message. Please try again with more details.',
            invalid_opp_id: 'Invalid opportunity selected for deletion.',
            delete_failed: 'Could not delete that opportunity. Please try again.'
        };
        const successMessages = {
            opp_added: 'Opportunity added successfully!',
            opp_deleted: 'Opportunity deleted successfully!'
        };

        const error = errorMessages[req.query.error] || null;
        const success = successMessages[req.query.success] || null;
        const opportunities = await Opportunity.find().sort({ deadline: 1 });

        let totalOpportunities = opportunities.length;
        let highMatchCount = 0;
        let deadlinesThisWeek = 0;

        // Calculate match scores
        const displayOpps = opportunities.map(opp => {
            let score = 0;
            let matchLabel = 'Low Match';
            const userSkills = user.skills.map(s => s.toLowerCase());
            const authenticityScore = clampNumber(Number(opp.authenticity_score) || 0, 0, 100);
            const deadlineMentioned = typeof opp.deadline_mentioned === 'boolean'
                ? opp.deadline_mentioned
                : hasDeadlineSignal(opp.raw_message);
            const parsedDeadline = new Date(opp.deadline);
            const hasValidDeadline = deadlineMentioned && !Number.isNaN(parsedDeadline.getTime());

            let authenticityLabel = 'Needs Verification';
            let authenticityClass = 'auth-medium';
            if (authenticityScore >= 75) {
                authenticityLabel = 'Likely Authentic';
                authenticityClass = 'auth-high';
            } else if (authenticityScore < 45) {
                authenticityLabel = 'Potential Risk';
                authenticityClass = 'auth-low';
            }

            const oppSkills = (opp.required_skills && opp.required_skills.length > 0)
                ? opp.required_skills
                : [];

            let matchedSkills = [];
            let missingSkills = [];

            if (oppSkills.length > 0) {
                oppSkills.forEach(skill => {
                    const skillLower = skill.toLowerCase();
                    const hasSkill = userSkills.some(us => us.includes(skillLower) || skillLower.includes(us));
                    if (hasSkill) matchedSkills.push(skill);
                    else missingSkills.push(skill);
                });
            } else {
                const oppWords = Array.from(new Set(`${opp.eligibility} ${opp.role}`.toLowerCase().split(/\W+/)));
                for (const skill of userSkills) {
                    if (oppWords.includes(skill)) matchedSkills.push(skill);
                }
                missingSkills = ['Cannot determine required skills from text'];
            }

            if (oppSkills.length > 0) {
                score = Math.floor((matchedSkills.length / oppSkills.length) * 100);
            } else if (userSkills.length > 0) {
                score = Math.floor(Math.min((matchedSkills.length / (matchedSkills.length + 2)) * 100, 100));
            }

            if (score > 70) { matchLabel = 'High Match'; highMatchCount++; }
            else if (score > 40) matchLabel = 'Medium Match';
            else matchLabel = 'Low Match';

            const today = new Date();
            let timeDiff = null;
            let daysLeft = null;
            let totalHours = null;
            let hoursLeft = null;

            if (hasValidDeadline) {
                timeDiff = parsedDeadline.getTime() - today.getTime();
                daysLeft = Math.floor(timeDiff / (1000 * 3600 * 24));
                totalHours = Math.floor(timeDiff / (1000 * 3600));
                hoursLeft = totalHours % 24;
            }

            if (hasValidDeadline && timeDiff > 0 && daysLeft <= 7) deadlinesThisWeek++;

            let urgencyLabel = 'No Deadline';
            if (hasValidDeadline) {
                urgencyLabel = 'Normal';
                if (timeDiff <= 0) urgencyLabel = 'Passed';
                else if (totalHours < 12) urgencyLabel = 'Critical';
                else if (totalHours < 72) urgencyLabel = 'Urgent';
                else if (daysLeft <= 7) urgencyLabel = 'Upcoming';
            }

            let priority = 'Low Priority';
            if (score > 70 && hasValidDeadline && daysLeft >= 0 && daysLeft <= 7) priority = 'Apply Immediately';
            else if (score >= 40) priority = 'Consider Applying';

            return {
                ...opp.toObject(),
                matchScore: score,
                matchLabel,
                authenticityScore,
                authenticityLabel,
                authenticityClass,
                deadlineMentioned: hasValidDeadline,
                matchedSkills,
                missingSkills,
                daysLeft,
                hoursLeft,
                totalHours,
                urgencyLabel,
                priority
            };
        });

        const insights = { totalOpportunities, highMatchCount, deadlinesThisWeek };

        res.render('dashboard', { user, opportunities: displayOpps, insights, error, success });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

// Parse Opportunity Form
router.post('/parse-opportunity', async (req, res) => {
    const isBot = req.body.source === 'telegram';
    if (!req.session.userId && !isBot) return res.redirect('/login');

    const rawMessageText = normalizeString(req.body.raw_message_text);
    const sourceLink = normalizeUrlInput(req.body.source_link);

    if (!rawMessageText && !normalizeString(req.body.source_link)) {
        return isBot ? res.status(400).json({ error: 'empty_message' }) : res.redirect('/dashboard?error=empty_message');
    }
    if (!rawMessageText && normalizeString(req.body.source_link) && !sourceLink) {
        return isBot ? res.status(400).json({ error: 'invalid_link' }) : res.redirect('/dashboard?error=invalid_link');
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

        const sourceText = buildSourceText(rawMessageText, sourceLink, linkContext);
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

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                }
            });

            const rawText = stripCodeFences(response.text || '');
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

        const applicationLink = normalizeString(extract.application_link) || sourceLink || extractFirstUrl(sourceText) || 'about:blank';
        const company = normalizeString(extract.company) || extractCompanyFromText(sourceText, applicationLink) || 'Unknown Company';
        const role = normalizeString(extract.role) || extractRoleFromText(sourceText) || 'Opportunity';
        const eligibility = normalizeString(extract.eligibility) || 'Not specified in message';
        const requiredUtils = Array.isArray(extract.required_skills) ? extract.required_skills : [];
        const authenticityCheck = evaluateOpportunityAuthenticity({
            rawMessageText,
            sourceText,
            linkContext,
            company,
            role,
            eligibility,
            requiredSkills: requiredUtils,
            applicationLink
        });

        let targetDate = normalizeString(extract.deadline_date);
        let targetTime = normalizeString(extract.deadline_time) || "23:59";
        const sourceHasDeadline = hasDeadlineSignal(sourceText);

        let deadline = buildFallbackDeadline();
        let deadlineMentioned = false;

        if (sourceHasDeadline && targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) && /^\d{2}:\d{2}(?::\d{2})?$/.test(targetTime)) {
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
                const hrs = parseInt(targetTime.split(':')[0], 10);
                const mins = parseInt(targetTime.split(':')[1], 10);
                deadline.setHours(Number.isInteger(hrs) ? hrs : 23, Number.isInteger(mins) ? mins : 59, 0, 0);
            } else {
                deadline = buildFallbackDeadline();
            }
        }

        const newOpp = new Opportunity({
            company,
            role,
            required_skills: requiredUtils,
            eligibility,
            deadline,
            deadline_mentioned: deadlineMentioned,
            application_link: applicationLink,
            raw_message: rawMessageText || `Source link: ${sourceLink}`,
            authenticity_score: authenticityCheck.score,
            authenticity_reason: authenticityCheck.reason
        });
        await newOpp.save();

        if (isBot) {
            return res.status(200).json({ success: true, message: 'opp_added', data: newOpp });
        }
        res.redirect('/dashboard?success=opp_added');

    } catch (err) {
        console.error('Opportunity save error:', err);
        if (isBot) {
            return res.status(500).json({ error: 'parse_failed' });
        }
        res.redirect('/dashboard?error=parse_failed');
    }
});

router.post('/delete-opportunity/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    const { id } = req.params;
    if (!id || !/^[a-fA-F0-9]{24}$/.test(id)) {
        return res.redirect('/dashboard?error=invalid_opp_id');
    }

    try {
        const deletedOpp = await Opportunity.findByIdAndDelete(id);
        if (!deletedOpp) {
            return res.redirect('/dashboard?error=delete_failed');
        }

        return res.redirect('/dashboard?success=opp_deleted');
    } catch (err) {
        console.error('Opportunity delete error:', err);
        return res.redirect('/dashboard?error=delete_failed');
    }
});

module.exports = router;
