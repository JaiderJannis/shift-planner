import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';

// 🔥 Jouw Firebase-config (zelfde als app.html)
const firebaseConfig = {
  apiKey: "AIzaSyB8uHwRXCe1iV7z6T80YPxEbeB64qdMpNY",
  authDomain: "shift-planner-dc7ad.firebaseapp.com",
  projectId: "shift-planner-dc7ad",
  storageBucket: "shift-planner-dc7ad.firebasestorage.app",
  messagingSenderId: "719441527396",
  appId: "1:719441527396:web:de87d6f950fe23702a5571"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// check if already logged in
onAuthStateChanged(auth, user => {
  if (user) window.location.href = "app.html";
});

document.getElementById("googleLoginBtn").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
    window.location.href = "app.html";
  } catch (err) {
    alert("Inloggen mislukt: " + err.message);
  }
});