import { db, auth } from './firebase-config.js';
import { logoutUser, currentFirebaseUser } from './auth.js';
import {
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  updateDoc,
  setDoc
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import {
  createUserWithEmailAndPassword,
  signOut,
  signInWithEmailAndPassword,
  sendEmailVerification
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { showMessage, getFirebaseErrorMessage } from './utils.js';

// ---------- Logout binding ----------
const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await logoutUser();
  });
}

export async function setupEditUsersPage() {
  const tbody = document.querySelector('#usersTable tbody');
  const msgEl = document.getElementById("editUsersMessage");
  const searchInput = document.getElementById('editUsersSearch');
  const limitSelect = document.getElementById('editUsersLimit');
  if (!tbody) return;

  tbody.innerHTML = "<tr><td colspan='4'>Loading...</td></tr>";

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const focusUID = urlParams.get("uid");

    const q = query(collection(db, 'userProfiles'), orderBy('lastName', 'asc'));
    const snap = await getDocs(q);

    if (snap.empty) {
      tbody.innerHTML = "<tr><td colspan='4'>No users found.</td></tr>";
      return;
    }

    // Cache all users
    const allUsers = [];
    snap.forEach((docSnap) => {
      const u = docSnap.data();
      const userUID = docSnap.id;
      allUsers.push({ id: userUID, ...u });
    });

    const normalize = (v) => (v || '').toString().trim().toLowerCase();
    const computeName = (u) => {
      const n = [u.firstName, u.middleName, u.lastName].filter(Boolean).join(' ').trim();
      return n || u.fullName || u.email || '(No name)';
    };

    function bindRowActions(tr, u, name, isAdmin = false) {
      const userUID = u.id;
      
      // Only bind role change actions for non-admin users
      if (!isAdmin) {
        const select = tr.querySelector('.role-select');
        const saveBtn = tr.querySelector('.btn-save');
        if (select && saveBtn) {
          select.addEventListener('change', () => {
            saveBtn.style.display = 'inline-block';
          });
          saveBtn.addEventListener('click', async () => {
            const newRole = select.value;
            showSaveChangesModal(userUID, name, newRole, saveBtn, msgEl);
          });
        }
      } else {
        // For admin users, hide the save button since role cannot be changed
        const saveBtn = tr.querySelector('.btn-save');
        if (saveBtn) {
          saveBtn.style.display = 'none';
        }
      }

      // Block/unblock action works for all users (including admins)
      const blockBtn = tr.querySelector('.btn-block');
      if (blockBtn) {
        blockBtn.addEventListener('click', async () => {
          const newBlocked = blockBtn.textContent.includes('Deactivate');
          showBlockUserModal(userUID, name, newBlocked, blockBtn, msgEl);
        });
      }
    }

    function render() {
      const q = normalize(searchInput?.value || '');
      const limitVal = (limitSelect?.value || '25');
      const limit = limitVal === 'all' ? Infinity : parseInt(limitVal, 10) || 25;

      let list = allUsers;
      if (focusUID) {
        list = list.filter(u => u.id === focusUID);
      }
      if (q) {
        list = list.filter((u) => {
          const name = computeName(u);
          return normalize(name).includes(q) || normalize(u.email).includes(q) || normalize(u.role).includes(q);
        });
      }

      const slice = list.slice(0, limit);
      tbody.innerHTML = '';
      if (!slice.length) {
        tbody.innerHTML = "<tr><td colspan='4'>No matching users.</td></tr>";
        return;
      }

      slice.forEach((u) => {
        const name = computeName(u);
        const isBlocked = u.blocked === true;
        // Map old "user" role to "employee" for backward compatibility
        let currentRole = u.role || 'employee';
        if (currentRole === 'user') {
          currentRole = 'employee';
        }
        const tr = document.createElement('tr');
        tr.setAttribute('data-name', name);
        
        // Build role select options based on current role
        // Admin role is exclusive - it should not be changeable via dropdown
        // If user is admin, show admin as selected but disabled (read-only)
        // If user is not admin, only show Employee and Trainee (admin option hidden for exclusivity)
        let roleSelectHTML = '';
        if (currentRole === 'admin') {
          // For admin users, show admin as selected but make the select disabled
          // This prevents changing admin role while still showing current role
          roleSelectHTML = `
            <select data-uid="${u.id}" class="role-select" disabled style="opacity: 1; cursor: not-allowed;" title="Admin role cannot be changed">
              <option value="admin" selected>Admin</option>
            </select>
          `;
        } else {
          // For non-admin users, only show Employee and Trainee (admin option hidden for exclusivity)
          roleSelectHTML = `
            <select data-uid="${u.id}" class="role-select">
              <option value="employee" ${currentRole === 'employee' ? 'selected' : ''}>Employee</option>
              <option value="trainee" ${currentRole === 'trainee' ? 'selected' : ''}>Trainee</option>
            </select>
          `;
        }
        
        tr.innerHTML = `
          <td data-label="Name">${name}</td>
          <td data-label="Email">${u.email || ''}</td>
          <td data-label="Role">
            ${roleSelectHTML}
          </td>
          <td data-label="Actions">
            <div class="action-buttons">
              <button class="action-btn btn-save" data-uid="${u.id}" style="display:none;">
                <i class="fas fa-save"></i> Save
              </button>
              <button class="action-btn btn-block" data-uid="${u.id}">
                <i class="fas fa-ban"></i> ${isBlocked ? 'Activate' : 'Deactivate'}
              </button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
        // Bind actions - admin users can still be blocked/unblocked but role cannot be changed
        bindRowActions(tr, u, name, currentRole === 'admin');
      });
    }

    render();
    if (searchInput) searchInput.addEventListener('input', render);
    if (limitSelect) limitSelect.addEventListener('change', render);

  } catch (err) {
    console.error('[editUsers.js] Error loading users:', err);
    tbody.innerHTML = "<tr><td colspan='4'>Error loading data.</td></tr>";
    showMessage(msgEl, `Error: ${getFirebaseErrorMessage(err)}`, "error");
  }

  // Modal functions for confirmation dialogs
  function showSaveChangesModal(userUID, name, newRole, saveBtn, msgEl) {
    const modal = document.getElementById('saveChangesModal');
    const messageEl = document.getElementById('saveChangesMessage');
    const cancelBtn = document.getElementById('saveChangesCancel');
    const confirmBtn = document.getElementById('saveChangesConfirm');

    // Update message with specific details
    messageEl.textContent = `Are you sure you want to change ${name}'s role to "${newRole}"?`;

    // Show modal with animation
    modal.style.display = 'flex';
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
      const userRef = doc(db, 'userProfiles', userUID);
      showMessage(msgEl, `Saving role for ${name}...`, "info");
      try {
        await updateDoc(userRef, { role: newRole });
        showMessage(msgEl, `Role updated successfully for ${name}`, "success");
        saveBtn.style.display = 'none';
        modal.classList.remove('show');
        setTimeout(() => {
          modal.style.display = 'none';
        }, 300);
      } catch (err) {
        console.error("[editUsers.js] Role update error:", err);
        showMessage(msgEl, `Error: ${getFirebaseErrorMessage(err)}`, "error");
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


  function showBlockUserModal(userUID, name, newBlocked, blockBtn, msgEl) {
    const modal = document.getElementById('blockUserModal');
    const messageEl = document.getElementById('blockUserMessage');
    const cancelBtn = document.getElementById('blockUserCancel');
    const confirmBtn = document.getElementById('blockUserConfirm');

    // Update message and button text
    const action = newBlocked ? 'deactivate' : 'activate';
    messageEl.textContent = `Are you sure you want to ${action} "${name}"?`;
    confirmBtn.textContent = `${newBlocked ? 'Deactivate' : 'Activate'} User`;

    // Show modal with animation
    modal.style.display = 'flex';
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
      const userRef = doc(db, 'userProfiles', userUID);
      try {
        await updateDoc(userRef, { blocked: newBlocked });
        blockBtn.innerHTML = `<i class="fas fa-ban"></i> ${newBlocked ? 'Activate' : 'Deactivate'}`;
        showMessage(msgEl, `${name} ${newBlocked ? 'deactivated' : 'activated'} successfully.`, "success");
        modal.classList.remove('show');
        setTimeout(() => {
          modal.style.display = 'none';
        }, 300);
      } catch (err) {
        console.error("[editUsers.js] Deactivate error:", err);
        showMessage(msgEl, `Error: ${getFirebaseErrorMessage(err)}`, "error");
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

  // Setup Add New User Modal
  setupAddUserModal();
}

function setupAddUserModal() {
  const addUserBtn = document.getElementById('addNewUserBtn');
  const addUserModal = document.getElementById('addUserModal');
  const closeBtn = document.getElementById('closeAddUserModal');
  const cancelBtn = document.getElementById('cancelAddUser');
  const addUserForm = document.getElementById('addUserForm');
  const messageEl = document.getElementById('addUserMessage');
  const loadingModal = document.getElementById('loadingModal');

  if (!addUserBtn || !addUserModal) return;

  // Open modal
  addUserBtn.addEventListener('click', () => {
    addUserModal.style.display = 'flex';
    setTimeout(() => {
      addUserModal.classList.add('show');
    }, 10);
    // Reset form
    if (addUserForm) addUserForm.reset();
    if (messageEl) {
      messageEl.textContent = '';
      messageEl.className = 'message';
    }
  });

  // Close modal function
  const closeModal = () => {
    addUserModal.classList.remove('show');
    setTimeout(() => {
      addUserModal.style.display = 'none';
    }, 300);
  };

  // Close button handlers
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  // Close on backdrop click
  addUserModal.addEventListener('click', (e) => {
    if (e.target === addUserModal) {
      closeModal();
    }
  });

  // Setup birthdate input formatting
  const birthdateInput = document.getElementById('modalBirthdate');
  if (birthdateInput) {
    birthdateInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/\D/g, '');
      if (value.length >= 2) {
        value = value.substring(0, 2) + '/' + value.substring(2);
      }
      if (value.length >= 5) {
        value = value.substring(0, 5) + '/' + value.substring(5, 9);
      }
      e.target.value = value;
    });

    birthdateInput.addEventListener('keypress', (e) => {
      const char = String.fromCharCode(e.which);
      if (!/\d/.test(char) && char !== '/') {
        e.preventDefault();
      }
    });
  }

  // Handle form submission
  if (addUserForm) {
    addUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Reset message
      if (messageEl) {
        messageEl.textContent = '';
        messageEl.className = 'message';
      }

      const firstName = document.getElementById('modalFirstName').value.trim();
      const middleName = document.getElementById('modalMiddleName').value.trim();
      const lastName = document.getElementById('modalLastName').value.trim();
      const birthdateInputValue = document.getElementById('modalBirthdate').value.trim();
      const email = document.getElementById('modalEmail').value.trim();
      const password = document.getElementById('modalPassword').value;
      const confirmPassword = document.getElementById('modalConfirmPassword').value;
      const role = document.getElementById('modalRole').value;

      // Validate birthdate
      if (!birthdateInputValue) {
        if (messageEl) {
          messageEl.textContent = "Please enter a valid birthdate.";
          messageEl.className = 'message';
        }
        return;
      }

      const datePattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
      const match = birthdateInputValue.match(datePattern);

      if (!match) {
        if (messageEl) {
          messageEl.textContent = "Please enter birthdate in MM/DD/YYYY format.";
          messageEl.className = 'message';
        }
        return;
      }

      const month = parseInt(match[1], 10);
      const day = parseInt(match[2], 10);
      const year = parseInt(match[3], 10);

      if (month < 1 || month > 12) {
        if (messageEl) {
          messageEl.textContent = "Please enter a valid month (01-12).";
          messageEl.className = 'message';
        }
        return;
      }

      if (day < 1 || day > 31) {
        if (messageEl) {
          messageEl.textContent = "Please enter a valid day (01-31).";
          messageEl.className = 'message';
        }
        return;
      }

      const birthDate = new Date(year, month - 1, day);

      if (birthDate.getMonth() !== month - 1 || birthDate.getDate() !== day || birthDate.getFullYear() !== year) {
        if (messageEl) {
          messageEl.textContent = "Please enter a valid date.";
          messageEl.className = 'message';
        }
        return;
      }

      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }

      if (age < 18) {
        if (messageEl) {
          messageEl.textContent = "Registration is only allowed for users 18 years old and above.";
          messageEl.className = 'message';
        }
        return;
      }

      const birthdate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      // Validate password match
      if (password !== confirmPassword) {
        if (messageEl) {
          messageEl.textContent = "Passwords do not match";
          messageEl.className = 'message';
        }
        return;
      }

      // Show loading modal
      const loadingSpinner = document.getElementById('loadingSpinner');
      const successCheckmark = document.getElementById('successCheckmark');
      const loadingText = document.getElementById('loadingText');

      if (loadingSpinner) loadingSpinner.style.display = 'block';
      if (successCheckmark) successCheckmark.style.display = 'none';
      if (loadingText) {
        loadingText.textContent = 'Registering user...';
        loadingText.style.color = '#333';
      }
      if (loadingModal) {
        loadingModal.classList.remove('success');
        loadingModal.classList.add('show');
      }

      try {
        // Save current admin credentials
        const adminEmail = sessionStorage.getItem('adminEmail');
        const adminPassword = sessionStorage.getItem('adminPassword');

        // Set flag to prevent auth redirect
        sessionStorage.setItem('preventAuthRedirect', 'true');

        // Create the new user
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCred.user.uid;

        // Send verification email
        await sendEmailVerification(userCred.user);

        // Save profile in Firestore
        await setDoc(doc(db, "userProfiles", uid), {
          firstName,
          middleName,
          lastName,
          birthdate,
          email,
          role,
          username: `${firstName} ${lastName}`.trim(),
          emailVerified: false,
          createdAt: new Date().toISOString()
        });

        // Show success
        if (loadingSpinner) loadingSpinner.style.display = 'none';
        if (successCheckmark) successCheckmark.style.display = 'block';
        if (loadingText) {
          loadingText.textContent = 'Account Created, awaiting email verification from user';
          loadingText.style.color = '#28a745';
        }
        if (loadingModal) {
          loadingModal.classList.add('success');
        }

        // Wait for animation
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Sign out the new user
        await signOut(auth);

        // Restore admin session
        if (adminEmail && adminPassword) {
          await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
        }

        // Clear flag
        sessionStorage.removeItem('preventAuthRedirect');

        // Hide loading modal
        if (loadingModal) {
          loadingModal.classList.remove('show', 'success');
        }

        // Close add user modal
        closeModal();

        // Show success message and reload users
        if (messageEl) {
          messageEl.textContent = "Account Created, awaiting email verification from user";
          messageEl.className = 'message success';
        }

        // Reload the page to show new user
        setTimeout(() => {
          window.location.reload();
        }, 1000);

      } catch (err) {
        console.error("[editUsers.js] Registration error:", err);

        // Hide loading modal
        if (loadingModal) {
          loadingModal.classList.remove('show');
        }

        // Clear flag
        sessionStorage.removeItem('preventAuthRedirect');

        let errorMsg = "An error occurred. Please try again.";

        switch (err.code) {
          case "auth/email-already-in-use":
            errorMsg = "Email already in use.";
            break;
          case "auth/invalid-email":
            errorMsg = "Invalid email address.";
            break;
          case "auth/weak-password":
            errorMsg = "Password should be at least 6 characters.";
            break;
          default:
            errorMsg = err.message;
        }

        if (messageEl) {
          messageEl.textContent = errorMsg;
          messageEl.className = 'message';
        }
      }
    });
  }
}
