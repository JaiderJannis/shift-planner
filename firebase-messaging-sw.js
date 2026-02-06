importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-app-sw.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-sw.js');

firebase.initializeApp({
  apiKey: "AIzaSyB8uHwRXCe1iV7z6T80YPxEbeB64qdMpNY",
  projectId: "shift-planner-dc7ad",
  messagingSenderId: "719441527396",
  appId: "1:719441527396:web:de87d6f950fe23702a5571"
});

const messaging = firebase.messaging();

// Optioneel: Achtergrond berichten afhandelen
messaging.onBackgroundMessage((payload) => {
  console.log('Bericht ontvangen in achtergrond:', payload);
});