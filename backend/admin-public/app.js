// Global State
let activeTab = 'dashboard';
let users = [];
let quizzes = [];
let stats = {};
let adminToken = localStorage.getItem('jeopardy_admin_token') || '';
let setupRequired = false;
let userSortColumn = 'created_at';
let userSortDirection = 'desc';
let growthChart = null;
let growthChartMode = 'cumulative'; // 'cumulative' or 'daily'
let refreshIntervalId = null;

// Confirm Modal Callback
let confirmCallback = null;

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  // Init Lucide Icons
  lucide.createIcons();
  
  // Setup Auto-Refresh Listeners
  const autoRefreshToggle = document.getElementById('autoRefreshToggle');
  autoRefreshToggle.addEventListener('change', toggleAutoRefresh);
  
  // Check access requirement first
  checkAccess();
});

// Switch Tab logic
function switchTab(tabId) {
  activeTab = tabId;
  
  // Update nav buttons
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.remove('active');
  });
  event.currentTarget.classList.add('active');

  // Update sections
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  document.getElementById(`tab-${tabId}`).classList.add('active');

  // Update Page Title
  const titles = {
    dashboard: 'Dashboard Overview',
    users: 'Benutzer-Verwaltung',
    quizzes: 'Quiz-Bibliothek',
    git: 'Versions-Verwaltung & Git',
    system: 'System & Logs'
  };
  document.getElementById('pageTitle').textContent = titles[tabId] || 'Admin';

  // Toggle dashboard range filter visibility
  const rangeFilter = document.getElementById('dashboard-range-filter');
  if (rangeFilter) {
    rangeFilter.style.display = tabId === 'dashboard' ? 'flex' : 'none';
  }

  // Fetch updated data for target tab
  fetchData();
}

// Fetch helper with headers
async function adminFetch(url, options = {}) {
  options.headers = {
    ...options.headers,
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`
  };
  
  const response = await fetch(url, options);
  
  if (response.status === 401) {
    showLoginModal();
    throw new Error('Unauthorized');
  }
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error ${response.status}`);
  }
  
  return response.json();
}

// Check if setup is required or if we have a valid token
async function checkAccess() {
  try {
    const res = await fetch('/api/admin/setup-status');
    const data = await res.json();
    
    setupRequired = data.setupRequired;

    const modalTitle = document.getElementById('loginModalTitle');
    const modalDesc = document.getElementById('loginModalDesc');
    const confirmGroup = document.getElementById('adminConfirmGroup');
    const submitBtn = document.getElementById('loginSubmitBtn');
    const loginIcon = document.getElementById('loginIcon');

    if (setupRequired) {
      // Setup Mode
      if (modalTitle) modalTitle.textContent = 'Admin-Konto einrichten';
      if (modalDesc) modalDesc.textContent = 'Erstelle das erste Administrations-Konto für diesen Server.';
      if (confirmGroup) confirmGroup.style.display = 'block';
      if (submitBtn) submitBtn.textContent = 'Admin-Konto erstellen & anmelden';
      if (loginIcon) loginIcon.setAttribute('data-lucide', 'shield-plus');
      lucide.createIcons();
      showLoginModal();
    } else {
      // Standard Login Mode
      if (modalTitle) modalTitle.textContent = 'Admin-Verifizierung';
      if (modalDesc) modalDesc.textContent = 'Bitte melde dich mit deinen Admin-Zugangsdaten an.';
      if (confirmGroup) confirmGroup.style.display = 'none';
      if (submitBtn) submitBtn.textContent = 'Anmelden';
      if (loginIcon) loginIcon.setAttribute('data-lucide', 'shield-check');
      lucide.createIcons();

      document.getElementById('sys-passcode-status').innerHTML = '<span class="badge badge-success">Aktiv (Benutzer-Datenbank)</span>';

      if (adminToken) {
        // Verify current token
        try {
          await adminFetch('/api/admin/stats');
          hideLoginModal();
          fetchData();
          startAutoRefresh();
        } catch (e) {
          // Token invalid, show login
          showLoginModal();
        }
      } else {
        showLoginModal();
      }
    }
  } catch (err) {
    console.error('Setup status verification failed:', err);
    showLoginModal();
  }
}

