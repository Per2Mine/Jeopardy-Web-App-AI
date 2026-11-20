const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dns = require('dns').promises;
const rateLimit = require('express-rate-limit');
const { getDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.JWT_SECRET) {
  console.warn('[Server] WARNING: JWT_SECRET is not set. Using ephemeral runtime secret.');
}

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.DEBUG_HTTP === '1') {
    res.on('finish', () => {
      console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (host=${req.headers.host || ''})`);
    });
  }
  next();
});

// Rate Limiters
const globalLimiter = rateLimit.rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/p2p/'),
  message: { error: 'Zu viele Anfragen von dieser IP, bitte versuche es in einer Minute erneut.' }
});

const p2pLimiter = rateLimit.rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele P2P-Anfragen. Bitte kurz warten.' }
});

const authLimiter = rateLimit.rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anmelde- oder Registrierungsversuche. Bitte warte einige Minuten.' }
});

const quizLimiter = rateLimit.rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Quiz-Aktionen. Bitte warte eine Minute.' }
});

const ttsLimiter = rateLimit.rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Sprachausgabe-Anfragen. Bitte kurz warten.' }
});

// Configurable CORS
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
  : null;

app.use(cors({
  origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Use a tight default JSON body limit; larger payloads are explicitly allowed only on quiz upload routes
const largeJsonParser = express.json({ limit: '50mb' });
const defaultJsonParser = express.json({ limit: '256kb' });
app.use((req, res, next) => {
  if (
    (req.method === 'POST' && (req.path === '/api/quizzes' || req.path === '/api/quizzes/sync')) ||
    (req.method === 'PUT' && req.path.startsWith('/api/quizzes/'))
  ) {
    return largeJsonParser(req, res, next);
  }
  return defaultJsonParser(req, res, next);
});

app.use('/api/', globalLimiter);

// --- VALIDATION UTILITIES ---

function withTimeout(promise, ms) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

// 1. Email Validator (Regex + disposable list + active DNS check)
async function validateEmail(email) {
  if (typeof email !== 'string' || !email.trim()) {
    return { valid: false, error: 'E-Mail-Adresse darf nicht leer sein.' };
  }

  const formattedEmail = email.toLowerCase().trim();
  if (formattedEmail.length > 254) {
    return { valid: false, error: 'Die E-Mail-Adresse ist zu lang.' };
  }

  // Syntax validation requiring a multi-label domain (with TLD)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(formattedEmail)) {
    return { valid: false, error: 'Bitte gib eine E-Mail-Adresse in einem gültigen Format ein.' };
  }

  const parts = formattedEmail.split('@');
  const domain = parts[1];

  // Disposable/temporary email domains blocklist
  const disposableDomains = new Set([
    'mailinator.com', '10minutemail.com', 'tempmail.com', 'guerrillamail.com',
    'sharklasers.com', 'yopmail.com', 'dispostable.com', 'getairmail.com',
    'burnermail.io', 'trashmail.com', 'temp-mail.org', 'maildrop.cc', 'tempmailaddress.com'
  ]);
  if (disposableDomains.has(domain)) {
    return { valid: false, error: 'Die Verwendung von temporären/Wegwerf-E-Mail-Adressen ist nicht gestattet.' };
  }

  // Active DNS Verification with timeout (MX -> A -> AAAA fallback)
  try {
    const mxRecords = await withTimeout(dns.resolveMx(domain), 4000);
    if (mxRecords && mxRecords.length > 0) {
      return { valid: true };
    }
  } catch (err) {
    // Fall through to A/AAAA check
  }

  try {
    const addresses = await withTimeout(dns.resolve4(domain), 4000);
    if (addresses && addresses.length > 0) {
      return { valid: true };
    }
  } catch (err) {
    // Fall through to AAAA check
  }

  try {
    const addresses6 = await withTimeout(dns.resolve6(domain), 4000);
    if (addresses6 && addresses6.length > 0) {
      return { valid: true };
    }
  } catch (err) {
    return { valid: false, error: 'Die E-Mail-Domain existiert nicht oder kann keine E-Mails empfangen.' };
  }

  return { valid: false, error: 'Die E-Mail-Domain konnte nicht validiert werden.' };
}

// 2. Username Validation (Profanity Check)
function isOffensiveUsername(username) {
  if (typeof username !== 'string' || !username) return false;

  const original = username.toLowerCase().trim();

  // Normalize common leetspeak character substitutions
  let normalized = original
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/!/g, 'i');

  const alphanumericOnly = normalized.replace(/[^a-z0-9]/g, '');

  // Substring blacklist (highly specific offensive words)
  const specificBlacklist = [
    'arschloch', 'hurensohn', 'huren', 'huso', 'miststueck', 'miststück', 'wichser', 'wixxer', 'wixer',
    'fotze', 'schlampe', 'niger', 'neger', 'nigger', 'kanacke', 'asshole', 'bitch', 'cunt', 'motherfucker', 
    'cockhead', 'scheisse', 'scheisser', 'bastard', 'pussy', 'retard', 'faggot', 'wixxen', 'ficken',
    'ficker', 'idiot', 'depp', 'penis', 'vagina'
  ];

  for (const word of specificBlacklist) {
    if (alphanumericOnly.includes(word) || original.includes(word)) {
      return true;
    }
  }

  // Exact/boundary blacklist (shorter words to avoid the Scunthorpe problem, e.g. "Sebastian" or "Marschall")
  const shortBlacklist = [
    'arsch', 'fick', 'nazi', 'hitler', 'fuck', 'shit', 'ass', 'cock', 'dick', 'slut', 'whore', 'sex'
  ];

  for (const word of shortBlacklist) {
    const regex = new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i');
    if (regex.test(original) || regex.test(normalized)) {
      return true;
    }
  }

  return false;
}

// Initialize Database on server startup
let db;
async function initDb() {
  db = await getDatabase();
  console.log('SQLite database initialized successfully.');
}

// Ensure DB is ready for API calls
app.use('/api', (req, res, next) => {
  if (!db && !req.path.startsWith('/p2p/') && req.path !== '/tts' && req.path !== '/webrtc/ice-servers') {
    return res.status(503).json({ error: 'Server startet gerade. Bitte kurz warten.' });
  }
  next();
});

// Request logging middleware (skip static assets & high-frequency P2P polling to prevent SQLite write bloat)
app.use((req, res, next) => {
  const isAsset = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map)$/i.test(req.path);
  const isNoisyRoute = req.path.startsWith('/api/p2p/') || req.path.startsWith('/peerjs');
  if (!isAsset && !isNoisyRoute && db) {
    const safePath = String(req.path || '').slice(0, 200);
    db.run('INSERT INTO request_logs (path) VALUES (?)', [safePath]).catch(() => {
      // Silent error during boot or database locks
    });
  }
  next();
});

// Lobby creation logging endpoint
app.post('/api/lobby/create', async (req, res) => {
  try {
    const { roomCode } = req.body || {};
    if (typeof roomCode !== 'string' || !/^[A-Z0-9]{4,12}$/i.test(roomCode.trim())) {
      return res.status(400).json({ error: 'Ungültiger roomCode.' });
    }

    if (db) {
      await db.run('INSERT INTO lobby_creations (room_code) VALUES (?)', [roomCode.toUpperCase().trim()]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to log lobby creation:', err);
    res.status(500).json({ error: 'Fehler beim Erfassen der Lobby-Erstellung.' });
  }
});

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Nicht autorisiert. Kein Token bereitgestellt.' });
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
    if (err || !user || user.isAdmin === true || typeof user.email !== 'string') {
      return res.status(403).json({ error: 'Sitzung abgelaufen oder ungültiges Token. Bitte melde dich erneut an.' });
    }
    req.user = user;
    next();
  });
}

// Optional Authentication Middleware (does not block if unauthorized)
function optionalAuthenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
    if (err || !user || user.isAdmin === true || typeof user.email !== 'string') {
      return next();
    }
    req.user = user;
    next();
  });
}

// --- API ROUTES ---

// 1. Register User
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, email, password, securityQuestion, securityAnswer } = req.body || {};

    if (
      typeof username !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      typeof securityQuestion !== 'string' ||
      typeof securityAnswer !== 'string'
    ) {
      return res.status(400).json({ error: 'Bitte fülle alle Pflichtfelder gültig aus.' });
    }

    const formattedEmail = email.toLowerCase().trim();
    const formattedUsername = username.trim();

    if (!formattedUsername) {
      return res.status(400).json({ error: 'Benutzername darf nicht leer sein.' });
    }

    // Validate username length and characters (consistent with lobby/game rules)
    if (formattedUsername.length < 3 || formattedUsername.length > 20) {
      return res.status(400).json({ error: 'Der Benutzername muss zwischen 3 und 20 Zeichen lang sein.' });
    }

    const usernameRegex = /^[a-zA-Z0-9_\-]+$/;
    if (!usernameRegex.test(formattedUsername)) {
      return res.status(400).json({ error: 'Der Benutzername darf nur Buchstaben, Zahlen, Unterstriche und Bindestriche enthalten.' });
    }

    if (isOffensiveUsername(formattedUsername)) {
      return res.status(400).json({ error: 'Dieser Benutzername enthält unangemessene Ausdrücke. Bitte wähle einen anderen.' });
    }

    const emailValidation = await validateEmail(formattedEmail);
    if (!emailValidation.valid) {
      return res.status(400).json({ error: emailValidation.error });
    }

    if (password.length < 6 || password.length > 72) {
      return res.status(400).json({ error: 'Das Passwort muss zwischen 6 und 72 Zeichen lang sein.' });
    }

    if (!securityQuestion.trim() || securityQuestion.trim().length > 200) {
      return res.status(400).json({ error: 'Bitte wähle eine gültige Sicherheitsfrage aus.' });
    }

    if (!securityAnswer.trim() || securityAnswer.trim().length > 200) {
      return res.status(400).json({ error: 'Bitte gib eine gültige Antwort auf deine Sicherheitsfrage ein.' });
    }

    const existingUser = await db.get('SELECT email FROM users WHERE email = ?', [formattedEmail]);
    if (existingUser) {
      return res.status(400).json({ error: 'Ein Konto mit dieser E-Mail-Adresse existiert bereits.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const formattedAnswer = securityAnswer.trim().toLowerCase();
    const securityAnswerHash = await bcrypt.hash(formattedAnswer, 10);

    try {
      await db.run(
        'INSERT INTO users (email, username, password_hash, security_question, security_answer_hash) VALUES (?, ?, ?, ?, ?)',
        [formattedEmail, formattedUsername, passwordHash, securityQuestion.trim(), securityAnswerHash]
      );
    } catch (insertErr) {
      if (String(insertErr.message || '').includes('UNIQUE')) {
        return res.status(400).json({ error: 'Ein Konto mit dieser E-Mail-Adresse existiert bereits.' });
      }
      throw insertErr;
    }

    const tokenPayload = { email: formattedEmail, username: formattedUsername };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });

    res.status(201).json({
      token,
      user: { username: formattedUsername, email: formattedEmail }
    });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ error: 'Registrierung fehlgeschlagen. Bitte versuche es später noch einmal.' });
  }
});

// 1.5 Get User's Security Question
app.post('/api/auth/security-question', authLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    const formattedEmail = typeof email === 'string' ? email.toLowerCase().trim() : '';

    if (!formattedEmail) {
      return res.status(400).json({ error: 'Bitte gib eine E-Mail-Adresse ein.' });
    }

    if (formattedEmail === 'ai-assistant@jeopardy.app') {
      return res.status(400).json({ error: 'Für dieses Konto ist keine Sicherheitsfrage eingerichtet.' });
    }

    const user = await db.get('SELECT security_question FROM users WHERE email = ?', [formattedEmail]);
    if (!user) {
      return res.status(404).json({ error: 'Es wurde kein Konto mit dieser E-Mail-Adresse gefunden.' });
    }
    if (!user.security_question) {
      return res.status(400).json({ error: 'Für dieses Konto ist keine Sicherheitsfrage eingerichtet.' });
    }
    res.json({ securityQuestion: user.security_question });
  } catch (err) {
    console.error('Security Question Fetch Error:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Sicherheitsfrage.' });
  }
});

// 1.6 Reset Password
app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  try {
    const { email, securityAnswer, newPassword } = req.body || {};
    if (typeof email !== 'string' || typeof securityAnswer !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Bitte fülle alle Pflichtfelder aus.' });
    }

    const formattedEmail = email.toLowerCase().trim();
    const formattedAnswer = securityAnswer.trim().toLowerCase();

    if (!formattedEmail || !formattedAnswer || !newPassword) {
      return res.status(400).json({ error: 'Bitte fülle alle Pflichtfelder aus.' });
    }

    if (newPassword.length < 6 || newPassword.length > 72) {
      return res.status(400).json({ error: 'Das neue Passwort muss zwischen 6 und 72 Zeichen lang sein.' });
    }

    if (formattedEmail === 'ai-assistant@jeopardy.app') {
      return res.status(400).json({ error: 'Für dieses Konto ist keine Sicherheitsfrage eingerichtet.' });
    }

    const user = await db.get('SELECT * FROM users WHERE email = ?', [formattedEmail]);
    if (!user) {
      return res.status(404).json({ error: 'Es wurde kein Konto mit dieser E-Mail-Adresse gefunden.' });
    }

    if (!user.security_answer_hash) {
      return res.status(400).json({ error: 'Für dieses Konto ist keine Sicherheitsfrage eingerichtet.' });
    }

    const match = await bcrypt.compare(formattedAnswer, user.security_answer_hash);
    if (!match) {
      return res.status(400).json({ error: 'Die Antwort auf die Sicherheitsfrage ist falsch.' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await db.run('UPDATE users SET password_hash = ? WHERE email = ?', [newPasswordHash, formattedEmail]);

    res.json({ message: 'Passwort erfolgreich zurückgesetzt.' });
  } catch (err) {
    console.error('Password Reset Error:', err);
    res.status(500).json({ error: 'Fehler beim Zurücksetzen des Passworts.' });
  }
});

// 2. Login User
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Bitte fülle alle Felder aus.' });
    }

    const formattedEmail = email.toLowerCase().trim();
    if (!formattedEmail || !password) {
      return res.status(400).json({ error: 'Bitte fülle alle Felder aus.' });
    }

    if (formattedEmail === 'ai-assistant@jeopardy.app') {
      return res.status(401).json({ error: 'Ungültige E-Mail-Adresse oder Passwort.' });
    }

    const user = await db.get('SELECT * FROM users WHERE email = ?', [formattedEmail]);
    if (!user) {
      return res.status(401).json({ error: 'Ungültige E-Mail-Adresse oder Passwort.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Ungültige E-Mail-Adresse oder Passwort.' });
    }

    // Update last login timestamp
    try {
      await db.run('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE email = ?', [formattedEmail]);
    } catch (dbErr) {
      console.warn('Failed to update last_login_at for user:', formattedEmail, dbErr);
    }

    const tokenPayload = { email: user.email, username: user.username };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });

    res.json({
      token,
      user: { username: user.username, email: user.email }
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ error: 'Anmeldung fehlgeschlagen. Bitte versuche es später noch einmal.' });
  }
});

// 3. Get Me (Restore Session)
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await db.get('SELECT email, username FROM users WHERE email = ?', [req.user.email]);
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    }
    res.json({ user });
  } catch (err) {
    console.error('Auth Me Error:', err);
    res.status(500).json({ error: 'Serverfehler.' });
  }
});

// 4. Update Username
app.put('/api/auth/username', authenticateToken, async (req, res) => {
  try {
    const { username } = req.body || {};
    if (typeof username !== 'string') {
      return res.status(400).json({ error: 'Benutzername darf nicht leer sein.' });
    }

    const formattedUsername = username.trim();
    if (!formattedUsername) {
      return res.status(400).json({ error: 'Benutzername darf nicht leer sein.' });
    }

    if (formattedUsername.length < 3 || formattedUsername.length > 20) {
      return res.status(400).json({ error: 'Der Benutzername muss zwischen 3 und 20 Zeichen lang sein.' });
    }

    const usernameRegex = /^[a-zA-Z0-9_\-]+$/;
    if (!usernameRegex.test(formattedUsername)) {
      return res.status(400).json({ error: 'Der Benutzername darf nur Buchstaben, Zahlen, Unterstriche und Bindestriche enthalten.' });
    }

    if (isOffensiveUsername(formattedUsername)) {
      return res.status(400).json({ error: 'Dieser Benutzername enthält unangemessene Ausdrücke. Bitte wähle einen anderen.' });
    }

    await db.run('UPDATE users SET username = ? WHERE email = ?', [formattedUsername, req.user.email]);
    res.json({ success: true, username: formattedUsername });
  } catch (err) {
    console.error('Update Username Error:', err);
    res.status(500).json({ error: 'Aktualisierung fehlgeschlagen.' });
  }
});

// 4.5 Delete Account
app.delete('/api/auth/account', authenticateToken, async (req, res) => {
  try {
    await db.run('DELETE FROM users WHERE email = ?', [req.user.email]);
    res.json({ success: true, message: 'Konto erfolgreich gelöscht.' });
  } catch (err) {
    console.error('Delete Account Error:', err);
    res.status(500).json({ error: 'Fehler beim Löschen des Kontos.' });
  }
});

// 5. Get Custom Quizzes
app.get('/api/quizzes', authenticateToken, async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM quizzes WHERE user_email = ? ORDER BY created_at DESC', [req.user.email]);
    const quizzes = rows.map(row => {
      let categories = [];
      try {
        categories = JSON.parse(row.categories);
      } catch (e) {
        console.warn('Corrupt quiz categories JSON for quiz:', row.id);
      }
      return {
        id: row.id,
        name: row.name,
        icon: row.icon || '📝',
        userEmail: row.user_email,
        categories,
        isComplete: row.is_complete === 1,
        isPublic: row.is_public === 1
      };
    });
    res.json(quizzes);
  } catch (err) {
    console.error('Get Quizzes Error:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Quizzes.' });
  }
});

const ALLOWED_IMAGE_DATA_URL = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i;
const ALLOWED_AUDIO_DATA_URL = /^data:audio\/(mp3|mpeg);base64,/i;

function sanitizeQuizCategories(categories) {
  return categories.map(cat => ({
    name: typeof cat.name === 'string' ? cat.name.trim() : '',
    questions: Array.isArray(cat.questions)
      ? cat.questions.map((q, idx) => {
          const clean = {
            text: typeof q.text === 'string' ? q.text.trim() : '',
            answer: typeof q.answer === 'string' ? q.answer.trim() : '',
            value: typeof q.value === 'number' && Number.isFinite(q.value) && q.value >= 0 && q.value <= 100000
              ? Math.round(q.value)
              : (idx + 1) * 100
          };
          if (typeof q.image === 'string' && q.image) clean.image = q.image;
          if (typeof q.pixelate === 'boolean') clean.pixelate = q.pixelate;
          if (typeof q.pixelateStrength === 'number' && Number.isFinite(q.pixelateStrength)) {
            clean.pixelateStrength = Math.max(1, Math.min(100, q.pixelateStrength));
          }
          if (typeof q.reducePixelationOnWrong === 'boolean') clean.reducePixelationOnWrong = q.reducePixelationOnWrong;
          if (typeof q.reducePixelationAmount === 'number' && Number.isFinite(q.reducePixelationAmount)) {
            clean.reducePixelationAmount = Math.max(1, Math.min(100, q.reducePixelationAmount));
          }
          if (typeof q.zoom === 'number' && Number.isFinite(q.zoom)) {
            clean.zoom = Math.max(1, Math.min(5, q.zoom));
          }
          if (typeof q.rotation === 'number' && Number.isFinite(q.rotation)) {
            clean.rotation = Math.max(-360, Math.min(360, q.rotation));
          }
          if (typeof q.audio === 'string' && q.audio) clean.audio = q.audio;
          if (typeof q.audioStart === 'number' && Number.isFinite(q.audioStart)) clean.audioStart = q.audioStart;
          if (typeof q.audioEnd === 'number' && Number.isFinite(q.audioEnd)) clean.audioEnd = q.audioEnd;
          if (typeof q.audioSpeed === 'number' && Number.isFinite(q.audioSpeed)) clean.audioSpeed = q.audioSpeed;
          if (typeof q.audioPitch === 'number' && Number.isFinite(q.audioPitch)) clean.audioPitch = q.audioPitch;
          return clean;
        })
      : []
  }));
}

// Draft validation: only quiz name is required, images/audio are validated if present
function validateQuizPayloadDraft(name, categories, icon) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    return 'Bitte gib der Quiz-Vorlage einen Namen.';
  }
  if (name.trim().length > 30) {
    return 'Der Quiz-Name darf maximal 30 Zeichen lang sein.';
  }
  if (icon !== undefined && (typeof icon !== 'string' || icon.length > 16)) {
    return 'Ungültiges Quiz-Icon.';
  }
  if (!categories || !Array.isArray(categories)) {
    return 'Ungültiges Format für Kategorien.';
  }
  if (categories.length > 10) {
    return 'Ein Quiz darf maximal 10 Kategorien besitzen.';
  }

  for (let c = 0; c < categories.length; c++) {
    const cat = categories[c];
    if (!cat || typeof cat !== 'object') {
      return `Ungültige Kategorie ${c + 1}.`;
    }
    if (cat.name !== undefined && (typeof cat.name !== 'string' || cat.name.trim().length > 30)) {
      return `Der Kategorie-Name von Kategorie ${c + 1} darf maximal 30 Zeichen lang sein.`;
    }
    if (cat.questions !== undefined) {
      if (!Array.isArray(cat.questions)) {
        return `Ungültige Fragenliste in Kategorie ${c + 1}.`;
      }
      if (cat.questions.length > 15) {
        return `Kategorie ${c + 1} darf maximal 15 Fragen besitzen.`;
      }
      for (let qIdx = 0; qIdx < cat.questions.length; qIdx++) {
        const q = cat.questions[qIdx];
        if (!q || typeof q !== 'object') {
          return `Ungültige Frage ${qIdx + 1} in Kategorie ${c + 1}.`;
        }
        if (q.text !== undefined && (typeof q.text !== 'string' || q.text.trim().length > 160)) {
          return `Der Frage-Text in Kategorie ${c + 1} bei Frage ${qIdx + 1} darf maximal 160 Zeichen lang sein.`;
        }
        if (q.answer !== undefined && (typeof q.answer !== 'string' || q.answer.trim().length > 100)) {
          return `Der Antwort-Text in Kategorie ${c + 1} bei Frage ${qIdx + 1} darf maximal 100 Zeichen lang sein.`;
        }
        if (q.image) {
          if (typeof q.image !== 'string' || !ALLOWED_IMAGE_DATA_URL.test(q.image)) {
            return 'Unterstützte Bildformate sind nur PNG, JPEG, WEBP und GIF.';
          }
          const base64Body = q.image.split(',')[1] || '';
          const approximateSizeBytes = base64Body.length * 0.75;
          if (approximateSizeBytes > 5 * 1024 * 1024) {
            return 'Die Bildgröße darf 5 MB nicht überschreiten.';
          }
        }
        if (q.audio) {
          if (typeof q.audio !== 'string' || !ALLOWED_AUDIO_DATA_URL.test(q.audio)) {
            return 'Unterstütztes Audioformat ist nur MP3.';
          }
          const base64Body = q.audio.split(',')[1] || '';
          const approximateSizeBytes = base64Body.length * 0.75;
          if (approximateSizeBytes > 10 * 1024 * 1024) {
            return 'Die Audiodatei darf 10 MB nicht überschreiten.';
          }
          if (q.audioStart !== undefined && (typeof q.audioStart !== 'number' || !Number.isFinite(q.audioStart) || q.audioStart < 0)) {
            return 'Ungültiger Audio-Startwert.';
          }
          if (q.audioEnd !== undefined && (typeof q.audioEnd !== 'number' || !Number.isFinite(q.audioEnd) || q.audioEnd < 0)) {
            return 'Ungültiger Audio-Endwert.';
          }
          if (q.audioStart !== undefined && q.audioEnd !== undefined && q.audioEnd < q.audioStart) {
            return 'Der Audio-Endwert darf nicht vor dem Startwert liegen.';
          }
          if (q.audioSpeed !== undefined && (typeof q.audioSpeed !== 'number' || !Number.isFinite(q.audioSpeed) || q.audioSpeed < 0.5 || q.audioSpeed > 2.0)) {
            return 'Ungültiger Audio-Geschwindigkeitswert.';
          }
          if (q.audioPitch !== undefined && (typeof q.audioPitch !== 'number' || !Number.isFinite(q.audioPitch) || q.audioPitch < -12 || q.audioPitch > 12)) {
            return 'Ungültiger Audio-Tonhöhenwert.';
          }
          if (q.audioStart !== undefined && q.audioEnd !== undefined && q.audioEnd - q.audioStart > 10.1) {
            return 'Der ausgewählte Audio-Ausschnitt darf maximal 10 Sekunden lang sein.';
          }
        }
      }
    }
  }
  return null;
}

// Completeness check: verifies all fields are filled for a playable quiz
function isQuizComplete(categories) {
  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return false;
  }
  for (const cat of categories) {
    if (!cat || typeof cat !== 'object' || !cat.name || typeof cat.name !== 'string' || !cat.name.trim()) {
      return false;
    }
    if (!cat.questions || !Array.isArray(cat.questions) || cat.questions.length === 0) {
      return false;
    }
    for (const q of cat.questions) {
      if (!q || typeof q !== 'object') return false;
      if (!q.text || typeof q.text !== 'string' || !q.text.trim()) {
        return false;
      }
      if (!q.answer || typeof q.answer !== 'string' || !q.answer.trim()) {
        return false;
      }
    }
  }
  return true;
}

// 6. Save Custom Quiz (Create)
app.post('/api/quizzes', quizLimiter, authenticateToken, async (req, res) => {
  try {
    const { name, categories, isPublic, icon } = req.body || {};

    const validationError = validateQuizPayloadDraft(name, categories, icon);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const sanitizedCategories = sanitizeQuizCategories(categories);
    const id = 'custom_' + crypto.randomUUID();
    const complete = isQuizComplete(sanitizedCategories) ? 1 : 0;
    const isPublicVal = isPublic === true ? 1 : 0;
    const safeIcon = typeof icon === 'string' && icon.trim() ? icon.trim().slice(0, 16) : '📝';

    const existingQuiz = await db.get('SELECT id FROM quizzes WHERE name = ? AND user_email = ?', [name.trim(), req.user.email]);
    if (existingQuiz) {
      return res.status(400).json({ error: `Du hast bereits ein Quiz mit dem Namen „${name.trim()}“.` });
    }

    if (isPublicVal === 1 && complete === 0) {
      return res.status(400).json({ error: 'Ein unvollständiges Quiz kann nicht öffentlich geschaltet werden.' });
    }

    await db.run(
      'INSERT INTO quizzes (id, name, user_email, categories, icon, is_complete, is_public) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name.trim(), req.user.email, JSON.stringify(sanitizedCategories), safeIcon, complete, isPublicVal]
    );
    res.status(201).json({ success: true, id, isComplete: complete === 1, isPublic: isPublicVal === 1 });
  } catch (err) {
    console.error('Create Quiz Error:', err);
    res.status(500).json({ error: 'Fehler beim Erstellen des Quizzes.' });
  }
});

// 7. Update Custom Quiz
app.put('/api/quizzes/:id', quizLimiter, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, categories, isPublic, icon } = req.body || {};

    const validationError = validateQuizPayloadDraft(name, categories, icon);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const sanitizedCategories = sanitizeQuizCategories(categories);
    const complete = isQuizComplete(sanitizedCategories) ? 1 : 0;
    const isPublicVal = isPublic === true ? 1 : 0;
    const safeIcon = typeof icon === 'string' && icon.trim() ? icon.trim().slice(0, 16) : '📝';

    const quiz = await db.get('SELECT id, user_email FROM quizzes WHERE id = ?', [id]);
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz nicht gefunden.' });
    }
    if (quiz.user_email !== req.user.email) {
      return res.status(403).json({ error: 'Keine Berechtigung, dieses Quiz zu bearbeiten.' });
    }

    const existingQuiz = await db.get('SELECT id FROM quizzes WHERE name = ? AND user_email = ? AND id != ?', [name.trim(), req.user.email, id]);
    if (existingQuiz) {
      return res.status(400).json({ error: `Du hast bereits ein Quiz mit dem Namen „${name.trim()}“.` });
    }

    if (isPublicVal === 1 && complete === 0) {
      return res.status(400).json({ error: 'Ein unvollständiges Quiz kann nicht öffentlich geschaltet werden.' });
    }

    await db.run(
      'UPDATE quizzes SET name = ?, categories = ?, icon = ?, is_complete = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name.trim(), JSON.stringify(sanitizedCategories), safeIcon, complete, isPublicVal, id]
    );
    res.json({ success: true, isComplete: complete === 1, isPublic: isPublicVal === 1 });
  } catch (err) {
    console.error('Update Quiz Error:', err);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Quizzes.' });
  }
});

// 8. Delete Custom Quiz
app.delete('/api/quizzes/:id', quizLimiter, authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const quiz = await db.get('SELECT id, user_email FROM quizzes WHERE id = ?', [id]);
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz nicht gefunden.' });
    }
    if (quiz.user_email !== req.user.email) {
      return res.status(403).json({ error: 'Keine Berechtigung, dieses Quiz zu löschen.' });
    }

    await db.run('DELETE FROM quizzes WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete Quiz Error:', err);
    res.status(500).json({ error: 'Fehler beim Löschen des Quizzes.' });
  }
});

// 8b. Toggle Custom Quiz Public Status
app.patch('/api/quizzes/:id/public', quizLimiter, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { isPublic } = req.body || {};

    if (typeof isPublic !== 'boolean') {
      return res.status(400).json({ error: 'Ungültiger Parameter isPublic.' });
    }

    const isPublicVal = isPublic ? 1 : 0;

    const quiz = await db.get('SELECT id, user_email, is_complete FROM quizzes WHERE id = ?', [id]);
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz nicht gefunden.' });
    }
    if (quiz.user_email !== req.user.email) {
      return res.status(403).json({ error: 'Keine Berechtigung, dieses Quiz zu ändern.' });
    }

    if (isPublicVal === 1 && quiz.is_complete !== 1) {
      return res.status(400).json({ error: 'Ein unvollständiges Quiz kann nicht öffentlich geschaltet werden.' });
    }

    await db.run('UPDATE quizzes SET is_public = ? WHERE id = ?', [isPublicVal, id]);
    res.json({ success: true, isPublic: isPublicVal === 1 });
  } catch (err) {
    console.error('Toggle Public Status Error:', err);
    res.status(500).json({ error: 'Fehler beim Ändern der Sichtbarkeit.' });
  }
});

function escapeLikePattern(str) {
  return str.replace(/[\\%_]/g, '\\$&');
}

// 8c. Get Community Quizzes (Public, paginated, lightweight)
app.get('/api/community-quizzes', optionalAuthenticateToken, async (req, res) => {
  try {
    let page = parseInt(req.query.page, 10) || 1;
    let limit = parseInt(req.query.limit, 10) || 6;
    const rawSearch = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const favoritesOnly = req.query.favoritesOnly === 'true';

    if (page < 1) page = 1;
    if (limit < 1 || limit > 50) limit = 6;

    const offset = (page - 1) * limit;

    if (favoritesOnly && !req.user) {
      return res.status(401).json({ error: 'Anmeldung erforderlich, um Favoriten zu filtern.' });
    }

    const params = [];
    let whereClauses = 'q.is_public = 1 AND q.is_complete = 1';

    if (favoritesOnly) {
      whereClauses += ' AND f.user_email = ?';
      params.push(req.user.email);
    }

    if (rawSearch) {
      if (rawSearch.startsWith('@')) {
        const creatorSearch = escapeLikePattern(rawSearch.slice(1).trim());
        whereClauses += " AND u.username LIKE ? ESCAPE '\\'";
        params.push(`%${creatorSearch}%`);
      } else {
        whereClauses += " AND q.name LIKE ? ESCAPE '\\'";
        params.push(`%${escapeLikePattern(rawSearch)}%`);
      }
    }

    let countSql = '';
    let selectSql = '';

    if (favoritesOnly) {
      countSql = `SELECT COUNT(*) as count FROM quizzes q JOIN users u ON q.user_email = u.email JOIN user_favorites f ON q.id = f.quiz_id WHERE ${whereClauses}`;
      selectSql = `SELECT q.id, q.name, q.categories, q.icon, q.created_at, u.username as creator_name, 1 as is_favorited FROM quizzes q JOIN users u ON q.user_email = u.email JOIN user_favorites f ON q.id = f.quiz_id WHERE ${whereClauses}`;
    } else if (req.user) {
      countSql = `SELECT COUNT(*) as count FROM quizzes q JOIN users u ON q.user_email = u.email WHERE ${whereClauses}`;
      selectSql = `SELECT q.id, q.name, q.categories, q.icon, q.created_at, u.username as creator_name, (CASE WHEN f.quiz_id IS NOT NULL THEN 1 ELSE 0 END) as is_favorited FROM quizzes q JOIN users u ON q.user_email = u.email LEFT JOIN user_favorites f ON q.id = f.quiz_id AND f.user_email = ? WHERE ${whereClauses}`;
    } else {
      countSql = `SELECT COUNT(*) as count FROM quizzes q JOIN users u ON q.user_email = u.email WHERE ${whereClauses}`;
      selectSql = `SELECT q.id, q.name, q.categories, q.icon, q.created_at, u.username as creator_name, 0 as is_favorited FROM quizzes q JOIN users u ON q.user_email = u.email WHERE ${whereClauses}`;
    }

    selectSql += ' ORDER BY q.created_at DESC LIMIT ? OFFSET ?';

    const totalRow = await db.get(countSql, params);
    const total = totalRow ? totalRow.count : 0;

    const selectParams = [];
    if (!favoritesOnly && req.user) {
      selectParams.push(req.user.email);
    }
    selectParams.push(...params);
    selectParams.push(limit, offset);

    const rows = await db.all(selectSql, selectParams);

    const quizzes = rows.map(row => {
      let categoriesCount = 0;
      let questionsCount = 0;
      try {
        const categories = JSON.parse(row.categories);
        categoriesCount = categories.length;
        categories.forEach(c => {
          if (c.questions) questionsCount += c.questions.length;
        });
      } catch (e) {
        // Ignore parsing errors
      }

      return {
        id: row.id,
        name: row.name,
        icon: row.icon || '📝',
        creatorName: row.creator_name,
        categoriesCount,
        questionsCount,
        createdAt: row.created_at,
        isFavorited: row.is_favorited === 1
      };
    });

    const totalPages = Math.ceil(total / limit);

    res.json({
      quizzes,
      total,
      page,
      limit,
      totalPages
    });
  } catch (err) {
    console.error('Get Community Quizzes Error:', err);
    res.status(500).json({ error: 'Fehler beim Laden des Community Pools.' });
  }
});

// 8e. Favorite a Quiz
app.post('/api/quizzes/:id/favorite', quizLimiter, authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const quiz = await db.get('SELECT id, is_public, user_email FROM quizzes WHERE id = ?', [id]);
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz nicht gefunden.' });
    }
    if (quiz.is_public !== 1 && quiz.user_email !== req.user.email) {
      return res.status(403).json({ error: 'Keine Berechtigung, dieses Quiz zu favorisieren.' });
    }

    await db.run(
      'INSERT OR IGNORE INTO user_favorites (user_email, quiz_id) VALUES (?, ?)',
      [req.user.email, id]
    );
    res.json({ success: true, isFavorited: true });
  } catch (err) {
    console.error('Favorite Quiz Error:', err);
    res.status(500).json({ error: 'Fehler beim Favorisieren des Quizzes.' });
  }
});

// 8f. Unfavorite a Quiz
app.delete('/api/quizzes/:id/favorite', quizLimiter, authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    await db.run(
      'DELETE FROM user_favorites WHERE user_email = ? AND quiz_id = ?',
      [req.user.email, id]
    );
    res.json({ success: true, isFavorited: false });
  } catch (err) {
    console.error('Unfavorite Quiz Error:', err);
    res.status(500).json({ error: 'Fehler beim Entfernen des Favoriten.' });
  }
});

// 8d. Get Full Community Quiz Details (Public — omits creator's private email)
app.get('/api/community-quizzes/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const quiz = await db.get(
      'SELECT q.id, q.name, q.icon, q.categories, q.is_complete, q.is_public, u.username as creator_name FROM quizzes q JOIN users u ON q.user_email = u.email WHERE q.id = ? AND q.is_public = 1 AND q.is_complete = 1',
      [id]
    );

    if (!quiz) {
      return res.status(404).json({ error: 'Quiz nicht gefunden oder nicht öffentlich.' });
    }

    let categories = [];
    try {
      categories = JSON.parse(quiz.categories);
    } catch (e) {
      return res.status(500).json({ error: 'Quizdaten sind beschädigt.' });
    }

    res.json({
      id: quiz.id,
      name: quiz.name,
      icon: quiz.icon || '📝',
      creatorName: quiz.creator_name,
      categories,
      isComplete: quiz.is_complete === 1,
      isPublic: quiz.is_public === 1
    });
  } catch (err) {
    console.error('Get Full Community Quiz Error:', err);
    res.status(500).json({ error: 'Fehler beim Laden des Quizzes.' });
  }
});

// 9. Sync Legacy Quizzes
app.post('/api/quizzes/sync', quizLimiter, authenticateToken, async (req, res) => {
  try {
    const { quizzes } = req.body || {};

    if (!quizzes || !Array.isArray(quizzes) || quizzes.length > 50) {
      return res.status(400).json({ error: 'Ungültiges Payload.' });
    }

    for (const quiz of quizzes) {
      if (!quiz || typeof quiz !== 'object') continue;
      const { name, categories, id } = quiz;
      if (!name || !categories) continue;

      const validationError = validateQuizPayloadDraft(name, categories);
      if (validationError) continue;

      const sanitizedCategories = sanitizeQuizCategories(categories);
      const complete = isQuizComplete(sanitizedCategories) ? 1 : 0;
      const safeId = typeof id === 'string' && /^[a-zA-Z0-9_-]{4,80}$/.test(id)
        ? id
        : 'custom_' + crypto.randomUUID();

      const existing = await db.get('SELECT id FROM quizzes WHERE id = ?', [safeId]);
      if (!existing) {
        await db.run(
          'INSERT INTO quizzes (id, name, user_email, categories, is_complete) VALUES (?, ?, ?, ?, ?)',
          [safeId, name.trim(), req.user.email, JSON.stringify(sanitizedCategories), complete]
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Sync Quizzes Error:', err);
    res.status(500).json({ error: 'Fehler beim Synchronisieren der Quizzes.' });
  }
});

// Proxy for Google Translate Text-to-Speech to avoid CORS and browser blocking (ORB/CORB)
app.get('/api/tts', ttsLimiter, (req, res) => {
  const text = req.query.text;
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 300) {
    return res.status(400).json({ error: 'Ungültiger Text-Parameter (max. 300 Zeichen).' });
  }

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=de&client=tw-ob&q=${encodeURIComponent(text.trim())}`;

  const clientReq = https.get(url, { timeout: 10000 }, (googleRes) => {
    const contentType = String(googleRes.headers['content-type'] || '');
    if (googleRes.statusCode !== 200 || !contentType.toLowerCase().startsWith('audio/')) {
      googleRes.resume();
      if (!res.headersSent) {
        res.status(502).json({ error: 'TTS-Dienst momentan nicht verfügbar.' });
      }
      return;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (googleRes.headers['content-length']) {
      res.setHeader('Content-Length', googleRes.headers['content-length']);
    }
    googleRes.pipe(res);
  });

  clientReq.on('timeout', () => {
    clientReq.destroy(new Error('TTS_TIMEOUT'));
  });

  req.on('close', () => {
    if (!res.writableEnded) {
      clientReq.destroy();
    }
  });

  clientReq.on('error', (err) => {
    if (err.code !== 'ECONNRESET') {
      console.error('TTS Proxy Error:', err.message);
    }
    if (!res.headersSent) {
      res.status(502).json({ error: 'Fehler beim Abrufen der Sprachausgabe.' });
    }
  });
});

// 10. Get WebRTC ICE Servers (STUN/TURN)
app.get('/api/webrtc/ice-servers', (req, res) => {
  const turnUrl = process.env.TURN_URL;
  const turnUsername = process.env.TURN_USERNAME;
  const turnPassword = process.env.TURN_PASSWORD;

  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Open Relay Project (Free STUN/TURN servers powered by Metered.ca)
    { urls: 'stun:openrelay.metered.ca:80' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];

  if (turnUrl && turnUsername && turnPassword) {
    const urls = turnUrl.includes(',')
      ? turnUrl.split(',').map(u => u.trim())
      : turnUrl.trim();

    iceServers.push({
      urls: urls,
      username: turnUsername,
      credential: turnPassword
    });
  }

  res.json({ iceServers });
});

// Debug log endpoint (disabled in production to prevent log injection / disk exhaustion)
app.post('/api/debug/log', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(204).end();
  }
  const msg = typeof req.body?.message === 'string' ? req.body.message.slice(0, 500) : '';
  if (msg) {
    console.log('[Client Log]', msg.replace(/[\r\n\x1b]/g, ' '));
  }
  res.json({ success: true });
});

