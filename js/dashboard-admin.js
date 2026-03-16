import { db } from './firebase-config.js';
import {
  collection,
  getDocs,
  query,
  orderBy,
  where,
  limit,
  doc,
  getDoc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { showMessage, getFirebaseErrorMessage } from './utils.js';
import {
  EXAMINATION_LEVEL_NAMES,
  TRAINING_LEVEL_NAMES,
  ASSESSMENT_LEVEL_NAMES,
  MAINTENANCE_LEVEL_NAMES
} from './constants.js';

// Leaderboard limit - top N users per category
const TOP_LEADERBOARD_LIMIT = 10;

// Global chart instance
let leaderboardChart = null;

/**
 * Format user role for display
 * @param {string} role - User role string
 * @returns {string} Formatted role with proper capitalization
 */
function formatRole(role) {
  if (!role) return '';
  // Map old "user" role to "employee" for display consistency
  const normalizedRole = role.toLowerCase() === 'user' ? 'employee' : role.toLowerCase();
  // Capitalize first letter of each word
  return normalizedRole.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
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

/**
 * Extract score from a record (handles both old and new data structures)
 */
function extractScoreFromRecord(record) {
  if (!record || typeof record !== 'object') return null;
  
  // New structure with attempts array
  if (Array.isArray(record.attempts) && record.attempts.length > 0) {
    const firstAttempt = record.attempts[0];
    const score = firstAttempt?.performanceScore ?? firstAttempt?.score ?? null;
    return typeof score === 'number' ? score : null;
  }
  
  // New structure with attempts object
  if (record.attempts && typeof record.attempts === 'object') {
    const attemptsArray = Object.values(record.attempts);
    if (attemptsArray.length > 0) {
      const firstAttempt = attemptsArray[0];
      const score = firstAttempt?.performanceScore ?? firstAttempt?.score ?? null;
      return typeof score === 'number' ? score : null;
    }
  }
  
  // Old structure with direct score
  const score = record.performanceScore ?? record.score ?? null;
  return typeof score === 'number' ? score : null;
}

/**
 * Calculate user's average score for a specific category
 */
async function calculateUserCategoryAverage(userId, category) {
  try {
    const userDocRef = doc(db, 'userProfiles', userId);
    const userDocSnap = await getDoc(userDocRef);
    
    if (!userDocSnap.exists()) return 0;
    
    const userData = userDocSnap.data();
    const scores = [];
    
    // Determine which data field to use based on category
    let dataField = null;
    let progressField = null;
    let levelNames = [];
    
    switch (category) {
      case 'Quiz':
        dataField = 'quizData';
        progressField = 'quizProgress';
        levelNames = EXAMINATION_LEVEL_NAMES;
        break;
      case 'Training':
        dataField = 'trainingData';
        progressField = 'trainingProgress';
        levelNames = TRAINING_LEVEL_NAMES;
        break;
      case 'Assessment':
        dataField = 'assessmentData';
        progressField = 'assessmentProgress';
        levelNames = ASSESSMENT_LEVEL_NAMES;
        break;
      case 'Maintenance':
        dataField = 'maintenanceData';
        progressField = 'maintenanceProgress';
        levelNames = MAINTENANCE_LEVEL_NAMES;
        break;
      default:
        return 0;
    }
    
    // Try new data structure first (object-based)
    if (userData[dataField] && typeof userData[dataField] === 'object') {
      Object.entries(userData[dataField]).forEach(([key, record]) => {
        // Skip meta keys
        if (key === 'default_quiz_id') return;
        
        // Only include completed activities
        const isCompleted = record.isCompleted || (record.status && /(completed|passed)/i.test(String(record.status)));
        if (!isCompleted) return;
        
        const score = extractScoreFromRecord(record);
        if (score !== null) {
          scores.push(score);
        }
      });
    }
    // Fallback to old progress array structure
    else if (Array.isArray(userData[progressField])) {
      userData[progressField].forEach((record) => {
        if (!record) return;
        
        // Only include completed activities
        const isCompleted = record.isCompleted || (record.status && /(completed|passed)/i.test(String(record.status)));
        if (!isCompleted) return;
        
        const score = extractScoreFromRecord(record);
        if (score !== null) {
          scores.push(score);
        }
      });
    }
    
    if (scores.length === 0) return 0;
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    return Math.round(average);
  } catch (error) {
    console.error(`Error calculating average for user ${userId}, category ${category}:`, error);
    return 0;
  }
}

/**
 * Populate leaderboard bar chart
 */
export async function populateLeaderboardChart() {
  const canvas = document.getElementById('leaderboardBarChart');
  const categorySelect = document.getElementById('categorySelect');
  
  if (!canvas || !categorySelect) {
    console.warn('Leaderboard chart elements not found');
    return;
  }
  
  async function renderChart(category) {
    try {
      // Get all users
      const userProfilesRef = collection(db, 'userProfiles');
      const userProfilesSnap = await getDocs(query(userProfilesRef, orderBy('lastName', 'asc')));
      
      if (userProfilesSnap.empty) {
        console.warn('No users found');
        return;
      }
      
      // Calculate averages for each user
      const userDataPromises = userProfilesSnap.docs.map(async (docSnap) => {
        const userData = docSnap.data();
        const userName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email || 'Unknown';
        const average = await calculateUserCategoryAverage(docSnap.id, category);
        
        return {
          name: userName,
          average: average
        };
      });
      
      const allUserData = await Promise.all(userDataPromises);
      
      // Filter out users with 0 scores and sort by average (descending)
      // Limit to top N users per category
      const sortedData = allUserData
        .filter(user => user.average > 0)
        .sort((a, b) => b.average - a.average)
        .slice(0, TOP_LEADERBOARD_LIMIT);
      
      if (sortedData.length === 0) {
        // Show message if no data
        if (leaderboardChart) {
          leaderboardChart.destroy();
          leaderboardChart = null;
        }
        
        // Hide the canvas and show no data message
        canvas.style.display = 'none';
        let noDataMessage = canvas.parentElement.querySelector('.no-data-message');
        if (!noDataMessage) {
          noDataMessage = document.createElement('p');
          noDataMessage.className = 'no-data-message';
          noDataMessage.style.cssText = 'text-align: center; color: #666; padding: 50px; margin: 0; display: block;';
          canvas.parentElement.appendChild(noDataMessage);
        }
        noDataMessage.style.display = 'block';
        noDataMessage.textContent = 'No data available for this category yet.';
        return;
      }
      
      const labels = sortedData.map(user => user.name);
      const data = sortedData.map(user => user.average);
      
      // Generate gradient colors in navy blue shades
      const colors = sortedData.map((_, index) => {
        // Navy blue gradient from dark to lighter
        const lightness = 25 + (index * 5); // Start dark, get lighter
        const saturation = 85 - (index * 5); // Start more saturated
        return `hsla(230, ${saturation}%, ${lightness}%, 0.8)`;
      });
      
      const borderColors = sortedData.map((_, index) => {
        const lightness = 20 + (index * 5);
        const saturation = 90 - (index * 5);
        return `hsla(230, ${saturation}%, ${lightness}%, 1)`;
      });
      
      // Show canvas and hide no-data message when we have data
      canvas.style.display = 'block';
      const noDataMessage = canvas.parentElement.querySelector('.no-data-message');
      if (noDataMessage) {
        noDataMessage.style.display = 'none';
      }
      
      // Create or update chart
      if (!leaderboardChart) {
        // Create empty chart first
        leaderboardChart = new Chart(canvas, {
          type: 'bar',
          data: {
            labels: [],
            datasets: [{
              label: `${category} Average Score`,
              data: [],
              backgroundColor: [],
              borderColor: [],
              borderWidth: 2,
              borderRadius: 8,
              borderSkipped: false
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: true,
                position: 'top',
                labels: {
                  font: {
                    size: 14,
                    family: 'Poppins'
                  }
                }
              },
              tooltip: {
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                padding: 12,
                titleFont: {
                  size: 14,
                  family: 'Poppins'
                },
                bodyFont: {
                  size: 13,
                  family: 'Poppins'
                },
                callbacks: {
                  label: function(context) {
                    return `Average Score: ${context.parsed.y}%`;
                  }
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                max: 100,
                ticks: {
                  callback: function(value) {
                    return value + '%';
                  },
                  font: {
                    size: 12,
                    family: 'Poppins'
                  }
                },
                grid: {
                  color: 'rgba(0, 0, 0, 0.05)'
                }
              },
              x: {
                ticks: {
                  font: {
                    size: 11,
                    family: 'Poppins'
                  },
                  maxRotation: 45,
                  minRotation: 45
                },
                grid: {
                  display: false
                }
              }
            }
          }
        });
        
        // Now update with actual data to trigger animation
        leaderboardChart.data.labels = labels;
        leaderboardChart.data.datasets[0].label = `${category} Average Score`;
        leaderboardChart.data.datasets[0].data = data;
        leaderboardChart.data.datasets[0].backgroundColor = colors;
        leaderboardChart.data.datasets[0].borderColor = borderColors;
        leaderboardChart.update();
      } else {
        leaderboardChart.data.labels = labels;
        leaderboardChart.data.datasets[0].label = `${category} Average Score`;
        leaderboardChart.data.datasets[0].data = data;
        leaderboardChart.data.datasets[0].backgroundColor = colors;
        leaderboardChart.data.datasets[0].borderColor = borderColors;
        leaderboardChart.update();
      }
    } catch (error) {
      console.error('Error rendering leaderboard chart:', error);
    }
  }
  
  // Initial render
  await renderChart(categorySelect.value);
  
  // Add event listener for category changes
  categorySelect.addEventListener('change', () => {
    renderChart(categorySelect.value);
  });
}

/**
 * Archive a user by updating the archived field in Firestore
 */
async function archiveUser(userId, archiveStatus) {
  try {
    const userRef = doc(db, 'userProfiles', userId);
    await updateDoc(userRef, { archived: archiveStatus });
    return { success: true };
  } catch (error) {
    console.error('[dashboard-admin.js] Error archiving user:', error);
    return { success: false, error: getFirebaseErrorMessage(error) };
  }
}

/**
 * Populates the user table on Admin Dashboard (admin-dashboard.html)
 * Looks for ".user-table tbody"
 */
export async function populateAdminUserTable() {
  const tbody = document.querySelector('.user-table tbody');
  if (!tbody) return;

  const searchInput = document.getElementById('userSearch');
  const limitSelect = document.getElementById('userDisplayLimit');
  const filterSelect = document.getElementById('userFilter');

  tbody.innerHTML = "<tr><td colspan='7'>Loading...</td></tr>";

  let allUsers = [];

  try {
    const q = query(collection(db, 'userProfiles'), orderBy('lastName', 'asc'));
    const snap = await getDocs(q);

    if (snap.empty) {
      tbody.innerHTML = "<tr><td colspan='7'>No users found.</td></tr>";
      return;
    }

    allUsers = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      // Only show enabled users (applications that have been approved)
      if (data.enabled !== false) {
        allUsers.push({ id: docSnap.id, ...data });
      }
    });
  } catch (err) {
    console.error('[dashboard-admin.js] Error loading admin table:', err);
    tbody.innerHTML = "<tr><td colspan='7'>Access denied or error loading data.</td></tr>";
    return;
  }

  const normalize = (v) => (v || '').toString().trim().toLowerCase();

  function computeDisplayName(user) {
    const name = [user.firstName, user.middleName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return name || user.fullName || user.email || '(No name)';
  }

  function render() {
    const q = normalize(searchInput?.value || '');
    const filterValue = filterSelect?.value || 'all';
    let list = allUsers;

    // Apply filter based on selected option
    if (filterValue === 'archived') {
      list = list.filter((u) => u.archived === true);
    } else if (filterValue === 'deactivated') {
      list = list.filter((u) => u.blocked === true);
    } else {
      // "all" - show users that aren't archived (but still show deactivated users)
      list = list.filter((u) => u.archived !== true);
    }

    // Apply search filter
    if (q) {
      list = list.filter((u) => {
        const name = computeDisplayName(u);
        return (
          normalize(name).includes(q) ||
          normalize(u.email).includes(q) ||
          normalize(u.role).includes(q)
        );
      });
    }

    const limitVal = (limitSelect?.value || '25');
    const limit = limitVal === 'all' ? Infinity : parseInt(limitVal, 10) || 25;
    const slice = list.slice(0, limit);

    tbody.innerHTML = '';
    if (!slice.length) {
      tbody.innerHTML = "<tr><td colspan='7'>No matching users.</td></tr>";
      return;
    }

    slice.forEach((u) => {
      const tr = document.createElement('tr');
      const displayName = computeDisplayName(u);
      const isBlocked = u.blocked === true;
      const isArchived = u.archived === true;
      
      // Add blocked class to row if user is blocked
      if (isBlocked) {
        tr.classList.add('blocked-user');
      }
      
      // Add archived class to row if user is archived
      if (isArchived) {
        tr.classList.add('archived-user');
      }
      
      tr.setAttribute('data-name', displayName);
      tr.innerHTML = `
        <td data-label="First Name">
          ${u.firstName || ''}
          ${isBlocked ? '<span class="deactivated-text" title="User is deactivated">deactivated</span>' : ''}
          ${isArchived ? '<span class="archived-text" title="User is archived">archived</span>' : ''}
        </td>
        <td data-label="Middle Name">${u.middleName || ''}</td>
        <td data-label="Last Name">${u.lastName || ''}</td>
        <td data-label="Birthdate">${formatBirthdate(u.birthdate)}</td>
        <td data-label="Email">${u.email || ''}</td>
        <td data-label="Role">${formatRole(u.role)}</td>
        <td data-label="Actions">
            <a href="view-user.html?userId=${u.id}" class="btn btn-info btn-sm">
              <i class="fas fa-eye"></i> View
            </a>
            <button class="btn btn-archive btn-sm archive-btn" data-user-id="${u.id}" data-user-name="${displayName}" data-archived="${isArchived}" title="${isArchived ? 'Unarchive' : 'Archive'}">
              <i class="fas fa-${isArchived ? 'undo' : 'archive'}"></i> ${isArchived ? 'Unarchive' : 'Archive'}
            </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Attach event listeners to archive buttons
    const archiveButtons = tbody.querySelectorAll('.archive-btn');
    archiveButtons.forEach(button => {
      button.addEventListener('click', async (e) => {
        e.preventDefault();
        const userId = button.getAttribute('data-user-id');
        const userName = button.getAttribute('data-user-name');
        const isArchived = button.getAttribute('data-archived') === 'true';
        const newArchiveStatus = !isArchived;

        // Confirm action
        const confirmMessage = newArchiveStatus 
          ? `Are you sure you want to archive ${userName}?`
          : `Are you sure you want to unarchive ${userName}?`;
        
        if (!confirm(confirmMessage)) {
          return;
        }

        // Disable button during operation
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

        const result = await archiveUser(userId, newArchiveStatus);
        
        if (result.success) {
          // Re-render the table to reflect changes
          render();
        } else {
          alert(`Error: ${result.error || 'Failed to update user archive status'}`);
          // Re-enable button on error
          button.disabled = false;
          const newStatus = !isArchived;
          button.innerHTML = `<i class="fas fa-${newStatus ? 'undo' : 'archive'}"></i> ${newStatus ? 'Unarchive' : 'Archive'}`;
        }
      });
    });
  }

  // Initial render and wire events
  render();
  if (searchInput) searchInput.addEventListener('input', render);
  if (limitSelect) limitSelect.addEventListener('change', render);
  if (filterSelect) filterSelect.addEventListener('change', render);
}

/**
 * Populates the table on Edit Users page (admin/edit-users.html)
 * Looks for "#usersTable tbody"
 */
export async function setupEditUsersPage() {
  const tbody = document.querySelector('#usersTable tbody');
  if (!tbody) return;

  tbody.innerHTML = "<tr><td colspan='4'>Loading...</td></tr>";

  try {
    const q = query(collection(db, 'userProfiles'), orderBy('lastName', 'asc'));
    const snap = await getDocs(q);

    if (snap.empty) {
      tbody.innerHTML = "<tr><td colspan='4'>No users found.</td></tr>";
      return;
    }

    tbody.innerHTML = '';
    snap.forEach((docSnap) => {
      const u = docSnap.data();
      // Only show enabled users (applications that have been approved)
      if (u.enabled !== false) {
        const name =
          [u.firstName, u.middleName, u.lastName].filter(Boolean).join(' ') ||
          u.fullName ||
          '(No name)';

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td data-label="Name">${name}</td>
          <td data-label="Email">${u.email || ''}</td>
          <td data-label="Role">${u.role || 'user'}</td>
          <td data-label="Actions"><!-- actions placeholder --></td>
        `;
        tbody.appendChild(tr);
      }
    });
  } catch (err) {
    console.error('[dashboard-admin.js] Error loading edit-users table:', err);
    tbody.innerHTML = "<tr><td colspan='4'>Access denied or error loading data.</td></tr>";
  }
}
