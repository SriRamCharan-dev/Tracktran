require('dotenv').config();
const { connectDB } = require('./config/db');
const { createApp } = require('./server-app');

// Connect to DB then start HTTP server
connectDB().then(() => {
  const app = createApp();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
  require('./telegram-bot/bot');
});
