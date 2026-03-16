// website/js/view-user.js
import { db } from './firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { logoutUser, currentFirebaseUser } from './auth.js';
import { buildUserScoresMap } from './dashboard-user.js';
import {
  EXAMINATION_LEVEL_NAMES,
  TRAINING_LEVEL_NAMES,
  ASSESSMENT_LEVEL_NAMES,
  MAINTENANCE_LEVEL_NAMES
} from './constants.js';

// ---------- Logout binding ----------
const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await logoutUser();
  });
}

// ---------- module-level cache ----------
let cachedAllRows = []; // holds the rows for charts/table/printing
let radarChart = null;
let barChart = null;

// ---------- utilities ----------
function getTargetUserId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("userId") || params.get("uid") || currentFirebaseUser?.uid || null;
}

function getFullName(profile) {
  const fullName = `${(profile.firstName || "").trim()} ${(profile.lastName || "").trim()}`.trim();
  return fullName || "N/A";
}

/**
 * Format user role for display
 * @param {string} role - User role string
 * @returns {string} Formatted role with proper capitalization
 */
function formatRole(role) {
  if (!role) return 'N/A';
  // Map old "user" role to "employee" for display consistency
  const normalizedRole = role.toLowerCase() === 'user' ? 'employee' : role.toLowerCase();
  // Capitalize first letter of each word
  return normalizedRole.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

function findTableBody() {
  const idsToTry = [
    'userDashboardActivitiesTable',
    'scoresTable',
    'scores-table',
    'userActivitiesTable'
  ];
  for (const id of idsToTry) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.tagName && el.tagName.toLowerCase() === 'table') {
      return el.querySelector('tbody') || el;
    }
    if (el.tagName && el.tagName.toLowerCase() === 'tbody') return el;
    const tb = el.querySelector('tbody');
    if (tb) return tb;
  }
  return document.querySelector('#scoresTable tbody, #scores-table tbody, #userDashboardActivitiesTable, .scores-table tbody');
}

// ---------- Charts ----------
function renderRadarChart(category, rows) {
  const canvas = document.getElementById("userRadarChart");
  if (!canvas) return;

  const filtered = rows.filter(r => r.category === category);
  const labels = filtered.map(r => r.activityName);
  const data = filtered.map(r => r.score);

  if (!radarChart) {
    // Create empty chart first
    radarChart = new Chart(canvas, {
      type: "radar",
      data: {
        labels: [],
        datasets: [{
          label: `${category} Scores`,
          data: [],
          backgroundColor: "rgba(54, 162, 235, 0.2)",
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 2,
          pointBackgroundColor: "rgba(54, 162, 235, 1)"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        devicePixelRatio: window.devicePixelRatio || 1,
        scales: { r: { suggestedMin: 0, suggestedMax: 100 } }
      }
    });
    
    // Now update with actual data to trigger animation
    radarChart.data.labels = labels;
    radarChart.data.datasets[0].label = `${category} Scores`;
    radarChart.data.datasets[0].data = data;
    radarChart.update();
  } else {
    radarChart.data.labels = labels;
    radarChart.data.datasets[0].label = `${category} Scores`;
    radarChart.data.datasets[0].data = data;
    radarChart.update();
  }
}

function renderBarChart(rows) {
  const canvas = document.getElementById("userBarChart");
  if (!canvas) return;

  const categories = ["Quiz", "Training", "Assessment", "Maintenance"];
  const averages = categories.map(cat => {
    const filtered = rows.filter(r => r.category === cat);
    if (filtered.length === 0) return 0;
    return Math.round(filtered.reduce((s, x) => s + x.score, 0) / filtered.length);
  });

  const colors = [
    "rgba(255, 99, 132, 0.6)",
    "rgba(54, 162, 235, 0.6)",
    "rgba(255, 206, 86, 0.6)",
    "rgba(75, 192, 192, 0.6)"
  ];

  if (!barChart) {
    // Create empty chart first
    barChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: [],
        datasets: [{ label: "Average Score per Category", data: [], backgroundColor: [] }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, suggestedMax: 100 } }
      }
    });
    
    // Now update with actual data to trigger animation
    barChart.data.labels = categories;
    barChart.data.datasets[0].data = averages;
    barChart.data.datasets[0].backgroundColor = colors;
    barChart.update();
  } else {
    barChart.data.datasets[0].data = averages;
    barChart.update();
  }
}

// ---------- Table ----------
function renderTable(category, rows) {
  const tbody = findTableBody();
  if (!tbody) {
    console.warn("[view-user] Table body not found.");
    return;
  }
  tbody.innerHTML = "";

  const filtered = rows.filter(r => r.category === category);
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">No scores available.</td></tr>`;
    return;
  }

  filtered.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.category}</td>
      <td>${row.activityName}</td>
      <td>
        <span class="status-badge ${row.completed ? 'status-completed' : 'status-pending'}">
          ${row.completed ? 'Completed' : 'Pending'} (${row.score}%)
        </span>
      </td>
      <td>${row.date}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------- Print helper ----------
