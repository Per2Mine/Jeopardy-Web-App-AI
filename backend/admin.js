const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDatabase } = require('./database');

const app = express();
const ADMIN_PORT = process.env.ADMIN_PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'jeopardy_super_secret_key_123_abc_xyz';

app.use(express.json());

// Helper to check if IP is local/private
function isLocalIp(ip) {
  if (!ip) return false;
  
  // Normalize IPv6 mapped IPv4 address
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    return true;
  }

  // Private IPv4 ranges
  if (ip.startsWith('10.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith('192.168.')) return true;

  // Link-local IPv6 (fe80::/10)
  if (ip.toLowerCase().startsWith('fe80:')) return true;

  // Unique local address IPv6 (fc00::/7)
  if (/^[fF][cCdD]/.test(ip)) return true;

  return false;
}

// IP restriction middleware
app.use((req, res, next) => {
  if (process.env.DISABLE_ADMIN_IP_RESTRICTION === 'true') {
    return next();
  }
  
  const clientIp = req.ip || req.connection.remoteAddress;
  if (isLocalIp(clientIp)) {
    next();
  } else {
    console.warn(`[Admin Panel] Blocked non-local request from IP: ${clientIp}`);
    res.status(403).send('Forbidden: Access allowed only from local network.');
  }
});

// Admin authentication middleware using JWT Bearer tokens
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Nicht autorisiert. Kein Token bereitgestellt.', authRequired: true });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || !decoded.isAdmin) {
      return res.status(401).json({ error: 'Sitzung abgelaufen oder ungültiges Token.', authRequired: true });
    }
    req.admin = decoded;
    next();
  });
}

// Serve static admin panel dashboard
app.use(express.static(path.join(__dirname, 'admin-public')));

