// website/js/dashboard-user.js
import { db } from './firebase-config.js';
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { currentFirebaseUser } from './auth.js';
import {
  TRAINING_LEVEL_NAMES,
  EXAMINATION_LEVEL_NAMES,
  ASSESSMENT_LEVEL_NAMES,
  MAINTENANCE_LEVEL_NAMES
} from './constants.js';
import { showMessage } from './utils.js';

// ----- tiny DOM helpers
const $id = (id) => document.getElementById(id);
const setText = (id, value) => { const el = $id(id); if (el) el.textContent = value ?? ''; };

/**
 * Capitalize the first letter of a string
 * @param {string} str - String to capitalize
 * @returns {string} String with first letter capitalized
 */
function capitalizeFirstLetter(str) {
  if (!str || typeof str !== 'string') return str || '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Format birthdate to MM/DD/YYYY format
 * @param {string} birthdate - Birthdate string (YYYY-MM-DD format or ISO string)
 * @returns {string} Formatted date in MM/DD/YYYY format or empty string
 */
function formatBirthdate(birthdate) {
  if (!birthdate) return '';
  
  try {
    // Handle Firestore Timestamp object
    if (birthdate && typeof birthdate === 'object' && birthdate.toDate) {
      const date = birthdate.toDate();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const year = date.getFullYear();
      return `${month}/${day}/${year}`;
    }
    
    // Handle Firestore Timestamp with seconds property
    if (birthdate && typeof birthdate === 'object' && birthdate.seconds) {
      const date = new Date(birthdate.seconds * 1000);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const year = date.getFullYear();
      return `${month}/${day}/${year}`;
    }
    
    // Handle YYYY-MM-DD format (from date input)
    if (typeof birthdate === 'string' && birthdate.match(/^\d{4}-\d{2}-\d{2}/)) {
      const parts = birthdate.split('-');
      if (parts.length >= 3) {
        const year = parts[0];
        const month = parts[1];
        const day = parts[2].split('T')[0]; // Handle ISO strings with time
        return `${month}/${day}/${year}`;
      }
    }
    
    // Fallback to Date object for other formats
    const date = new Date(birthdate);
    if (isNaN(date.getTime())) return '';
    
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${month}/${day}/${year}`;
  } catch (error) {
    console.error('Error formatting birthdate:', error, birthdate);
    return '';
  }
}

// ----- mapping helpers
const NAME_MAP = {
  Training: TRAINING_LEVEL_NAMES,
  Quiz: EXAMINATION_LEVEL_NAMES,
  Assessment: ASSESSMENT_LEVEL_NAMES,
  Maintenance: MAINTENANCE_LEVEL_NAMES
};

/**
 * Short-key -> Full display name mapping for quiz keys stored in DB
 */
const QUIZ_KEY_TO_DISPLAY = {
  Crimp: "Crimping & Wires",
  WISP: "WISP Fundamentals",
  Router: "Router Configuration",
  Tool: "Tool Descriptions & Usages",
  SOP: "Standard Operating Procedure",
  Problem: "Maintenance & Troubleshooting"
};

/**
 * Short-key -> Full display name mapping for training keys stored in DB
 */
const TRAINING_KEY_TO_DISPLAY = {
  training_antenna_install: "Antenna Installation",
  training_router_install: "Router Installation",
  training_crimping: "Cable Crimping",
  training_cable_laying: "Cable Laying",
  training_signal_opt: "Signal Optimization"
};

// Placeholders for Assessment & Maintenance
const ASSESSMENT_KEY_TO_DISPLAY = {
  assessment_level: "Assessment Level"
};

const MAINTENANCE_KEY_TO_DISPLAY = {
  M1: "Signal Loss After Storm",
  M2: "Intermittent Connection",
  M3: "Sudden Slow Speeds",
  M4: "No Connection After Move",
  M5: "No Power to Router",
};

/**
 * Convert Unix timestamp → formatted string
 */
function formatUnixTimestamp(ts) {
  if (!ts && ts !== 0) return 'N/A';
  if (typeof ts === 'object' && ts.seconds) ts = ts.seconds;
  if (typeof ts !== 'number') return 'N/A';
  const maybeSeconds = ts > 1e12 ? Math.floor(ts / 1000) : ts;
  return new Date(maybeSeconds * 1000).toLocaleString();
}

/**
 * Helper: extract ONLY the first attempt info
 * Supports:
 *  - rec.attempts (object with numeric keys)
 *  - rec.attemptHistory (array)
 *  - legacy single-record style (direct fields on rec)
 */
function extractFirstAttemptFromRecord(rec) {
  const res = { score: 0, completed: false, date: 'N/A' };
  if (!rec || typeof rec !== 'object') return res;

  // Helper: return attempts array in numeric order
  function attemptsArrayFromRecord(r) {
    if (!r || typeof r !== 'object') return [];
    if (Array.isArray(r.attemptHistory) && r.attemptHistory.length) return r.attemptHistory;
    if (r.attempts && typeof r.attempts === 'object') {
      // attempts could be an object with numeric keys (0,1,2...) — sort by numeric key
      if (Array.isArray(r.attempts)) return r.attempts;
      return Object.keys(r.attempts)
        .filter(k => r.attempts[k] != null)
        .sort((a, b) => Number(a) - Number(b))
        .map(k => r.attempts[k]);
    }
    return [];
  }

  // Helper: pick numeric timestamp in seconds (or seconds-like firestore object)
  function pickTimestamp(a) {
    if (!a) return null;
    let cand = a.timestamp ?? a.timeStamp ?? a.time?.timestamp ?? a.createdAt ?? a.date ?? null;
    if (cand == null) return null;
    // Firestore Timestamp object: { seconds: ..., nanoseconds: ... }
    if (typeof cand === 'object' && cand.seconds != null) return Number(cand.seconds);
    // numeric string or number (seconds or ms)
    if (!isNaN(Number(cand))) return Number(cand);
    return null;
  }

  // Helper: pick score number if present
  function pickScore(a) {
    if (!a) return null;
    if (typeof a.performanceScore === 'number') return Math.round(a.performanceScore);
    if (typeof a.score === 'number') return Math.round(a.score);
    if (typeof a.marks === 'number') return Math.round(a.marks);
    if (typeof a.percentage === 'number') return Math.round(a.percentage);
    return null;
  }

  const attempts = attemptsArrayFromRecord(rec);
  if (attempts.length > 0) {
    const first = attempts[0] || {};

    const s = pickScore(first);
    if (s != null) res.score = s;

    // Completed state: prefer flag on the attempt, but fall back to record-level isCompleted/status
    res.completed = !!(
      first.isCompleted ||
      rec.isCompleted ||
      /(completed|passed)/i.test(String(first.status || rec.status || ''))
    );

    const ts = pickTimestamp(first);
    if (ts != null) res.date = formatUnixTimestamp(ts);

    return res;
  }

  // No attempts/attemptHistory — treat rec itself as the attempt (legacy)
  const s2 = pickScore(rec);
  if (s2 != null) res.score = s2;

  res.completed = !!(rec.isCompleted || /(completed|passed)/i.test(String(rec.status || '')));
  const ts2 = pickTimestamp(rec);
  if (ts2 != null) res.date = formatUnixTimestamp(ts2);

  return res;
}

/**
 * Build a Map of user's first-attempt scores
 */
export async function buildUserScoresMap(uid) {
  const out = new Map();
  if (!uid) return out;

  try {
    const userDocSnap = await getDoc(doc(db, 'userProfiles', uid));
    if (!userDocSnap.exists()) return out;
    const profile = userDocSnap.data() || {};

    const processObjectBag = (bag, category, keyToDisplayMap) => {
      if (!bag || typeof bag !== 'object') return;
      Object.entries(bag).forEach(([rawKey, rec]) => {
        if (!rawKey) return;
        if (String(rawKey).toLowerCase().includes('default_quiz_id')) return;

        const displayName = (keyToDisplayMap && keyToDisplayMap[rawKey]) || rawKey;
        const idx = (NAME_MAP[category] || []).findIndex(n => n === displayName);
        if (idx < 0) {
          const altIdx = (NAME_MAP[category] || []).findIndex(n => n === rawKey);
          if (altIdx < 0) return;
          out.set(`${category}|${altIdx}`, extractFirstAttemptFromRecord(rec));
          return;
        }
        out.set(`${category}|${idx}`, extractFirstAttemptFromRecord(rec));
      });
    };

    const processArrayProgress = (arr, category) => {
      if (!Array.isArray(arr)) return;
      const names = NAME_MAP[category] || [];
      arr.forEach((slot, i) => {
        if (i >= names.length) return;
        out.set(`${category}|${i}`, extractFirstAttemptFromRecord(slot));
      });
    };

    // QUIZ
    if (profile.quizData && typeof profile.quizData === 'object') {
      processObjectBag(profile.quizData, 'Quiz', QUIZ_KEY_TO_DISPLAY);
    } else if (Array.isArray(profile.quizProgress)) {
      processArrayProgress(profile.quizProgress, 'Quiz');
    }

    // TRAINING
    if (profile.trainingData && typeof profile.trainingData === 'object') {
      processObjectBag(profile.trainingData, 'Training', TRAINING_KEY_TO_DISPLAY);
    } else if (Array.isArray(profile.trainingProgress)) {
      processArrayProgress(profile.trainingProgress, 'Training');
    }

    // ASSESSMENT
    if (profile.assessmentData && typeof profile.assessmentData === 'object') {
      processObjectBag(profile.assessmentData, 'Assessment', ASSESSMENT_KEY_TO_DISPLAY);
    } else if (Array.isArray(profile.assessmentProgress)) {
      processArrayProgress(profile.assessmentProgress, 'Assessment');
    }

    // MAINTENANCE
    if (profile.maintenanceData && typeof profile.maintenanceData === 'object') {
      processObjectBag(profile.maintenanceData, 'Maintenance', MAINTENANCE_KEY_TO_DISPLAY);
    } else if (Array.isArray(profile.maintenanceProgress)) {
      processArrayProgress(profile.maintenanceProgress, 'Maintenance');
    }

  } catch (err) {
    console.error('[dashboard-user.js] Error building user scores map:', err);
  }

  return out;
}

/**
 * Render table + cards for selected category
 */
async function renderCategory(profile, category) {
  const tbody = $id('userDashboardActivitiesTable');
  const cardContainer = $id('userDashboardActivitiesCards');

  if (tbody) tbody.innerHTML = '';
  if (cardContainer) cardContainer.innerHTML = '';

  let pending = 0;

  const levelNames = NAME_MAP[category] || [];
  const uid = currentFirebaseUser?.uid || profile?.userID;
  const userScores = uid ? await buildUserScoresMap(uid) : new Map();

  levelNames.forEach((levelName, index) => {
    const key = `${category}|${index}`;
    const data = userScores.get(key) || { score: 0, completed: false, date: 'N/A' };
    if (!data.completed) pending++;

    // --- TABLE ROW ---
    if (tbody) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${category}</td>
        <td>${levelName}</td>
        <td>
          <span class="status-badge ${data.completed ? 'status-completed' : 'status-pending'}">
            ${data.completed ? 'Completed' : 'Pending'} (${data.score}%)
          </span>
        </td>
        <td>${data.date}</td>
      `;
      tbody.appendChild(tr);
    }

    // --- CARD ENTRY ---
    if (cardContainer) {
      const card = document.createElement('div');
      card.classList.add('activity-card');
      card.innerHTML = `
        <p><strong>Category:</strong> ${category}</p>
        <p><strong>Level:</strong> ${levelName}</p>
        <p><strong>Status:</strong> ${data.completed ? 'Completed' : 'Pending'} (${data.score}%)</p>
        <p><strong>Date:</strong> ${data.date}</p>
      `;
      cardContainer.appendChild(card);
    }
  });

  setText('userDashboardPendingCount', String(pending));
}

