// main.js
import { setupViewScoresPage } from './scores.js';
import { populateUserDashboardElements } from './dashboard-user.js';
import { populateAdminUserTable } from './dashboard-admin.js';
import { currentFirebaseUser, userProfileCache, logoutUser } from './auth.js';

export function updateUIAfterAuthStateKnown() {
  const path = window.location.pathname;

  if (path.includes('user-dashboard.html')) {
    if (currentFirebaseUser && userProfileCache) {
      populateUserDashboardElements(userProfileCache);
    }
  } else if (path.includes('admin-dashboard.html') || path.includes('edit-users.html')) {
    if (currentFirebaseUser && userProfileCache?.role === 'admin') {
      populateAdminUserTable();
    }
  } else if (path.includes('view-score.html')) {
    setupViewScoresPage();
  }
}

// Attach logout button to all pages
document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await logoutUser();
    });
  }
});
