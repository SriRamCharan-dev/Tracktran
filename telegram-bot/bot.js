require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const token = process.env.TELEGRAM_BOT_TOKEN;

const bot = new TelegramBot(token, { polling: true });

console.log("Telegram bot running...");

// keywords for filtering opportunity messages
const keywords = ["intern", "internship", "hiring", "apply", "deadline", "role"];

const handleMessage = async (msg) => {
  const text = msg.text || msg.caption;

  if (!text) return;

  console.log("Message received:", text);

  const lowerText = text.toLowerCase();
  const isOpportunity = keywords.some((word) => lowerText.includes(word));

  if (!isOpportunity) return;

  console.log("Opportunity detected:", text);

  try {
    await axios.post("http://localhost:3000/parse-opportunity", {
      raw_message_text: text,
      source: "telegram",
    });

    console.log("Sent opportunity to Tracktern backend");
  } catch (err) {
    console.error("Error sending opportunity:", err.message);
  }
};

bot.on("message", handleMessage);
bot.on("channel_post", handleMessage);
