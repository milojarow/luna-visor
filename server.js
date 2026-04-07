const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const config = require('./src/config');

// Initialize DB (runs schema)
require('./src/db/connection');

const app = express();
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: config.MEDIA_DB_PATH,
  }),
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

const { requireAuth, requireSession } = require('./src/middleware/auth');

// Static files (login page must be accessible without auth)
app.use('/login.html', express.static(path.join(__dirname, 'public', 'login.html')));
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));

// Auth routes (before auth middleware)
app.use('/api/auth', require('./src/routes/auth'));

// Auth middleware for everything else
app.use(requireAuth);

// Protected static files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/clients', requireSession, require('./src/routes/clients'));
app.use('/api/files', require('./src/routes/files'));
app.use('/api/api-keys', requireSession, require('./src/routes/api-keys'));

// Error handler
app.use(require('./src/middleware/error'));

app.listen(config.PORT, '127.0.0.1', () => {
  console.log(`Luna Visor running on http://127.0.0.1:${config.PORT}`);
  const { startPeriodicScan } = require('./src/services/log-scanner');
  startPeriodicScan(5 * 60 * 1000); // scan CDN logs every 5 minutes
});
