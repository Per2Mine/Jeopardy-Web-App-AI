const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dns = require('dns').promises;
const rateLimit = require('express-rate-limit');
const { getDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'jeopardy_super_secret_key_123_abc_xyz';

// Rate Limiters
const globalLimiter = rateLimit.rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => req.originalUrl && req.originalUrl.includes('/api/p2p'),
  message: { error: 'Zu viele Anfragen von dieser IP, bitte versuche es in 15 Minuten erneut.' }
});

const authLimiter = rateLimit.rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 registration/login attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anmelde- oder Registrierungsversuche. Bitte warte 15 Minuten.' }
});

const quizLimiter = rateLimit.rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 quiz creations/updates/deletes per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Quiz-Aktionen. Bitte warte 15 Minuten.' }
});

// Middlewares
app.use(cors({
  origin: '*', // Allow all origins for dev simplicity, or specify localhost:4200
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' })); // Support larger custom quiz payloads
app.use('/api/', globalLimiter); // Apply global rate limiter to all API endpoints

// --- VALIDATION UTILITIES ---

// 1. Email Validator (Regex + disposable list + active DNS check)
async function validateEmail(email) {
  if (!email) return { valid: false, error: 'E-Mail-Adresse darf nicht leer sein.' };
  
  const formattedEmail = email.toLowerCase().trim();

  // Syntax validation using standard RFC 5322 regex
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
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

  // Active DNS Verification
  try {
    const mxRecords = await dns.resolveMx(domain);
    if (mxRecords && mxRecords.length > 0) {
      return { valid: true };
    }
  } catch (err) {
    // If MX lookup fails, check A records as a fallback
    try {
      const addresses = await dns.resolve4(domain);
      if (addresses && addresses.length > 0) {
        return { valid: true };
      }
    } catch (err2) {
      return { valid: false, error: 'Die E-Mail-Domain existiert nicht oder kann keine E-Mails empfangen.' };
    }
  }

  return { valid: false, error: 'Die E-Mail-Domain konnte nicht validiert werden.' };
}

// 2. Username Validation (Profanity Check)
function isOffensiveUsername(username) {
  if (!username) return false;

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
  try {
    db = await getDatabase();
    console.log('SQLite database initialized successfully.');
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }
}
initDb();

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Nicht autorisiert. Kein Token bereitgestellt.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Sitzung abgelaufen oder ungültiges Token. Bitte melde dich erneut an.' });
    }
    req.user = user;
    next();
  });
}

// --- API ROUTES ---

