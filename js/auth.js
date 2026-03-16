// auth.js  (replace contents)
import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

import { showMessage } from './utils.js';

export let currentFirebaseUser = null;
export let userProfileCache = null;

/* ---- helpers ---- */
function updateLoginMessage(msg, type = "info") {
  // try to update DOM if present
  const el = document.getElementById("loginMessage");
  if (el) {
    el.textContent = msg;
    el.style.color =
      type === "success" ? "green" :
      type === "error"   ? "red" :
      "#555";
    el.style.fontSize = "0.9rem";
    el.style.marginTop = "6px";
    el.style.textAlign = "center";
  } else {
    // fallback: persist using sessionStorage so the login page can read it
    sessionStorage.setItem('auth_message', JSON.stringify({ msg, type }));
  }
}

// read any persisted auth message (call on loginPage.html DOMContentLoaded)
export function flushPersistentAuthMessage() {
  const raw = sessionStorage.getItem('auth_message');
  if (!raw) return;
  try {
    const { msg, type } = JSON.parse(raw);
    // attempt to set on DOM (loginPage.html should include the updateLoginMessage function)
    const el = document.getElementById("loginMessage");
    if (el) {
      el.textContent = msg;
      el.style.color = type === "success" ? "green" : type === "error" ? "red" : "#555";
      el.style.fontSize = "0.9rem";
      el.style.marginTop = "6px";
      el.style.textAlign = "center";
    }
  } catch (e) {
    console.warn("[auth.js] Could not parse persisted auth message:", e);
  } finally {
    sessionStorage.removeItem('auth_message');
  }
}

/**
 * Fetch the user profile from Firestore
 */
export async function fetchUserProfile(uid) {
  try {
    const docRef = doc(db, "userProfiles", uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data();
    } else {
      console.warn(`[auth.js] No profile found for UID: ${uid}`);
      return null;
    }
  } catch (err) {
    console.error("[auth.js] Error fetching profile:", err);
    return null;
  }
}

/**
 * Login handler
 */
export async function loginUser(email, password) {
  try {
    updateLoginMessage("Logging in...", "info");

    // sign in first
    const cred = await signInWithEmailAndPassword(auth, email, password);

    // Fetch profile immediately and check blocked state BEFORE allowing navigation
    const profile = await fetchUserProfile(cred.user.uid);
    if (!profile) {
      // no profile → sign out and show message
      await signOut(auth);
      updateLoginMessage("Account not found. Contact admin.", "error");
      return;
    }

    // Check if email is verified (only for accounts created after email verification was added)
    const hasEmailVerificationFlag = profile.hasOwnProperty('emailVerified');
    if (hasEmailVerificationFlag && !cred.user.emailVerified) {
      await signOut(auth);
      updateLoginMessage("Please verify your email before logging in. Check your inbox.", "error");
      return;
    }

    if (profile.blocked) {
      // persist message then sign out to ensure message is shown on login page
      sessionStorage.setItem('auth_message', JSON.stringify({ msg: "Your account is currently deactivated.", type: "error" }));
      await signOut(auth);
      // if we're currently on login page, show message immediately
      updateLoginMessage("Your account is currently deactivated.", "error");
      return;
    }

    // Store admin credentials for session restoration
    if (profile.role === 'admin') {
      sessionStorage.setItem('adminEmail', email);
      sessionStorage.setItem('adminPassword', password);
    }

    // success — let onAuthStateChanged handle redirects if needed
    updateLoginMessage("Logged in.", "success");
    // currentFirebaseUser will be set by onAuthStateChanged shortly
  } catch (err) {
    console.error("[auth.js] Login error:", err);

    let msg = "Login failed.";
    if (err.code === "auth/user-not-found") {
      msg = "User does not exist.";
    } else if (err.code === "auth/wrong-password") {
      msg = "Incorrect credentials.";
    } else if (err.code === "auth/too-many-requests") {
      msg = "Too many attempts. Try again later.";
    }

    updateLoginMessage(msg, "error");
  }
}

/**
 * Logout handler
 */
export async function logoutUser() {
  try {
    await signOut(auth);
    console.log("[auth.js] Logout successful.");
    // persist message optionally (none here)
    window.location.href = "/loginPage.html"; // always back to login
  } catch (err) {
    console.error("[auth.js] Logout error:", err);
  }
}

/**
 * Auth state listener — robustly checks profile and blocked status,
 * and uses sessionStorage to ensure messages persist to the login page.
 */
onAuthStateChanged(auth, async (user) => {
  console.log("[auth.js] onAuthStateChanged fired. User:", user ? user.uid : "null");

  // Check if we should prevent redirects (e.g., during application approval)
  const preventRedirect = sessionStorage.getItem('preventAuthRedirect');
  if (preventRedirect === 'true') {
    console.log("[auth.js] Redirect prevented due to preventAuthRedirect flag");
    return;
  }

  if (!user) {
    currentFirebaseUser = null;
    userProfileCache = null;
    // not logged in → always send to login (if not already there)
    if (!window.location.pathname.endsWith("/loginPage.html")) {
      // allow login page to show a message (if set)
      window.location.href = "/loginPage.html";
    }
    return;
  }

  // user is present — fetch profile
  currentFirebaseUser = user;
  const profile = await fetchUserProfile(user.uid);
  userProfileCache = profile;

  if (!profile) {
    console.warn("[auth.js] No user profile found, logging out.");
    // persist message for login page
    sessionStorage.setItem('auth_message', JSON.stringify({ msg: "User profile missing. Contact admin.", type: "error" }));
    await signOut(auth);
    return;
  }

  // EMAIL VERIFICATION CHECK: if not verified, sign out and persist message (only for accounts with verification flag)
  const hasEmailVerificationFlag = profile.hasOwnProperty('emailVerified');
  if (hasEmailVerificationFlag && !user.emailVerified) {
    console.warn("[auth.js] Unverified email attempted access, logging out.");
    sessionStorage.setItem('auth_message', JSON.stringify({ msg: "Please verify your email before logging in. Check your inbox.", type: "error" }));
    await signOut(auth);
    return;
  }

  // Sync emailVerified status from Firebase Auth to Firestore if it changed
  if (hasEmailVerificationFlag && profile.emailVerified === false && user.emailVerified === true) {
    console.log("[auth.js] Email verification status changed, updating Firestore.");
    try {
      await updateDoc(doc(db, "userProfiles", user.uid), {
        emailVerified: true
      });
      console.log("[auth.js] Email verification status updated in Firestore.");
    } catch (err) {
      console.error("[auth.js] Error updating emailVerified status:", err);
    }
  }

  // BLOCK CHECK: if blocked, sign out and persist message
  if (profile.blocked) {
    console.warn("[auth.js] Blocked user attempted access, logging out.");
    sessionStorage.setItem('auth_message', JSON.stringify({ msg: "Your account is currently deactivated.", type: "error" }));
    await signOut(auth);
    return;
  }

  // Normal redirect based on role
  if (profile.role === "admin") {
    // only redirect if not on admin pages already
    if (!window.location.pathname.includes("/admin/")) {
      window.location.href = "/admin/admin-dashboard.html";
    }
  } else {
    if (!window.location.pathname.includes("/user/")) {
      window.location.href = "/user/user-dashboard.html";
    }
  }
});