// 11. P2P HTTP Long-Polling Relay
const MAX_RELAY_PEERS = 2000;
const messageQueues = new Map(); // peerId -> queue of messages
const pendingPolls = new Map();  // peerId -> array of { res, timer }
const lastActivity = new Map();  // peerId -> timestamp of last poll/send

function isValidPeerId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 128;
}

function flushPendingPolls(receiverId) {
  if (!pendingPolls.has(receiverId)) return;
  const polls = pendingPolls.get(receiverId);
  pendingPolls.delete(receiverId);

  const activePolls = [];
  for (const entry of polls) {
    clearTimeout(entry.timer);
    if (!entry.res.destroyed && !entry.res.headersSent) {
      activePolls.push(entry.res);
    }
  }

  // Only drain queue if at least one live poll response actually receives it
  if (activePolls.length > 0) {
    const currentQueue = messageQueues.get(receiverId) || [];
    messageQueues.set(receiverId, []);
    for (const pollRes of activePolls) {
      pollRes.json({ messages: currentQueue });
    }
  }
}

// Periodic cleanup of idle queues and old request logs to prevent memory/disk leaks
setInterval(() => {
  const now = Date.now();
  const maxIdleTime = 5 * 60 * 1000; // 5 minutes of inactivity
  for (const [peerId, timestamp] of lastActivity.entries()) {
    if (now - timestamp > maxIdleTime) {
      messageQueues.delete(peerId);
      const polls = pendingPolls.get(peerId) || [];
      for (const entry of polls) {
        clearTimeout(entry.timer);
        if (!entry.res.destroyed && !entry.res.headersSent) {
          entry.res.json({ messages: [] });
        }
      }
      pendingPolls.delete(peerId);
      lastActivity.delete(peerId);
    }
  }

  // Prune request logs older than 90 days
  if (db) {
    db.run("DELETE FROM request_logs WHERE created_at < datetime('now', '-90 days')").catch(() => {});
  }
}, 60 * 1000);

