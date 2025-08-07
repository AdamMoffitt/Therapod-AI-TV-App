// firebase.js
import { getAnalytics } from 'firebase/analytics';
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { setAnalyticsCollectionEnabled, settings } from 'firebase/analytics';

// Replace with your Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyB9ATpM2LRvPGJVTSJBbmwK_YN1DFkVgFg",
    authDomain: "therapod-454503.firebaseapp.com",
    projectId: "therapod-454503",
    storageBucket: "therapod-454503.appspot.com",
    messagingSenderId: "395597389018",
    appId: "1:395597389018:web:cb6f371b42fe89d5bb99e3",
    measurementId: "G-9HHG4MNX5S"
};
// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
export const analytics = getAnalytics(app);
setAnalyticsCollectionEnabled(analytics, true);


export { db };