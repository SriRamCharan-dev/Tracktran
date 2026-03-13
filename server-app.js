const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');

function getSessionSecret() {
  const configuredSecret = (process.env.SESSION_SECRET || '').trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  // Use an ephemeral secret in development to avoid hardcoded credentials.
  const fallbackSecret = `tracktern-${crypto.randomUUID()}`;
  console.warn('SESSION_SECRET is not set. Using an ephemeral fallback secret for this process only.');
  return fallbackSecret;
}

function getMongoUri() {
  const atlasUri = (process.env.MONGODB_ATLAS_URI || '').trim();
  if (atlasUri) {
    return atlasUri;
  }
  return (process.env.MONGO_URI || '').trim();
}

function createSessionStore(isProduction, ttlSeconds) {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'test') {
    return null;
  }

  const mongoUri = getMongoUri();
  if (!mongoUri) {
    if (isProduction) {
      console.warn('Session store fallback: Mongo URI missing, using in-memory store.');
    }
    return null;
  }

  try {
    if (mongoose.connection.readyState === 1 && typeof mongoose.connection.getClient === 'function') {
      return MongoStore.create({
        client: mongoose.connection.getClient(),
        collectionName: 'sessions',
        ttl: ttlSeconds,
        autoRemove: 'native'
      });
    }

    return MongoStore.create({
      mongoUrl: mongoUri,
      collectionName: 'sessions',
      ttl: ttlSeconds,
      autoRemove: 'native'
    });
  } catch (err) {
    console.error('Session store initialization failed. Falling back to in-memory store:', err && err.message ? err.message : err);
    return null;
  }
}

// Create an Express app without starting the HTTP server.
// This is used by tests with supertest.
function createApp() {
  const app = express();
  const sessionSecret = getSessionSecret();
  const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;
  const sessionStore = createSessionStore(isProduction, Math.floor(sessionTtlMs / 1000));
  
  if (isProduction) {
    app.set('trust proxy', 1);
  }

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(express.json({ limit: '1mb' }));

  const sessionOptions = {
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: sessionTtlMs
    }
  };

  if (sessionStore) {
    sessionOptions.store = sessionStore;
  }

  app.use(session(sessionOptions));

  app.use((req, res, next) => {
    res.locals.currentUserId = req.session && req.session.userId ? String(req.session.userId) : '';
    next();
  });

  app.use('/', require('./routes/auth'));
  app.use('/', require('./routes/resume'));
  app.use('/', require('./routes/opportunity'));

  app.get('/', (req, res) => {
    res.redirect('/login');
  });

  // Final error handler so route failures do not crash the server process.
  app.use((err, req, res, next) => {
    console.error('Unhandled application error:', err && err.stack ? err.stack : err);
    if (res.headersSent) {
      return next(err);
    }

    if (req.accepts('html')) {
      return res.status(500).send('Something went wrong. Please try again.');
    }
    return res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}

module.exports = { createApp };