// Login & Setup form handler
async function handleAuthSubmit(event) {
  event.preventDefault();
  const usernameField = document.getElementById('adminUsername');
  const passwordField = document.getElementById('adminPassword');
  const confirmPasswordField = document.getElementById('adminConfirmPassword');
  const errorMsg = document.getElementById('loginError');

  const username = usernameField.value;
  const password = passwordField.value;

  if (setupRequired) {
    // Validate confirm password
    const confirmPassword = confirmPasswordField.value;
    if (password !== confirmPassword) {
      errorMsg.style.display = 'block';
      errorMsg.textContent = 'Die Passwörter stimmen nicht überein.';
      return;
    }

    try {
      const res = await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (res.ok) {
        adminToken = data.token;
        localStorage.setItem('jeopardy_admin_token', adminToken);
        hideLoginModal();
        errorMsg.style.display = 'none';
        
        usernameField.value = '';
        passwordField.value = '';
        confirmPasswordField.value = '';
        setupRequired = false;

        fetchData();
        startAutoRefresh();
      } else {
        errorMsg.style.display = 'block';
        errorMsg.textContent = data.error || 'Setup fehlgeschlagen.';
      }
    } catch (err) {
      errorMsg.style.display = 'block';
      errorMsg.textContent = 'Server-Verbindung fehlgeschlagen.';
    }
  } else {
    // Standard Login
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (res.ok) {
        adminToken = data.token;
        localStorage.setItem('jeopardy_admin_token', adminToken);
        hideLoginModal();
        errorMsg.style.display = 'none';
        
        usernameField.value = '';
        passwordField.value = '';

        fetchData();
        startAutoRefresh();
      } else {
        errorMsg.style.display = 'block';
        errorMsg.textContent = data.error || 'Falsche Anmeldedaten.';
      }
    } catch (err) {
      errorMsg.style.display = 'block';
      errorMsg.textContent = 'Server-Verbindung fehlgeschlagen.';
    }
  }
}

function showLoginModal() {
  document.getElementById('loginModal').classList.add('active');
  document.getElementById('loginModal').style.display = 'flex';
  stopAutoRefresh();
}

function hideLoginModal() {
  document.getElementById('loginModal').classList.remove('active');
  document.getElementById('loginModal').style.display = 'none';
}

// Fetch all resources
async function fetchData() {
  const refreshIcon = document.getElementById('refreshIcon');
  if (refreshIcon) refreshIcon.classList.add('spinning');

  try {
    // 1. Stats
    if (activeTab === 'dashboard' || activeTab === 'system') {
      const range = document.getElementById('statRange')?.value || 'days';
      const statsData = await adminFetch(`/api/admin/stats?range=${range}`);
      stats = statsData;
      renderDashboardStats();
    }

    // 2. Users
    if (activeTab === 'users' || activeTab === 'dashboard') {
      users = await adminFetch('/api/admin/users');
      if (activeTab === 'users') {
        filterUsers();
      } else {
        renderUsersTable();
      }
    }

    // 3. Quizzes
    if (activeTab === 'quizzes') {
      quizzes = await adminFetch('/api/admin/quizzes');
      filterQuizzes();
    }

    // 4. Git
    if (activeTab === 'git') {
      await fetchGitData();
    }
  } catch (err) {
    console.error('Fetch error:', err);
  } finally {
    setTimeout(() => {
      const icon = document.getElementById('refreshIcon');
      if (icon) icon.classList.remove('spinning');
    }, 500);
  }
}

// Render Dashboard
function renderDashboardStats() {
  if (!stats || !stats.totals) return;

  // Numbers
  document.getElementById('stat-users').textContent = stats.totals.users;
  document.getElementById('stat-quizzes').textContent = stats.totals.quizzes;
  document.getElementById('stat-public').textContent = stats.totals.publicQuizzes;
  document.getElementById('stat-lobbies').textContent = stats.totals.lobbies;
  document.getElementById('stat-requests').textContent = stats.totals.requests;
  
  // DB Size
  const dbSizeEl = document.getElementById('sys-db-size');
  if (dbSizeEl) dbSizeEl.textContent = stats.totals.dbSize;

  // Environment mode
  const envBadge = document.getElementById('env-badge');
  if (envBadge) {
    envBadge.style.display = 'block';
    if (stats.env === 'production') {
      envBadge.className = 'badge badge-info';
      envBadge.textContent = 'Live-System';
    } else {
      envBadge.className = 'badge badge-warning';
      envBadge.textContent = 'Dev-System';
    }
  }

  // Recent Users Table
  const tbody = document.getElementById('recent-users-body');
  if (tbody) {
    if (!stats.recentUsers || stats.recentUsers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center">Keine Registrierungen vorhanden.</td></tr>';
    } else {
      tbody.innerHTML = stats.recentUsers.map(user => `
        <tr>
          <td>${escapeHtml(user.username)}</td>
          <td>${escapeHtml(user.email)}</td>
          <td>${formatDate(user.created_at)}</td>
        </tr>
      `).join('');
    }
  }

  // Draw/Update Growth Chart
  drawGrowthChart(stats.signupStats, stats.quizStats);

  // Draw/Update Activity Chart
  drawActivityChart(stats.lobbyStats, stats.trafficStats);
}