// Database access helper
let db;
async function initDb() {
  try {
    db = await getDatabase();
    
    // Create admin_users table if not exists
    await db.exec(`
      CREATE TABLE IF NOT EXISTS admin_users (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error('[Admin Panel] Failed to initialize database connection:', err);
  }
}
initDb();

// 1. Setup Status check
app.get('/api/admin/setup-status', async (req, res) => {
  try {
    const row = await db.get('SELECT COUNT(*) as count FROM admin_users');
    const setupRequired = !row || row.count === 0;
    res.json({ setupRequired });
  } catch (err) {
    console.error('[Admin Panel] Setup status error:', err);
    res.status(500).json({ error: 'Fehler beim Abrufen des Setup-Status.' });
  }
});

// 1.2 Setup Admin Account (Register first admin)
app.post('/api/admin/setup', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Benutzername und Passwort sind erforderlich.' });
  }

  const trimmedUsername = username.trim();
  if (trimmedUsername.length < 3) {
    return res.status(400).json({ error: 'Der Benutzername muss mindestens 3 Zeichen lang sein.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Das Passwort muss mindestens 6 Zeichen lang sein.' });
  }

  try {
    const row = await db.get('SELECT COUNT(*) as count FROM admin_users');
    if (row && row.count > 0) {
      return res.status(400).json({ error: 'Ein Admin-Konto existiert bereits. Setup-Endpunkt ist gesperrt.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.run('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', [trimmedUsername, passwordHash]);

    const token = jwt.sign({ username: trimmedUsername, isAdmin: true }, JWT_SECRET, { expiresIn: '1d' });
    res.status(201).json({ success: true, token });
  } catch (err) {
    console.error('[Admin Panel] Setup error:', err);
    res.status(500).json({ error: 'Fehler beim Einrichten des Admin-Kontos.' });
  }
});

// 1.3 Login Admin Account
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Bitte Benutzername und Passwort eingeben.' });
  }

  try {
    const admin = await db.get('SELECT * FROM admin_users WHERE username = ?', [username.trim()]);
    if (!admin) {
      return res.status(401).json({ error: 'Ungültiger Benutzername oder Passwort.' });
    }

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Ungültiger Benutzername oder Passwort.' });
    }

    const token = jwt.sign({ username: admin.username, isAdmin: true }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ success: true, token });
  } catch (err) {
    console.error('[Admin Panel] Login error:', err);
    res.status(500).json({ error: 'Fehler beim Anmelden.' });
  }
});

// 2. Stats API
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
  try {
    const range = req.query.range || 'days';
    let dateFormat = '%Y-%m-%d';
    let timeConstraint = "-30 days";

    if (range === 'weeks') {
      dateFormat = '%Y-W%W';
      timeConstraint = "-12 weeks";
    } else if (range === 'years') {
      dateFormat = '%Y';
      timeConstraint = "-5 years";
    }

    const userCountRow = await db.get('SELECT COUNT(*) as count FROM users');
    const quizCountRow = await db.get('SELECT COUNT(*) as count FROM quizzes');
    const publicQuizRow = await db.get('SELECT COUNT(*) as count FROM quizzes WHERE is_public = 1');
    const favoriteRow = await db.get('SELECT COUNT(*) as count FROM user_favorites');
    const lobbyCountRow = await db.get('SELECT COUNT(*) as count FROM lobby_creations');
    const requestCountRow = await db.get("SELECT COUNT(*) as count FROM request_logs WHERE created_at >= date('now', 'start of day')");

    // Recent registrations
    const recentUsers = await db.all('SELECT email, username, created_at FROM users ORDER BY created_at DESC LIMIT 5');

    // Registration stats over time
    const signupStats = await db.all(`
      SELECT strftime('${dateFormat}', created_at) as date, COUNT(*) as count 
      FROM users 
      WHERE created_at >= date('now', '${timeConstraint}')
      GROUP BY date 
      ORDER BY date ASC
    `);

    // Quizzes stats over time
    const quizStats = await db.all(`
      SELECT strftime('${dateFormat}', created_at) as date, COUNT(*) as count 
      FROM quizzes 
      WHERE created_at >= date('now', '${timeConstraint}')
      GROUP BY date 
      ORDER BY date ASC
    `);

    // Lobby creations stats over time
    const lobbyStats = await db.all(`
      SELECT strftime('${dateFormat}', created_at) as date, COUNT(*) as count 
      FROM lobby_creations 
      WHERE created_at >= date('now', '${timeConstraint}')
      GROUP BY date 
      ORDER BY date ASC
    `);

    // Request traffic stats over time
    const trafficStats = await db.all(`
      SELECT strftime('${dateFormat}', created_at) as date, COUNT(*) as count 
      FROM request_logs 
      WHERE created_at >= date('now', '${timeConstraint}')
      GROUP BY date 
      ORDER BY date ASC
    `);

    // Database size calculation
    let dbSize = 'Unknown';
    try {
      const dbDir = process.env.DATABASE_DIR || __dirname;
      const dbPath = path.join(dbDir, 'database.sqlite');
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        const sizeBytes = stats.size;
        if (sizeBytes < 1024) dbSize = `${sizeBytes} B`;
        else if (sizeBytes < 1024 * 1024) dbSize = `${(sizeBytes / 1024).toFixed(1)} KB`;
        else dbSize = `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
      }
    } catch (fsErr) {
      console.warn('Failed to calculate DB size:', fsErr);
    }

    res.json({
      totals: {
        users: userCountRow ? userCountRow.count : 0,
        quizzes: quizCountRow ? quizCountRow.count : 0,
        publicQuizzes: publicQuizRow ? publicQuizRow.count : 0,
        favorites: favoriteRow ? favoriteRow.count : 0,
        lobbies: lobbyCountRow ? lobbyCountRow.count : 0,
        requests: requestCountRow ? requestCountRow.count : 0,
        dbSize
      },
      env: process.env.NODE_ENV || 'development',
      recentUsers,
      signupStats,
      quizStats,
      lobbyStats,
      trafficStats
    });
  } catch (err) {
    console.error('[Admin Panel] Stats fetch error:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Systemstatistiken.' });
  }
});

// 3. Users List
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
  try {
    const users = await db.all('SELECT email, username, last_login_at, created_at FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (err) {
    console.error('[Admin Panel] Users fetch error:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Benutzer.' });
  }
});

// 4. Delete User
app.delete('/api/admin/users/:email', authenticateAdmin, async (req, res) => {
  const { email } = req.params;
  try {
    await db.run('DELETE FROM users WHERE email = ?', [email]);
    res.json({ success: true, message: `Benutzer ${email} und alle zugehörigen Daten wurden gelöscht.` });
  } catch (err) {
    console.error('[Admin Panel] User delete error:', err);
    res.status(500).json({ error: 'Fehler beim Löschen des Benutzers.' });
  }
});

// Helper for generating readable temporary passwords
function generateReadablePassword(length = 10) {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const symbols = '!@#$%&*?';
  const allChars = lowercase + uppercase + digits + symbols;
  
  let password = '';
  // Ensure at least one character from each set for password strength
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += digits[Math.floor(Math.random() * digits.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];

  for (let i = 4; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // Shuffle password characters
  return password.split('').sort(() => 0.5 - Math.random()).join('');
}

// 5. Reset User Password
app.post('/api/admin/users/reset-password', authenticateAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'E-Mail-Adresse fehlt.' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    }

    const tempPassword = generateReadablePassword(10);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // Update password hash and reset security questions (forcing re-creation on login)
    await db.run(
      'UPDATE users SET password_hash = ?, security_question = NULL, security_answer_hash = NULL WHERE email = ?',
      [passwordHash, email]
    );

    res.json({
      success: true,
      email,
      tempPassword
    });
  } catch (err) {
    console.error('[Admin Panel] Password reset error:', err);
    res.status(500).json({ error: 'Fehler beim Zurücksetzen des Passworts.' });
  }
});

