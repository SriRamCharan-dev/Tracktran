const express = require('express');
const session = require('express-session');
const path = require('path');

// Create an Express app without starting the HTTP server.
// This is used by tests with supertest.
function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(express.json());

  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'secret',
      resave: false,
      saveUninitialized: false,
    })
  );

  app.use('/', require('./routes/auth'));
  app.use('/', require('./routes/resume'));
  app.use('/', require('./routes/opportunity'));

  app.get('/', (req, res) => {
    res.redirect('/login');
  });

  return app;
}

module.exports = { createApp };

