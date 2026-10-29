/**
 * Shift Planner — Cloud Function: pushmelding de avond vóór je dienst.
 *
 * Draait elke dag om 20:00 (Brussel). Voor elke gebruiker met een opgeslagen
 * pushtoken (fcmToken) en met de voorkeur "De avond vóór je dienst" aan:
 * staat er morgen een shift in? Dan krijgt die gebruiker een pushmelding,
 * ook als de app gesloten is. De melding komt ook bij het belletje in de app
 * (dezelfde tekst als de app zelf maakt, dus nooit dubbel).
 *
 * Installeren: zie functions/README.md
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

const TZ = 'Europe/Brussels';
const DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const APP_URL = 'https://jaiderjannis.github.io/shift-planner/';

/** Datum in Brussel als { iso, y, m (0-11), weekday }. */
function brusselsDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(d)
      .map(p => [p.type, p.value])
  );
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return { iso, y: Number(parts.year), m: Number(parts.month) - 1, weekday };
}

function shiftName(key, shifts) {
  return shifts?.[key]?.realName || key;
}

/** Zelfde tekst als tomorrowReminderText() in app.js. */
function reminderText(user, tomorrow) {
  const rows = user.monthData?.[tomorrow.y]?.[tomorrow.m]?.rows || {};
  const keys = Object.keys(rows)
    .filter(k => k === tomorrow.iso || k.startsWith(`${tomorrow.iso}#`) || k.startsWith(`${tomorrow.iso}_`))
    .sort((a, b) => (rows[a]?.start || '24:00').localeCompare(rows[b]?.start || '24:00') || a.localeCompare(b));
  const parts = keys
    .map(k => rows[k])
    .filter(r => r?.shift && (!r.status || r.status === 'approved'))
    .filter(r => !/vrij|niet ingepland/i.test(shiftName(r.shift, user.shifts)))
    .map(r => {
      const name = shiftName(r.shift, user.shifts);
      const hasTime = r.start && r.end && !(r.start === '00:00' && r.end === '00:00');
      return hasTime ? `${name} ${r.start}–${r.end}` : name;
    });
  const uniq = parts.filter((p, i) => parts.indexOf(p) === i);
  return uniq.length ? `Morgen (${DAYS[tomorrow.weekday]}): ${uniq.join(' + ')}` : '';
}

exports.avondMelding = onSchedule({ schedule: '0 20 * * *', timeZone: TZ, region: 'europe-west1' }, async () => {
  const db = getFirestore();
  const today = brusselsDate(0);
  const tomorrow = brusselsDate(1);
  const users = await db.collection('users').get();

  let sent = 0;
  for (const docSnap of users.docs) {
    const user = docSnap.data();
    if (user.settings?.notificationPrefs?.notifyEveningBefore === false) continue;
    const text = reminderText(user, tomorrow);
    if (!text) continue;

    // Bij het belletje (niet dubbel als de app hem vandaag al maakte)
    const notifCol = docSnap.ref.collection('notifications');
    const existing = await notifCol.where('text', '==', text).where('dateKey', '==', today.iso).limit(1).get();
    if (existing.empty) {
      await notifCol.add({ text, timestamp: new Date().toISOString(), dateKey: today.iso, read: false });
    }

    // Pushmelding op de telefoon
    if (user.fcmToken) {
      try {
        await getMessaging().send({
          token: user.fcmToken,
          notification: { title: 'Shift Planner', body: text },
          webpush: { fcmOptions: { link: APP_URL }, notification: { icon: 'favicon-192x192.png' } }
        });
        sent++;
      } catch (err) {
        console.warn(`Push naar ${docSnap.id} mislukt:`, err.code || err.message);
      }
    }
  }
  console.log(`Avondmelding: ${sent} pushberichten verstuurd`);
});