// Render Growth Chart
function drawGrowthChart(signupData, quizData) {
  const ctx = document.getElementById('growthChart');
  if (!ctx) return;

  const range = document.getElementById('statRange')?.value || 'days';

  // Set title dynamically in the card header
  const titleMap = {
    days: 'Registrierungen & Quizzes (Letzte 30 Tage)',
    weeks: 'Registrierungen & Quizzes (Letzte 12 Wochen)',
    years: 'Registrierungen & Quizzes (Letzte 5 Jahre)'
  };
  const titleEl = document.getElementById('growthChartTitle');
  if (titleEl) titleEl.textContent = titleMap[range] || 'Registrierungen & Quizzes';

  // Align dates
  const datesSet = new Set();
  signupData.forEach(d => datesSet.add(d.date));
  quizData.forEach(d => datesSet.add(d.date));
  const sortedDates = Array.from(datesSet).sort();

  // Map to counts
  const userCounts = sortedDates.map(date => {
    const found = signupData.find(d => d.date === date);
    return found ? found.count : 0;
  });

  const quizCounts = sortedDates.map(date => {
    const found = quizData.find(d => d.date === date);
    return found ? found.count : 0;
  });

  const isCumulative = growthChartMode === 'cumulative';

  // Calculate cumulative sums
  let userCumulative = 0;
  const userCumulativeData = userCounts.map(count => {
    userCumulative += count;
    return userCumulative;
  });

  let quizCumulative = 0;
  const quizCumulativeData = quizCounts.map(count => {
    quizCumulative += count;
    return quizCumulative;
  });

  const userPlotData = isCumulative ? userCumulativeData : userCounts;
  const quizPlotData = isCumulative ? quizCumulativeData : quizCounts;

  const userLabel = isCumulative ? 'Registrierte Benutzer (Gesamt)' : 'Registrierte Benutzer (Neu)';
  const quizLabel = isCumulative ? 'Erstellte Quizzes (Gesamt)' : 'Erstellte Quizzes (Neu)';

  if (growthChart) {
    growthChart.destroy();
  }

  growthChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sortedDates.map(d => formatDateShort(d)),
      datasets: [
        {
          label: userLabel,
          data: userPlotData,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          borderWidth: 2,
          tension: 0.3,
          fill: true
        },
        {
          label: quizLabel,
          data: quizPlotData,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.1)',
          borderWidth: 2,
          tension: 0.3,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#f3f4f6', font: { family: 'Outfit' } }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af', font: { family: 'Outfit' } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af', precision: 0, font: { family: 'Outfit' } }
        }
      }
    }
  });
}

function toggleGrowthChartMode(mode) {
  growthChartMode = mode;

  const btnCum = document.getElementById('btn-chart-cumulative');
  const btnDaily = document.getElementById('btn-chart-daily');

  if (mode === 'cumulative') {
    if (btnCum) { btnCum.className = 'btn btn-primary btn-sm'; }
    if (btnDaily) { btnDaily.className = 'btn btn-secondary btn-sm'; }
  } else {
    if (btnCum) { btnCum.className = 'btn btn-secondary btn-sm'; }
    if (btnDaily) { btnDaily.className = 'btn btn-primary btn-sm'; }
  }

  if (stats && stats.signupStats && stats.quizStats) {
    drawGrowthChart(stats.signupStats, stats.quizStats);
  }
}

// Render Activity Chart (Lobbies & Traffic)
let activityChart = null;
function drawActivityChart(lobbyData, trafficData) {
  const ctx = document.getElementById('activityChart');
  if (!ctx) return;

  const range = document.getElementById('statRange')?.value || 'days';

  // Align dates
  const datesSet = new Set();
  lobbyData.forEach(d => datesSet.add(d.date));
  trafficData.forEach(d => datesSet.add(d.date));
  const sortedDates = Array.from(datesSet).sort();

  // Map to counts
  const lobbyCounts = sortedDates.map(date => {
    const found = lobbyData.find(d => d.date === date);
    return found ? found.count : 0;
  });

  const trafficCounts = sortedDates.map(date => {
    const found = trafficData.find(d => d.date === date);
    return found ? found.count : 0;
  });

  if (activityChart) {
    activityChart.destroy();
  }

  // Set title dynamically in the card header
  const titleMap = {
    days: 'Lobby-Erstellungen & Server-Anfragen (Letzte 30 Tage)',
    weeks: 'Lobby-Erstellungen & Server-Anfragen (Letzte 12 Wochen)',
    years: 'Lobby-Erstellungen & Server-Anfragen (Letzte 5 Jahre)'
  };
  const titleEl = document.getElementById('activityChartTitle');
  if (titleEl) titleEl.textContent = titleMap[range] || 'Lobby-Erstellungen & Server-Anfragen';

  activityChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedDates.map(d => formatDateShort(d)),
      datasets: [
        {
          label: 'Erstellte Lobbys',
          data: lobbyCounts,
          backgroundColor: 'rgba(168, 85, 247, 0.6)',
          borderColor: '#a855f7',
          borderWidth: 1.5,
          borderRadius: 4
        },
        {
          label: 'Server-Anfragen (Traffic)',
          data: trafficCounts,
          backgroundColor: 'rgba(20, 184, 166, 0.6)',
          borderColor: '#14b8a6',
          borderWidth: 1.5,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#f3f4f6', font: { family: 'Outfit' } }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af', font: { family: 'Outfit' } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af', precision: 0, font: { family: 'Outfit' } }
        }
      }
    }
  });
}

