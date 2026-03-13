require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const { GoogleGenAI } = require('@google/genai');

const Opportunity = require('./models/Opportunity');

function isTruthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function shouldStartPollingBot() {
    if ((process.env.NODE_ENV || '').toLowerCase() === 'test') {
        return false;
    }

    if (process.env.VERCEL) {
        return false;
    }

    const onRender = isTruthy(process.env.RENDER) || Boolean(process.env.RENDER_EXTERNAL_URL);
    if (onRender && !isTruthy(process.env.ENABLE_TELEGRAM_BOT)) {
        return false;
    }

    return true;
}

// Add these placeholders if variables don't exist
const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const LLM_API_KEY = (process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || '').trim();

if (!token) {
    console.error(' [Bot] TELEGRAM_BOT_TOKEN missing in .env');
}

if (!LLM_API_KEY) {
    console.error(' [Bot] LLM_API_KEY missing in .env');
}

let bot;

if (token && LLM_API_KEY) {
    if (!shouldStartPollingBot()) {
        if (process.env.VERCEL) {
            console.log(' [Bot] Running on Vercel: Polling disabled. (Use webhooks for serverless)');
        } else {
            console.log(' [Bot] Polling disabled for this process. Set ENABLE_TELEGRAM_BOT=true on exactly one bot instance to enable.');
        }
    } else {
        console.log(' [Bot] Initializing GenAI and Telegram Bot...');
        const ai = new GoogleGenAI({ apiKey: LLM_API_KEY });
        bot = new TelegramBot(token, { polling: true });

        console.log(' [Bot] Telegram bot active and polling...');

        bot.on('polling_error', async (error) => {
            const message = String((error && error.message) || error || 'Unknown polling error');
            console.error(' [Bot] polling_error:', message);

            // Telegram allows only one active getUpdates long-polling consumer per bot token.
            if (message.includes('409 Conflict')) {
                console.error(' [Bot] Polling conflict detected (409). Stopping polling for this instance.');
                try {
                    await bot.stopPolling();
                } catch (stopErr) {
                    console.error(' [Bot] Failed to stop polling after 409:', stopErr && stopErr.message ? stopErr.message : stopErr);
                }
            }
        });

    // Matches "/add_opp [whatever]"
    bot.onText(/\/add_opp (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const resp = match[1];
        console.log(` [Bot] Received /add_opp from ${chatId}: ${resp.slice(0, 50)}...`);

        // Let the user know we're processing
        bot.sendMessage(chatId, 'Processing your opportunity...');

        try {
            const prompt = "Extract the following information from the opportunity content and return ONLY a valid JSON object with exactly these keys:\n{\n\"company\": \"Company Name\",\n\"role\": \"Role Name\",\n\"required_skills\": [\"C++\", \"Python\", \"Machine Learning\"],\n\"eligibility\": \"Eligibility requirements\",\n\"deadline_date\": \"YYYY-MM-DD\",\n\"deadline_time\": \"HH:MM\",\n\"application_link\": \"URL\"\n}\n\nRules:\n- Do not include markdown code fences.\n- Use empty string for missing values.\n- If time is missing, default to \"23:59\".\n- Prefer the direct opportunity/application link when one is present.\n\nContent: " + resp;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash', 
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                }
            });

            let rawText = '';
            if (response && response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts[0]) {
                rawText = response.candidates[0].content.parts[0].text;
            } else if (typeof response.text === 'function') {
                rawText = await response.text();
            } else if (typeof response.text === 'string') {
                rawText = response.text;
            }
            
            if (!rawText) throw new Error('Empty response from AI');
            
            rawText = rawText.trim();
            // Handle common markdown fences if AI returns them despite prompt
            if (rawText.includes('```')) {
                rawText = rawText.replace(/```(?:json)?\s*/gi, '').replace(/\s*```/g, '').trim();
            }

            const extract = JSON.parse(rawText);

            // Extract logic
            const company = extract.company || 'Unknown Company';
            const role = extract.role || 'Opportunity';
            const eligibility = extract.eligibility || 'Not specified';
            const applicationLink = extract.application_link || 'about:blank';
            const requiredSkills = Array.isArray(extract.required_skills) ? extract.required_skills : [];

            let deadline = new Date();
            deadline.setDate(deadline.getDate() + 30); // Default 30 days
            
            if (extract.deadline_date && /^\\d{4}-\\d{2}-\\d{2}$/.test(extract.deadline_date)) {
               const time = extract.deadline_time || '23:59';
               const parsed = new Date(extract.deadline_date + "T" + time + ":00");
               if (!Number.isNaN(parsed.getTime())) {
                   deadline = parsed;
               }
            }

            // Save to database
            // Note: We leave owner undefined so it acts as Global
            const newOpp = new Opportunity({
                company,
                role,
                required_skills: requiredSkills,
                eligibility,
                deadline,
                deadline_mentioned: Boolean(extract.deadline_date),
                application_link: applicationLink,
                raw_message: resp,
                authenticity_score: 50, // default
                authenticity_reason: 'Added via Telegram Bot',
                category: 'General',
                application_status: 'Applied',
                status_history: [{ status: 'Applied', changedAt: new Date(), note: 'Added via Telegram' }]
            });

            await newOpp.save();

            bot.sendMessage(chatId, "Great! I've added the " + role + " role at " + company + " to Tracktern.");

        } catch (error) {
            console.error('Error processing telegram message:', error);
            bot.sendMessage(chatId, 'Error processing opportunity: ' + (error.message || error.toString()));
        }
    });
    }
}

module.exports = bot;
