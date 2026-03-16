// scores.js
import { auth, db } from './firebase-config.js';
import {
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import {
  TRAINING_LEVEL_NAMES,
  EXAMINATION_LEVEL_NAMES,
  ASSESSMENT_LEVEL_NAMES,
  MAINTENANCE_LEVEL_NAMES
} from './constants.js';

/**
 * Map short keys saved in DB -> full display names
 */
const MODULE_NAME_MAPS = {
  Quiz: {
    Crimp: "Crimping & Wires",
    WISP: "WISP Fundamentals",
    Router: "Router Configuration",
    Tool: "Tool Descriptions & Usages",
    SOP: "Standard Operating Procedure",
    Problem: "Maintenance & Troubleshooting"
  },
  Training: {
    training_antenna_install: "Antenna Installation",
    training_router_install: "Router Installation",
    training_crimping: "Cable Crimping",
    training_cable_laying: "Cable Laying",
    training_signal_opt: "Signal Optimization"
  },
  Assessment: {
    assessment_level: "Assessment Level"
  },
  
  Maintenance: {
    M1: "Signal Loss After Storm",
    M2: "Sudden Slow Speeds",
    M3: "Corroded RJ45",
  }
};

/* ----------------------
   Helper utilities
   ---------------------- */

/**
 * Escape HTML for safe injection into table cell renderers
 */
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Extract score + timestamp from record
 */
function extractScore(record, mode = 'first') {
  if (!record || typeof record !== 'object') return [];

  let attempts = [];

  // CASE 1: new structure with "attempts" as object
  if (record.attempts && typeof record.attempts === 'object') {
    attempts = Object.values(record.attempts);
  }

  // CASE 3: fallback to single record
  else {
    attempts = [record];
  }

  if (mode === 'first') {
    const first = attempts[0];
    return [{
      score: first?.performanceScore ?? first?.score ?? null,
      timestamp: first?.timestamp ?? first?.timeStamp ?? null
    }];
  }

  // all attempts
  return attempts.map(attempt => ({
    score: attempt?.performanceScore ?? attempt?.score ?? null,
    timestamp: attempt?.timestamp ?? attempt?.timeStamp ?? null
  }));
}


/**
 * Convert unix timestamp -> readable string
 */
function formatTimestamp(ts) {
  if (!ts || isNaN(ts)) return 'N/A';
  const date = new Date(ts * 1000); // convert seconds → ms
  return date.toLocaleString();
}

/**
 * Add an entry to the aggregated scores array.
 * NOTE: changed to include userId so action buttons can target the correct user document.
 * Also includes numeric timestamp property for precise single-entry deletions.
 */
function addScoreEntry(outArray, userId, userDisplay, activityName, scoreObjs, type, rawKey, completed) {
  if (!completed) return; // only include completed activities
  if (!scoreObjs || scoreObjs.length === 0) return;

  scoreObjs.forEach(scoreObj => {
    const s = Number.isFinite(scoreObj.score) ? Math.round(scoreObj.score) : null;
    const ts = scoreObj.timestamp ? formatTimestamp(scoreObj.timestamp) : 'N/A';
    if (s == null) return;

    outArray.push({
      userId,
      userDisplay,
      activityName,
      score: s,
      type,
      rawKey: rawKey ?? activityName,
      date: ts,
      // new: keep original numeric timestamp (seconds or whatever stored) for precise targeting
      timestamp: scoreObj.timestamp ?? null
    });
  });
}

/* build list from progress array (old structure) */
function processProgressArray(outArray, userId, userDisplay, progressArray, nameArray, type, mode) {
  if (!Array.isArray(progressArray) || !Array.isArray(nameArray)) return;
  progressArray.forEach((slot, idx) => {
    if (!slot) return;
    const isCompleted = !!slot.isCompleted || (slot.status && /(completed|passed)/i.test(String(slot.status)));
    const scoreObjs = extractScore(slot, mode);
    addScoreEntry(outArray, userId, userDisplay, nameArray[idx] || `Unnamed ${type} ${idx + 1}`, scoreObjs, type, idx, isCompleted);
  });
}

/* build list from object map (new structure) */
function processDataObject(outArray, userId, userDisplay, dataObject, nameMap, type, mode) {
  if (!dataObject || typeof dataObject !== 'object') return;
  Object.entries(dataObject).forEach(([key, rec]) => {
    if (key === "default_quiz_id") return; // skip irrelevant keys for listing
    const displayName = (nameMap && nameMap[key]) || key;
    const scoreObjs = extractScore(rec, mode);
    const isCompleted = !!rec.isCompleted || (rec.status && /(completed|passed)/i.test(String(rec.status)));
    addScoreEntry(outArray, userId, userDisplay, displayName, scoreObjs, type, key, isCompleted);
  });
}

/* ----------------------
   DOM helpers
   ---------------------- */

function getSelectById(id) {
  return document.getElementById(id);
}

function clearSelectOptions(selectEl) {
  if (!selectEl) return;
  // If Select2 is attached, destroy it first to avoid issues
  try {
    if (window.jQuery && $.fn.select2 && $(selectEl).data('select2')) {
      $(selectEl).select2('destroy');
    }
  } catch (e) {
    // ignore any errors
  }
  selectEl.innerHTML = '';
}

function populateModuleDropdownFor(activityType) {
  const moduleSelect = getSelectById('viewScoresModuleFilter');
  if (!moduleSelect) return;

  clearSelectOptions(moduleSelect);

  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = 'All Modules';
  moduleSelect.appendChild(allOpt);

  let options = [];

  if (activityType === 'Quiz') {
    options = Object.values(MODULE_NAME_MAPS.Quiz);
  } else if (activityType === 'Training') {
    options = Object.keys(MODULE_NAME_MAPS.Training || {}).length > 0
      ? Object.values(MODULE_NAME_MAPS.Training)
      : Array.isArray(TRAINING_LEVEL_NAMES) ? TRAINING_LEVEL_NAMES.slice() : [];
  } else if (activityType === 'Assessment') {
    options = Object.keys(MODULE_NAME_MAPS.Assessment || {}).length > 0
      ? Object.values(MODULE_NAME_MAPS.Assessment)
      : Array.isArray(ASSESSMENT_LEVEL_NAMES) ? ASSESSMENT_LEVEL_NAMES.slice() : [];
  } else if (activityType === 'Maintenance') {
    options = Object.keys(MODULE_NAME_MAPS.Maintenance || {}).length > 0
      ? Object.values(MODULE_NAME_MAPS.Maintenance)
      : Array.isArray(MAINTENANCE_LEVEL_NAMES) ? MAINTENANCE_LEVEL_NAMES.slice() : [];
  } else if (activityType === 'all') {
    const set = new Set();
    Object.values(MODULE_NAME_MAPS.Quiz).forEach(n => set.add(n));
    (Array.isArray(TRAINING_LEVEL_NAMES) ? TRAINING_LEVEL_NAMES : []).forEach(n => n && set.add(n));
    (Array.isArray(EXAMINATION_LEVEL_NAMES) ? EXAMINATION_LEVEL_NAMES : []).forEach(n => n && set.add(n));
    (Array.isArray(ASSESSMENT_LEVEL_NAMES) ? ASSESSMENT_LEVEL_NAMES : []).forEach(n => n && set.add(n));
    (Array.isArray(MAINTENANCE_LEVEL_NAMES) ? MAINTENANCE_LEVEL_NAMES : []).forEach(n => n && set.add(n));
    options = Array.from(set);
  }

  options.forEach(optText => {
    if (!optText) return;
    const opt = document.createElement('option');
    opt.value = optText;
    opt.textContent = optText;
    moduleSelect.appendChild(opt);
  });
}

/* ----------------------
   Data loading & display
   ---------------------- */

export async function setupViewScoresPage() {
  const scoresTableElement = document.getElementById('scoresTable');
  if (!scoresTableElement) return;

  let scoresTableAPI;
  function getOrInitializeTable() {
    if ($.fn.DataTable.isDataTable(scoresTableElement)) {
      scoresTableAPI = $(scoresTableElement).DataTable();
    } else {
      scoresTableAPI = $(scoresTableElement).DataTable({
        responsive: true,
        pageLength: 10,
        columns: [
          { data: 'userDisplay', title: 'User' },
          { data: 'activityName', title: 'Level/Activity Name' },
          {
            data: 'score',
            title: 'Score (%)',
            render: (d) => (d != null ? `${d.toFixed(0)}%` : 'N/A')
          },
          { data: 'date', title: 'Date' },
          {
            data: null,
            title: 'Actions',
            orderable: false,
            render: (data, type, row) => {
              // row contains userId and userDisplay now and also timestamp
              const uid = escapeHtml(row.userId || '');
              const uname = escapeHtml(row.userDisplay || '');
              const rkey = escapeHtml(String(row.rawKey ?? ''));
              const rtype = escapeHtml(String(row.type ?? ''));
              const rtimestamp = escapeHtml(String(row.timestamp ?? ''));

              // Two buttons: Clear Entry (single attempt) + Clear All (existing)
              return `
                <button class="btn btn-sm btn-warning clear-entry-btn" 
                        data-userid="${uid}" data-username="${uname}" data-type="${rtype}" data-rawkey="${rkey}" data-timestamp="${rtimestamp}" title="Clear this score for ${uname}">
                  <i class="fas fa-eraser"></i> Clear Entry
                </button>
                &nbsp;
                <button class="btn btn-sm btn-danger clear-scores-btn" data-userid="${uid}" data-username="${uname}" title="Clear all scores for ${uname}">
                  <i class="fas fa-trash"></i> Clear All
                </button>
              `;
            }
          }
        ],
        language: {
          emptyTable: 'No scores to display.',
          zeroRecords: 'No matching scores found.'
        },
        data: []
      });
    }
    return scoresTableAPI;
  }

  scoresTableAPI = getOrInitializeTable();

  const activityTypeFilter = getSelectById('viewScoresActivityTypeFilter');
  const moduleFilter = getSelectById('viewScoresModuleFilter');
  const attemptFilterSelect = getSelectById('viewScoresAttemptFilter');
  const excludeUserFilter = getSelectById('excludeUserFilter');
  let attemptFilterMode = attemptFilterSelect ? attemptFilterSelect.value : 'first';

  let allUsersList = []; // store for exclude dropdown

  /**
   * Return selected excludes as normalized strings (trim + lower)
   * This makes comparisons robust regardless of casing or whitespace.
   */
  function getSelectedExcludedUsers() {
    if (!excludeUserFilter) return [];
    try {
      if (window.jQuery && $.fn.select2 && $(excludeUserFilter).data('select2')) {
        const vals = $(excludeUserFilter).val() || [];
        return (Array.isArray(vals) ? vals : [vals]).map(v => (v || '').toString().trim().toLowerCase()).filter(Boolean);
      }
    } catch (e) {
      // fallthrough to native
    }
    return Array.from(excludeUserFilter.selectedOptions).map(o => o.value.toString().trim().toLowerCase());
  }

  async function loadAndDisplayAllUserScores() {
    if (!scoresTableAPI) return;

    scoresTableAPI
      .clear()
      .rows.add([{ userDisplay: 'Loading...', activityName: '', score: null, date: '' }])
      .draw();

    try {
      const usersCollectionRef = collection(db, 'userProfiles');
      const querySnapshot = await getDocs(usersCollectionRef);
      const allActivityScores = [];
      allUsersList = [];

      // Get excludes now and normalize for the early skip
      const excludedNow = getSelectedExcludedUsers();

      querySnapshot.forEach((docSnap) => {
        const userData = docSnap.data();
        if (!userData) return;

        const userId = docSnap.id;
        const userDisplay =
          (userData.username || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email || docSnap.id)
          .toString();

        allUsersList.push(userDisplay);

        // If this user is excluded, skip adding any of their activity entries
        if (excludedNow.length > 0 && excludedNow.includes(userDisplay.toString().trim().toLowerCase())) {
          return;
        }

        if (userData.quizData && typeof userData.quizData === 'object') {
          processDataObject(allActivityScores, userId, userDisplay, userData.quizData, MODULE_NAME_MAPS.Quiz, 'Quiz', attemptFilterMode);
        } else if (Array.isArray(userData.quizProgress)) {
          processProgressArray(allActivityScores, userId, userDisplay, userData.quizProgress, EXAMINATION_LEVEL_NAMES, 'Quiz', attemptFilterMode);
        }

        if (userData.trainingData && typeof userData.trainingData === 'object') {
          processDataObject(allActivityScores, userId, userDisplay, userData.trainingData, MODULE_NAME_MAPS.Training, 'Training', attemptFilterMode);
        } else if (Array.isArray(userData.trainingProgress)) {
          processProgressArray(allActivityScores, userId, userDisplay, userData.trainingProgress, TRAINING_LEVEL_NAMES, 'Training', attemptFilterMode);
        }

        if (userData.assessmentData && typeof userData.assessmentData === 'object') {
          processDataObject(allActivityScores, userId, userDisplay, userData.assessmentData, MODULE_NAME_MAPS.Assessment, 'Assessment', attemptFilterMode);
        } else if (Array.isArray(userData.assessmentProgress)) {
          processProgressArray(allActivityScores, userId, userDisplay, userData.assessmentProgress, ASSESSMENT_LEVEL_NAMES, 'Assessment', attemptFilterMode);
        }

        if (userData.maintenanceData && typeof userData.maintenanceData === 'object') {
          processDataObject(allActivityScores, userId, userDisplay, userData.maintenanceData, MODULE_NAME_MAPS.Maintenance, 'Maintenance', attemptFilterMode);
        } else if (Array.isArray(userData.maintenanceProgress)) {
          processProgressArray(allActivityScores, userId, userDisplay, userData.maintenanceProgress, MAINTENANCE_LEVEL_NAMES, 'Maintenance', attemptFilterMode);
        }
      });

      // refresh exclude user dropdown (multi-select)
      if (excludeUserFilter) {
        // destroy any existing Select2 instance (safe)
        try {
          if (window.jQuery && $.fn.select2 && $(excludeUserFilter).data('select2')) {
            $(excludeUserFilter).select2('destroy');
          }
        } catch (e) {
          // ignore
        }

        clearSelectOptions(excludeUserFilter);

        // build unique, trimmed user list
        const uniqueUsers = [...new Set(allUsersList.map(u => (u || '').toString().trim()).filter(Boolean))];

        // load saved selection from localStorage (raw values)
        let savedExcludedRaw = [];
        let savedExcludedNormalized = [];
        try {
          const savedJSON = localStorage.getItem('viewScoresExcludedUsers');
          savedExcludedRaw = savedJSON ? JSON.parse(savedJSON) : [];
          if (!Array.isArray(savedExcludedRaw)) savedExcludedRaw = [];
          savedExcludedNormalized = savedExcludedRaw.map(x => (x || '').toString().trim().toLowerCase());
        } catch (e) {
          savedExcludedRaw = [];
          savedExcludedNormalized = [];
        }

        uniqueUsers.forEach(u => {
          const opt = document.createElement('option');
          opt.value = u;
          opt.textContent = u;
          // mark selected if previously saved (case-insensitive match)
          if (savedExcludedNormalized.includes(u.toString().trim().toLowerCase())) {
            opt.selected = true;
          }
          excludeUserFilter.appendChild(opt);
        });

        // initialize Select2 on the select (if Select2 is available)
        try {
          if (window.jQuery && $.fn.select2) {
            $(excludeUserFilter).select2({
              placeholder: "Click to exclude users",
              allowClear: true,
              closeOnSelect: false,
              width: 'resolve'
            });

            // ensure selected values are set in Select2 UI by using the actual option values that match savedNormalized
            if (savedExcludedNormalized.length > 0) {
              const toSelect = uniqueUsers.filter(u => savedExcludedNormalized.includes(u.toString().trim().toLowerCase()));
              $(excludeUserFilter).val(toSelect).trigger('change.select2');
            }
          }
        } catch (e) {
          // ignore errors related to Select2 initialization
        }
      }

      const selectedType = (activityTypeFilter && activityTypeFilter.value) ? activityTypeFilter.value : 'all';
      let filteredData = allActivityScores;
      if (selectedType !== 'all') {
        filteredData = allActivityScores.filter(s => s.type === selectedType);
      }

      const selectedModule = (moduleFilter && moduleFilter.value) ? moduleFilter.value : 'all';
      if (selectedModule !== 'all') {
        filteredData = filteredData.filter(s => s.activityName === selectedModule);
      }

      // final exclusion filter (safety) using normalized values
      const selectedExcludeUsers = getSelectedExcludedUsers();
      if (selectedExcludeUsers.length > 0) {
        filteredData = filteredData.filter(s => {
          const uname = (s.userDisplay || '').toString().trim().toLowerCase();
          return !selectedExcludeUsers.includes(uname);
        });
      }

      scoresTableAPI.clear().rows.add(filteredData).draw();
    } catch (err) {
      console.error('Error fetching scores:', err);
      scoresTableAPI
        .clear()
        .rows.add([{ userDisplay: 'Error loading scores.', activityName: '', score: null, date: '' }])
        .draw();
    }
  }

  function initFiltersAndBindings() {
    const initialType = (activityTypeFilter && activityTypeFilter.value) ? activityTypeFilter.value : 'all';
    populateModuleDropdownFor(initialType);

    if (activityTypeFilter) {
      activityTypeFilter.addEventListener('change', () => {
        const newType = activityTypeFilter.value || 'all';
        populateModuleDropdownFor(newType);
        if (moduleFilter) moduleFilter.value = 'all';
        loadAndDisplayAllUserScores();
      });
    }
    if (moduleFilter) {
      moduleFilter.addEventListener('change', () => {
        loadAndDisplayAllUserScores();
      });
    }
    if (attemptFilterSelect) {
      attemptFilterSelect.addEventListener('change', () => {
        attemptFilterMode = attemptFilterSelect.value === 'all' ? 'all' : 'first';
        loadAndDisplayAllUserScores();
      });
    }

    // Attach change handler for exclude dropdown (works for both Select2 and native select)
    const excludeChangeHandler = () => {
      // Save raw selected values (original casing) to localStorage for persistence
      let selRaw = [];
      try {
        if (window.jQuery && $.fn.select2 && $(excludeUserFilter).data('select2')) {
          selRaw = $(excludeUserFilter).val() || [];
        } else if (excludeUserFilter) {
          selRaw = Array.from(excludeUserFilter.selectedOptions).map(o => o.value);
        }
        localStorage.setItem('viewScoresExcludedUsers', JSON.stringify(selRaw));
      } catch (e) {
        // ignore storage errors
      }
      loadAndDisplayAllUserScores();
    };

    if (window.jQuery && $.fn.select2 && excludeUserFilter) {
      // jQuery binding (works when select2 triggers change)
      $(excludeUserFilter).off('change.excludeHandler').on('change.excludeHandler', excludeChangeHandler);
    }
    if (excludeUserFilter) {
      // native fallback
      excludeUserFilter.removeEventListener('change', excludeChangeHandler);
      excludeUserFilter.addEventListener('change', excludeChangeHandler);
    }

    // Delegated click handler for clear buttons (works even when DataTable redraws)
    if (scoresTableElement) {
      scoresTableElement.addEventListener('click', async (ev) => {
        // "Clear Entry" (single attempt) handler
        const entryBtn = ev.target.closest && ev.target.closest('.clear-entry-btn');
        if (entryBtn) {
          const userId = entryBtn.getAttribute('data-userid');
          const userName = entryBtn.getAttribute('data-username') || userId;
          const type = entryBtn.getAttribute('data-type');
          const rawKey = entryBtn.getAttribute('data-rawkey');
          const timestampStr = entryBtn.getAttribute('data-timestamp');

          if (!userId || !type || rawKey == null || !timestampStr) {
            alert('Missing data to clear the selected score. Check console for details.');
            console.error('clear-entry: missing data', { userId, type, rawKey, timestampStr });
            return;
          }

          // Show custom modal instead of browser confirm
          showClearEntryModal(userId, userName, type, rawKey, timestampStr);
          return; // stop (don't also run outer clear-all handler)
        }

        // existing "Clear All" handler
        const btn = ev.target.closest && ev.target.closest('.clear-scores-btn');
        if (!btn) return;
        const userId = btn.getAttribute('data-userid');
        const userName = btn.getAttribute('data-username') || userId;
        if (!userId) return;

        // Show custom modal instead of browser confirm
        showClearAllScoresModal(userId, userName);
      });
    }
  }

  initFiltersAndBindings();

  /**
   * Clear scores for a single user document (by userId)
   * - resets quizData and trainingData entries (skips default_quiz_id)
   * - resets quizProgress/trainingProgress arrays to same length with default "not completed" entries
   * - clears top-level attemptHistory
   * - also handles assessmentData and maintenanceData
   *
   * Implementation notes:
   * - Uses nested-field update paths (e.g. "quizData.someKey") so we don't
   *   overwrite other meta keys like default_quiz_id.
   */
  async function clearUserScores(userId) {
    if (!userId) throw new Error('No userId provided');

    const userRef = doc(db, 'userProfiles', userId);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      throw new Error('User not found');
    }

    const data = snap.data() || {};
    const updateFields = {};

    // Helper to reset data map keys (use nested update fields)
    function resetMapKeys(mapObj, mapFieldName, skipKeys = []) {
  if (!mapObj || typeof mapObj !== 'object') return;
  Object.keys(mapObj).forEach((k) => {
    if (skipKeys.includes(k)) return;
    const existing = mapObj[k];

    // Reset attempts while keeping its type
    if (existing && Array.isArray(existing.attempts)) {
      updateFields[`${mapFieldName}.${k}.attempts`] = [];
    } else if (existing && existing.attempts && typeof existing.attempts === 'object') {
      updateFields[`${mapFieldName}.${k}.attempts`] = {};
    }

    // Always reset isCompleted
    updateFields[`${mapFieldName}.${k}.isCompleted`] = false;
  });
}


    // Quiz data (skip default_quiz_id)
    resetMapKeys(data.quizData, 'quizData', ['default_quiz_id']);

    // Training data
    resetMapKeys(data.trainingData, 'trainingData', []);

    // Assessment data
    resetMapKeys(data.assessmentData, 'assessmentData', []);

    // Maintenance data
    resetMapKeys(data.maintenanceData, 'maintenanceData', []);


    // Run update (if there are fields to update)
    if (Object.keys(updateFields).length > 0) {
      await updateDoc(userRef, updateFields);
    }
  }

    /**
   * Clear a single specific score attempt for a user
   *
   * Preserves whether attempts were stored as an ARRAY or as a MAP so Unity's
   * deserializer doesn't fail converting a map into a List<AttemptData>.
   *
   * @param {string} userId
   * @param {string} type       ("Quiz"|"Training"|"Assessment"|"Maintenance")
   * @param {string} rawKey     the sub-key (quiz id / training id)
   * @param {number|string} timestamp  numeric timestamp or string to match attempt
   */
  async function clearSingleScore(userId, type, rawKey, timestamp) {
    if (!userId || !type || rawKey == null) throw new Error("Missing parameters");

    const fieldMap = {
      Quiz: "quizData",
      Training: "trainingData",
      Assessment: "assessmentData",
      Maintenance: "maintenanceData"
    };
    const fieldName = fieldMap[type];
    if (!fieldName) throw new Error(`Unknown type: ${type}`);

    const userRef = doc(db, "userProfiles", userId);
    const snap = await getDoc(userRef);
    if (!snap.exists()) throw new Error("User not found");

    const data = snap.data() || {};
    const parentObj = data[fieldName];
    if (!parentObj || typeof parentObj !== "object") {
      throw new Error(`${fieldName} not found`);
    }

    const entry = parentObj[rawKey];
    if (!entry) throw new Error(`Entry ${rawKey} not found under ${fieldName}`);

    // Normalize timestamp for comparison
    const targetTsStr = String(timestamp);

    // Prepare targeted updates (so we don't overwrite unrelated fields)
    const updates = {};

    // CASE A: attempts stored as an ARRAY (common; Unity expects List)
    if (Array.isArray(entry.attempts)) {
      const origArray = entry.attempts || [];
      const newArray = origArray.filter(a => String(a?.timestamp ?? a?.timeStamp ?? "") !== targetTsStr);

      updates[`${fieldName}.${rawKey}.attempts`] = newArray;
      updates[`${fieldName}.${rawKey}.isCompleted`] = newArray.length > 0;

      await updateDoc(userRef, updates);
      return;
    }

    // CASE B: attempts stored as an OBJECT/MAP (keyed attempts)
    if (entry.attempts && typeof entry.attempts === "object") {
      const newMap = {};
      Object.entries(entry.attempts).forEach(([k, v]) => {
        if (String(v?.timestamp ?? v?.timeStamp ?? "") !== targetTsStr) {
          newMap[k] = v;
        }
      });

      updates[`${fieldName}.${rawKey}.attempts`] = newMap;
      updates[`${fieldName}.${rawKey}.isCompleted`] = Object.keys(newMap).length > 0;

      await updateDoc(userRef, updates);
      return;
    }

    // CASE C: legacy single-record structure (no "attempts" container)
    // If the root entry's timestamp matches the target timestamp, convert it to "no attempts"
    const rootTs = entry.timestamp ?? entry.timeStamp ?? null;
    if (rootTs != null && String(rootTs) === targetTsStr) {
      // create empty attempts array (preferred because Unity expects a List)
      updates[`${fieldName}.${rawKey}.attempts`] = [];
      updates[`${fieldName}.${rawKey}.isCompleted`] = false;
      // optional: remove/clear root score/timestamp so it truly appears reset
      updates[`${fieldName}.${rawKey}.score`] = null;
      updates[`${fieldName}.${rawKey}.timestamp`] = null;
      await updateDoc(userRef, updates);
      return;
    }

    // If we get here: timestamp not found
    throw new Error("Specified timestamp not found in entry attempts");
  }


  // load after auth state changes
  onAuthStateChanged(auth, (user) => {
    if (user) {
      loadAndDisplayAllUserScores();
    } else {
      scoresTableAPI
        .clear()
        .rows.add([{ userDisplay: 'Please log in.', activityName: '', score: null, date: '' }])
        .draw();
    }
  });

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await signOut(auth);
        window.location.href = '../loginPage.html';
      } catch (err) {
        console.error('Logout failed:', err);
      }
    });
  }

  const printBtn = document.getElementById('printScoresBtn');
  function buildAdminPrintableHTML(rows) {
    const genDate = new Date().toLocaleString();
    const tableRows = rows.map(r => `
      <tr>
        <td>${r.userDisplay}</td>
        <td>${r.activityName}</td>
        <td>${r.score != null ? r.score.toFixed(0) + '%' : 'N/A'}</td>
        <td>${r.date || 'N/A'}</td>
      </tr>
    `).join('');
    return `
      <html><head><title>Total User Scores Report</title><meta charset="utf-8" />
      <style>body{font-family:Arial;margin:40px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:8px;text-align:left}</style>
      </head><body>
      <h1>DelaCruz Network Solutions</h1><h3>Total User Scores Report</h3>
      <div><strong>Generated:</strong> ${genDate}</div><div><strong>Total Records:</strong> ${rows.length}</div>
      <table><thead><tr><th>User</th><th>Level / Activity</th><th>Score (%)</th><th>Date</th></tr></thead><tbody>${tableRows}</tbody></table>
      </body></html>
    `;
  }

  if (printBtn && scoresTableElement) {
    printBtn.addEventListener('click', () => {
      if (!scoresTableAPI) return;
      const rows = scoresTableAPI.rows({ search: 'applied' }).data().toArray().slice(0, 100);

      // apply exclusions (normalized) for printing
      const selectedExcludeUsers = getSelectedExcludedUsers(); // already normalized
      const printableRows = selectedExcludeUsers.length > 0
        ? rows.filter(r => !selectedExcludeUsers.includes((r.userDisplay || '').toString().trim().toLowerCase()))
        : rows;

      const html = buildAdminPrintableHTML(printableRows);
      const win = window.open('', '', 'height=900,width=1200');
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    });
  }

  // Modal functions for confirmation dialogs
  function showClearEntryModal(userId, userName, type, rawKey, timestampStr) {
  const modal = document.getElementById('clearEntryModal');
  const messageEl = document.getElementById('clearEntryMessage');
  const cancelBtn = document.getElementById('clearEntryCancel');
  const confirmBtn = document.getElementById('clearEntryConfirm');

  // Update message with specific details
  messageEl.textContent = `Are you sure you want to clear THIS score (${type} / ${rawKey}) for "${userName}"? This cannot be undone.`;

  // Show modal with animation
  modal.style.display = 'flex';
  // Trigger animation after a small delay to ensure display is set
  setTimeout(() => {
    modal.classList.add('show');
  }, 10);

  // Event listeners
  const handleCancel = () => {
    modal.classList.remove('show');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 300);
    cleanup();
  };

  const handleConfirm = async () => {
    try {
      // parse timestamp to numeric if possible
      const tsNum = isNaN(Number(timestampStr)) ? timestampStr : Number(timestampStr);
      await clearSingleScore(userId, type, rawKey, tsNum);
      loadAndDisplayAllUserScores();
      modal.classList.remove('show');
      setTimeout(() => {
        modal.style.display = 'none';
      }, 300);
    } catch (err) {
      console.error('Clear single score failed:', err);
      alert('Failed to clear the specific score. Check console for details.');
    }
    cleanup();
  };

  const cleanup = () => {
    cancelBtn.removeEventListener('click', handleCancel);
    confirmBtn.removeEventListener('click', handleConfirm);
    modal.removeEventListener('click', handleBackdropClick);
  };

  const handleBackdropClick = (e) => {
    if (e.target === modal) {
      modal.classList.remove('show');
      setTimeout(() => {
        modal.style.display = 'none';
      }, 300);
      cleanup();
    }
  };

  cancelBtn.addEventListener('click', handleCancel);
  confirmBtn.addEventListener('click', handleConfirm);
  modal.addEventListener('click', handleBackdropClick);
  }

  function showClearAllScoresModal(userId, userName) {
  const modal = document.getElementById('clearAllScoresModal');
  const messageEl = document.getElementById('clearAllScoresMessage');
  const cancelBtn = document.getElementById('clearAllScoresCancel');
  const confirmBtn = document.getElementById('clearAllScoresConfirm');

  // Update message with user name
  messageEl.textContent = `Are you sure you want to clear ALL scores for "${userName}"? This cannot be undone.`;

  // Show modal with animation
  modal.style.display = 'flex';
  // Trigger animation after a small delay to ensure display is set
  setTimeout(() => {
    modal.classList.add('show');
  }, 10);

  // Event listeners
  const handleCancel = () => {
    modal.classList.remove('show');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 300);
    cleanup();
  };

  const handleConfirm = async () => {
    try {
      await clearUserScores(userId);
      loadAndDisplayAllUserScores();
      modal.classList.remove('show');
      setTimeout(() => {
        modal.style.display = 'none';
      }, 300);
    } catch (err) {
      console.error('Clear scores failed:', err);
      alert('Failed to clear scores. Check console for details.');
    }
    cleanup();
  };

  const cleanup = () => {
    cancelBtn.removeEventListener('click', handleCancel);
    confirmBtn.removeEventListener('click', handleConfirm);
    modal.removeEventListener('click', handleBackdropClick);
  };

  const handleBackdropClick = (e) => {
    if (e.target === modal) {
      modal.classList.remove('show');
      setTimeout(() => {
        modal.style.display = 'none';
      }, 300);
      cleanup();
    }
  };

  cancelBtn.addEventListener('click', handleCancel);
  confirmBtn.addEventListener('click', handleConfirm);
  modal.addEventListener('click', handleBackdropClick);
  }
}

export default setupViewScoresPage;