app.post('/api/p2p/send', p2pLimiter, (req, res) => {
  const { senderId, receiverId, message } = req.body || {};
  if (!isValidPeerId(receiverId) || !message) {
    return res.status(400).json({ error: 'Missing or invalid receiverId or message' });
  }
  if (senderId !== undefined && !isValidPeerId(senderId)) {
    return res.status(400).json({ error: 'Invalid senderId' });
  }

  if (typeof message !== 'string' && typeof message !== 'object') {
    return res.status(400).json({ error: 'Invalid message type' });
  }

  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
  if (messageStr.length > 50 * 1024) {
    return res.status(400).json({ error: 'Message size exceeds limit of 50KB' });
  }

  if (!lastActivity.has(receiverId) && lastActivity.size >= MAX_RELAY_PEERS) {
    return res.status(503).json({ error: 'Relay capacity reached. Please retry shortly.' });
  }

  lastActivity.set(receiverId, Date.now());
  if (senderId) {
    lastActivity.set(senderId, Date.now());
  }

  if (!messageQueues.has(receiverId)) {
    messageQueues.set(receiverId, []);
  }

  const queue = messageQueues.get(receiverId);
  if (queue.length >= 100) {
    queue.shift();
  }
  queue.push({ senderId, message });

  flushPendingPolls(receiverId);
  res.json({ success: true });
});

