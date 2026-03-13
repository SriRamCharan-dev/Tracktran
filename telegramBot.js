require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenAI } = require('@google/genai');

const Opportunity = require('./models/Opportunity');

function isTruthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

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

function normalizeStringArray(values, maxItems = 40, maxLen = 80) {
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
    const match = normalizeString(text, 12000).match(/https?:\/\/[^\s)]+/i);
    return match ? match[0] : '';
}

function normalizeUrl(value) {
    const cleaned = normalizeString(value, 600);
    if (!cleaned) return '';

    const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    try {
        return new URL(withProtocol).toString();
    } catch (err) {
        return '';
    }
}

function looksLikeOpportunityText(text) {
    const cleaned = normalizeString(text, 12000);
    if (!cleaned || cleaned.length < 24) {
        return false;
    }

    return /(intern|hiring|opportunit|role|deadline|eligibility|skills|apply|https?:\/\/)/i.test(cleaned);
}

function parseDeadline(deadlineDate, deadlineTime, rawMessage) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 30);
    fallback.setHours(23, 59, 0, 0);

    const normalizedDate = normalizeString(deadlineDate, 40);
    const normalizedTime = normalizeString(deadlineTime, 20);
    const timeMatch = normalizedTime.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    const parsedTime = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '23:59';

    // ISO format first when available.
    if (normalizedDate && /^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
        const parsed = new Date(`${normalizedDate}T${parsedTime}:00`);
        if (!Number.isNaN(parsed.getTime())) {
            return { deadline: parsed, deadlineMentioned: true };
        }
    }

    const raw = normalizeString(rawMessage, 12000);
    const inlineIso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (inlineIso && inlineIso[1]) {
        const parsed = new Date(`${inlineIso[1]}T${parsedTime}:00`);
        if (!Number.isNaN(parsed.getTime())) {
            return { deadline: parsed, deadlineMentioned: true };
        }
    }

    const deadlinePhrase = raw.match(/(?:deadline|apply\s*by|last\s*date)\s*[:\-]?\s*([^\n.]+)/i);
    if (deadlinePhrase && deadlinePhrase[1]) {
        const parsed = new Date(deadlinePhrase[1].trim());
        if (!Number.isNaN(parsed.getTime())) {
            return { deadline: parsed, deadlineMentioned: true };
        }
    }

    return { deadline: fallback, deadlineMentioned: false };
}