// Render Users list
function renderUsersTable(filteredList = users) {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;

  if (filteredList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Keine Benutzer gefunden.</td></tr>';
    return;
  }

  tbody.innerHTML = filteredList.map(user => `
    <tr>
      <td class="font-weight-medium">${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${user.last_login_at ? formatDate(user.last_login_at) : '<span class="text-muted">Nie</span>'}</td>
      <td>${formatDate(user.created_at)}</td>
      <td class="text-right">
        <div class="actions-cell">
          <button class="btn btn-secondary btn-sm" onclick="triggerResetPassword('${user.email}')" title="Passwort zurücksetzen">
            <i data-lucide="key" class="btn-icon-sz"></i> Passwort zurücksetzen
          </button>
          <button class="btn btn-danger btn-sm" onclick="triggerDeleteUser('${user.email}')" title="Konto löschen">
            <i data-lucide="trash-2" class="btn-icon-sz"></i> Löschen
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  lucide.createIcons();
}

// Render Quizzes list
function renderQuizzesTable(filteredList = quizzes) {
  const tbody = document.getElementById('quizzes-table-body');
  if (!tbody) return;

  if (filteredList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Keine Quizzes gefunden.</td></tr>';
    return;
  }

  tbody.innerHTML = filteredList.map(quiz => {
    const publicBadge = quiz.isPublic
      ? '<span class="badge badge-success">Öffentlich</span>'
      : '<span class="badge badge-danger">Privat</span>';
      
    const completeBadge = quiz.isComplete
      ? '<span class="badge badge-success">Vollständig</span>'
      : '<span class="badge badge-warning">Entwurf</span>';

    return `
      <tr>
        <td>
          <span style="margin-right: 8px; font-size: 1.15rem;">${escapeHtml(quiz.icon)}</span>
          <span class="font-weight-medium">${escapeHtml(quiz.name)}</span>
        </td>
        <td>
          <div class="text-monospace" style="font-size: 0.8rem;">${escapeHtml(quiz.creatorEmail)}</div>
          <div class="text-muted" style="font-size: 0.75rem;">@${escapeHtml(quiz.creatorName)}</div>
        </td>
        <td>${quiz.categoriesCount}</td>
        <td>${quiz.questionsCount}</td>
        <td>${completeBadge}</td>
        <td>${publicBadge}</td>
        <td>${formatDate(quiz.createdAt)}</td>
        <td class="text-right">
          <div class="actions-cell">
            <button class="btn btn-secondary btn-sm" onclick="showQuizDetail('${quiz.id}')" title="Details ansehen">
              <i data-lucide="eye" class="btn-icon-sz"></i> Details
            </button>
            <button class="btn btn-secondary btn-sm" onclick="togglePublicQuiz('${quiz.id}')" title="Sichtbarkeit umschalten">
              <i data-lucide="shuffle" class="btn-icon-sz"></i> Freigabe
            </button>
            <button class="btn btn-danger btn-sm" onclick="triggerDeleteQuiz('${quiz.id}', '${quiz.name}')" title="Quiz löschen">
              <i data-lucide="trash-2" class="btn-icon-sz"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

// User Filter/Search
function filterUsers() {
  const query = document.getElementById('userSearch').value.toLowerCase().trim();
  const filterVal = document.getElementById('userFilter').value;

  let filtered = [...users];

  if (query) {
    filtered = filtered.filter(u => 
      u.username.toLowerCase().includes(query) || 
      u.email.toLowerCase().includes(query)
    );
  }

  if (filterVal === 'today') {
    const today = new Date().toDateString();
    filtered = filtered.filter(u => new Date(u.created_at).toDateString() === today);
  } else if (filterVal === 'week') {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    filtered = filtered.filter(u => new Date(u.created_at).getTime() >= oneWeekAgo);
  }

  // Sort users
  filtered.sort((a, b) => {
    let valA = a[userSortColumn];
    let valB = b[userSortColumn];

    if (valA === null || valA === undefined) valA = '';
    if (valB === null || valB === undefined) valB = '';

    if (typeof valA === 'string') {
      return userSortDirection === 'asc'
        ? valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' })
        : valB.localeCompare(valA, undefined, { numeric: true, sensitivity: 'base' });
    } else {
      return userSortDirection === 'asc' ? valA - valB : valB - valA;
    }
  });

  // Update sort icons in the DOM
  const cols = ['username', 'email', 'last_login_at', 'created_at'];
  cols.forEach(col => {
    const el = document.getElementById(`sort-icon-${col}`);
    if (el) {
      if (col === userSortColumn) {
        el.textContent = userSortDirection === 'asc' ? ' ▲' : ' ▼';
        el.style.opacity = '1';
      } else {
        el.textContent = ' ↕';
        el.style.opacity = '0.3';
      }
    }
  });

  renderUsersTable(filtered);
}

function sortUsers(column) {
  if (userSortColumn === column) {
    userSortDirection = userSortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    userSortColumn = column;
    userSortDirection = 'asc';
  }
  filterUsers();
}

// Quiz Filter/Search
function filterQuizzes() {
  const query = document.getElementById('quizSearch').value.toLowerCase().trim();
  const filterVal = document.getElementById('quizFilter').value;

  let filtered = quizzes;

  if (query) {
    filtered = filtered.filter(q => 
      q.name.toLowerCase().includes(query) || 
      q.creatorEmail.toLowerCase().includes(query)
    );
  }

  if (filterVal === 'public') {
    filtered = filtered.filter(q => q.isPublic);
  } else if (filterVal === 'private') {
    filtered = filtered.filter(q => !q.isPublic);
  } else if (filterVal === 'complete') {
    filtered = filtered.filter(q => q.isComplete);
  } else if (filterVal === 'incomplete') {
    filtered = filtered.filter(q => !q.isComplete);
  }

  renderQuizzesTable(filtered);
}

// Action: Reset password
function triggerResetPassword(email) {
  showConfirmModal(`Möchtest du das Passwort für den Benutzer <strong>${escapeHtml(email)}</strong> wirklich zurücksetzen? Dadurch wird ein neues Passwort generiert und die Sicherheitsfrage gelöscht.`, async () => {
    try {
      const data = await adminFetch('/api/admin/users/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      
      // Open Passwort modal displaying the new password
      document.getElementById('tempPasswordText').textContent = data.tempPassword;
      document.getElementById('passwordResetModal').classList.add('active');
      document.getElementById('passwordResetModal').style.display = 'flex';
      
      fetchData(); // reload
    } catch (err) {
      alert('Passwort-Reset fehlgeschlagen: ' + err.message);
    }
  });
}

function closePasswordResetModal() {
  document.getElementById('passwordResetModal').classList.remove('active');
  document.getElementById('passwordResetModal').style.display = 'none';
  document.getElementById('copySuccessMsg').style.display = 'none';
}

function copyPasswordToClipboard() {
  const passwordText = document.getElementById('tempPasswordText').textContent;
  navigator.clipboard.writeText(passwordText).then(() => {
    document.getElementById('copySuccessMsg').style.display = 'block';
  }).catch(err => {
    console.error('Could not copy text: ', err);
  });
}

// Action: Delete user
function triggerDeleteUser(email) {
  showConfirmModal(`Möchtest du das Konto von <strong>${escapeHtml(email)}</strong> wirklich löschen? Dies löscht auch alle Quizzes und Favoriten dieses Benutzers unwiderruflich!`, async () => {
    try {
      const data = await adminFetch(`/api/admin/users/${encodeURIComponent(email)}`, {
        method: 'DELETE'
      });
      fetchData();
    } catch (err) {
      alert('Fehler beim Löschen des Benutzers: ' + err.message);
    }
  });
}

// Action: Delete quiz
function triggerDeleteQuiz(id, name) {
  showConfirmModal(`Möchtest du das Quiz <strong>${escapeHtml(name)}</strong> wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`, async () => {
    try {
      const data = await adminFetch(`/api/admin/quizzes/${id}`, {
        method: 'DELETE'
      });
      fetchData();
    } catch (err) {
      alert('Fehler beim Löschen des Quizzes: ' + err.message);
    }
  });
}

// Action: Toggle visibility
async function togglePublicQuiz(id) {
  try {
    const data = await adminFetch(`/api/admin/quizzes/toggle-public/${id}`, {
      method: 'POST'
    });
    fetchData();
  } catch (err) {
    alert('Fehler beim Ändern des Sichtbarkeitsstatus: ' + err.message);
  }
}

// Action: Show Quiz details
function showQuizDetail(id) {
  const quiz = quizzes.find(q => q.id === id);
  if (!quiz) return;

  document.getElementById('detailQuizName').textContent = `${quiz.icon} ${quiz.name}`;
  
  let html = '';
  if (!quiz.categories || quiz.categories.length === 0) {
    html = '<p class="text-center text-muted">Dieses Quiz enthält keine Kategorien.</p>';
  } else {
    html = quiz.categories.map(cat => {
      const questionsHtml = cat.questions && cat.questions.length > 0
        ? cat.questions.map((q, idx) => {
            const mediaBadges = [];
            if (q.image) mediaBadges.push('<span class="badge badge-info"><i data-lucide="image" class="btn-icon-sz"></i> Bild</span>');
            if (q.audio) mediaBadges.push('<span class="badge badge-info"><i data-lucide="music" class="btn-icon-sz"></i> Audio</span>');
            
            return `
              <div class="q-item">
                <div class="q-label">Frage ${idx + 1} (${(idx + 1) * 100} Pkt): ${escapeHtml(q.text || 'Kein Text')}</div>
                <div class="q-answer">Antwort: ${escapeHtml(q.answer || 'Keine Antwort')}</div>
                ${mediaBadges.length > 0 ? `<div class="media-badges">${mediaBadges.join(' ')}</div>` : ''}
              </div>
            `;
          }).join('')
        : '<p class="text-muted">Keine Fragen in dieser Kategorie.</p>';

      return `
        <div class="cat-preview-box">
          <h4>Kategorie: ${escapeHtml(cat.name)}</h4>
          <div class="questions-preview-list">
            ${questionsHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('detailQuizContent').innerHTML = html;
  
  // Render Lucide inside detail modal
  lucide.createIcons();

  document.getElementById('quizDetailModal').classList.add('active');
  document.getElementById('quizDetailModal').style.display = 'flex';
}

function closeQuizDetailModal() {
  document.getElementById('quizDetailModal').classList.remove('active');
  document.getElementById('quizDetailModal').style.display = 'none';
}

// Confirm Dialog control
function showConfirmModal(text, callback) {
  document.getElementById('confirmText').innerHTML = text;
  confirmCallback = callback;
  
  document.getElementById('confirmModal').classList.add('active');
  document.getElementById('confirmModal').style.display = 'flex';
}

function closeConfirmModal() {
  document.getElementById('confirmModal').classList.remove('active');
  document.getElementById('confirmModal').style.display = 'none';
  confirmCallback = null;
  const submitBtn = document.getElementById('confirmSubmitBtn');
  if (submitBtn) {
    submitBtn.textContent = 'Ja, löschen';
    submitBtn.className = 'btn btn-danger';
  }
}

// Bind the confirm button
document.getElementById('confirmSubmitBtn').addEventListener('click', async () => {
  if (confirmCallback) {
    await confirmCallback();
  }
  closeConfirmModal();
});

// Auto-Refresh polling control
function startAutoRefresh() {
  stopAutoRefresh();
  refreshIntervalId = setInterval(() => {
    fetchData();
  }, 10000);
}

function stopAutoRefresh() {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
}

function toggleAutoRefresh() {
  const isChecked = document.getElementById('autoRefreshToggle').checked;
  if (isChecked) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

// Utility formatting functions
function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleString('de-DE', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  if (dateStr.includes('-W') || dateStr.length === 4) {
    return dateStr;
  }
  const date = new Date(dateStr);
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- GIT MANAGEMENT TAB ---
async function fetchGitData() {
  try {
    const status = await adminFetch('/api/admin/git/status');

    if (!status.available) {
      document.getElementById('git-unavailable-alert').style.display = 'block';
      document.getElementById('git-unavailable-reason').textContent = status.reason;
      document.getElementById('git-content').style.display = 'none';
      return;
    }

    document.getElementById('git-unavailable-alert').style.display = 'none';
    document.getElementById('git-content').style.display = 'flex';

    // Update Overview Cards
    document.getElementById('git-active-branch').textContent = status.activeBranch;
    document.getElementById('git-active-commit').textContent = status.activeCommit;

    const statusBg = document.getElementById('git-status-icon-bg');
    const statusIcon = document.getElementById('git-status-icon');
    const statusText = document.getElementById('git-working-dir-status');

    if (status.isClean) {
      statusText.innerHTML = '<span class="badge badge-success">Sauber</span>';
      if (statusBg) {
        statusBg.className = 'stat-icon green-bg';
      }
      if (statusIcon) {
        statusIcon.setAttribute('data-lucide', 'check-circle');
      }
    } else {
      statusText.innerHTML = '<span class="badge badge-warning">Geändert</span>';
      if (statusBg) {
        statusBg.className = 'stat-icon orange-bg';
      }
      if (statusIcon) {
        statusIcon.setAttribute('data-lucide', 'alert-circle');
      }
    }

    // Render Branches
    const branchesBody = document.getElementById('git-branches-body');
    if (branchesBody) {
      if (!status.branches || status.branches.length === 0) {
        branchesBody.innerHTML = '<tr><td colspan="3" class="text-center">Keine Branches gefunden.</td></tr>';
      } else {
        branchesBody.innerHTML = status.branches.map(branch => {
          const typeBadge = branch.isRemote 
            ? '<span class="badge badge-info">Remote</span>' 
            : '<span class="badge badge-success">Lokal</span>';
            
          const currentBadge = branch.isCurrent
            ? '<span class="badge badge-success" style="margin-left: 8px;">Aktuell</span>'
            : '';

          const actionBtn = branch.isCurrent
            ? '<button class="btn btn-secondary btn-sm" disabled>Aktiv</button>'
            : `<button class="btn btn-primary btn-sm" onclick="switchBranch('${escapeJs(branch.name)}')">Wechseln</button>`;

          return `
            <tr>
              <td>
                <span class="font-weight-medium text-monospace">${escapeHtml(branch.displayName)}</span>
                ${currentBadge}
              </td>
              <td>${typeBadge}</td>
              <td class="text-right">${actionBtn}</td>
            </tr>
          `;
        }).join('');
      }
    }

    // Render Tags (Releases)
    const tagsBody = document.getElementById('git-tags-body');
    if (tagsBody) {
      const tags = await adminFetch('/api/admin/git/tags');
      if (!tags || tags.length === 0) {
        tagsBody.innerHTML = '<tr><td colspan="3" class="text-center">Keine veröffentlichten Versionen (Tags) gefunden.</td></tr>';
      } else {
        tagsBody.innerHTML = tags.map(tag => {
          // Check if active commit matches the tag commit
          const isActive = status.activeCommit.startsWith(tag.shortHash);
          const currentBadge = isActive
            ? '<span class="badge badge-success" style="margin-left: 8px;">Aktuell</span>'
            : '';

          const actionBtn = isActive
            ? '<button class="btn btn-secondary btn-sm" disabled>Aktiv</button>'
            : `<button class="btn btn-primary btn-sm" onclick="revertToCommit('${escapeJs(tag.hash)}', '${escapeJs(tag.name)}')">Wechseln</button>`;

          return `
            <tr>
              <td>
                <span class="font-weight-medium text-monospace" style="color: var(--accent-indigo); font-weight: 600;">${escapeHtml(tag.name)}</span>
                ${currentBadge}
                <div class="text-muted" style="font-size: 0.72rem; margin-top: 4px;">Commit: ${escapeHtml(tag.shortHash)}</div>
              </td>
              <td style="max-width: 200px; word-break: break-word;">
                <div style="font-weight: 500;">${escapeHtml(tag.message)}</div>
                <div class="text-muted" style="font-size: 0.72rem; margin-top: 4px;">${escapeHtml(tag.date)} von ${escapeHtml(tag.author)}</div>
              </td>
              <td class="text-right">${actionBtn}</td>
            </tr>
          `;
        }).join('');
      }
    }

    // Render Commits Log
    const commitsBody = document.getElementById('git-commits-body');
    if (commitsBody) {
      const commits = await adminFetch('/api/admin/git/commits');
      if (!commits || commits.length === 0) {
        commitsBody.innerHTML = '<tr><td colspan="3" class="text-center">Keine Commits vorhanden.</td></tr>';
      } else {
        commitsBody.innerHTML = commits.map(commit => {
          return `
            <tr>
              <td>
                <div class="text-monospace" style="font-weight: 600; color: var(--accent-blue);">${escapeHtml(commit.shortHash)}</div>
                <div class="text-muted" style="font-size: 0.75rem; margin-top: 4px;">${escapeHtml(commit.date)} von ${escapeHtml(commit.author)}</div>
              </td>
              <td style="max-width: 220px; word-break: break-word;">${escapeHtml(commit.message)}</td>
              <td class="text-right">
                <button class="btn btn-secondary btn-sm" onclick="revertToCommit('${escapeJs(commit.hash)}', '${escapeJs(commit.shortHash)}')">
                  <i data-lucide="history" class="btn-icon-sz"></i> Wechseln
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // Create Lucide Icons for dynamic content
    lucide.createIcons();

  } catch (err) {
    console.error('Error fetching git info:', err);
  }
}

async function switchBranch(branchName, force = false) {
  const confirmMsg = force
    ? `Achtung: Du hast ungespeicherte Änderungen! Möchtest du den Wechsel zum Branch <strong>${escapeHtml(branchName)}</strong> wirklich ERZWINGEN? Lokale Änderungen gehen verloren.`
    : `Möchtest du wirklich zum Branch <strong>${escapeHtml(branchName)}</strong> wechseln?`;

  showConfirmModal(confirmMsg, async () => {
    try {
      const res = await adminFetch('/api/admin/git/checkout', {
        method: 'POST',
        body: JSON.stringify({ target: branchName, force })
      });
      alert(res.message || 'Branch erfolgreich gewechselt.');
      fetchData();
    } catch (err) {
      if (err.message.includes('ungespeicherte') || err.message.includes('uncommitted') || err.message.includes('Arbeitsverzeichnis nicht sauber') || err.message.includes('Dirty')) {
        // Offer forced checkout
        setTimeout(() => {
          showConfirmModal(`Wechsel fehlgeschlagen wegen ungespeicherter Änderungen.<br/><br/>Möchtest du den Wechsel zum Branch <strong>${escapeHtml(branchName)}</strong> erzwingen? (Achtung: Lokale Änderungen werden überschrieben!)`, () => {
            switchBranch(branchName, true);
          });
        }, 300);
      } else {
        alert('Fehler beim Branch-Wechsel: ' + err.message);
      }
    }
  });
}

async function revertToCommit(commitHash, shortHash, force = false) {
  const confirmMsg = force
    ? `Achtung: Du hast ungespeicherte Änderungen! Möchtest du das Zurücksetzen auf Version <strong>${shortHash}</strong> wirklich ERZWINGEN? Lokale Änderungen gehen verloren.`
    : `Möchtest du wirklich auf die Version <strong>${shortHash}</strong> zurücksetzen? (Detached HEAD)`;

  showConfirmModal(confirmMsg, async () => {
    try {
      const res = await adminFetch('/api/admin/git/checkout', {
        method: 'POST',
        body: JSON.stringify({ target: commitHash, force })
      });
      alert(res.message || 'Erfolgreich auf Version zurückgesetzt.');
      fetchData();
    } catch (err) {
      if (err.message.includes('ungespeicherte') || err.message.includes('uncommitted') || err.message.includes('Arbeitsverzeichnis nicht sauber') || err.message.includes('Dirty')) {
        // Offer forced checkout
        setTimeout(() => {
          showConfirmModal(`Zurücksetzen fehlgeschlagen wegen ungespeicherter Änderungen.<br/><br/>Möchtest du das Zurücksetzen auf Version <strong>${shortHash}</strong> erzwingen? (Achtung: Lokale Änderungen werden überschrieben!)`, () => {
            revertToCommit(commitHash, shortHash, true);
          });
        }, 300);
      } else {
        alert('Fehler beim Zurücksetzen: ' + err.message);
      }
    }
  });
}

// Simple JS escaping helper
function escapeJs(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

async function controlSystem(action) {
  const isRestart = action === 'restart';
  const confirmMsg = isRestart
    ? 'Möchtest du den Server wirklich neu starten? Das lädt alle Backend- und Frontend-Dienste neu.'
    : 'Möchtest du den Server wirklich stoppen? Die Anwendung ist danach offline, bis sie manuell neu gestartet wird.';

  showConfirmModal(confirmMsg, async () => {
    try {
      // Use standard fetch call since adminFetch might trigger alerts on connection loss
      const response = await fetch(`/api/admin/system/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        }
      });
      
      const result = await response.json();
      
      if (response.ok) {
        // Show an overlay warning that the server is shutting down
        document.body.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #0b0f19; color: #f3f4f6; font-family: 'Outfit', sans-serif; text-align: center; padding: 24px;">
            <div style="margin-bottom: 24px; font-size: 3rem;">
              ${isRestart ? '🔄' : '🛑'}
            </div>
            <h1 style="font-size: 2rem; margin-bottom: 16px; font-weight: 700;">${isRestart ? 'System startet neu...' : 'System heruntergefahren'}</h1>
            <p style="color: #9ca3af; max-width: 480px; font-size: 1rem; line-height: 1.5;">
              ${isRestart 
                ? 'Das System wird neu gestartet. Bitte warte ca. 10 Sekunden und lade die Seite dann neu.' 
                : 'Das System wurde erfolgreich gestoppt. Das Browser-Fenster kann jetzt geschlossen werden.'}
            </p>
            ${isRestart ? '<button onclick="location.reload()" class="btn btn-primary" style="margin-top: 24px; padding: 8px 20px;">Seite neu laden</button>' : ''}
          </div>
        `;
      } else {
        alert(result.error || 'Fehler beim Steuern des Systems.');
      }
    } catch (err) {
      // For restart, network error is expected because the server immediately terminates
      if (isRestart) {
        document.body.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #0b0f19; color: #f3f4f6; font-family: 'Outfit', sans-serif; text-align: center; padding: 24px;">
            <div style="margin-bottom: 24px; font-size: 3rem;">🔄</div>
            <h1 style="font-size: 2rem; margin-bottom: 16px; font-weight: 700;">System startet neu...</h1>
            <p style="color: #9ca3af; max-width: 480px; font-size: 1rem; line-height: 1.5;">
              Das System wird neu gestartet. Bitte warte ca. 10 Sekunden und lade die Seite dann neu.
            </p>
            <button onclick="location.reload()" class="btn btn-primary" style="margin-top: 24px; padding: 8px 20px;">Seite neu laden</button>
          </div>
        `;
      } else {
        alert('Verbindungsfehler: ' + err.message);
      }
    }
  });

  // Customize confirm submit button
  const submitBtn = document.getElementById('confirmSubmitBtn');
  if (submitBtn) {
    submitBtn.textContent = isRestart ? 'Ja, neu starten' : 'Ja, stoppen';
    submitBtn.className = isRestart ? 'btn btn-primary' : 'btn btn-danger';
  }
}