/* -------------------------
   PRINT: Formal User Report
--------------------------*/
export async function collectAllRows(profile) {
  const uid = currentFirebaseUser?.uid || profile?.userID;
  const categories = ['Quiz', 'Training', 'Assessment', 'Maintenance'];
  const rows = [];
  const counts = { total: 0, completed: 0, pending: 0, byCategory: {} };

  const userScores = uid ? await buildUserScoresMap(uid) : new Map();

  for (const category of categories) {
    const levelNames = NAME_MAP[category] || [];
    counts.byCategory[category] = { total: 0, completed: 0, pending: 0 };

    levelNames.forEach((levelName, index) => {
      const key = `${category}|${index}`;
      const data = userScores.get(key) || { score: 0, completed: false, date: 'N/A' };

      rows.push({
        category,
        index: index + 1,
        activityName: levelName,
        score: data.score,
        done: data.completed,
        date: data.date
      });

      counts.total++;
      counts.byCategory[category].total++;
      if (data.completed) {
        counts.completed++;
        counts.byCategory[category].completed++;
      } else {
        counts.pending++;
        counts.byCategory[category].pending++;
      }
    });
  }

  return { rows, counts };
}

function buildPrintableHTML(profile, rows) {
  const fullName =
    profile?.username ||
    `${(profile?.firstName || '').trim()} ${(profile?.lastName || '').trim()}`.trim() ||
    '[Name N/A]';
  const email = profile?.email || '[Email N/A]';
  const role = profile?.role ? capitalizeFirstLetter(profile.role) : '[Role N/A]';
  const genDate = new Date().toLocaleString();

  const tableRows = rows.map(r => `
    <tr>
      <td>${r.category}</td>
      <td>${r.activityName}</td>
      <td>${r.done ? 'Completed' : 'Pending'}</td>
      <td>${r.score}%</td>
      <td>${r.date}</td>
    </tr>
  `).join('');

  return `
    <html>
      <head>
        <title>User Score Report</title>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          h1 { text-align: center; margin-bottom: 6px; }
          h3 { text-align: center; margin-top: 0; font-weight: normal; color: #555; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #333; padding: 8px; text-align: left; font-size: 14px; }
          th { background-color: #f2f2f2; }
          .meta { margin: 18px 0; }
        </style>
      </head>
      <body>
        <h1>DelaCruz Network Solutions</h1>
        <h3>User Score Report</h3>
        <div class="meta">
          <div><strong>Name:</strong> ${fullName}</div>
          <div><strong>Email:</strong> ${email}</div>
          <div><strong>Role:</strong> ${role}</div>
          <div><strong>Generated:</strong> ${genDate}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Level / Activity</th>
              <th>Status</th>
              <th>Score (%)</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `;
}

