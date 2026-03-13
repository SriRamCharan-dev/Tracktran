require('dotenv').config();
const { connectDB } = require('./config/db');
const { createApp } = require('./server-app');

async function startServer() {
  try {
    await connectDB();
    require('./telegramBot');
    const app = createApp();
    const port = Number(process.env.PORT) || 3000;

    app.listen(port, () => {
      console.log(`Server started on port ${port}`);
    });
  } catch (err) {
    console.error('Server startup failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

startServer();