// 1. Register User
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { username, email, password, securityQuestion, securityAnswer } = req.body;
  
  const formattedEmail = email ? email.toLowerCase().trim() : '';
  const formattedUsername = username ? username.trim() : '';

  if (!formattedUsername) {
    return res.status(400).json({ error: 'Benutzername darf nicht leer sein.' });
  }

  // Validate username length and characters
  if (formattedUsername.length < 3 || formattedUsername.length > 20) {
    return res.status(400).json({ error: 'Der Benutzername muss zwischen 3 und 20 Zeichen lang sein.' });
  }

  const usernameRegex = /^[a-zA-Z0-9_\-]+$/;
  if (!usernameRegex.test(formattedUsername)) {
    return res.status(400).json({ error: 'Der Benutzername darf nur Buchstaben, Zahlen, Unterstriche und Bindestriche enthalten.' });
  }

  // Check for offensive username
  if (isOffensiveUsername(formattedUsername)) {
    return res.status(400).json({ error: 'Dieser Benutzername enthält unangemessene Ausdrücke. Bitte wähle einen anderen.' });
  }

  // Robust email validation
  const emailValidation = await validateEmail(formattedEmail);
  if (!emailValidation.valid) {
    return res.status(400).json({ error: emailValidation.error });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Das Passwort muss mindestens 6 Zeichen lang sein.' });
  }

  if (!securityQuestion || !securityQuestion.trim()) {
    return res.status(400).json({ error: 'Bitte wähle eine Sicherheitsfrage aus.' });
  }

  if (!securityAnswer || !securityAnswer.trim()) {
    return res.status(400).json({ error: 'Bitte gib eine Antwort auf deine Sicherheitsfrage ein.' });
  }

  try {
    const existingUser = await db.get('SELECT * FROM users WHERE email = ?', [formattedEmail]);
    if (existingUser) {
      return res.status(400).json({ error: 'Ein Konto mit dieser E-Mail-Adresse existiert bereits.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const formattedAnswer = securityAnswer.trim().toLowerCase();
    const securityAnswerHash = await bcrypt.hash(formattedAnswer, 10);

    await db.run(
      'INSERT INTO users (email, username, password_hash, security_question, security_answer_hash) VALUES (?, ?, ?, ?, ?)',
      [formattedEmail, formattedUsername, passwordHash, securityQuestion.trim(), securityAnswerHash]
    );

    const tokenPayload = { email: formattedEmail, username: formattedUsername };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

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
  const { email } = req.body;
  const formattedEmail = email ? email.toLowerCase().trim() : '';

  if (!formattedEmail) {
    return res.status(400).json({ error: 'Bitte gib eine E-Mail-Adresse ein.' });
  }

  try {
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
  const { email, securityAnswer, newPassword } = req.body;
  const formattedEmail = email ? email.toLowerCase().trim() : '';
  const formattedAnswer = securityAnswer ? securityAnswer.trim().toLowerCase() : '';

  if (!formattedEmail || !formattedAnswer || !newPassword) {
    return res.status(400).json({ error: 'Bitte fülle alle Pflichtfelder aus.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Das neue Passwort muss mindestens 6 Zeichen lang sein.' });
  }

  try {
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
  const { email, password } = req.body;
  const formattedEmail = email ? email.toLowerCase().trim() : '';

  if (!formattedEmail || !password) {
    return res.status(400).json({ error: 'Bitte fülle alle Felder aus.' });
  }

  try {
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
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

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
  const { username } = req.body;
  const formattedUsername = username ? username.trim() : '';

  if (!formattedUsername) {
    return res.status(400).json({ error: 'Benutzername darf nicht leer sein.' });
  }

  // Validate username length and characters
  if (formattedUsername.length < 3 || formattedUsername.length > 20) {
    return res.status(400).json({ error: 'Der Benutzername muss zwischen 3 und 20 Zeichen lang sein.' });
  }

  const usernameRegex = /^[a-zA-Z0-9_\-]+$/;
  if (!usernameRegex.test(formattedUsername)) {
    return res.status(400).json({ error: 'Der Benutzername darf nur Buchstaben, Zahlen, Unterstriche und Bindestriche enthalten.' });
  }

  // Check for offensive username
  if (isOffensiveUsername(formattedUsername)) {
    return res.status(400).json({ error: 'Dieser Benutzername enthält unangemessene Ausdrücke. Bitte wähle einen anderen.' });
  }

  try {
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
    const quizzes = rows.map(row => ({
      id: row.id,
      name: row.name,
      icon: '📝',
      userEmail: row.user_email,
      categories: JSON.parse(row.categories),
      isComplete: row.is_complete === 1
    }));
    res.json(quizzes);
  } catch (err) {
    console.error('Get Quizzes Error:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Quizzes.' });
  }
});

// Draft validation: only quiz name is required, images are validated if present
function validateQuizPayloadDraft(name, categories) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    return 'Bitte gib der Quiz-Vorlage einen Namen.';
  }
  if (name.trim().length > 30) {
    return 'Der Quiz-Name darf maximal 30 Zeichen lang sein.';
  }
  if (!categories || !Array.isArray(categories)) {
    return 'Ungültiges Format für Kategorien.';
  }
  if (categories.length > 10) {
    return 'Ein Quiz darf maximal 10 Kategorien besitzen.';
  }

  // Validate fields and images if present
  for (let c = 0; c < categories.length; c++) {
    const cat = categories[c];
    if (cat.name && (typeof cat.name !== 'string' || cat.name.trim().length > 18)) {
      return `Der Kategorie-Name von Kategorie ${c + 1} darf maximal 18 Zeichen lang sein.`;
    }
    if (cat.questions && Array.isArray(cat.questions)) {
      for (let qIdx = 0; qIdx < cat.questions.length; qIdx++) {
        const q = cat.questions[qIdx];
        if (q.text && (typeof q.text !== 'string' || q.text.trim().length > 160)) {
          return `Der Frage-Text in Kategorie ${c + 1} bei Frage ${qIdx + 1} darf maximal 160 Zeichen lang sein.`;
        }
        if (q.answer && (typeof q.answer !== 'string' || q.answer.trim().length > 100)) {
          return `Der Antwort-Text in Kategorie ${c + 1} bei Frage ${qIdx + 1} darf maximal 100 Zeichen lang sein.`;
        }
        if (q.image) {
          if (typeof q.image !== 'string') {
            return 'Ungültiges Bild-Format.';
          }
          if (!q.image.startsWith('data:image/')) {
            return 'Unterstützte Bildformate sind nur PNG, JPEG, WEBP und GIF.';
          }
          const allowedTypes = ['data:image/png', 'data:image/jpeg', 'data:image/jpg', 'data:image/webp', 'data:image/gif'];
          const matchesType = allowedTypes.some(type => q.image.startsWith(type));
          if (!matchesType) {
            return 'Unterstützte Bildformate sind nur PNG, JPEG, WEBP und GIF.';
          }
          const approximateSizeBytes = q.image.length * 0.75;
          if (approximateSizeBytes > 6.8 * 1024 * 1024) {
            return 'Die Bildgröße darf 5 MB nicht überschreiten.';
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
    if (!cat.name || typeof cat.name !== 'string' || !cat.name.trim()) {
      return false;
    }
    if (!cat.questions || !Array.isArray(cat.questions) || cat.questions.length === 0) {
      return false;
    }
    for (const q of cat.questions) {
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
  const { name, categories } = req.body;

  const validationError = validateQuizPayloadDraft(name, categories);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const id = 'custom_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
  const complete = isQuizComplete(categories) ? 1 : 0;

  try {
    await db.run(
      'INSERT INTO quizzes (id, name, user_email, categories, is_complete) VALUES (?, ?, ?, ?, ?)',
      [id, name.trim(), req.user.email, JSON.stringify(categories), complete]
    );
    res.status(201).json({ success: true, id, isComplete: complete === 1 });
  } catch (err) {
    console.error('Create Quiz Error:', err);
    res.status(500).json({ error: 'Fehler beim Erstellen des Quizzes.' });
  }
});

// 7. Update Custom Quiz
app.put('/api/quizzes/:id', quizLimiter, authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, categories } = req.body;

  const validationError = validateQuizPayloadDraft(name, categories);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const complete = isQuizComplete(categories) ? 1 : 0;

  try {
    const quiz = await db.get('SELECT * FROM quizzes WHERE id = ?', [id]);
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz nicht gefunden.' });
    }
    if (quiz.user_email !== req.user.email) {
      return res.status(403).json({ error: 'Keine Berechtigung, dieses Quiz zu bearbeiten.' });
    }

    await db.run(
      'UPDATE quizzes SET name = ?, categories = ?, is_complete = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name.trim(), JSON.stringify(categories), complete, id]
    );
    res.json({ success: true, isComplete: complete === 1 });
  } catch (err) {
    console.error('Update Quiz Error:', err);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Quizzes.' });
  }
});

// 8. Delete Custom Quiz
app.delete('/api/quizzes/:id', quizLimiter, authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const quiz = await db.get('SELECT * FROM quizzes WHERE id = ?', [id]);
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

// 9. Sync Legacy Quizzes
app.post('/api/quizzes/sync', authenticateToken, async (req, res) => {
  const { quizzes } = req.body;

  if (!quizzes || !Array.isArray(quizzes)) {
    return res.status(400).json({ error: 'Ungültiges Payload.' });
  }

  try {
    // Perform bulk inserts
    for (const quiz of quizzes) {
      const { name, categories, id } = quiz;
      if (!name || !categories) continue;

      const validationError = validateQuizPayloadDraft(name, categories);
      if (validationError) continue; // Skip invalid quizzes during legacy sync

      const complete = isQuizComplete(categories) ? 1 : 0;
      const quizId = id || ('custom_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5));
      
      // Check if quiz already exists
      const existing = await db.get('SELECT * FROM quizzes WHERE id = ?', [quizId]);
      if (!existing) {
        await db.run(
          'INSERT INTO quizzes (id, name, user_email, categories, is_complete) VALUES (?, ?, ?, ?, ?)',
          [quizId, name.trim(), req.user.email, JSON.stringify(categories), complete]
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Sync Quizzes Error:', err);
    res.status(500).json({ error: 'Fehler beim Synchronisieren der Quizzes.' });
  }
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
    iceServers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnPassword
    });
  }

  res.json({ iceServers });
});

// Debug log endpoint to capture client logs on server
app.post('/api/debug/log', (req, res) => {
  console.log('[Client Log]', req.body.message);
  res.json({ success: true });
});

// 11. P2P HTTP Long-Polling Relay
const messageQueues = new Map(); // peerId -> queue of messages
const pendingPolls = new Map();  // peerId -> array of pending response objects
const lastActivity = new Map();  // peerId -> timestamp of last poll/send

// Periodic cleanup of idle queues to prevent memory leaks/DoS
setInterval(() => {
  const now = Date.now();
  const maxIdleTime = 5 * 60 * 1000; // 5 minutes of inactivity
  for (const [peerId, timestamp] of lastActivity.entries()) {
    if (now - timestamp > maxIdleTime) {
      messageQueues.delete(peerId);
      pendingPolls.delete(peerId);
      lastActivity.delete(peerId);
    }
  }
}, 60 * 1000); // Run cleanup every minute

app.post('/api/p2p/send', (req, res) => {
  const { senderId, receiverId, message } = req.body;
  if (!receiverId || !message) {
    return res.status(400).json({ error: 'Missing receiverId or message' });
  }

  // Safety checks to prevent spam / memory exhaustion
  if (typeof message !== 'string' && typeof message !== 'object') {
    return res.status(400).json({ error: 'Invalid message type' });
  }

  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
  if (messageStr.length > 50 * 1024) { // 50 KB limit
    return res.status(400).json({ error: 'Message size exceeds limit of 50KB' });
  }

  // Update activity timestamp
  lastActivity.set(receiverId, Date.now());
  if (senderId) {
    lastActivity.set(senderId, Date.now());
  }

  // Queue message for receiver
  if (!messageQueues.has(receiverId)) {
    messageQueues.set(receiverId, []);
  }

  const queue = messageQueues.get(receiverId);
  if (queue.length >= 100) {
    // Drop the oldest message if the queue exceeds 100 messages to prevent memory abuse
    queue.shift();
  }
  queue.push({ senderId, message });

  // Resolve pending polls for receiver
  if (pendingPolls.has(receiverId)) {
    const polls = pendingPolls.get(receiverId);
    pendingPolls.delete(receiverId);
    
    const currentQueue = messageQueues.get(receiverId) || [];
    messageQueues.set(receiverId, []);

    for (const pollRes of polls) {
      if (!pollRes.destroyed && !pollRes.headersSent) {
        pollRes.json({ messages: currentQueue });
      }
    }
  }

  res.json({ success: true });
});

app.get('/api/p2p/poll/:peerId', (req, res) => {
  const { peerId } = req.params;

  // Update activity timestamp
  lastActivity.set(peerId, Date.now());

  // If messages are queued, return them immediately
  const queue = messageQueues.get(peerId) || [];
  if (queue.length > 0) {
    messageQueues.set(peerId, []);
    return res.json({ messages: queue });
  }

  // Otherwise, hold connection (long poll)
  if (!pendingPolls.has(peerId)) {
    pendingPolls.set(peerId, []);
  }
  pendingPolls.get(peerId).push(res);

  // Timeout after 15 seconds
  setTimeout(() => {
    const polls = pendingPolls.get(peerId) || [];
    const index = polls.indexOf(res);
    if (index !== -1) {
      polls.splice(index, 1);
      if (polls.length === 0) {
        pendingPolls.delete(peerId);
      }
      if (!res.destroyed && !res.headersSent) {
        res.json({ messages: [] });
      }
    }
  }, 15000);
});



const { ExpressPeerServer } = require('peer');

// Start Server
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Initialize and mount PeerJS server (must be mounted BEFORE the static catch-all route)
const peerServer = ExpressPeerServer(server, {
  path: '/'
});
app.use('/peerjs', peerServer);

// --- SERVE STATIC FRONTEND IN PRODUCTION ---
const angularBuildPath = path.join(__dirname, '../dist/jeopardy-app/browser');
app.use(express.static(angularBuildPath));

// Catch-all route to serve Angular app for any client-side routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(angularBuildPath, 'index.html'));
});