function buildFallbackExtract(rawMessage) {
    const cleaned = normalizeString(rawMessage, 12000);

    const companyMatch = cleaned.match(/\b([A-Z][A-Za-z0-9&.'()\- ]{1,80}?)\s+(?:is\s+)?hiring\b/i);
    const roleMatch = cleaned.match(/(?:role|position)\s*[:\-]?\s*([^\n.]+)/i)
        || cleaned.match(/hiring\s+(?:for\s+)?(.+?)(?=\s+(?:who|with|for|deadline|apply|eligibility)\b|[.,]|$)/i);
    const eligibilityMatch = cleaned.match(/eligibility\s*[:\-]?\s*([^\n.]+)/i);
    const skillsMatch = cleaned.match(/(?:required\s*)?skills?\s*[:\-]?\s*([^\n]+)/i);
    const dateMatch = cleaned.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const timeMatch = cleaned.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    const firstUrl = extractFirstUrl(cleaned);

    const requiredSkills = skillsMatch && skillsMatch[1]
        ? skillsMatch[1].split(/[,|]/).map(skill => normalizeString(skill, 80)).filter(Boolean)
        : [];

    return {
        company: normalizeString(companyMatch && companyMatch[1], 180),
        role: normalizeString(roleMatch && roleMatch[1], 180),
        required_skills: normalizeStringArray(requiredSkills, 40, 80),
        eligibility: normalizeString(eligibilityMatch && eligibilityMatch[1], 1200),
        deadline_date: normalizeString(dateMatch && dateMatch[1], 20),
        deadline_time: timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '',
        application_link: normalizeString(firstUrl, 600)
    };
}

async function extractOpportunityFromMessage(ai, rawMessage) {
    if (!ai) {
        return buildFallbackExtract(rawMessage);
    }

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

Content: ${rawMessage}`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: 'application/json' }
        });

        const rawText = stripCodeFences(parseAiText(response));
        if (!rawText) {
            throw new Error('Empty AI extraction response');
        }

        const parsed = JSON.parse(rawText);
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('AI extraction payload is not a JSON object');
        }

        return parsed;
    } catch (err) {
        console.warn(' [Bot] AI extraction failed, using fallback parser:', err && err.message ? err.message : err);
        return buildFallbackExtract(rawMessage);
    }
}

async function processOpportunityMessage({ bot, ai, chatId, rawMessage }) {
    const cleanedMessage = normalizeString(rawMessage, 6000);
    if (!cleanedMessage) {
        await bot.sendMessage(chatId, 'Please send opportunity details after /add_opp.');
        return;
    }

    await bot.sendMessage(chatId, 'Processing your opportunity...');

    try {
        const extract = await extractOpportunityFromMessage(ai, cleanedMessage);

        const company = normalizeString(extract && extract.company, 180) || 'Unknown Company';
        const role = normalizeString(extract && extract.role, 180) || 'Opportunity';
        const eligibility = normalizeString(extract && extract.eligibility, 1200) || 'Not specified';
        const requiredSkills = normalizeStringArray(extract && extract.required_skills, 40, 80);
        const applicationLink = normalizeUrl(extract && extract.application_link)
            || normalizeUrl(extractFirstUrl(cleanedMessage))
            || 'about:blank';

        const { deadline, deadlineMentioned } = parseDeadline(
            extract && extract.deadline_date,
            extract && extract.deadline_time,
            cleanedMessage
        );

        const duplicateQuery = applicationLink !== 'about:blank'
            ? { owner: { $exists: false }, company, role, application_link: applicationLink }
            : { owner: { $exists: false }, company, role, raw_message: cleanedMessage };

        const existing = await Opportunity.findOne(duplicateQuery).select('_id company role');
        if (existing) {
            await bot.sendMessage(chatId, `This opportunity is already saved: ${existing.role} at ${existing.company}.`);
            return;
        }

        const newOpp = new Opportunity({
            company,
            role,
            required_skills: requiredSkills,
            eligibility,
            deadline,
            deadline_mentioned: deadlineMentioned,
            application_link: applicationLink,
            raw_message: cleanedMessage,
            authenticity_score: 50,
            authenticity_reason: 'Added via Telegram Bot',
            category: 'General',
            application_status: 'Applied',
            status_history: [{ status: 'Applied', changedAt: new Date(), note: 'Added via Telegram' }]
        });

        await newOpp.save();
        await bot.sendMessage(chatId, `Great! I've added the ${role} role at ${company} to Tracktern.`);
    } catch (error) {
        console.error('Error processing telegram message:', error);
        await bot.sendMessage(chatId, `Error processing opportunity: ${error.message || String(error)}`);
    }
}

function shouldStartPollingBot() {
    if ((process.env.NODE_ENV || '').toLowerCase() === 'test') {
        return false;
    }

    if (process.env.VERCEL) {
        return false;
    }

    const enabledRaw = String(process.env.ENABLE_TELEGRAM_BOT || '').trim();
    if (enabledRaw && !isTruthy(enabledRaw)) {
        return false;
    }

    // Default to enabled when not explicitly disabled.
    return true;
}

// Add these placeholders if variables don't exist
const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const LLM_API_KEY = (process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || '').trim();

if (!token) {
    console.error(' [Bot] TELEGRAM_BOT_TOKEN missing in .env');
}

if (!LLM_API_KEY) {
    console.warn(' [Bot] LLM_API_KEY missing. Falling back to rule-based extraction.');
}

let bot;

if (token) {
    if (!shouldStartPollingBot()) {
        if (process.env.VERCEL) {
            console.log(' [Bot] Running on Vercel: Polling disabled. (Use webhooks for serverless)');
        } else {
            console.log(' [Bot] Polling disabled for this process. Set ENABLE_TELEGRAM_BOT=true to enable.');
        }
    } else {
        console.log(' [Bot] Initializing GenAI and Telegram Bot...');
        const ai = LLM_API_KEY ? new GoogleGenAI({ apiKey: LLM_API_KEY }) : null;
        bot = new TelegramBot(token, { polling: true });

        console.log(' [Bot] Telegram bot active and polling...');

        let pollingRetryTimer = null;
        let pollingRetryDelayMs = 15000;

        const schedulePollingRestart = () => {
            if (!bot || pollingRetryTimer) {
                return;
            }

            const waitMs = pollingRetryDelayMs;
            pollingRetryTimer = setTimeout(async () => {
                pollingRetryTimer = null;

                try {
                    await bot.startPolling();
                    pollingRetryDelayMs = 15000;
                    console.log(' [Bot] Polling resumed successfully.');
                } catch (restartErr) {
                    console.error(' [Bot] Polling restart failed:', restartErr && restartErr.message ? restartErr.message : restartErr);
                    pollingRetryDelayMs = Math.min(pollingRetryDelayMs * 2, 120000);
                    schedulePollingRestart();
                }
            }, waitMs);
        };

        bot.on('polling_error', async (error) => {
            const message = String((error && error.message) || error || 'Unknown polling error');
            console.error(' [Bot] polling_error:', message);

            // Telegram allows only one active getUpdates long-polling consumer per bot token.
            if (message.includes('409 Conflict')) {
                console.error(' [Bot] Polling conflict detected (409). Will retry with backoff.');
                try {
                    await bot.stopPolling();
                } catch (stopErr) {
                    console.error(' [Bot] Failed to stop polling after 409:', stopErr && stopErr.message ? stopErr.message : stopErr);
                }

                schedulePollingRestart();
            }
        });

        bot.on('message', async (msg) => {
            const chatId = msg && msg.chat ? msg.chat.id : null;
            const incomingText = normalizeString((msg && (msg.text || msg.caption)) || '', 12000);

            if (!chatId || !incomingText) {
                return;
            }

            if (/^\/(start|help)\b/i.test(incomingText)) {
                await bot.sendMessage(
                    chatId,
                    'Send an opportunity with /add_opp <details> or just paste the opportunity text directly.'
                );
                return;
            }

            let opportunityText = '';
            if (/^\/add_opp\b/i.test(incomingText)) {
                opportunityText = normalizeString(incomingText.replace(/^\/add_opp\b/i, ''), 6000);

                if (!opportunityText) {
                    await bot.sendMessage(chatId, 'Usage: /add_opp <paste full opportunity text>');
                    return;
                }
            } else {
                if (incomingText.startsWith('/')) {
                    return;
                }
                if (!looksLikeOpportunityText(incomingText)) {
                    return;
                }

                opportunityText = normalizeString(incomingText, 6000);
            }

            console.log(` [Bot] Received opportunity message from ${chatId}: ${opportunityText.slice(0, 80)}...`);
            await processOpportunityMessage({ bot, ai, chatId, rawMessage: opportunityText });
        });
    }
}

module.exports = bot;