function buildPrintHtml(profile, rowsToPrint) {
  const fullName = profile?.username || `${(profile?.firstName || '').trim()} ${(profile?.lastName || '').trim()}`.trim() || '[Name N/A]';
  const email = profile?.email || '[Email N/A]';
  const role = formatRole(profile?.role);
  const genDate = new Date().toLocaleString();

  const tableRowsHtml = rowsToPrint.map(r => `
    <tr>
      <td>${r.category}</td>
      <td>${r.activityName}</td>
      <td>${r.completed ? 'Completed' : 'Pending'}</td>
      <td>${r.score}%</td>
      <td>${r.date}</td>
    </tr>
  `).join('');

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>User Score Report - ${fullName}</title>
        <style>
          body{font-family:Arial,Helvetica,sans-serif;margin:24px}
          h1{text-align:center;margin-bottom:6px}
          h3{text-align:center;margin-top:0;color:#555;font-weight:normal}
          table{width:100%;border-collapse:collapse;margin-top:10px}
          th,td{border:1px solid #333;padding:8px;text-align:left;font-size:14px}
          th{background:#f2f2f2}
          .meta{margin:18px 0}
          .footer{position:fixed;right:16px;bottom:12px;font-size:12px;color:#222}
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
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
        <div class="footer">Generated by DelaCruz Network Solutions</div>
      </body>
    </html>
  `;
}

// ---------- Main loader ----------
async function loadUserProfileAndScores() {
  try {
    const uid = getTargetUserId();
    if (!uid) {
      console.warn("[view-user] No target user specified.");
      return;
    }

    const profileRef = doc(db, "userProfiles", uid);
    const snap = await getDoc(profileRef);
    if (!snap.exists()) {
      console.warn("[view-user] User profile not found:", uid);
      return;
    }
    const profile = { userID: uid, ...snap.data() };

    const userNameEl = document.getElementById("userName");
    const userEmailEl = document.getElementById("userEmail");
    const userRoleEl = document.getElementById("userRole");
    if (userNameEl) userNameEl.textContent = getFullName(profile);
    if (userEmailEl) userEmailEl.textContent = profile.email || "N/A";
    if (userRoleEl) userRoleEl.textContent = formatRole(profile.role);

    const categories = {
      Quiz: EXAMINATION_LEVEL_NAMES,
      Training: TRAINING_LEVEL_NAMES,
      Assessment: ASSESSMENT_LEVEL_NAMES,
      Maintenance: MAINTENANCE_LEVEL_NAMES
    };

    if (typeof buildUserScoresMap !== 'function') {
      console.error("[view-user] buildUserScoresMap is not available.");
      const tbodyErr = findTableBody();
      if (tbodyErr) tbodyErr.innerHTML = `<tr><td colspan="4">Configuration error.</td></tr>`;
      return;
    }

    const userScores = await buildUserScoresMap(uid);

    const allRows = [];
    for (const [cat, names] of Object.entries(categories)) {
      names.forEach((name, i) => {
        const key = `${cat}|${i}`;
        const data = userScores.get(key) || { score: 0, completed: false, date: 'N/A' };
        allRows.push({
          category: cat,
          activityName: name,
          index: i,
          score: typeof data.score === 'number' ? data.score : 0,
          completed: !!data.completed,
          date: data.date || 'N/A'
        });
      });
    }

    cachedAllRows = allRows;

    const selector = document.getElementById("userDashboardActivityFilter") || document.getElementById("category-select");
    const initialCategory = selector?.value || "Quiz";

    renderRadarChart(initialCategory, allRows);
    renderBarChart(allRows);
    renderTable(initialCategory, allRows);

    if (selector && !selector.dataset._bound) {
      selector.addEventListener("change", () => {
        const cat = selector.value || "Quiz";
        renderRadarChart(cat, cachedAllRows);
        renderTable(cat, cachedAllRows);
      });
      selector.dataset._bound = "1";
    }

    // PRINT button: always prints all categories
    const printBtn = document.getElementById('userDashboardPrintBtn') || document.getElementById('printScoresBtn') || document.getElementById('print-btn');
    if (printBtn && !printBtn.dataset._bound) {
      printBtn.addEventListener('click', () => {
        try {
          if (!cachedAllRows || cachedAllRows.length === 0) {
            alert('No scores to print.');
            return;
          }
          const html = buildPrintHtml(profile, cachedAllRows);
          const w = window.open('', '', 'width=1100,height=800');
          if (!w) throw new Error('Popup blocked');
          w.document.write(html);
          w.document.close();
          w.focus();
          w.print();
        } catch (err) {
          console.error('[view-user] Print failed:', err);
          alert('Unable to generate print report.');
        }
      });
      printBtn.dataset._bound = '1';
    }

    console.log("[view-user] Profile, table and charts loaded for:", uid);
  } catch (err) {
    console.error("[view-user] Failed to load profile/scores:", err);
    const tbody = findTableBody();
    if (tbody) tbody.innerHTML = `<tr><td colspan="4">Error loading scores.</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadUserProfileAndScores();
});
