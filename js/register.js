// register.js
import { auth, db } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signOut,
  signInWithEmailAndPassword,
  sendEmailVerification
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { logoutUser } from './auth.js';


// ---------- Logout binding ----------
const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await logoutUser();
  });
}

const registerForm = document.getElementById('registerForm');
const messageEl = document.getElementById('registerMessage');
const loadingModal = document.getElementById('loadingModal');
const submitButton = registerForm ? registerForm.querySelector('button[type="submit"]') : null;
const birthdateInput = document.getElementById('birthdate');

// Save current admin credentials before creating a new user
let adminEmail = null;
let adminPassword = null;
document.addEventListener('DOMContentLoaded', () => {
  adminEmail = sessionStorage.getItem('adminEmail');
  adminPassword = sessionStorage.getItem('adminPassword');
  
  // Add date formatting to birthdate input
  if (birthdateInput) {
    birthdateInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/\D/g, ''); // Remove all non-digits
      
      if (value.length >= 2) {
        value = value.substring(0, 2) + '/' + value.substring(2);
      }
      if (value.length >= 5) {
        value = value.substring(0, 5) + '/' + value.substring(5, 9);
      }
      
      e.target.value = value;
    });
    
    // Prevent invalid characters
    birthdateInput.addEventListener('keypress', (e) => {
      const char = String.fromCharCode(e.which);
      if (!/\d/.test(char) && char !== '/') {
        e.preventDefault();
      }
    });
  }
});

if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Reset message every attempt
    messageEl.textContent = "";
    messageEl.style.color = "";

    const firstName = document.getElementById('firstName').value.trim();
    const middleName = document.getElementById('middleName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const birthdateInputValue = document.getElementById('birthdate').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const role = document.getElementById('role').value;

    // Birthdate validation - must be 18 years or older
    if (!birthdateInputValue) {
      messageEl.textContent = "Please enter a valid birthdate.";
      messageEl.style.color = "red";
      return;
    }

    // Validate and parse MM/DD/YYYY format
    const datePattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const match = birthdateInputValue.match(datePattern);
    
    if (!match) {
      messageEl.textContent = "Please enter birthdate in MM/DD/YYYY format.";
      messageEl.style.color = "red";
      return;
    }

    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);

    // Validate month and day ranges
    if (month < 1 || month > 12) {
      messageEl.textContent = "Please enter a valid month (01-12).";
      messageEl.style.color = "red";
      return;
    }

    if (day < 1 || day > 31) {
      messageEl.textContent = "Please enter a valid day (01-31).";
      messageEl.style.color = "red";
      return;
    }

    // Create date object (using MM/DD/YYYY format)
    const birthDate = new Date(year, month - 1, day); // month is 0-indexed in Date
    
    // Verify the date is valid (catches invalid dates like 02/30/2000)
    if (birthDate.getMonth() !== month - 1 || birthDate.getDate() !== day || birthDate.getFullYear() !== year) {
      messageEl.textContent = "Please enter a valid date.";
      messageEl.style.color = "red";
      return;
    }

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    // Adjust age if birthday hasn't occurred this year
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    if (age < 18) {
      messageEl.textContent = "Registration is only allowed for users 18 years old and above.";
      messageEl.style.color = "red";
      return;
    }

    // Convert MM/DD/YYYY to YYYY-MM-DD for storage
    const birthdate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Validate password match
    if (password !== confirmPassword) {
      messageEl.textContent = "Passwords do not match";
      messageEl.style.color = "red";
      return; // safely exit only for this attempt
    }

    // Reset modal state and show loading modal
    const loadingSpinner = document.getElementById('loadingSpinner');
    const successCheckmark = document.getElementById('successCheckmark');
    const loadingText = document.getElementById('loadingText');
    
    // Reset to loading state
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
    
    document.body.classList.add('loading');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.style.opacity = '0.6';
      submitButton.style.cursor = 'not-allowed';
    }

    try {
      // Set flag to prevent auth redirect during user creation
      sessionStorage.setItem('preventAuthRedirect', 'true');

      // Create the new user
      const userCred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCred.user.uid;

      // Send verification email
      await sendEmailVerification(userCred.user);

      // Save profile in Firestore with emailVerified flag
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

      // Show success checkmark
      const loadingSpinner = document.getElementById('loadingSpinner');
      const successCheckmark = document.getElementById('successCheckmark');
      const loadingText = document.getElementById('loadingText');
      
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      if (successCheckmark) successCheckmark.style.display = 'block';
      if (loadingText) {
        loadingText.textContent = 'Verification email sent!';
        loadingText.style.color = '#28a745';
      }
      
      if (loadingModal) {
        loadingModal.classList.add('success');
      }

      // Wait for checkmark animation to complete, then proceed
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Hide loading modal and re-enable form
      document.body.classList.remove('loading');
      if (loadingModal) {
        loadingModal.classList.remove('show', 'success');
      }

      messageEl.textContent = "User created! Please check email for verification link.";
      messageEl.style.color = "green";

      // Add a small delay before signing out the new user
      await new Promise(resolve => setTimeout(resolve, 500));

      // Sign out the new user immediately
      await signOut(auth);

      // Clear the prevent redirect flag
      sessionStorage.removeItem('preventAuthRedirect');

      // Restore admin session
      if (adminEmail && adminPassword) {
        await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
      }

      // Redirect admin back to dashboard
      setTimeout(() => {
        window.location.href = "admin-dashboard.html";
      }, 500);

    } catch (err) {
      console.error("[register.js] Registration error:", err);
      
      // Hide loading modal and re-enable form
      document.body.classList.remove('loading');
      if (loadingModal) {
        loadingModal.classList.remove('show');
      }
      
      // Re-enable form
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.style.opacity = '1';
        submitButton.style.cursor = 'pointer';
      }
      
      // Clear the prevent redirect flag in case of error
      sessionStorage.removeItem('preventAuthRedirect');
      
      let errorMsg = "An error occured. Please try again.";

      switch (err.code) {
        case "auth/email-already-in-use":
          errorMsg= "Email already in use.";
          break;
        case "auth/invalid-email":
          errorMsg= "Invalid email address.";
          break;
        case "auth/weak-password":
          errorMsg = "Password should be at least 6 characters.";
          break;
        default:
          errorMsg = err.message; //fallback
      }
      messageEl.textContent = errorMsg;
      messageEl.style.color = "red";
    }
  });
}
