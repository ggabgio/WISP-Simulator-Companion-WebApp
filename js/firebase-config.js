// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth, setPersistence, browserSessionPersistence } 
  from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCwY9IdMuNioCDSdR-K7Z5YhRjc_HwpUcU",
  authDomain: "wispsim-030-c1718.firebaseapp.com",
  projectId: "wispsim-030",
  storageBucket: "wispsim-030.firebasestorage.app",
  messagingSenderId: "933187629225",
  appId: "1:933187629225:web:6caaa749aec03b1fadb9b8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Force session-only persistence (clears when browser/tab is closed)
setPersistence(auth, browserSessionPersistence)
  .then(() => {
    console.log("[firebase.js] Auth persistence set to SESSION");
  })
  .catch((err) => {
    console.error("[firebase.js] Failed to set persistence:", err);
  });

const db = getFirestore(app);

export { app, auth, db };
