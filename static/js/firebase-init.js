
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Re-export common Auth/DB functions so consumers don't need to import from CDN
export { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, doc, setDoc, getDoc };

const firebaseConfig = {
    apiKey: "AIzaSyDLhNhGd97RAIT6ccMIaNQo7iIfhZDaF-I",
    authDomain: "ls-personal-lab.firebaseapp.com",
    projectId: "ls-personal-lab",
    storageBucket: "ls-personal-lab.firebasestorage.app",
    messagingSenderId: "402992364590",
    appId: "1:402992364590:web:b087281b67a551190773bf"
};

// Singleton Pattern: Initialize only if not already initialized
export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);

// Helper to get token (returns null if not logged in)
export async function getAuthToken() {
    if (auth.currentUser) return await auth.currentUser.getIdToken();
    return null;
}

// Optional: Global Auth Listener for UI updates (passed in callback)
export function initGlobalAuthListener(loginBtnId, userIconId) {
    onAuthStateChanged(auth, (user) => {
        const loginLink = document.getElementById(loginBtnId);
        const userIcon = document.getElementById(userIconId);

        // Debug
        // console.log("Auth State Changed:", user ? user.uid : "No User");

        if (user) {
            if (loginLink) loginLink.style.display = 'none';
            if (userIcon) userIcon.style.display = 'flex';
        } else {
            if (loginLink) loginLink.style.display = 'inline-block';
            if (userIcon) userIcon.style.display = 'none';
        }
    });
}