// Batch send: send the same message to multiple receivers in a single request
app.post('/api/p2p/send-batch', p2pLimiter, (req, res) => {
  const { senderId, receiverIds, message } = req.body || {};
  if (!Array.isArray(receiverIds) || !message) {
    return res.status(400).json({ error: 'Missing receiverIds array or message' });
  }
  if (senderId !== undefined && !isValidPeerId(senderId)) {
    return res.status(400).json({ error: 'Invalid senderId' });
  }
  if (typeof message !== 'string' && typeof message !== 'object') {
    return res.status(400).json({ error: 'Invalid message type' });
  }

  if (receiverIds.length > 50) {
    return res.status(400).json({ error: 'Too many receivers (max 50)' });
  }

  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
  if (messageStr.length > 50 * 1024) {
    return res.status(400).json({ error: 'Message size exceeds limit of 50KB' });
  }

  for (const receiverId of receiverIds) {
    if (!isValidPeerId(receiverId)) continue;
    if (!lastActivity.has(receiverId) && lastActivity.size >= MAX_RELAY_PEERS) continue;

    lastActivity.set(receiverId, Date.now());

    if (!messageQueues.has(receiverId)) {
      messageQueues.set(receiverId, []);
    }

    const queue = messageQueues.get(receiverId);
    if (queue.length >= 100) {
      queue.shift();
    }
    queue.push({ senderId, message });

    flushPendingPolls(receiverId);
  }

  if (senderId) {
    lastActivity.set(senderId, Date.now());
  }

  res.json({ success: true });
});

