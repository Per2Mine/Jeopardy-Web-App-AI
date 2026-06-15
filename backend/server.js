const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'jeopardy_super_secret_key_123_abc_xyz';

// Middlewares
app.use(cors({
  origin: '*', // Allow all origins for dev simplicity, or specify localhost:4200
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' })); // Support larger custom quiz payloads

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
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  const formattedEmail = email ? email.toLowerCase().trim() : '';
  const formattedUsername = username ? username.trim() : '';

  if (!formattedUsername) {
    return res.status(400).json({ error: 'Benutzername darf nicht leer sein.' });
  }
  if (!formattedEmail || !formattedEmail.includes('@')) {
    return res.status(400).json({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Das Passwort muss mindestens 6 Zeichen lang sein.' });
  }

  try {
    const existingUser = await db.get('SELECT * FROM users WHERE email = ?', [formattedEmail]);
    if (existingUser) {
      return res.status(400).json({ error: 'Ein Konto mit dieser E-Mail-Adresse existiert bereits.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.run(
      'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
      [formattedEmail, formattedUsername, passwordHash]
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

// 2. Login User
app.post('/api/auth/login', async (req, res) => {
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

  try {
    await db.run('UPDATE users SET username = ? WHERE email = ?', [formattedUsername, req.user.email]);
    res.json({ success: true, username: formattedUsername });
  } catch (err) {
    console.error('Update Username Error:', err);
    res.status(500).json({ error: 'Aktualisierung fehlgeschlagen.' });
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
      categories: JSON.parse(row.categories)
    }));
    res.json(quizzes);
  } catch (err) {
    console.error('Get Quizzes Error:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Quizzes.' });
  }
});

// 6. Save Custom Quiz (Create)
app.post('/api/quizzes', authenticateToken, async (req, res) => {
  const { name, categories } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Bitte gib der Quiz-Vorlage einen Namen.' });
  }
  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'Das Quiz muss mindestens eine Kategorie enthalten.' });
  }

  const id = 'custom_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);

  try {
    await db.run(
      'INSERT INTO quizzes (id, name, user_email, categories) VALUES (?, ?, ?, ?)',
      [id, name.trim(), req.user.email, JSON.stringify(categories)]
    );
    res.status(201).json({ success: true, id });
  } catch (err) {
    console.error('Create Quiz Error:', err);
    res.status(500).json({ error: 'Fehler beim Erstellen des Quizzes.' });
  }
});

// 7. Update Custom Quiz
app.put('/api/quizzes/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, categories } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Bitte gib der Quiz-Vorlage einen Namen.' });
  }
  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'Das Quiz muss mindestens eine Kategorie enthalten.' });
  }

  try {
    const quiz = await db.get('SELECT * FROM quizzes WHERE id = ?', [id]);
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz nicht gefunden.' });
    }
    if (quiz.user_email !== req.user.email) {
      return res.status(403).json({ error: 'Keine Berechtigung, dieses Quiz zu bearbeiten.' });
    }

    await db.run(
      'UPDATE quizzes SET name = ?, categories = ? WHERE id = ?',
      [name.trim(), JSON.stringify(categories), id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update Quiz Error:', err);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Quizzes.' });
  }
});

// 8. Delete Custom Quiz
app.delete('/api/quizzes/:id', authenticateToken, async (req, res) => {
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

      const quizId = id || ('custom_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5));
      
      // Check if quiz already exists
      const existing = await db.get('SELECT * FROM quizzes WHERE id = ?', [quizId]);
      if (!existing) {
        await db.run(
          'INSERT INTO quizzes (id, name, user_email, categories) VALUES (?, ?, ?, ?)',
          [quizId, name.trim(), req.user.email, JSON.stringify(categories)]
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Sync Quizzes Error:', err);
    res.status(500).json({ error: 'Fehler beim Synchronisieren der Quizzes.' });
  }
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