function bindPrintButton(profile) {
  const btn = $id('userDashboardPrintBtn') || $id('printScoresBtn');
  if (!btn || btn.dataset.bound) return;

  btn.addEventListener('click', async () => {
    try {
      const { rows } = await collectAllRows(profile);
      const html = buildPrintableHTML(profile, rows);
      const win = window.open('', '', 'height=900,width=1200');
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    } catch (err) {
      console.error('[dashboard-user.js] Print failed:', err);
      showMessage(null, 'Unable to generate print report.', 'error');
    }
  });

  btn.dataset.bound = '1';
}

export async function populateUserDashboardElements(profile) {
  try {
    if (!profile) return;

    setText('userDashboardFullName',
      profile.username ||
      `${(profile.firstName || '').trim()} ${(profile.lastName || '').trim()}`.trim() || '[Name N/A]'
    );
    setText('userDashboardEmail', profile.email || '[Email N/A]');
    setText('userDashboardBirthdate', formatBirthdate(profile.birthdate) || '[Birthdate N/A]');
    setText('userDashboardRole', profile.role ? capitalizeFirstLetter(profile.role) : '[Role N/A]');

    const selector = $id('userDashboardActivityFilter');
    const category = selector?.value || 'Quiz';

    await renderCategory(profile, category);

    if (selector && !selector.dataset.bound) {
      selector.addEventListener('change', async () => {
        await renderCategory(profile, selector.value || 'Quiz');
      });
      selector.dataset.bound = '1';
    }

    bindPrintButton(profile);

    console.log('[dashboard-user.js] User dashboard populated.');
  } catch (err) {
    console.error('[dashboard-user.js] Error populating dashboard:', err);
    showMessage(null, 'Error loading dashboard', 'error');
  }
}