app.get('/api/p2p/poll/:peerId', p2pLimiter, (req, res) => {
  const { peerId } = req.params;
  if (!isValidPeerId(peerId)) {
    return res.status(400).json({ error: 'Invalid peerId' });
  }
  if (!lastActivity.has(peerId) && lastActivity.size >= MAX_RELAY_PEERS) {
    return res.status(503).json({ error: 'Relay capacity reached.' });
  }

  lastActivity.set(peerId, Date.now());

  const queue = messageQueues.get(peerId) || [];
  if (queue.length > 0) {
    messageQueues.set(peerId, []);
    return res.json({ messages: queue });
  }

  if (!pendingPolls.has(peerId)) {
    pendingPolls.set(peerId, []);
  }

  const entry = { res, timer: null };

  const cleanupEntry = () => {
    clearTimeout(entry.timer);
    const polls = pendingPolls.get(peerId);
    if (!polls) return;
    const idx = polls.indexOf(entry);
    if (idx !== -1) {
      polls.splice(idx, 1);
    }
    if (polls.length === 0) {
      pendingPolls.delete(peerId);
    }
  };

  entry.timer = setTimeout(() => {
    cleanupEntry();
    if (!res.destroyed && !res.headersSent) {
      res.json({ messages: [] });
    }
  }, 15000);

  req.on('close', cleanupEntry);
  pendingPolls.get(peerId).push(entry);
});

