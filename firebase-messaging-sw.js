importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js');

// Gebruik exact dezelfde config als in je hoofdscript
const firebaseConfig = {
  apiKey: "AIzaSyB8uHwRXCe1iV7z6T80YPxEbeB64qdMpNY",
  authDomain: "shift-planner-dc7ad.firebaseapp.com",
  projectId: "shift-planner-dc7ad",
  messagingSenderId: "719441527396",
  appId: "1:719441527396:web:de87d6f950fe23702a5571"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Luister naar berichten wanneer de app op de achtergrond draait
messaging.onBackgroundMessage((payload) => {
  console.log('[sw.js] Bericht ontvangen: ', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});