// 6. Quizzes List
app.get('/api/admin/quizzes', authenticateAdmin, async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT q.id, q.name, q.user_email, q.categories, q.icon, q.is_complete, q.is_public, q.created_at, q.updated_at, u.username as creator_username 
      FROM quizzes q 
      JOIN users u ON q.user_email = u.email 
      ORDER BY q.created_at DESC
    `);

    const quizzes = rows.map(row => {
      let categoriesCount = 0;
      let questionsCount = 0;
      let categoriesObj = [];
      try {
        categoriesObj = JSON.parse(row.categories);
        categoriesCount = categoriesObj.length;
        categoriesObj.forEach(c => {
          if (c.questions) questionsCount += c.questions.length;
        });
      } catch (e) {
        // Handle parsing errors
      }

      return {
        id: row.id,
        name: row.name,
        icon: row.icon || '📝',
        creatorEmail: row.user_email,
        creatorName: row.creator_username,
        categoriesCount,
        questionsCount,
        categories: categoriesObj,
        isComplete: row.is_complete === 1,
        isPublic: row.is_public === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });

    res.json(quizzes);
  } catch (err) {
    console.error('[Admin Panel] Quizzes fetch error:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Quizzes.' });
  }
});

// 7. Delete Quiz
app.delete('/api/admin/quizzes/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.run('DELETE FROM quizzes WHERE id = ?', [id]);
    res.json({ success: true, message: `Quiz ${id} wurde gelöscht.` });
  } catch (err) {
    console.error('[Admin Panel] Quiz delete error:', err);
    res.status(500).json({ error: 'Fehler beim Löschen des Quizzes.' });
  }
});

// 8. Toggle Public Status of Quiz
app.post('/api/admin/quizzes/toggle-public/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const quiz = await db.get('SELECT * FROM quizzes WHERE id = ?', [id]);
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz nicht gefunden.' });
    }

    if (quiz.is_complete !== 1 && quiz.is_public === 0) {
      return res.status(400).json({ error: 'Ein unvollständiges Quiz kann nicht öffentlich geschaltet werden.' });
    }

    const newPublicState = quiz.is_public === 1 ? 0 : 1;
    await db.run('UPDATE quizzes SET is_public = ? WHERE id = ?', [newPublicState, id]);
    res.json({ success: true, isPublic: newPublicState === 1 });
  } catch (err) {
    console.error('[Admin Panel] Quiz public toggle error:', err);
    res.status(500).json({ error: 'Fehler beim Umschalten der Sichtbarkeit.' });
  }
});

// --- GIT INTEGRATION APIs ---
const { exec } = require('child_process');

function runGitCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: path.join(__dirname, '..') }, (error, stdout, stderr) => {
      if (error) {
        reject(stdout + stderr || error.message);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// 9. Git Status & Branches
app.get('/api/admin/git/status', authenticateAdmin, async (req, res) => {
  try {
    // Check if git is available
    try {
      await runGitCommand('git rev-parse --is-inside-work-tree');
    } catch (e) {
      return res.json({ available: false, reason: 'Kein Git-Repository gefunden oder Git ist nicht installiert.' });
    }

    // Get current branch/commit
    const currentRef = await runGitCommand('git rev-parse --abbrev-ref HEAD');
    const isDetached = currentRef === 'HEAD';
    
    let activeBranch = currentRef;
    let activeCommit = '';
    if (isDetached) {
      activeCommit = await runGitCommand('git rev-parse --short HEAD');
      activeBranch = `Detached HEAD (${activeCommit})`;
    } else {
      activeCommit = await runGitCommand('git rev-parse --short HEAD');
    }

    // Get status (clean/dirty)
    const statusOutput = await runGitCommand('git status --porcelain');
    const isClean = statusOutput === '';

    // Get list of local and remote branches
    const branchesOutput = await runGitCommand('git branch -a');
    const lines = branchesOutput.split('\n').filter(Boolean);
    const branches = [];
    
    for (let line of lines) {
      line = line.trim();
      const isCurrent = line.startsWith('*');
      let name = line.replace(/^\*\s*/, '').trim();
      
      // Skip HEAD symbolic ref
      if (name.includes('->')) {
        continue;
      }
      
      let displayName = name;
      let isRemote = false;
      if (name.startsWith('remotes/')) {
        name = name.substring(8); // Remove "remotes/" prefix
        displayName = name;
        isRemote = true;
      }

      // Deduplicate remote tracking names
      if (isRemote && name.startsWith('origin/')) {
        displayName = name.substring(7); // Show "main" instead of "origin/main" in visual list if appropriate, but keep name as target
      }

      branches.push({
        name,          // Checkout target e.g. "main" or "origin/main"
        displayName,   // Visual label
        isCurrent,
        isRemote
      });
    }

    res.json({
      available: true,
      activeBranch,
      activeCommit,
      isClean,
      isDetached,
      branches
    });
  } catch (err) {
    console.error('[Admin Panel] Git status error:', err);
    res.status(500).json({ error: 'Fehler beim Abrufen des Git-Status.' });
  }
});

// 10. Git Commits Log
app.get('/api/admin/git/commits', authenticateAdmin, async (req, res) => {
  try {
    try {
      await runGitCommand('git rev-parse --is-inside-work-tree');
    } catch (e) {
      return res.json({ available: false });
    }

    const logOutput = await runGitCommand('git log -n 20 --pretty=format:"%H|%an|%ad|%s" --date=short');
    const commits = logOutput.split('\n').filter(Boolean).map(line => {
      const [hash, author, date, message] = line.split('|');
      return {
        hash,
        shortHash: hash.substring(0, 7),
        author,
        date,
        message
      };
    });

    res.json(commits);
  } catch (err) {
    console.error('[Admin Panel] Git commits error:', err);
    res.status(500).json({ error: 'Fehler beim Abrufen der Commit-Historie.' });
  }
});

// 10.1 Git Tags (Releases) Log
app.get('/api/admin/git/tags', authenticateAdmin, async (req, res) => {
  try {
    try {
      await runGitCommand('git rev-parse --is-inside-work-tree');
    } catch (e) {
      return res.json({ available: false });
    }

    const logOutput = await runGitCommand('git log --tags --simplify-by-decoration --pretty="format:%d|%H|%an|%ad|%s" --date=short');
    if (!logOutput) {
      return res.json([]);
    }

    const lines = logOutput.split('\n').filter(Boolean);
    const tagsList = [];

    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length < 5) continue;
      
      const decoration = parts[0];
      const hash = parts[1];
      const author = parts[2];
      const date = parts[3];
      const message = parts.slice(4).join('|');

      const matches = decoration.matchAll(/tag:\s*([^,\)]+)/g);
      for (const match of matches) {
        const tagName = match[1].trim();
        tagsList.push({
          name: tagName,
          hash,
          shortHash: hash.substring(0, 7),
          author,
          date,
          message
        });
      }
    }

    // Sort by name descending (latest semver tag first)
    tagsList.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }));

    res.json(tagsList);
  } catch (err) {
    console.error('[Admin Panel] Failed to fetch git tags:', err);
    res.status(500).json({ error: 'Fehler beim Abrufen der Git-Tags.' });
  }
});

// 11. Git Checkout Action
app.post('/api/admin/git/checkout', authenticateAdmin, async (req, res) => {
  const { target, force } = req.body;
  if (!target) {
    return res.status(400).json({ error: 'Checkout-Ziel fehlt.' });
  }

  try {
    // Check if git is available
    try {
      await runGitCommand('git rev-parse --is-inside-work-tree');
    } catch (e) {
      return res.status(400).json({ error: 'Git ist in dieser Umgebung nicht verfügbar.' });
    }

    // Check status first to prevent code loss
    const statusOutput = await runGitCommand('git status --porcelain');
    const isClean = statusOutput === '';

    if (!isClean && !force) {
      return res.status(400).json({ 
        error: 'Arbeitsverzeichnis nicht sauber. Du hast uncommitted Änderungen.',
        isDirty: true 
      });
    }

    // Run checkout (git checkout target)
    let checkoutCmd = `git checkout ${target}`;
    if (force) {
      checkoutCmd = `git checkout -f ${target}`;
    }

    await runGitCommand(checkoutCmd);

    res.json({
      success: true,
      message: `Erfolgreich gewechselt zu: ${target}`
    });
  } catch (err) {
    console.error('[Admin Panel] Git checkout error:', err);
    res.status(500).json({ error: `Checkout fehlgeschlagen: ${err}` });
  }
});

// POST /api/admin/system/restart
app.post('/api/admin/system/restart', authenticateAdmin, (req, res) => {
  res.json({
    success: true,
    message: 'Das Backend-System wird jetzt neu gestartet...'
  });
  console.log('[Admin Panel] System restart triggered by administrator.');
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// POST /api/admin/system/stop
app.post('/api/admin/system/stop', authenticateAdmin, (req, res) => {
  res.json({
    success: true,
    message: 'Das Backend-System wird jetzt gestoppt...'
  });
  console.log('[Admin Panel] System shutdown triggered by administrator.');
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Start listening
app.listen(ADMIN_PORT, () => {
  console.log(`[Admin Panel] Running locally on port ${ADMIN_PORT} (Local access only)`);
});

module.exports = app;