// Return JSON 404 for unknown API routes instead of serving index.html
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'API-Endpunkt nicht gefunden.' });
});

// Global error handler
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Anfrage ist zu groß.' });
  }
  console.error('[Server] Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: 'Interner Serverfehler.' });
});

const { ExpressPeerServer } = require('peer');
const server = http.createServer(app);

// Initialize and mount PeerJS server (mounted BEFORE static catch-all)
const peerServer = ExpressPeerServer(server, {
  path: '/'
});
app.use('/peerjs', peerServer);

// --- SERVE STATIC FRONTEND IN PRODUCTION ---
const angularBuildPath = path.resolve(__dirname, '../dist/jeopardy-app/browser');
const COMPRESSIBLE_TYPES = {
  '.js': 'application/javascript; charset=UTF-8',
  '.mjs': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.html': 'text/html; charset=UTF-8',
  '.svg': 'image/svg+xml'
};

app.use((req, res, next) => {
  if (req.method !== 'GET' || !String(req.headers['accept-encoding'] || '').includes('gzip')) {
    return next();
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(req.path);
  } catch {
    return next();
  }
  const relPath = decodedPath.replace(/^\/+/, '');
  if (!relPath || relPath.includes('\0')) return next();
  const ext = path.extname(relPath).toLowerCase();
  const contentType = COMPRESSIBLE_TYPES[ext];
  if (!contentType) return next();

  const filePath = path.resolve(angularBuildPath, relPath);
  if (!filePath.startsWith(angularBuildPath + path.sep)) return next();

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return next();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    const stream = fs.createReadStream(filePath);
    const gzip = zlib.createGzip({ level: 6 });
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    stream.pipe(gzip).pipe(res);
  });
});

app.use(express.static(angularBuildPath));

// Catch-all route to serve Angular app for any client-side routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(angularBuildPath, 'index.html'));
});

// Start server only after SQLite database is fully initialized
initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

    // Start local admin panel server
    try {
      require('./admin');
    } catch (err) {
      console.error('[Admin Panel] Failed to start admin server:', err);
    }
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

// Graceful shutdown
function shutdown(signal) {
  console.log(`[Server] Received ${signal}, shutting down gracefully...`);
  server.close(async () => {
    try {
      if (db) await db.close();
    } catch (e) {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

