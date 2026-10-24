/*
 * Shift Planner — app.js
 *
 * Inhoud (zoek op "§" + nummer om te springen):
 *   §01  FIREBASE — Imports, configuratie en Firebase-services.
 *   §02  STATE & CONSTANTEN — Globale toestand van de app, vaste waarden en vaak gebruikte schermelementen.
 *   §03  ALGEMENE HELPERS — Kleine hulpfuncties zonder app-logica (datums, opmaak, meldingen).
 *   §04  DATA (FIRESTORE) — Gebruikersdata laden en opslaan; welke gebruiker actief is.
 *   §05  REKENREGELS — Shift-, project-, verlof- en stage-regels en urenberekening.
 *   §06  FEESTDAGEN & SCHOOLVAKANTIES — Belgische feestdagen en Vlaamse schoolvakanties.
 *   §07  OPSTARTEN & LOGIN — Inloggen, eerste rendering en alles opnieuw tekenen.
 *   §08  LAYOUT & THEMA — Zijbalk, accentkleur, donkere modus en mobiele weergave.
 *   §09  HOME — Dashboard, voortgang en team-mededelingen.
 *   §10  PROJECTEN — Projectbeheer (alleen admins mogen wijzigen).
 *   §11  SHIFTEN — Shiftbeheer: lijst, volgorde, opslaan.
 *   §12  INVOER — MAAND & STATUS — Maandkeuze, doelen, totalen, status, saldo-badges, versies en PDF.
 *   §13  INVOER — KALENDER — Kalenderweergave, dag-popup en snelle iconen.
 *   §14  INVOER — TABEL — Lijstweergave van de maand (rij per dag).
 *   §15  INVOER — SNELLE INVOER & MEERDERE DAGEN — Snelle invoer-popup en meerdere dagen tegelijk invullen.
 *   §16  INVOER — VERFMODUS & SCREENSHOT — Dagen "inkleuren" met favoriete shiften en de kalender als afbeelding bewaren.
 *   §17  BIJLAGEN — Bijlage per shift uploaden, downloaden en verwijderen.
 *   §18  HISTORIEK — Jaaroverzicht per maand.
 *   §19  CONVERTER — Uren/minuten ↔ decimale uren.
 *   §20  NON-BILLABLE — Niet-factureerbare uren per maand.
 *   §21  CHAT — Chat tussen gebruikers en admins.
 *   §22  MELDINGEN — In-app meldingen, automatische herinneringen en push/browser-meldingen.
 *   §23  PROFIEL — Profiel-popup: naam, thema, voorkeuren en export.
 *   §24  ADMIN — Gebruiker wisselen in de topbalk en rechten.
 *   §25  START — koppelt alle knoppen en start de app.
 *
 * Alle event-koppelingen staan per sectie in een bind…()-functie;
 * die worden helemaal onderaan in één keer gestart (initApp).
 */

// ======================================================================
// §01  FIREBASE
// Imports, configuratie en Firebase-services.
// ======================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';

import {
  getAuth,
  onAuthStateChanged,
  signOut,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';

import { getMessaging, getToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging.js';

import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getDocs,
  addDoc,
  deleteDoc,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  where,
  startAfter,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

import {
  getStorage,
  ref,
  getDownloadURL,
  deleteObject,
  uploadBytesResumable
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB8uHwRXCe1iV7z6T80YPxEbeB64qdMpNY',
  authDomain: 'shift-planner-dc7ad.firebaseapp.com',
  projectId: 'shift-planner-dc7ad',
  storageBucket: 'shift-planner-dc7ad.firebasestorage.app',
  messagingSenderId: '719441527396',
  appId: '1:719441527396:web:de87d6f950fe23702a5571',
  measurementId: 'G-7Q630776V6'
};

const app = initializeApp(firebaseConfig);
// Lokale cache: de app opent meteen met de laatst bekende gegevens en wijzigingen
// gemaakt zonder internet worden bewaard zodra je weer online bent.
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (err) {
  console.warn('Lokale cache niet beschikbaar, gewone verbinding wordt gebruikt:', err?.message || err);
  db = getFirestore(app);
}
const auth = getAuth(app);
const storage = getStorage(app);

// Push-berichten worden niet door elke browser ondersteund (bv. Safari op iPhone
// zonder "Zet op beginscherm"). Zonder deze try/catch start de hele app dan niet.
let messaging = null;
try {
  messaging = getMessaging(app);
} catch (err) {
  console.warn('Push-meldingen niet beschikbaar in deze browser:', err?.message || err);
}

// ======================================================================
// §02  STATE & CONSTANTEN
// Globale toestand van de app, vaste waarden en vaak gebruikte schermelementen.
// ======================================================================

// --- Toestand ---
let currentUserId = null; // ingelogde gebruiker
let mailUIBound = false;
let notificationInterval = null;
let isPaintMode = false;
let selectedPaintShiftKey = null;

// users: alle geladen gebruikers (admin ziet iedereen), viewUserId: gebruiker die een admin bekijkt
const dataStore = {
  users: {},
  currentUser: null,
  notifications: []
};

// Meerdere wijzigingen in hetzelfde moment worden samen in één keer weggeschreven
let saveQueued = false;
const debouncedSave = () => {
  if (saveQueued) return;
  saveQueued = true;
  queueMicrotask(() => {
    saveQueued = false;
    saveUserData();
  });
};

// --- Vaste waarden ---
const daysFull = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
const monthsFull = [
  'Januari',
  'Februari',
  'Maart',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Augustus',
  'September',
  'Oktober',
  'November',
  'December'
];

const LEAVE_SHIFT_NAMES = ['Verlof']; // telt mee als "verlof"
const SCHOOL_LEAVE_SHIFT_NAMES = ['Schoolverlof']; // telt mee als "schoolverlof"
const LEAVE_TYPES = ['Verlof', 'Schoolverlof', 'Ziekte', 'Feestdag'];
const STATUS_LABELS = { draft: 'Concept', submitted: 'Ingediend', approved: 'Goedgekeurd', rejected: 'Afgekeurd' };

// Shiften die automatisch aan een vast project gekoppeld worden
const SPECIAL_PROJECT_MAP = {
  Verlof: 'Eght Care',
  Ziekte: 'Eght Care',
  Teammeeting: 'Eght Care',
  School: 'PXL Verpleegkunde Hasselt',
  Schoolverlof: 'PXL Verpleegkunde Hasselt'
};

// Iconen voor shiften: sleutel → [emoji, naam]. Bestaande sleutels nooit hernoemen (staan in Firebase).
const SHIFT_ICON_LIST = {
  light_mode: ['☀️', 'Zon (vroege)'],
  wb_twilight: ['🌅', 'Schemer'],
  dag: ['🌤️', 'Dag'],
  avond: ['🌆', 'Avond'],
  bedtime: ['🌙', 'Maan (nacht)'],
  slaap: ['💤', 'Slaapdienst'],
  schedule: ['🕒', 'Klok'],
  kort: ['⏱️', 'Korte dienst'],
  star: ['⭐', 'Ster'],
  hart: ['❤️', 'Zorg'],
  stethoscoop: ['🩺', 'Verpleging'],
  spuit: ['💉', 'Spuiten/zorg'],
  pil: ['💊', 'Medicatie'],
  ambulance: ['🚑', 'Spoed'],
  oudere: ['👵', 'Ouderenzorg'],
  baby: ['👶', 'Kraam/kinderen'],
  brein: ['🧠', 'Psychiatrie'],
  thuiszorg: ['🏠', 'Thuiszorg'],
  auto: ['🚗', 'Verplaatsing'],
  oproep: ['📟', 'Oproepbaar'],
  telefoon: ['📞', 'Telefoondienst'],
  school: ['🎓', 'School'],
  stage: ['🏫', 'Stage'],
  opleiding: ['📚', 'Opleiding'],
  examen: ['📝', 'Examen/taak'],
  laptop: ['💻', 'Administratie'],
  teammeeting: ['👥', 'Teammeeting'],
  medical_services: ['🏥', 'Ziekte'],
  ziek: ['🤒', 'Ziek'],
  flight: ['✈️', 'Verlof'],
  vakantie: ['🏖️', 'Vakantie'],
  vrij_weekend: ['😎', 'Vrij weekend'],
  feestdag: ['🎉', 'Feestdag'],
  verjaardag: ['🎂', 'Verjaardag'],
  sport: ['🏃', 'Sport'],
  koffie: ['☕', 'Pauze'],
  bench: ['🪑', 'Bench'],
  niet_ingepland: ['❌', 'Niet ingepland']
};
const SHIFT_ICONS = Object.fromEntries(Object.entries(SHIFT_ICON_LIST).map(([k, [emoji]]) => [k, emoji]));
/** Hoeveel favoriete icoontjes er per dag zichtbaar zijn; de rest zit achter "⋯". */
const QUICK_ICONS_VISIBLE = 5;

// --- Vaak gebruikte schermelementen ---
const sidebar = document.getElementById('sidebar');
const logoutBtn = document.getElementById('logoutBtn');
const monthSelectMain = document.getElementById('monthSelectMain');
const yearSelectMain = document.getElementById('yearSelectMain');
const projectFilterSelect = document.getElementById('projectFilterSelect');
const monthTargetHours = document.getElementById('monthTargetHours');
const monthTargetMinutes = document.getElementById('monthTargetMinutes');
const tbody = document.getElementById('tbody');
const quickDate = document.getElementById('quickDate');
const quickShift = document.getElementById('quickShift');

// ======================================================================
// §03  ALGEMENE HELPERS
// Kleine hulpfuncties zonder app-logica (datums, opmaak, meldingen).
// ======================================================================

/** Maakt tekst veilig om in HTML te zetten (voorkomt dat berichten code uitvoeren). */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const toast = (msg, type = 'primary') => {
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${type} border-0 position-fixed bottom-0 end-0 m-3`;
  el.role = 'alert';
  el.ariaLive = 'assertive';
  el.ariaAtomic = 'true';
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  document.body.appendChild(el);
  new bootstrap.Toast(el, { delay: 2500 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
};

const dateKey = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Datum van vandaag als 'YYYY-MM-DD' in lokale tijd (toISOString geeft UTC → rond middernacht de verkeerde dag). */
const todayISO = () => {
  const d = new Date();
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
};

const toDisplayDate = iso => (!iso ? '-' : iso.split('-').reverse().join('-'));

const fromDisplayDate = disp => {
  const [d, m, y] = disp.split('-');
  return `${y}-${m}-${d}`;
};

const minutesBetween = (s, e, b) => {
  if (!s || !e) return 0;
  const [sh, sm] = s.split(':').map(Number),
    [eh, em] = e.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm) - (Number(b) || 0);
  if (mins < 0) mins += 1440;
  return mins;
};

/**
 * Ligt een datum binnen een periode? Werkt ook met rij-sleutels zoals
 * '2026-10-05#2' of '2026-10-05_1715…' (alleen de eerste 10 tekens tellen).
 */
const isDateWithin = (iso, start, end) => {
  const d = iso?.slice(0, 10).replaceAll('-', '');
  if (!d) return false;
  const s = start ? start.replaceAll('-', '') : null;
  const e = end ? end.replaceAll('-', '') : null;
  if (s && d < s) return false;
  if (e && d > e) return false;
  return true;
};

/** Compacte duur: 7u36. */
const fmtShort = mins => `${Math.floor(mins / 60)}u${String(mins % 60).padStart(2, '0')}`;

/** Korte notatie voor extra tijd: 45 min, 1u15. */
function fmtExtra(mins) {
  const n = Math.max(0, Number(mins) || 0);
  return n < 60 ? `${n} min` : `${Math.floor(n / 60)}u${String(n % 60).padStart(2, '0')}`;
}

function fmt(mins) {
  return `${Math.floor(mins / 60)}u ${mins % 60}min`;
}

function fmtMins(mins) {
  const a = Math.abs(mins);
  return `${Math.floor(a / 60)}u ${a % 60}min`;
}

/** Verschil met teken: '+2u 0min', '-1u 30min' of '0u 0min'. */
function fmtDiff(mins) {
  return `${mins > 0 ? '+' : mins < 0 ? '-' : ''}${fmtMins(mins)}`;
}

function getISOWeekParts(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // ma=1..zo=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // naar donderdag
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

function isoWeekId(date) {
  const { week, year } = getISOWeekParts(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Hex-kleur naar 'r, g, b' (voor CSS-variabelen). */
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

/** Firestore-tijdstempel of ISO-string naar ISO-string. */
function normTs(ts) {
  if (!ts) return '';
  if (typeof ts?.toDate === 'function') return ts.toDate().toISOString();
  if (typeof ts === 'string') return ts;
  return '';
}

// ======================================================================
// §04  DATA (FIRESTORE)
// Gebruikersdata laden en opslaan; welke gebruiker actief is.
// ======================================================================

async function ensureUserDoc(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: user.email,
      name: user.displayName || user.email.split('@')[0],
      role: 'user',
      shifts: {},
      monthData: {},
      projects: [],
      shiftOrder: []
    });
  } else {
    const data = snap.data(),
      updates = {};
    if (!('email' in data)) updates.email = user.email;
    if (!('name' in data)) updates.name = user.displayName || user.email.split('@')[0];
    if (!('role' in data)) updates.role = 'user';
    if (!('shifts' in data)) updates.shifts = {};
    if (!('monthData' in data)) updates.monthData = {};
    if (!('projects' in data)) updates.projects = [];
    if (!('shiftOrder' in data)) updates.shiftOrder = [];
    if (Object.keys(updates).length) await updateDoc(ref, updates);
  }
}

/** Gebruiker wiens data getoond/bewerkt wordt (admin kan iemand anders kiezen in de topbalk). */
function getActiveUserId() {
  return dataStore.viewUserId || currentUserId;
}

async function loadAllUsers() {
  const meSnap = await getDoc(doc(db, 'users', currentUserId));
  const me = meSnap.data();
  dataStore.users = {};
  if (me.role === 'admin') {
    const qs = await getDocs(collection(db, 'users'));
    qs.forEach(d => (dataStore.users[d.id] = d.data()));
  } else {
    dataStore.users[currentUserId] = me;
  }
  dataStore.currentUser = currentUserId;
}

// --- Live bijwerken: wijzigingen van een ander toestel of een andere gebruiker meteen tonen ---
let activeDocUnsub = null;
let activeDocUid = null;
let liveRefreshTimer = null;

/** Luistert naar het document van de gebruiker die je nu bekijkt (jezelf, of als admin iemand anders). */
function listenActiveUserDoc() {
  const uid = getActiveUserId();
  if (!uid || uid === activeDocUid) return;
  if (activeDocUnsub) activeDocUnsub();
  activeDocUid = uid;
  activeDocUnsub = onSnapshot(
    doc(db, 'users', uid),
    snap => {
      // Eigen, nog niet bevestigde wijzigingen: die staan al op het scherm
      if (!snap.exists() || snap.metadata?.hasPendingWrites) return;
      const fresh = snap.data();
      const cur = dataStore.users[uid] || {};
      const same = ['monthData', 'shifts', 'shiftOrder', 'projects', 'settings', 'role', 'name'].every(
        k => JSON.stringify(cur[k] ?? null) === JSON.stringify(fresh[k] ?? null)
      );
      if (same) return;
      dataStore.users[uid] = { ...cur, ...fresh };
      scheduleLiveRefresh(uid);
    },
    err => console.warn('Live bijwerken gestopt:', err.message)
  );
}

/** Scherm opnieuw tekenen na een wijziging van elders (niet terwijl je zelf iets aan het typen bent). */
function scheduleLiveRefresh(uid) {
  clearTimeout(liveRefreshTimer);
  liveRefreshTimer = setTimeout(() => {
    if (uid !== getActiveUserId()) return;
    const el = document.activeElement;
    const typing =
      el &&
      el.matches?.('input, textarea, select') &&
      el.closest('#dayEditorModal, #tbody, #quickModal, #shiftModal, #projectModal');
    if (typing) return scheduleLiveRefresh(uid); // even wachten tot je klaar bent
    renderProjects();
    renderShifts();
    renderProjectFilterForMonth();
    generateMonth();
    updateLeaveBadges();
    if (document.getElementById('dayEditorModal')?.classList.contains('show')) renderDayEditor();
    resetWorkWarnings();
    if (dataStore.viewUserId) {
      const u = dataStore.users[uid];
      toast(`Live bijgewerkt: ${escapeHtml(u?.name || u?.email || 'gebruiker')} heeft iets aangepast`, 'info');
    }
  }, 400);
}

// --- Opslaan met zichtbare status in de topbalk ---
let pendingSaves = 0;
let saveStatusTimer = null;

function setSaveStatus(state) {
  const el = document.getElementById('saveStatus');
  if (!el) return;
  clearTimeout(saveStatusTimer);
  const offline = !navigator.onLine;
  const text = {
    saving: offline ? 'Offline, wordt bewaard zodra je online bent' : 'Opslaan…',
    saved: 'Opgeslagen',
    error: 'Niet opgeslagen, probeer opnieuw'
  }[state];
  el.className = `save-status ${state}`;
  el.textContent = text || '';
  if (state === 'saved') {
    saveStatusTimer = setTimeout(() => {
      el.className = 'save-status';
      el.textContent = '';
    }, 2500);
  }
}

/** Volgt een schrijfactie naar Firebase: toont "Opslaan…" → "Opgeslagen" (of een fout). */
async function trackSave(promise) {
  pendingSaves++;
  setSaveStatus('saving');
  try {
    await promise;
    return true;
  } catch (err) {
    console.error('Opslaan mislukt:', err);
    setSaveStatus('error');
    toast('Opslaan mislukt: ' + (err?.message || 'onbekende fout'), 'danger');
    return false;
  } finally {
    pendingSaves--;
    if (pendingSaves === 0 && document.getElementById('saveStatus')?.classList.contains('saving'))
      setSaveStatus('saved');
  }
}

async function saveUserData() {
  const id = getActiveUserId();
  if (!id) return;
  return trackSave(setDoc(doc(db, 'users', id), dataStore.users[id], { merge: true }));
}

/**
 * Eén maand volledig wegschrijven (vervangt de maand in de databank).
 * Nodig bij verwijderen: saveUserData() voegt samen en laat verwijderde rijen staan.
 */
async function saveMonth(y, m) {
  const id = getActiveUserId();
  const md = dataStore.users[id]?.monthData?.[y]?.[m];
  if (!id || !md) return;
  return trackSave(updateDoc(doc(db, 'users', id), { [`monthData.${y}.${m}`]: md }));
}

/** Data van de actieve gebruiker (zie getActiveUserId). */
function getCurrentUserData() {
  const id = getActiveUserId();
  if (!id) return { shifts: {}, monthData: {}, projects: [], shiftOrder: [] };
  if (!dataStore.users[id]) dataStore.users[id] = { shifts: {}, monthData: {}, projects: [], shiftOrder: [] };
  return dataStore.users[id];
}

/** Is de INGELOGDE gebruiker admin? (niet de gebruiker die bekeken wordt) */
function isAdmin() {
  return dataStore.users[currentUserId]?.role === 'admin';
}

// ======================================================================
// §05  REKENREGELS
// Shift-, project-, verlof- en stage-regels en urenberekening.
// ======================================================================

function isValidProject(name) {
  const ud = getCurrentUserData();
  return !!(ud.projects || []).find(p => p.name === name);
}

/** Leesbare naam van een shift. Shift-sleutels kunnen een project-suffix hebben, bv. 'Ziekte (Eght Care)'. */
function shiftRealName(shiftKey, ud = getCurrentUserData()) {
  const key = String(shiftKey || '').trim();
  return String(ud?.shifts?.[key]?.realName || key).trim();
}

function autoProjectForShift(shiftName) {
  return SPECIAL_PROJECT_MAP[shiftName] || null;
}

function isStageProjectName(name) {
  return /stage/i.test(String(name || ''));
}

/**
 * Is deze rij een stage-shift? Stage-uren tellen NIET mee in de gewone uren.
 * Stage = shift met naam "Stage", shift met stage-icoon, of shift/rij gekoppeld
 * aan een project met "stage" in de naam.
 */
function isStageRow(r, ud) {
  if (!r) return false;
  ud = ud || getCurrentUserData();
  const sID = String(r.shift || '').trim();
  const shiftDef = ud?.shifts?.[sID];
  if (shiftRealName(sID, ud).toLowerCase() === 'stage' || sID.toLowerCase() === 'stage') return true;
  if (shiftDef?.icon === 'stage') return true;
  if (isStageProjectName(shiftDef?.project)) return true;
  if (isStageProjectName(r.project)) return true;
  return false;
}

/**
 * "Geplande" minuten van een maand: alles behalve stage en behalve verlof
 * dat nog in aanvraag of afgekeurd is. Overal dezelfde regel (home, invoer,
 * historiek, PDF, meldingen).
 */
function plannedMinutes(rows, ud = getCurrentUserData()) {
  return Object.values(rows || {}).reduce((sum, r) => {
    if (!r) return sum;
    if (r.status && r.status !== 'approved') return sum;
    if (isStageRow(r, ud)) return sum;
    return sum + (Number(r.minutes) || 0);
  }, 0);
}

// --- Rusttijd en werkdagen op rij ---

const MIN_REST_MINUTES = 10 * 60; // minder dan 10 uur rust tussen twee diensten = waarschuwing
const MAX_DAYS_IN_A_ROW = 7; // vanaf de 8e werkdag op rij = waarschuwing
const NON_WORK_ICONS = [
  'flight',
  'vakantie',
  'vrij_weekend',
  'niet_ingepland',
  'medical_services',
  'ziek',
  'feestdag',
  'school',
  'verjaardag'
];

/** Is dit echt werk (incl. stage)? Verlof, ziekte, vrij, school en lege rijen tellen niet. */
function isWorkRow(r, ud = getCurrentUserData()) {
  if (!r?.shift || (r.status && r.status !== 'approved')) return false;
  if (!(Number(r.minutes) > 0) || !r.start || !r.end || (r.start === '00:00' && r.end === '00:00')) return false;
  const def = ud?.shifts?.[r.shift] || {};
  const name = shiftRealName(r.shift, ud);
  if (LEAVE_TYPES.includes(name) || NON_WORK_ICONS.includes(def.icon)) return false;
  return !/verlof|ziek|vrij|niet ingepland|feestdag|^school$/i.test(name);
}

/**
 * Waarschuwingen per datum: te korte rust (< 10u) en te veel werkdagen op rij (> 7).
 * Geeft een Map ISO-datum → [{ type, text }].
 */
function computeWorkWarnings(ud = getCurrentUserData()) {
  const toMs = (iso, hhmm) => {
    const [h, m] = (hhmm || '00:00').split(':').map(Number);
    return new Date(`${iso}T00:00:00`).getTime() + (h * 60 + m) * 60000;
  };
  const intervals = [];
  Object.values(ud?.monthData || {}).forEach(months =>
    Object.values(months || {}).forEach(md =>
      Object.entries(md?.rows || {}).forEach(([key, r]) => {
        if (!isWorkRow(r, ud)) return;
        const iso = key.slice(0, 10);
        const start = toMs(iso, r.start);
        let end = toMs(iso, rowActualEnd(r));
        if (end <= start) end += 86400000; // nachtdienst over middernacht
        intervals.push({ iso, start, end, name: shiftRealName(r.shift, ud), endTxt: rowActualEnd(r) });
      })
    )
  );
  intervals.sort((a, b) => a.start - b.start);

  // Overlappende diensten (bv. MKA + Stage met dezelfde uren) samenvoegen
  const merged = [];
  for (const it of intervals) {
    const last = merged[merged.length - 1];
    if (last && it.start <= last.end) {
      if (it.end > last.end) Object.assign(last, { end: it.end, endTxt: it.endTxt, name: it.name });
    } else merged.push({ ...it });
  }

  const warnings = new Map();
  const add = (iso, w) => {
    if (!warnings.has(iso)) warnings.set(iso, []);
    warnings.get(iso).push(w);
  };

  // 1. Rust tussen twee werkdagen (een gesplitste dienst op dezelfde dag telt niet)
  for (let i = 1; i < merged.length; i++) {
    const prev = merged[i - 1];
    const cur = merged[i];
    if (prev.iso === cur.iso) continue;
    const rest = Math.round((cur.start - prev.end) / 60000);
    if (rest < MIN_REST_MINUTES) {
      add(cur.iso, {
        type: 'rest',
        text: `Maar ${fmtShort(Math.max(0, rest))} rust na ${prev.name} (tot ${prev.endTxt})`
      });
    }
  }

  // 2. Werkdagen op rij
  const days = [...new Set(intervals.map(it => it.iso))].sort();
  let streak = 0;
  let prevDay = null;
  for (const iso of days) {
    const d = new Date(`${iso}T12:00:00`);
    streak = prevDay && Math.round((d - prevDay) / 86400000) === 1 ? streak + 1 : 1;
    prevDay = d;
    if (streak > MAX_DAYS_IN_A_ROW) add(iso, { type: 'streak', text: `${streak}e werkdag op rij` });
  }
  return warnings;
}

let lastWorkWarnings = null;
function resetWorkWarnings() {
  lastWorkWarnings = null;
}

/** Na een wijziging: nieuwe waarschuwingen meteen melden. */
function announceNewWarnings() {
  const now = computeWorkWarnings();
  if (lastWorkWarnings) {
    const fresh = [];
    now.forEach((list, iso) => {
      const before = (lastWorkWarnings.get(iso) || []).map(w => w.text);
      list.filter(w => !before.includes(w.text)).forEach(w => fresh.push(`${toDisplayDate(iso)}: ${w.text}`));
    });
    if (fresh.length)
      toast(`⚠️ ${escapeHtml(fresh[0])}${fresh.length > 1 ? ` (+${fresh.length - 1})` : ''}`, 'warning');
  }
  lastWorkWarnings = now;
  return now;
}

/** Zit de maand op slot? (ingediend/goedgekeurd). Admins mogen altijd bewerken. */
function isMonthLocked(y, m) {
  if (isAdmin()) return false;
  const status = getMonthStatus(y, m);
  return status === 'submitted' || status === 'approved';
}

/** Toont een melding en geeft true terug als de maand op slot zit. */
function warnIfLocked(y, m) {
  if (!isMonthLocked(y, m)) return false;
  toast('Deze maand is ingediend of goedgekeurd en kan niet meer aangepast worden.', 'warning');
  return true;
}

/**
 * Vult het project in voor een nieuwe rij op basis van de shift (vaste koppelingen
 * zoals Verlof → Eght Care gaan voor).
 * Gebruikt door snelle invoer, kalender-iconen, verfmodus en meerdere dagen.
 */
function applyShiftDefaults(row, shiftKey, ud = getCurrentUserData()) {
  const realName = shiftRealName(shiftKey, ud);
  const special = autoProjectForShift(realName);
  if (special) {
    ensureProjectExists(special);
    row.project = special;
  } else {
    row.project = ud.shifts?.[shiftKey]?.project || row.project || '';
  }
  return row;
}

function userAllowsMultiMonth(ud, year, month) {
  // month: 0..11
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  return !!ud.settings?.multiByMonth?.[key];
}

function canAddMultiForProject(projectName) {
  const ud = getCurrentUserData();
  if (!projectName) return false;
  const p = (ud.projects || []).find(px => px.name === projectName);
  return !!p?.allowMulti;
}

function listDayKeys(monthData, dateKey) {
  if (!monthData || !monthData.rows) return [];

  // Verzamel alle keys die bij deze specifieke datum horen (incl. extra regels)
  const keys = Object.keys(monthData.rows).filter(
    k => k === dateKey || k.startsWith(dateKey + '_') || k.startsWith(dateKey + '#')
  );

  // Vaste volgorde: eerst werk, dan stage; binnen elke groep op startuur
  const ud = getCurrentUserData();
  return keys.sort((a, b) => {
    const rowA = monthData.rows[a];
    const rowB = monthData.rows[b];

    const stageA = isStageRow(rowA, ud) ? 1 : 0;
    const stageB = isStageRow(rowB, ud) ? 1 : 0;
    if (stageA !== stageB) return stageA - stageB;

    // Als er nog geen tijd is ingevuld (lege regel), zet deze dan onderaan
    const startA = rowA && rowA.start && rowA.start !== '' ? rowA.start : '24:00';
    const startB = rowB && rowB.start && rowB.start !== '' ? rowB.start : '24:00';

    // Vergelijk de tijden
    if (startA < startB) return -1;
    if (startA > startB) return 1;

    // Als ze exact tegelijk starten, behoud dan de originele volgorde
    return a.localeCompare(b);
  });
}

function nextLineIndex(md, baseKey) {
  const keys = listDayKeys(md, baseKey);
  let n = 2;
  while (keys.includes(`${baseKey}#${n}`)) n++;
  return n;
}

// ======= Maandstatus helpers (global) =======
// status: 'draft' | 'submitted' | 'approved' | 'rejected'
function getMonthStatus(y, m) {
  const ud = getCurrentUserData();
  return ud.monthData?.[y]?.[m]?.status || 'draft';
}

async function setMonthStatus(y, m, status) {
  const ud = getCurrentUserData();
  ud.monthData ||= {};
  ud.monthData[y] ||= {};
  ud.monthData[y][m] ||= { targetHours: 0, targetMinutes: 0, rows: {} };
  ud.monthData[y][m].status = status;
  await saveUserData();
  updateMonthStatusBadge();
}

async function ensureProjectExists(name) {
  const ud = getCurrentUserData();
  ud.projects = ud.projects || [];
  let p = ud.projects.find(p => p.name === name);
  if (!p) {
    // Oneindige geldigheid (altijd zichtbaar)
    ud.projects.push({ name, start: '2000-01-01', end: '2099-12-31' });
    saveUserData();
    renderProjects(); // meteen toevoegen aan alle dropdowns
  }
}

/**
 * Extra gewerkte minuten van een rij: "pauze doorgewerkt" (de pauze telt dan als werktijd)
 * plus de minuten die je na het geplande einduur bleef.
 */
function rowExtraMinutes(r) {
  if (!r) return 0;
  return (r.breakWorked ? Number(r.break) || 0 : 0) + Math.max(0, Number(r.extraMinutes) || 0);
}

/** Gewerkte minuten van een rij, inclusief doorgewerkte pauze en extra minuten. */
function rowWorkedMinutes(r) {
  return minutesBetween(r.start, r.end, r.breakWorked ? 0 : r.break) + Math.max(0, Number(r.extraMinutes) || 0);
}

/** Werkelijk einduur (gepland einde + extra minuten), als HH:MM. */
function rowActualEnd(r) {
  const extra = Math.max(0, Number(r.extraMinutes) || 0);
  if (!r.end || !extra) return r.end || '';
  const [h, m] = r.end.split(':').map(Number);
  const t = (h * 60 + m + extra) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Extra minuten in een maand (alleen rijen die meetellen). */
function monthExtraMinutes(rows, ud = getCurrentUserData()) {
  return Object.values(rows || {}).reduce((sum, r) => {
    if (!r || (r.status && r.status !== 'approved') || isStageRow(r, ud)) return sum;
    return sum + rowExtraMinutes(r);
  }, 0);
}

function recalcRowMinutes(r) {
  r.minutes = rowWorkedMinutes(r);
}

function saveCell(year, month, key, r, tr) {
  const ud = getCurrentUserData();
  ud.monthData = ud.monthData || {};
  ud.monthData[year] = ud.monthData[year] || {};
  ud.monthData[year][month] = ud.monthData[year][month] || { targetHours: 0, targetMinutes: 0, rows: {} };
  ud.monthData[year][month].rows[key] = { ...r, minutes: r.minutes || rowWorkedMinutes(r) };
}

// --- Verlof & schoolverlof ---

function getLeaveAllowanceMinutes() {
  const ud = getCurrentUserData();
  return Number(ud?.settings?.leaveAllowanceMinutes) || 0;
}

function getSchoolLeaveAllowanceMinutes(y, m) {
  const ud = getCurrentUserData();
  const label = getAcademicYearBounds(y, m).label; // bv "2024-2025"
  const map = ud?.settings?.schoolLeaveByYear || {};
  return Number(map[label]) || 0;
}

/** Minuten van rijen die bij één van de shiftnamen horen ('Stage' herkent ook stageprojecten). */
function sumRowsMatching(shiftNames, filterKey) {
  const ud = getCurrentUserData();
  let total = 0;
  for (const months of Object.values(ud.monthData || {})) {
    for (const md of Object.values(months || {})) {
      if (!md || md.status === 'rejected') continue;
      for (const [key, r] of Object.entries(md.rows || {})) {
        const sID = (r?.shift || '').trim();
        if (!sID || r.status === 'rejected' || !filterKey(key)) continue;
        const matches =
          shiftNames.includes(shiftRealName(sID, ud)) ||
          shiftNames.includes(sID) ||
          (shiftNames.includes('Stage') && isStageRow(r, ud));
        if (matches) total += Number(r.minutes) || 0;
      }
    }
  }
  return total;
}

/** Opgenomen minuten in een kalenderjaar (bv. verlof). */
function sumTakenMinutesFor(year, shiftNames) {
  return sumRowsMatching(shiftNames, key => key.startsWith(`${year}-`));
}

/** Opgenomen minuten tussen twee datums (bv. schoolverlof per schooljaar, stage-uren). */
function sumTakenMinutesForRange(startISO, endISO, shiftNames) {
  return sumRowsMatching(shiftNames, key => isDateWithin(key, startISO, endISO));
}

// === Schooljaar helpers ===
// Geeft grenzen van het schooljaar terug voor de huidig geselecteerde maand/jaar
function getAcademicYearBounds(y, m /* 0..11 */) {
  const startYear = m >= 8 ? y : y - 1; // 8 = september
  const endYear = startYear + 1;
  const startISO = `${startYear}-09-01`;
  const endISO = `${endYear}-08-31`;
  return { startISO, endISO, label: `${startYear}-${endYear}` };
}

function buildSchoolYearOptions(selectEl) {
  if (!selectEl) return;
  const now = new Date();
  const yNow = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1; // sept = 8
  const years = [];
  for (let y = yNow - 3; y <= yNow + 3; y++) {
    years.push(`${y}-${y + 1}`);
  }
  selectEl.innerHTML = '';
  years.forEach(label => {
    const opt = document.createElement('option');
    opt.value = label;
    opt.textContent = label;
    selectEl.appendChild(opt);
  });
}

// ======================================================================
// §06  FEESTDAGEN & SCHOOLVAKANTIES
// Belgische feestdagen en Vlaamse schoolvakanties.
// ======================================================================

// 🎉 FEESTDAGEN LOGICA (BELGIË)
function getBelgianHoliday(dateObj) {
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth(); // 0-based (Jan=0, Dec=11)
  const day = dateObj.getDate();

  // --- 1. VASTE OFFICIËLE & REGIONALE FEESTDAGEN ---
  if (month === 0 && day === 1) return { name: 'Nieuwjaar', emoji: '🥂' };
  if (month === 0 && day === 6) return { name: 'Driekoningen', emoji: '👑' }; // NIEUW
  if (month === 4 && day === 1) return { name: 'Dag v/d Arbeid', emoji: '🛠️' };
  if (month === 6 && day === 11) return { name: 'Vlaamse Feestdag', emoji: '🦁' }; // NIEUW
  if (month === 6 && day === 21) return { name: 'Nationale Feestdag', emoji: '🇧🇪' };
  if (month === 7 && day === 15) return { name: 'O.L.V. Hemelvaart', emoji: '⛪' };
  if (month === 10 && day === 1) return { name: 'Allerheiligen', emoji: '🍂' };
  if (month === 10 && day === 2) return { name: 'Allerzielen', emoji: '🕯️' }; // NIEUW
  if (month === 10 && day === 11) return { name: 'Wapenstilstand', emoji: '🌺' };
  if (month === 11 && day === 25) return { name: 'Kerstmis', emoji: '🎄' };
  if (month === 11 && day === 26) return { name: '2e Kerstdag', emoji: '🎄' }; // NIEUW

  // --- 2. POPULAIRE "SIDE" DAGEN ---
  if (month === 1 && day === 14) return { name: 'Valentijn', emoji: '❤️' };
  if (month === 3 && day === 1) return { name: '1 April', emoji: '🃏' };
  if (month === 5 && day === 14) return { name: 'Kaat & Jaider', emoji: '🧑🏽‍❤️‍💋‍👩🏼' };
  if (month === 5 && day === 26) return { name: 'Kaat', emoji: '🎂' };
  if (month === 9 && day === 31) return { name: 'Halloween', emoji: '🎃' };
  if (month === 11 && day === 6) return { name: 'Sinterklaas', emoji: '🎁' };
  if (month === 11 && day === 7) return { name: 'Jaider', emoji: '🎂' };
  if (month === 11 && day === 31) return { name: 'Oudejaarsavond', emoji: '🍾' };

  // --- 3. VARIABELE DATUMS (PASEN & CO) ---
  const easterDate = easterSunday(year);

  // Verschil in dagen berekenen
  const oneDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((dateObj - easterDate) / oneDay);

  if (diffDays === 0) return { name: 'Pasen', emoji: '🐣' };
  if (diffDays === 1) return { name: 'Paasmaandag', emoji: '🐣' };
  if (diffDays === 39) return { name: 'O.L.H. Hemelvaart', emoji: '🕊️' };
  if (diffDays === 49) return { name: 'Pinksteren', emoji: '🕯️' };
  if (diffDays === 50) return { name: 'Pinkstermaandag', emoji: '🕯️' };

  // --- 4. OPTIONEEL: Moederdag (2e zondag mei) & Vaderdag (2e zondag juni) ---
  // Moederdag
  if (month === 4) {
    // Mei
    const firstDayMay = new Date(year, 4, 1).getDay(); // 0=Zon, 1=Maa...
    const offset = firstDayMay === 0 ? 0 : 7 - firstDayMay; // Dagen tot 1e zondag
    const secondSunday = 1 + offset + 7;
    if (day === secondSunday) return { name: 'Moederdag', emoji: '💐' };
  }
  // Vaderdag
  if (month === 5) {
    // Juni
    const firstDayJune = new Date(year, 5, 1).getDay();
    const offset = firstDayJune === 0 ? 0 : 7 - firstDayJune;
    const secondSunday = 1 + offset + 7;
    if (day === secondSunday) return { name: 'Vaderdag', emoji: '👔' };
  }
  // ✅ Verloren Maandag (Maandag na Driekoningen)
  if (month === 0) {
    // Januari
    // Driekoningen is altijd 6 jan. We zoeken de maandag erna.
    const daySix = new Date(year, 0, 6).getDay(); // dag v/d week van 6 jan
    // Bereken hoeveel dagen we moeten optellen om bij maandag (1) te komen
    // Als 6 jan maandag is (1), moeten we er 7 dagen bijtellen (volgende week)
    let daysToAdd = (1 - daySix + 7) % 7;
    if (daysToAdd === 0) daysToAdd = 7;

    const verlorenMaandagDag = 6 + daysToAdd;
    if (day === verlorenMaandagDag) return { name: 'Verloren maandag', emoji: '🌭' };
  }
  return null;
}

/** Paaszondag (Gregoriaanse kalender, algoritme van Meeus/Jones/Butcher). */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

/** Maandag van de week waarin een datum valt. */
function mondayOf(date) {
  const dow = date.getDay() || 7; // ma=1 … zo=7
  return addDays(date, 1 - dow);
}

/** Vlaamse schoolvakanties die in een bepaald jaar beginnen. */
function flemishSchoolHolidays(year) {
  const easter = easterSunday(year);

  // Krokusvakantie: week van Aswoensdag (46 dagen voor Pasen)
  const krokusStart = mondayOf(addDays(easter, -46));

  // Paasvakantie: start 1e maandag van april; Pasen in maart → start paasmaandag;
  // Pasen na 15 april → start 2e maandag vóór Pasen (en loopt t/m paasmaandag).
  let paasStart;
  let paasEnd;
  if (easter.getMonth() === 2) {
    paasStart = addDays(easter, 1);
    paasEnd = addDays(paasStart, 13);
  } else if (easter.getDate() > 15) {
    paasStart = addDays(easter, -13);
    paasEnd = addDays(easter, 1);
  } else {
    const april1 = new Date(year, 3, 1);
    paasStart = addDays(april1, (8 - (april1.getDay() || 7)) % 7);
    paasEnd = addDays(paasStart, 13);
  }

  // Herfstvakantie: week van 1 november (valt 1 nov op zondag → de week erna)
  const nov1 = new Date(year, 10, 1);
  const herfstStart = nov1.getDay() === 0 ? addDays(nov1, 1) : mondayOf(nov1);

  // Kerstvakantie: 2 weken vanaf de maandag van de week met 25 december;
  // valt Kerstmis op zaterdag of zondag → vanaf de maandag erna.
  const xmas = new Date(year, 11, 25);
  const kerstStart = xmas.getDay() === 6 || xmas.getDay() === 0 ? mondayOf(addDays(xmas, 7)) : mondayOf(xmas);

  return [
    { name: 'Krokusvakantie', start: krokusStart, end: addDays(krokusStart, 6), icon: '🎭' },
    { name: 'Paasvakantie', start: paasStart, end: paasEnd, icon: '🐣' },
    { name: 'Zomervakantie', start: new Date(year, 6, 1), end: new Date(year, 7, 31), icon: '☀️', summer: true },
    { name: 'Herfstvakantie', start: herfstStart, end: addDays(herfstStart, 6), icon: '🍂' },
    { name: 'Kerstvakantie', start: kerstStart, end: addDays(kerstStart, 13), icon: '🎄' }
  ];
}

/** Schoolvakantie die (deels) in deze maand valt, of null. */
function getSchoolHolidayInfo(year, month) {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const hit = [...flemishSchoolHolidays(year - 1), ...flemishSchoolHolidays(year)].find(
    v => v.start <= monthEnd && v.end >= monthStart
  );
  if (!hit) return null;
  if (hit.summer) return { name: hit.name, fullMonth: true, icon: month === 7 ? '🏖️' : '☀️' };
  return hit;
}

// ======================================================================
// §07  OPSTARTEN & LOGIN
// Inloggen, eerste rendering en alles opnieuw tekenen.
// ======================================================================

function initSelectors() {
  if (!yearSelectMain || !monthSelectMain) return;

  const yNow = new Date().getFullYear();
  yearSelectMain.innerHTML = '';
  for (let y = yNow - 2; y <= yNow + 3; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === yNow) opt.selected = true;
    yearSelectMain.appendChild(opt);
  }
  monthSelectMain.value = String(new Date().getMonth());
}

/** Admin-onderdelen tonen voor admins (gebruikerswissel in de topbalk). */
function revealAdminIfNeeded() {
  if (!isAdmin()) return;
  document.body.classList.add('is-admin');
  initTopbarAdminSwitcher();
}

/** Alles opnieuw tekenen voor de actieve gebruiker. */
function renderAll() {
  renderProjects();
  renderShifts();
  populateFilterShiftYears();
  renderProjectFilterForMonth();
  generateMonth();
  updateRemainingHours();
  updateLeaveBadges();
  renderHome();
}

/** Tabblad openen via de zijbalk-link (werkt ook vanuit andere knoppen). */
function showTab(hash) {
  const link = document.querySelector(`#navTabs a[href="${hash}"]`);
  if (link) bootstrap.Tab.getOrCreateInstance(link).show();
}

const DEFAULT_AVATAR =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgZmlsbD0iY3VycmVudENvbG9yIiBjbGFzcz0iYmkgYmktcGVyc29uLWZpbGwiIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZD0iTTMgMTQgczEtMiAyLTIgMiAyIDIgMiAyLTItMi0yem01LTAiLz48cGF0aCBkPSJNODguNUM4IDcuNjcgNy4zMyA3IDYuNSA3UzUgNy42NyA1IDguNSA1LjY3IDEwIDYuNSAxMFM4IDkuMzMgOCA4LjV6bS0yIDBjMCAxLjExLS44OSAyLTIgMnMtMi0uODktMi0yIC44OS0yIDItMiAyIC44OSAyIDJ6bS0yLTNjLTMuMTQ2IDAtNS41IDIuNTM2LTUuNSA1LjVWMTloMTJ2LTIuNWMwLTIuOTY0LTIuMzU0LTUuNS01LjUtNS41eiIvPjwvc3ZnPg==';

function bindAuth() {
  onAuthStateChanged(auth, async user => {
    if (notificationInterval) clearInterval(notificationInterval);

    // Accentkleur meteen toepassen (voorkomt knipperen)
    const savedColor = localStorage.getItem('accentColor');
    if (savedColor) applyAccentColor(savedColor);

    // Niet ingelogd → naar de loginpagina
    if (!user) {
      window.location.replace('index.html');
      return;
    }

    document.body.classList.add('auth-checked');
    currentUserId = user.uid;

    const topPhotoEl = document.getElementById('topbarProfilePhoto');
    if (topPhotoEl) topPhotoEl.src = user.photoURL || DEFAULT_AVATAR;

    await ensureUserDoc(user);
    await loadAllUsers();

    // Persoonlijke voorkeuren
    const ud = getCurrentUserData();
    if (ud?.settings?.accentColor) applyAccentColor(ud.settings.accentColor);

    initSelectors();
    renderAll();
    revealAdminIfNeeded();
    listenActiveUserDoc();
    updateMonthStatusBadge();
    enableNotifications(user.uid);

    // Meldingen: live lijst + dagelijkse automatische controle
    listenToNotifications(user.uid);
    await autoCheckNotifications();
    notificationInterval = setInterval(autoCheckNotifications, 24 * 60 * 60 * 1000);
    startEveningReminder();

    // Mailbox
    bindMailboxUIOnce();
    listenMailbox(user.uid);

    // Opstart-tabblad uit het profiel
    if (ud?.settings?.defaultTab) showTab(ud.settings.defaultTab);
    handleLaunchShortcut();
  });

  logoutBtn?.addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}

// ======================================================================
// §08  LAYOUT & THEMA
// Zijbalk, accentkleur, donkere modus en mobiele weergave.
// ======================================================================

/** Past de gekozen accentkleur toe op de hele app (via CSS-variabelen in app.css). */
function applyAccentColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return;
  document.getElementById('accent-color-overrides').textContent =
    `:root { --accent: ${hex}; --accent-rgb: ${hexToRgb(hex)}; }`;
  localStorage.setItem('accentColor', hex);
}

/** Donkere modus aan/uit (per toestel bewaard). */
function setDarkMode(on) {
  document.documentElement.dataset.bsTheme = on ? 'dark' : 'light';
  localStorage.setItem('darkMode', on);
}

/** Paginatitel bijwerken (het actieve menu-item regelt Bootstrap zelf). */
function syncNavState(hash) {
  const link = document.querySelector(`#navTabs a[href="${hash}"]`);
  const title = link?.dataset.title || 'Shift Planner';
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = title;
  document.title = `${title} · Shift Planner`;
  // Op Home geen "+ Shift"-knop in de topbalk
  document.getElementById('topQuickBtn')?.classList.toggle('d-none', hash === '#tab-home');
}

/** Het zwevende hoofdmenu openen of sluiten. */
function setMenuOpen(open) {
  const toggle = document.getElementById('menuToggle');
  const backdrop = document.getElementById('menuBackdrop');
  if (!sidebar || !toggle) return;
  sidebar.classList.toggle('open', open);
  sidebar.setAttribute('aria-hidden', String(!open));
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Menu sluiten' : 'Menu openen');
  toggle.querySelector('.material-icons-outlined').textContent = open ? 'close' : 'menu';
  if (backdrop) backdrop.hidden = !open;
  document.body.classList.toggle('menu-open', open);
  if (open) sidebar.focus({ preventScroll: true });
}

function bindLayout() {
  // Zwevend menu: hamburgerknop, sluitknop, klik ernaast en Escape
  document.getElementById('menuToggle')?.addEventListener('click', () => {
    setMenuOpen(!sidebar.classList.contains('open'));
  });
  document.getElementById('menuClose')?.addEventListener('click', () => setMenuOpen(false));
  document.getElementById('menuBackdrop')?.addEventListener('click', () => setMenuOpen(false));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      setMenuOpen(false);
      document.getElementById('menuToggle')?.focus();
    }
  });
  // Na het kiezen van een pagina of Profiel klapt het menu dicht
  sidebar.addEventListener('click', e => {
    if (e.target.closest('.nav-link')) setMenuOpen(false);
  });
  document.getElementById('topQuickBtn')?.addEventListener('click', () => openQuickInput());

  // Logo "Shift Planner" → Home
  document.querySelector('#sidebar a.label[href="#tab-home"]')?.addEventListener('click', e => {
    e.preventDefault();
    showTab('#tab-home');
  });

  // Elke tabwissel: titel + onderbalk bijwerken en bovenaan beginnen
  document.querySelectorAll('#navTabs .nav-link').forEach(a => {
    a.addEventListener('shown.bs.tab', () => {
      syncNavState(a.getAttribute('href'));
      window.scrollTo({ top: 0 });
    });
  });

  // Knoppen elders in de app die naar een pagina springen
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (btn) showTab(btn.dataset.tab);
  });

  // Acties-menu sluiten na het kiezen van een actie (het menu blijft open bij het kiezen van een versie)
  document.querySelector('.actions-menu')?.addEventListener('click', e => {
    if (!e.target.closest('.dropdown-item')) return;
    const toggle = e.currentTarget.parentElement.querySelector('[data-bs-toggle="dropdown"]');
    bootstrap.Dropdown.getInstance(toggle)?.hide();
  });

  // Donkere modus van dit toestel
  setDarkMode(localStorage.getItem('darkMode') === 'true');

  // Opslaanstatus bij wegvallen/terugkomen van internet
  window.addEventListener('offline', () =>
    toast('Je bent offline. Wijzigingen worden bewaard zodra je weer online bent.', 'warning')
  );
  window.addEventListener('online', () => {
    if (pendingSaves) setSaveStatus('saving');
  });
}

// ======================================================================
// §09  HOME
// Dashboard, voortgang en team-mededelingen.
// ======================================================================

/** Laatste 5 meldingen op Home (uit het geheugen, geen extra databank-lezing). */
function loadHomeNotifications() {
  const listEl = document.getElementById('homeNotifList');
  if (!currentUserId || !listEl) return;

  const notifications = dataStore.notifications.slice(0, 5);
  if (notifications.length === 0) {
    listEl.innerHTML = '<li class="text-muted small">Geen meldingen.</li>';
    return;
  }
  listEl.innerHTML = notifications
    .map(n => {
      const when = n.timestamp ? new Date(n.timestamp).toLocaleString('nl-BE') : '';
      return `<li class="small mb-1">${escapeHtml(n.text)}<br><span class="text-muted">${when}</span></li>`;
    })
    .join('');
}

/**
 * Urenmeter in prikklok-stijl: groot getal + liniaal met één streepje per 8 uur (één dienst).
 * opts.title: kop boven de meter; opts.compact: kleinere variant (stage).
 */
function renderMeter(el, planned, target, opts = {}) {
  if (!el) return;
  const h = Math.floor(planned / 60);
  const mm = String(planned % 60).padStart(2, '0');
  const scale = Math.max(target, planned, 1);
  const pct = Math.min(100, (planned / scale) * 100);
  const tick = Math.max(1.2, (480 / Math.max(target || 160 * 60, planned, 480)) * 100);
  const diff = target - planned;

  let delta = '';
  if (!target) delta = '<span class="meter-delta">Geen doel ingesteld</span>';
  else if (diff > 0)
    delta = `<span class="meter-delta short">nog ${fmt(diff)}<span class="hide-xs"> te kort</span></span>`;
  else delta = `<span class="meter-delta done">${diff === 0 ? 'doel bereikt' : `${fmt(-diff)} extra`}</span>`;

  // Rood = nog uren te kort, groen = doel gehaald of overuren (stage blijft neutraal)
  const state = !target || opts.compact ? '' : diff > 0 ? 'short' : 'over';
  el.classList.toggle('compact', !!opts.compact);
  el.classList.toggle('is-short', state === 'short');
  el.classList.toggle('is-done', state === 'over');
  el.innerHTML = `
    ${opts.title ? `<h3>${opts.title}</h3>` : ''}
    <div class="meter-figures">
      <span class="meter-big">${h}<small>u</small>${mm}</span>
      <span class="meter-of">${target ? `van ${fmt(target)}` : 'gepland'}</span>
      ${delta}
    </div>
    ${opts.extra ? `<p class="meter-extra"><span class="material-icons-outlined" aria-hidden="true">more_time</span>Waarvan <strong>${fmtExtra(opts.extra)}</strong> extra gewerkt</p>` : ''}
    <div class="meter-ruler" style="--tick:${tick.toFixed(2)}%" role="progressbar" aria-valuemin="0"
         aria-valuemax="${target}" aria-valuenow="${planned}" aria-label="${fmt(planned)} van ${fmt(target)}">
      <div class="fill${state ? ` ${state}` : ''}" style="width:${pct.toFixed(1)}%"></div>
    </div>
    ${opts.caption === false ? '' : '<p class="meter-caption">Elk streepje is 8 uur.</p>'}`;
}

const STAGE = { start: '2026-09-28', end: '2027-01-31', targetMinutes: 450 * 60, dayMinutes: 7 * 60 + 36 }; // werkplekleren PXL

/** Stage-afteller: wat al gedaan is, wat ingepland staat en hoeveel stagedagen (à 7u36) er nog bij moeten. */
function stageCountdownHtml(plannedTotal) {
  const ud = getCurrentUserData();
  const today = todayISO();
  const done = sumTakenMinutesForRange(STAGE.start, today < STAGE.end ? today : STAGE.end, ['Stage']);
  const toPlan = Math.max(0, STAGE.targetMinutes - plannedTotal);
  const daysToPlan = Math.ceil(toPlan / STAGE.dayMinutes);

  // Ingeplande stagedagen vanaf vandaag (unieke datums)
  const futureDays = new Set();
  Object.values(ud.monthData || {}).forEach(months =>
    Object.values(months || {}).forEach(md =>
      Object.entries(md?.rows || {}).forEach(([key, r]) => {
        const iso = key.slice(0, 10);
        if (
          iso >= today &&
          isDateWithin(iso, STAGE.start, STAGE.end) &&
          r?.shift &&
          r.status !== 'rejected' &&
          isStageRow(r, ud)
        )
          futureDays.add(iso);
      })
    )
  );

  const msDay = 86400000;
  const daysLeft = Math.max(0, Math.round((new Date(`${STAGE.end}T12:00`) - new Date(`${today}T12:00`)) / msDay));
  const weeksLeft = Math.floor(daysLeft / 7);
  const ended = today > STAGE.end;

  return `<div class="stage-countdown">
    <div class="sc-item"><span class="sc-num">${fmtShort(done)}</span><span class="sc-lbl">al gedaan</span></div>
    <div class="sc-item"><span class="sc-num">${futureDays.size}</span><span class="sc-lbl">${futureDays.size === 1 ? 'dag' : 'dagen'} nog ingepland</span></div>
    <div class="sc-item ${toPlan ? 'todo' : 'ok'}"><span class="sc-num">${toPlan ? `±${daysToPlan}` : '✓'}</span><span class="sc-lbl">${
      toPlan ? `stagedagen van 7u36 nog in te plannen` : 'alle uren ingepland'
    }</span></div>
    <div class="sc-item"><span class="sc-num">${ended ? '—' : weeksLeft ? `${weeksLeft} wk` : `${daysLeft} d`}</span><span class="sc-lbl">${
      ended ? 'stage afgelopen' : `tot ${toDisplayDate(STAGE.end)}${weeksLeft ? ` (${daysLeft} dagen)` : ''}`
    }</span></div>
  </div>`;
}

function renderHome() {
  const ud = getCurrentUserData();
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const md = ud.monthData?.[y]?.[m] || { rows: {}, targetHours: 0, targetMinutes: 0 };

  const userEl = document.getElementById('homeUserName');
  if (userEl) userEl.textContent = (ud.name || ud.email || '').split(' ')[0] || '-';
  const monthNameEl = document.getElementById('homeMonthName');
  if (monthNameEl) monthNameEl.textContent = `${monthsFull[m]} ${y}`;

  // Maand (zelfde regel als Invoer/Historiek: zonder stage en zonder niet-goedgekeurd verlof)
  const planned = plannedMinutes(md.rows, ud);
  const target = (Number(md.targetHours) || 0) * 60 + (Number(md.targetMinutes) || 0);
  renderMeter(document.getElementById('homeMeter'), planned, target, { extra: monthExtraMinutes(md.rows, ud) });
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  setText('homeMonthPlanned', fmt(planned));
  setText('homeMonthTarget', fmt(target));
  setText('homeMonthDiff', fmtDiff(planned - target));

  // Stage
  const stageTaken = sumTakenMinutesForRange(STAGE.start, STAGE.end, ['Stage']);
  renderMeter(document.getElementById('stageProgressContainer'), stageTaken, STAGE.targetMinutes, {
    compact: true,
    caption: false,
    title: `Stage <span class="text-muted fw-normal">· ${toDisplayDate(STAGE.start)} t/m ${toDisplayDate(STAGE.end)}</span>`
  });
  document.getElementById('stageProgressContainer')?.insertAdjacentHTML('beforeend', stageCountdownHtml(stageTaken));

  // Status van de maand
  const st = document.getElementById('homeMonthStatus');
  if (st) {
    const status = getMonthStatus(y, m);
    st.textContent = STATUS_LABELS[status] || status;
    st.className = `badge badge-status badge-${status}`;
  }

  // Verlof en schoolverlof
  const leaveAllow = getLeaveAllowanceMinutes();
  const leaveRemain = leaveAllow - sumTakenMinutesFor(y, LEAVE_SHIFT_NAMES);
  const leaveEl = document.getElementById('homeLeave');
  if (leaveEl) {
    leaveEl.textContent = !leaveAllow
      ? 'Verlof: niet ingesteld'
      : leaveRemain >= 0
        ? `Verlof: ${fmt(leaveRemain)} over`
        : `Verlof: ${fmt(-leaveRemain)} te veel`;
    leaveEl.className = `badge ${!leaveAllow ? 'bg-secondary-subtle' : leaveRemain < 0 ? 'bg-danger' : 'bg-success'}`;
  }

  const schAllow = getSchoolLeaveAllowanceMinutes(y, m);
  const { startISO, endISO, label } = getAcademicYearBounds(y, m);
  const schRemain = schAllow - sumTakenMinutesForRange(startISO, endISO, SCHOOL_LEAVE_SHIFT_NAMES);
  const schEl = document.getElementById('homeSchoolLeave');
  if (schEl) {
    schEl.textContent = !schAllow
      ? `Schoolverlof ${label}: niet ingesteld`
      : schRemain >= 0
        ? `Schoolverlof ${label}: ${fmt(schRemain)} over`
        : `Schoolverlof ${label}: ${fmt(-schRemain)} te veel`;
    schEl.className = `badge ${!schAllow ? 'bg-secondary-subtle' : schRemain < 0 ? 'bg-danger' : schRemain === 0 ? 'bg-warning' : 'bg-success'}`;
  }

  // Lopende projecten (vandaag)
  const today = todayISO();
  const projWrap = document.getElementById('homeProjects');
  if (projWrap) {
    const list = (ud.projects || []).filter(p => isDateWithin(today, p.start || null, p.end || null));
    projWrap.innerHTML = list.length
      ? list
          .map(p => {
            const period = p.end && p.end < '2099-01-01' ? `tot ${toDisplayDate(p.end)}` : 'geen einddatum';
            return `<div class="project-row"><strong>${escapeHtml(p.name)}</strong><span>${period}</span></div>`;
          })
          .join('')
      : '<p class="empty">Geen lopende projecten vandaag.</p>';
  }

  renderHomeWeek();
  loadHomeNotifications();
  initAnnouncements();
}

// --- Mijn week ---

let homeWeekOffset = 0; // 0 = deze week, 1 = volgende week

/** Lokale datum als YYYY-MM-DD. */
const isoOf = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Weekoverzicht op Home: maandag t/m zondag met de shiften per dag. */
function renderHomeWeek() {
  const list = document.getElementById('homeWeek');
  if (!list) return;
  const ud = getCurrentUserData();
  const shifts = ud.shifts || {};
  const today = todayISO();
  const workWarnings = computeWorkWarnings(ud);
  const monday = new Date();
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + homeWeekOffset * 7);

  let workMinutes = 0;
  let stageMinutes = 0;
  let workDays = 0;
  const items = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = isoOf(d);
    const md = ud.monthData?.[d.getFullYear()]?.[d.getMonth()];
    const keys = listDayKeys(md, iso).filter(k => md.rows[k]?.shift);
    if (keys.length) workDays++;
    const holiday = getBelgianHoliday(d);
    const chips = keys
      .map(k => {
        const r = md.rows[k];
        const sh = shifts[r.shift] || {};
        const mins = Number(r.minutes) || 0;
        const counts = !r.status || r.status === 'approved';
        if (counts && isStageRow(r, ud)) stageMinutes += mins;
        else if (counts) workMinutes += mins;
        const name = sh.realName || r.shift;
        const short = sh.shortName || name.slice(0, 2);
        const hasTime = r.start && r.end && !(r.start === '00:00' && r.end === '00:00');
        const extra = rowExtraMinutes(r);
        const title = `${name}${hasTime ? ` ${r.start}–${rowActualEnd(r)}` : ''} (${fmtShort(mins)})${extra ? ` · +${fmtExtra(extra)} extra` : ''}`;
        return `<span class="week-shift${extra ? ' has-extra' : ''}" style="--shift-color:${escapeHtml(sh.color || '#e9ecef')}" title="${escapeHtml(title)}">
          <strong><span class="name-long">${escapeHtml(name)}</span><span class="name-short">${escapeHtml(short)}</span>${r.status === 'pending' ? ' ⏳' : ''}</strong>
          ${hasTime ? `<span class="t">${escapeHtml(r.start)}</span><span class="t">${escapeHtml(rowActualEnd(r))}</span>` : `<span class="t">${fmtShort(mins)}</span>`}
          ${extra ? `<span class="extra-badge">+${extra < 60 ? `${extra}m` : fmtExtra(extra)}</span>` : ''}
        </span>`;
      })
      .join('');
    const dayName = daysFull[d.getDay()];
    items.push(`
      <li class="week-cell${iso === today ? ' today' : ''}${iso < today ? ' past' : ''}${d.getDay() % 6 === 0 ? ' weekend' : ''}">
        <button type="button" class="week-day-btn" data-date="${iso}" aria-label="${dayName} ${toDisplayDate(iso)} bekijken">
          <span class="week-date"><span class="wd">${dayName.slice(0, 2)}</span><span class="dn">${d.getDate()}</span></span>
          ${
            workWarnings.has(iso)
              ? `<span class="week-warn" title="${escapeHtml(
                  workWarnings
                    .get(iso)
                    .map(w => w.text)
                    .join('\n')
                )}">⚠️ ${escapeHtml(workWarnings.get(iso)[0].type === 'rest' ? 'rust' : 'op rij')}</span>`
              : ''
          }
          <span class="week-shifts">${chips || (holiday ? `<span class="week-free" title="${escapeHtml(holiday.name)}">${holiday.emoji}</span>` : '')}</span>
        </button>
      </li>`);
  }
  list.innerHTML = items.join('');

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const range = `${monday.getDate()} ${monthsFull[monday.getMonth()].slice(0, 3).toLowerCase()} – ${sunday.getDate()} ${monthsFull[sunday.getMonth()].slice(0, 3).toLowerCase()}`;
  const summary = document.getElementById('homeWeekSummary');
  if (summary) {
    summary.innerHTML = `${range} · <strong>${fmtShort(workMinutes)}</strong> gepland${
      stageMinutes ? ` · ${fmtShort(stageMinutes)} stage` : ''
    } · ${workDays} ${workDays === 1 ? 'dag' : 'dagen'} ingevuld`;
  }
}

function bindHomeWeek() {
  document.querySelector('.week-switch')?.addEventListener('click', e => {
    const btn = e.target.closest('.week-tab');
    if (!btn) return;
    homeWeekOffset = Number(btn.dataset.week);
    document.querySelectorAll('.week-tab').forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', String(b === btn));
    });
    renderHomeWeek();
  });
  document.getElementById('homeWeek')?.addEventListener('click', e => {
    const btn = e.target.closest('.week-day-btn');
    if (btn) openDayEditor(btn.dataset.date);
  });
}

// --- Team-mededelingen (prikbord) ---

let announcementsUnsub = null;

/** Toont de "+"-knop voor admins en start (één keer) de live lijst. */
function initAnnouncements() {
  const list = document.getElementById('announcementList');
  if (!list) return;
  document.getElementById('addAnnouncementBtn')?.classList.toggle('d-none', !isAdmin());
  if (!announcementsUnsub) loadAnnouncements();
}

function loadAnnouncements() {
  const list = document.getElementById('announcementList');
  const q = query(collection(db, 'announcements'), orderBy('timestamp', 'desc'), limit(3));

  announcementsUnsub = onSnapshot(q, snapshot => {
    if (snapshot.empty) {
      list.innerHTML = '<small class="text-muted fst-italic">Geen mededelingen.</small>';
      return;
    }

    list.innerHTML = '';
    snapshot.forEach(docSnap => {
      const a = docSnap.data();
      const dateStr = a.timestamp
        ? new Date(a.timestamp).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })
        : '-';
      const colorClass = /^[a-z]+$/.test(a.color || '') ? `alert-${a.color}` : 'alert-light';
      const deleteBtn = isAdmin()
        ? `<button class="btn btn-link text-danger p-0 ms-2" onclick="deleteAnnouncement('${docSnap.id}')" style="text-decoration:none;">&times;</button>`
        : '';

      const div = document.createElement('div');
      div.className = `alert ${colorClass} border mb-2 p-2 d-flex justify-content-between align-items-start shadow-sm`;
      div.innerHTML = `
        <div class="w-100">
          <div class="fw-bold text-dark" style="font-size: 0.95rem;">${escapeHtml(a.text)}</div>
          <div class="text-muted d-flex justify-content-between mt-1" style="font-size: 0.75rem;">
            <span>${escapeHtml(a.author)}</span>
            <span>${dateStr}</span>
          </div>
        </div>
        ${deleteBtn}
      `;
      list.appendChild(div);
    });
  });
}

function bindHome() {
  // Snelkoppelingen op Home
  document.getElementById('homeBtnQuickInput')?.addEventListener('click', () => openQuickInput());

  document.getElementById('homeBtnNewShift')?.addEventListener('click', () => {
    new bootstrap.Modal(document.getElementById('shiftModal')).show();
  });

  document.getElementById('homeBtnGoInvoer')?.addEventListener('click', () => showTab('#tab-invoer'));
  bindHomeWeek();

  // Mededeling verwijderen (admin)
  window.deleteAnnouncement = async id => {
    if (!confirm('Verwijder dit bericht?')) return;
    try {
      await deleteDoc(doc(db, 'announcements', id));
      toast('Verwijderd', 'success');
    } catch (e) {
      console.error(e);
      toast('Kon niet verwijderen', 'danger');
    }
  };

  // Nieuwe mededeling: popup leegmaken en openen
  document.getElementById('addAnnouncementBtn')?.addEventListener('click', () => {
    const me = dataStore.users[currentUserId] || {};
    const myName = me.name || me.email || 'Admin';

    document.getElementById('announcementInputText').value = '';
    document.getElementById('announcementCustomAuthor').value = '';
    document.getElementById('announcementCustomAuthorDiv').classList.add('d-none');

    // Reset radio naar wit
    const radioLight = document.getElementById('colorLight');
    if (radioLight) radioLight.checked = true;

    const select = document.getElementById('announcementAuthorSelect');
    select.value = 'me';
    select.options[0].text = `Mijn naam (${myName})`;

    new bootstrap.Modal(document.getElementById('announcementModal')).show();
  });

  // Afzender 'Anders, namelijk…'
  document.getElementById('announcementAuthorSelect')?.addEventListener('change', e => {
    const customDiv = document.getElementById('announcementCustomAuthorDiv');
    if (e.target.value === 'custom') {
      customDiv.classList.remove('d-none');
      document.getElementById('announcementCustomAuthor').focus();
    } else {
      customDiv.classList.add('d-none');
    }
  });

  // Mededeling plaatsen
  document.getElementById('saveAnnouncementBtn')?.addEventListener('click', async () => {
    const text = document.getElementById('announcementInputText').value.trim();
    const selectVal = document.getElementById('announcementAuthorSelect').value;

    // Kleur ophalen
    const colorInput = document.querySelector('input[name="annColor"]:checked');
    const color = colorInput ? colorInput.value : 'light';

    let authorName = '';

    if (!text) return toast('Typ eerst een bericht', 'warning');

    if (selectVal === 'me') {
      const me = dataStore.users[currentUserId] || {};
      authorName = me.name || me.email || 'Admin';
    } else if (selectVal === 'custom') {
      authorName = document.getElementById('announcementCustomAuthor').value.trim();
      if (!authorName) return toast('Vul een afzender in', 'warning');
    } else {
      authorName = selectVal;
    }

    try {
      await addDoc(collection(db, 'announcements'), {
        text: text,
        author: authorName,
        color: color,
        timestamp: new Date().toISOString()
      });

      const modalEl = document.getElementById('announcementModal');
      bootstrap.Modal.getInstance(modalEl).hide();
      toast('Mededeling geplaatst', 'success');
    } catch (e) {
      console.error(e);
      toast('Fout bij plaatsen (check permissies)', 'danger');
    }
  });
}

// ======================================================================
// §10  PROJECTEN
// Projectbeheer (alleen admins mogen wijzigen).
// ======================================================================

let editingProjectIndex = null;

/** Hernoemt een project overal (shiften en ingevulde dagen), zodat koppelingen blijven werken. */
function renameProjectEverywhere(ud, oldName, newName) {
  Object.values(ud.shifts || {}).forEach(sh => {
    if (sh.project === oldName) sh.project = newName;
  });
  Object.values(ud.monthData || {}).forEach(months =>
    Object.values(months || {}).forEach(md =>
      Object.values(md?.rows || {}).forEach(r => {
        if (r?.project === oldName) r.project = newName;
      })
    )
  );
}

function renderProjects() {
  const ud = getCurrentUserData();
  const projectTableBody = document.getElementById('projectTableBody');
  const newShiftProjectSelect = document.getElementById('newShiftProjectSelect');
  const projectFilterSelect = document.getElementById('projectFilterSelect');

  // Alleen admins mogen projecten toevoegen/wijzigen
  const iAmAdmin = isAdmin();
  document.querySelector('#tab-projects button[data-bs-target="#projectModal"]')?.classList.toggle('d-none', !iAmAdmin);

  if (!projectTableBody) return;

  // Sorteren op startdatum, dan einddatum (ISO-datums kunnen als tekst vergeleken worden)
  const list = (ud.projects || [])
    .slice()
    .sort(
      (a, b) =>
        (a.start || '0000-01-01').localeCompare(b.start || '0000-01-01') ||
        (a.end || '9999-12-31').localeCompare(b.end || '9999-12-31')
    );

  // Tabel en dropdowns resetten
  projectTableBody.innerHTML = '';
  if (newShiftProjectSelect) newShiftProjectSelect.innerHTML = '<option value="">Geen project</option>';
  if (projectFilterSelect) projectFilterSelect.innerHTML = '<option value="">Alle projecten</option>';

  list.forEach((p, idx) => {
    const tr = document.createElement('tr');
    if (p.allowMulti === undefined) p.allowMulti = false;

    let actionsHtml = '';
    if (iAmAdmin) {
      actionsHtml = `
        <div class="btn-group">
          <button class="btn btn-sm btn-outline-primary" data-idx="${idx}" data-act="edit" title="Bewerken">
            <span class="material-icons-outlined" style="font-size:16px">edit</span>
          </button>
          
          <button class="btn btn-sm btn-outline-warning" data-idx="${idx}" data-act="extend" title="Snel verlengen">
            <span class="material-icons-outlined" style="font-size:16px">event_repeat</span>
          </button>
          <button class="btn btn-sm btn-outline-danger" data-idx="${idx}" data-act="delete" title="Verwijderen">
            <span class="material-icons-outlined" style="font-size:16px">delete</span>
          </button>
        </div>`;
    } else {
      actionsHtml = `<span class="text-muted small material-icons-outlined" style="font-size:16px; opacity:0.5;">lock</span>`;
    }

    tr.innerHTML = `
      <td>
        <div class="d-flex align-items-center">
            <div>
                <strong class="text-dark">${escapeHtml(p.name)}</strong>
            </div>
        </div>
      </td>
      <td><span class="badge bg-light text-dark border">${toDisplayDate(p.start)}</span></td>
      <td><span class="badge bg-light text-dark border">${toDisplayDate(p.end)}</span></td>
      <td class="text-end">
        ${actionsHtml}
      </td>`;

    projectTableBody.appendChild(tr);

    // Dropdowns vullen (voor iedereen, zodat shiften gekoppeld kunnen worden)
    if (newShiftProjectSelect) {
      const o1 = document.createElement('option');
      o1.value = p.name;
      o1.textContent = p.name;
      newShiftProjectSelect.appendChild(o1);
    }
    if (projectFilterSelect) {
      const o2 = document.createElement('option');
      o2.value = p.name;
      o2.textContent = p.name;
      projectFilterSelect.appendChild(o2);
    }
  });

  // Shift-popup: periode van het gekozen project automatisch invullen
  if (newShiftProjectSelect) {
    newShiftProjectSelect.onchange = () => {
      const selectedName = newShiftProjectSelect.value;
      const p = list.find(proj => proj.name === selectedName);

      const startInput = document.getElementById('newShiftStartDate');
      const endInput = document.getElementById('newShiftEndDate');

      if (p) {
        if (p.start && startInput) startInput.value = p.start;
        if (p.end && endInput) endInput.value = p.end;
      } else {
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';
      }
    };
  }

  // Knoppen (alleen aanwezig voor admins)
  if (iAmAdmin) {
    projectTableBody.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ud = getCurrentUserData();
        const clickedItem = list[Number(btn.dataset.idx)];
        const realIdx = ud.projects.indexOf(clickedItem);

        if (realIdx === -1) return;
        const p = ud.projects[realIdx];
        const action = btn.dataset.act;

        if (action === 'edit') {
          editingProjectIndex = realIdx;
          document.getElementById('modalProjectName').value = p.name;
          document.getElementById('modalProjectStart').value = p.start || '';
          document.getElementById('modalProjectEnd').value = p.end || '';
          document.querySelector('#projectModal .modal-title').textContent = 'Project Bewerken';
          new bootstrap.Modal(document.getElementById('projectModal')).show();
        } else if (action === 'extend') {
          const v = prompt('Nieuwe einddatum (DD-MM-YYYY):', p.end ? toDisplayDate(p.end) : '');
          if (!v) return;
          if (!/^\d{2}-\d{2}-\d{4}$/.test(v.trim())) return toast('Gebruik het formaat DD-MM-YYYY', 'warning');
          p.end = fromDisplayDate(v.trim());
          await saveUserData();
          renderProjects();
          renderProjectFilterForMonth();
          renderMonth(Number(yearSelectMain.value), Number(monthSelectMain.value));
          toast('Project verlengd', 'success');
        } else if (action === 'delete') {
          if (!confirm(`Project "${p.name}" verwijderen?`)) return;
          ud.projects.splice(realIdx, 1);
          await saveUserData();
          renderProjects();
          renderProjectFilterForMonth();
          renderMonth(Number(yearSelectMain.value), Number(monthSelectMain.value));
          toast('Project verwijderd', 'danger');
        }
      });
    });
  }
}

function bindProjects() {
  // Project opslaan (nieuw of bewerkt)
  document.getElementById('saveProjectBtn')?.addEventListener('click', async () => {
    if (!isAdmin()) return toast('Alleen beheerders mogen projecten aanpassen.', 'danger');
    const nameInput = document.getElementById('modalProjectName');
    const startInput = document.getElementById('modalProjectStart');
    const endInput = document.getElementById('modalProjectEnd');

    const name = nameInput.value.trim();
    if (!name) return toast('Vul een projectnaam in', 'warning');

    const ud = getCurrentUserData();
    ud.projects = ud.projects || [];

    if (editingProjectIndex !== null) {
      // Bestaand project bijwerken
      const existing = ud.projects[editingProjectIndex];
      const oldName = existing.name;
      existing.name = name;
      existing.start = startInput.value || null;
      existing.end = endInput.value || null;
      if (oldName !== name) renameProjectEverywhere(ud, oldName, name);
      toast('Project gewijzigd', 'success');
    } else {
      if (ud.projects.some(p => p.name === name)) return toast('Er bestaat al een project met deze naam', 'warning');
      // Nieuw project
      ud.projects.push({
        name: name,
        start: startInput.value || null,
        end: endInput.value || null,
        allowMulti: false
      });
      toast('Project toegevoegd', 'success');

      // Melding naar andere gebruikers
      const qs = await getDocs(collection(db, 'users'));
      for (const u of qs.docs) {
        if (u.id !== currentUserId) {
          await notifyProjectChange(u.id, 'added', name);
        }
      }
    }

    await saveUserData();

    // Popup sluiten (velden worden leeggemaakt in 'hidden.bs.modal' hieronder)
    bootstrap.Modal.getInstance(document.getElementById('projectModal'))?.hide();

    renderProjects();
    renderProjectFilterForMonth();
    renderShifts();
  });

  // Popup leegmaken na sluiten, zodat "Nieuw project" weer leeg opent
  document.getElementById('projectModal')?.addEventListener('hidden.bs.modal', () => {
    document.getElementById('modalProjectName').value = '';
    document.getElementById('modalProjectStart').value = '';
    document.getElementById('modalProjectEnd').value = '';
    editingProjectIndex = null;
    const title = document.querySelector('#projectModal .modal-title');
    if (title) title.textContent = 'Nieuw Project';
  });
}

// ======================================================================
// §11  SHIFTEN
// Shiftbeheer: lijst, volgorde, opslaan.
// ======================================================================

const filterShiftYear = document.getElementById('filterShiftYear');

/** Opties voor de icoon-keuze bij een shift. */
function shiftIconOptions(selected, withLabels = false) {
  return Object.entries(SHIFT_ICON_LIST)
    .map(
      ([value, [emoji, label]]) =>
        `<option value="${value}" ${selected === value ? 'selected' : ''}>${emoji}${withLabels ? ' ' + label : ''}</option>`
    )
    .join('');
}

/** Past de shift-sleutel aan in alle ingevulde dagen (bij hernoemen van een shift). */
function renameShiftKeyEverywhere(ud, oldKey, newKey) {
  Object.values(ud.monthData || {}).forEach(months =>
    Object.values(months || {}).forEach(md =>
      Object.values(md?.rows || {}).forEach(r => {
        if (r?.shift === oldKey) r.shift = newKey;
      })
    )
  ); // Koppelingen naar de oude naam meeverhuizen
  Object.values(ud.shifts || {}).forEach(sh => {
    if (sh?.linkedShift === oldKey) sh.linkedShift = newKey;
  });
}

async function saveShiftsToDb(ud) {
  const id = getActiveUserId();
  if (id) await trackSave(updateDoc(doc(db, 'users', id), { shifts: ud.shifts, shiftOrder: ud.shiftOrder }));
}

function refreshCalendarIfVisible() {
  const y = Number(yearSelectMain?.value);
  const m = Number(monthSelectMain?.value);
  if (y && !isNaN(m)) renderCalendarGrid(y, m);
}

function renderShifts() {
  const ud = getCurrentUserData();
  const shifts = ud.shifts || {};

  // -- Automatische reparatie volgorde --
  let order = ud.shiftOrder || [];
  const cleanedOrder = order.filter(key => shifts[key]);
  const realKeys = Object.keys(shifts);
  const missingKeys = realKeys.filter(key => !cleanedOrder.includes(key));
  if (order.length !== cleanedOrder.length || missingKeys.length > 0) {
    order = [...cleanedOrder, ...missingKeys];
    ud.shiftOrder = order;
    const id = getActiveUserId();
    if (id) updateDoc(doc(db, 'users', id), { shiftOrder: order });
  }

  const selectedYear = filterShiftYear?.value ? Number(filterShiftYear.value) : null;

  // Tabel leegmaken
  const shiftTableBody = document.getElementById('shiftTableBody');
  if (!shiftTableBody) return;
  shiftTableBody.innerHTML = '';

  order.forEach(name => {
    const sh = shifts[name];
    if (!sh) return;

    if (selectedYear) {
      const startY = sh.startDate ? new Date(sh.startDate).getFullYear() : null;
      const endY = sh.endDate ? new Date(sh.endDate).getFullYear() : null;
      if (
        (startY && endY && (selectedYear < startY || selectedYear > endY)) ||
        (startY && !endY && selectedYear < startY) ||
        (!startY && endY && selectedYear > endY)
      )
        return;
    }

    const tr = document.createElement('tr');
    tr.dataset.key = name; // Nodig voor het sorteren!

    const projectBadge = sh.project
      ? `<span class="badge bg-light text-dark border">${escapeHtml(sh.project)}</span>`
      : '<span class="text-muted small">-</span>';

    const periodText =
      sh.startDate || sh.endDate
        ? `<small>${toDisplayDate(sh.startDate) || '...'} <span class="text-muted">t/m</span> ${toDisplayDate(sh.endDate) || '...'}</small>`
        : '<span class="text-muted small">-</span>';

    const iconOptions = shiftIconOptions(sh.icon);

    // Tabelrij opbouwen
    tr.innerHTML = `
      <td>
        <div class="d-flex align-items-center">
            <span class="handle material-icons-outlined text-muted me-2" style="cursor: grab; font-size: 18px;">drag_indicator</span>
            <span class="dot" style="background:${sh.color || '#ccc'}; width:12px; height:12px; display:inline-block; border-radius:50%; margin-right:10px;"></span>
            <div>
                <strong class="text-dark">${escapeHtml(sh.realName || name)}</strong>
                ${sh.shortName ? `<div class="small text-muted">${escapeHtml(sh.shortName)}</div>` : ''}
                ${sh.linkedShift && ud.shifts?.[sh.linkedShift] ? `<div class="link-note"><span class="material-icons-outlined" aria-hidden="true">link</span>samen met ${escapeHtml(shiftRealName(sh.linkedShift, ud))}</div>` : ''}
            </div>
        </div>
      </td>

      <td>${sh.start || '00:00'}</td>
      <td>${sh.end || '00:00'}</td>
      <td>${sh.break || 0}</td>
      <td>${projectBadge}</td>

      <td class="text-center">
        <select class="form-select form-select-sm shift-icon-select" style="width: 70px; margin: auto;">
          ${iconOptions}
        </select>
      </td>

      <td class="text-center">
        <div class="form-check form-switch d-flex justify-content-center">
          <input class="form-check-input shift-fav-toggle" type="checkbox" ${sh.isFavorite ? 'checked' : ''}>
        </div>
      </td>

      <td>${periodText}</td>

      <td class="text-end">
        <div class="btn-group">
          <button class="btn btn-sm btn-outline-secondary btn-edit" title="Bewerken"><span class="material-icons-outlined" style="font-size:16px">edit</span></button>
          <button class="btn btn-sm btn-outline-danger btn-del" title="Verwijderen"><span class="material-icons-outlined" style="font-size:16px">delete</span></button>
          <button class="btn btn-sm btn-outline-primary btn-copy" title="Kopiëren"><span class="material-icons-outlined" style="font-size:16px">content_copy</span></button>
        </div>
      </td>
    `;

    // Verwijderen / kopiëren / bewerken
    tr.querySelector('.btn-del').onclick = async () => {
      if (!confirm(`Shift "${sh.realName || name}" verwijderen?`)) return;
      delete ud.shifts[name];
      ud.shiftOrder = ud.shiftOrder.filter(n => n !== name);
      await saveShiftsToDb(ud);
      renderShifts();
      toast('Verwijderd', 'success');
    };

    tr.querySelector('.btn-copy').onclick = async () => {
      // Unieke naam: "X (Kopie)", "X (Kopie 2)", …
      let n = 1;
      let copyKey = `${name} (Kopie)`;
      while (ud.shifts[copyKey]) copyKey = `${name} (Kopie ${++n})`;
      const copyReal = `${sh.realName || name} (Kopie${n > 1 ? ' ' + n : ''})`;
      ud.shifts[copyKey] = { ...sh, realName: copyReal };
      ud.shiftOrder.push(copyKey);
      await saveShiftsToDb(ud);
      renderShifts();
      toast('Gekopieerd', 'success');
    };

    tr.querySelector('.btn-edit').onclick = () => {
      const modalEl = document.getElementById('shiftModal');
      modalEl.dataset.editingKey = name;

      const newShiftName = document.getElementById('newShiftName');
      newShiftName.value = sh.realName || name;
      if (document.getElementById('newShiftShort')) document.getElementById('newShiftShort').value = sh.shortName || '';
      if (document.getElementById('newShiftColor'))
        document.getElementById('newShiftColor').value = sh.color || '#e9ecef';

      document.getElementById('newShiftStart').value = sh.start || '00:00';
      document.getElementById('newShiftEnd').value = sh.end || '00:00';
      document.getElementById('newShiftBreak').value = sh.break || 0;
      document.getElementById('newShiftProjectSelect').value = sh.project || '';
      document.getElementById('newShiftStartDate').value = sh.startDate || '';
      document.getElementById('newShiftEndDate').value = sh.endDate || '';

      new bootstrap.Modal(modalEl).show();
    };

    // Icoon en favoriet: meteen opslaan en kalender verversen
    tr.querySelector('.shift-icon-select').onchange = async e => {
      ud.shifts[name].icon = e.target.value;
      await saveUserData();
      refreshCalendarIfVisible();
    };

    tr.querySelector('.shift-fav-toggle').onchange = async e => {
      ud.shifts[name].isFavorite = e.target.checked;
      await saveUserData();
      refreshCalendarIfVisible();
    };

    shiftTableBody.appendChild(tr);
  });

  initShiftSortable();
}

/** Volgorde aanpassen met slepen (via het ⋮⋮-handvat). */
function initShiftSortable() {
  const el = document.getElementById('shiftTableBody');
  if (!el || el.dataset.sortableInitialized) return;

  if (typeof Sortable === 'undefined') return console.warn('SortableJS niet geladen');

  Sortable.create(el, {
    handle: '.handle', // Alleen slepen via de puntjes
    animation: 150,
    ghostClass: 'bg-light',
    onEnd: async function () {
      const ud = getCurrentUserData();
      const visible = [...el.querySelectorAll('tr')].map(row => row.dataset.key).filter(Boolean);
      // Shiften die door de jaarfilter verborgen zijn, behouden hun plaats achteraan
      const hidden = (ud.shiftOrder || []).filter(k => !visible.includes(k));
      const newOrder = [...visible, ...hidden];
      ud.shiftOrder = newOrder;

      // Opslaan
      const id = getActiveUserId();
      if (id) {
        await trackSave(updateDoc(doc(db, 'users', id), { shiftOrder: newOrder }));
        toast('Nieuwe volgorde opgeslagen', 'success');
      }
    }
  });

  el.dataset.sortableInitialized = 'true';
}

function populateFilterShiftYears() {
  const ud = getCurrentUserData();
  const years = new Set();

  // Verzamel jaartallen uit startDate en endDate
  Object.values(ud.shifts || {}).forEach(sh => {
    if (sh.startDate) years.add(new Date(sh.startDate).getFullYear());
    if (sh.endDate) years.add(new Date(sh.endDate).getFullYear());
  });

  const sortedYears = [...years].sort((a, b) => a - b);

  // Vul de dropdown
  const filterShiftYear = document.getElementById('filterShiftYear');
  if (filterShiftYear) {
    filterShiftYear.innerHTML = '<option value="">Alle jaren</option>';
    sortedYears.forEach(y => {
      const o = document.createElement('option');
      o.value = y;
      o.textContent = y;
      filterShiftYear.appendChild(o);
    });

    // Automatisch huidig jaar selecteren (indien aanwezig in de lijst)
    const currentYear = new Date().getFullYear();
    if (sortedYears.includes(currentYear)) {
      filterShiftYear.value = currentYear;
    }

    renderShifts();
  }
}

function bindShifts() {
  // Shift opslaan (nieuw of bewerkt)
  const saveShiftBtn = document.getElementById('addShiftBtn');
  if (saveShiftBtn) {
    saveShiftBtn.addEventListener('click', async () => {
      const newShiftName = document.getElementById('newShiftName');
      const visibleName = newShiftName.value.trim();
      const projectVal = document.getElementById('newShiftProjectSelect').value || '';
      const linkVal = document.getElementById('newShiftLinked')?.value || '';

      if (!visibleName) return toast('Naam verplicht', 'warning');

      let uniqueKey = visibleName;
      if (projectVal) {
        const suffix = ` (${projectVal})`;
        if (!visibleName.endsWith(suffix)) uniqueKey = `${visibleName}${suffix}`;
      }

      const modalEl = document.getElementById('shiftModal');
      const oldKey = modalEl.dataset.editingKey;

      const ud = getCurrentUserData();
      ud.shifts = ud.shifts || {};
      ud.shiftOrder = ud.shiftOrder || [];

      // Icoon en favoriet van de bestaande shift behouden
      const previous = (oldKey && ud.shifts[oldKey]) || ud.shifts[uniqueKey] || {};

      // Andere naam of project → nieuwe sleutel; ingevulde dagen meeverhuizen
      if (oldKey && oldKey !== uniqueKey) {
        if (ud.shifts[uniqueKey] && !confirm(`Er bestaat al een shift "${uniqueKey}". Overschrijven?`)) return;
        delete ud.shifts[oldKey];
        const idx = ud.shiftOrder.indexOf(oldKey);
        if (idx !== -1) ud.shiftOrder[idx] = uniqueKey;
        ud.shiftOrder = ud.shiftOrder.filter((k, i, arr) => arr.indexOf(k) === i);
        renameShiftKeyEverywhere(ud, oldKey, uniqueKey);
      }

      ud.shifts[uniqueKey] = {
        ...(previous.icon ? { icon: previous.icon } : {}),
        ...(previous.isFavorite ? { isFavorite: true } : {}),
        realName: visibleName,
        shortName: document.getElementById('newShiftShort')?.value.trim() || '',
        color: document.getElementById('newShiftColor')?.value || '#e9ecef',
        start: document.getElementById('newShiftStart').value || '00:00',
        end: document.getElementById('newShiftEnd').value || '00:00',
        break: Number(document.getElementById('newShiftBreak').value) || 0,
        project: projectVal,
        startDate: document.getElementById('newShiftStartDate').value || null,
        endDate: document.getElementById('newShiftEndDate').value || null,
        ...(linkVal && linkVal !== uniqueKey ? { linkedShift: linkVal } : {})
      };

      if (!ud.shiftOrder.includes(uniqueKey)) ud.shiftOrder.push(uniqueKey);

      await saveShiftsToDb(ud);
      if (oldKey && oldKey !== uniqueKey) await saveUserData(); // hernoemde dagen bewaren

      renderShifts();
      refreshCalendarIfVisible();
      bootstrap.Modal.getInstance(modalEl).hide();
      delete modalEl.dataset.editingKey;

      newShiftName.value = '';
      document.getElementById('newShiftBreak').value = 0;
      document.getElementById('newShiftStartDate').value = '';
      document.getElementById('newShiftEndDate').value = '';
      if (document.getElementById('newShiftShort')) document.getElementById('newShiftShort').value = '';

      toast('Shift opgeslagen', 'success');
    });
  }

  // Keuzelijst "Samen invullen met" vullen bij het openen
  document.getElementById('shiftModal')?.addEventListener('show.bs.modal', e => {
    const sel = document.getElementById('newShiftLinked');
    if (!sel) return;
    const ud = getCurrentUserData();
    const editing = e.target.dataset.editingKey || '';
    const keys = (ud.shiftOrder || []).filter(k => ud.shifts?.[k]);
    Object.keys(ud.shifts || {}).forEach(k => !keys.includes(k) && keys.push(k));
    sel.innerHTML =
      '<option value="">Niet gekoppeld</option>' +
      keys
        .filter(k => k !== editing)
        .map(
          k =>
            `<option value="${escapeHtml(k)}">${escapeHtml(shiftRealName(k, ud))}${ud.shifts[k].project ? ` (${escapeHtml(ud.shifts[k].project)})` : ''}</option>`
        )
        .join('');
    sel.value = (editing && ud.shifts?.[editing]?.linkedShift) || '';
  });

  // Nieuwe shift: popup leeg openen (niet met de gegevens van de vorige bewerking)
  document.getElementById('shiftModal')?.addEventListener('hidden.bs.modal', e => {
    delete e.target.dataset.editingKey;
  });

  filterShiftYear?.addEventListener('change', () => renderShifts());
}

// ======================================================================
// §12  INVOER — MAAND & STATUS
// Maandkeuze, doelen, totalen, status, saldo-badges, versies en PDF.
// ======================================================================

const versionSelect = document.getElementById('versionSelect');
const addVersionBtn = document.getElementById('addVersionBtn');
const delVersionBtn = document.getElementById('delVersionBtn');

/** Status-badge van de maand + welke knoppen zichtbaar zijn. */
function updateMonthStatusBadge() {
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const status = getMonthStatus(y, m);
  const badge = document.getElementById('monthStatusBadge');
  if (!badge) return;

  const admin = isAdmin();
  badge.className = `badge badge-status badge-${status}${admin ? ' dropdown-toggle' : ''}`;
  badge.textContent = STATUS_LABELS[status] || status;
  // Alleen admins kunnen de status via het menu wijzigen
  if (admin) badge.setAttribute('data-bs-toggle', 'dropdown');
  else badge.removeAttribute('data-bs-toggle');
  badge.style.cursor = admin ? 'pointer' : 'default';

  // Ingediende/goedgekeurde maand: knoppen verbergen voor gewone gebruikers
  const hide = isMonthLocked(y, m);
  for (const id of ['submitMonthBtn', 'multiDayShiftBtn', 'clearMonthBtn']) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.classList.toggle('d-none', hide);
    btn.disabled = hide;
  }
}

/** Projectfilter: enkel projecten die in de gekozen maand actief zijn. */
function renderProjectFilterForMonth() {
  const ud = getCurrentUserData();
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const monthStart = dateKey(y, m, 1);
  const monthEnd = dateKey(y, m, new Date(y, m + 1, 0).getDate());
  const previous = projectFilterSelect.value;

  projectFilterSelect.innerHTML = '<option value="">Alle projecten</option>';
  (ud.projects || [])
    .slice()
    .sort(
      (a, b) =>
        (a.start || '0000-01-01').localeCompare(b.start || '0000-01-01') || (a.name || '').localeCompare(b.name || '')
    )
    .filter(p => (p.start || '0000-01-01') <= monthEnd && (p.end || '9999-12-31') >= monthStart)
    .forEach(p => {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.name;
      projectFilterSelect.appendChild(o);
    });

  // Gekozen filter behouden als dat project ook in deze maand bestaat
  if ([...projectFilterSelect.options].some(o => o.value === previous)) projectFilterSelect.value = previous;
}

/** Gekozen maand (opnieuw) opbouwen en alle afhankelijke onderdelen verversen. */
async function generateMonth() {
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const ud = getCurrentUserData();
  ud.monthData = ud.monthData || {};
  ud.monthData[y] = ud.monthData[y] || {};
  if (!ud.monthData[y][m]) ud.monthData[y][m] = { targetHours: 0, targetMinutes: 0, rows: {} };
  await renderMonth(y, m);
  updateInputTotals();
  renderHome();
  renderHistory();
  renderVersionControls();
}

/** Vaste projectkoppeling (bv. Verlof → Eght Care) invullen als die ontbreekt. Geeft true als er iets wijzigde. */
function autoAssignProjectIfNeeded(r) {
  const sp = autoProjectForShift(shiftRealName(r.shift));
  if (sp && (!r.project || !isValidProject(r.project))) {
    ensureProjectExists(sp);
    r.project = sp;
    return true;
  }
  return false;
}

/** Alle tellers van de Invoer-pagina verversen. */
function updateInputTotals() {
  updateRemainingHours();
  updateLeaveBadges();
  renderProjectSummary();
}

/** Zwevende urenmeter in Invoer: doel, gepland en wat er nog rest (rood/groen). */
function updateRemainingHours() {
  const el = document.getElementById('remainingHoursAlert');
  if (!el) return;
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const ud = getCurrentUserData();
  const md = ud?.monthData?.[y]?.[m];
  if (!md) {
    el.classList.add('d-none');
    return;
  }
  const doel = (Number(md.targetHours) || 0) * 60 + (Number(md.targetMinutes) || 0);
  renderMeter(el, plannedMinutes(md.rows, ud), doel, { extra: monthExtraMinutes(md.rows, ud) });
  el.classList.remove('d-none');
}

/** Kaartjes met het totaal per project voor de gekozen maand. */
function renderProjectSummary() {
  const wrap = document.getElementById('projectSummary');
  if (!wrap) return;
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const md = getCurrentUserData().monthData?.[y]?.[m];

  if (!md?.rows || !Object.keys(md.rows).length) {
    wrap.innerHTML = '<div class="alert alert-light border small mb-0">Geen data in deze maand.</div>';
    return;
  }

  const filterProject = projectFilterSelect.value || '';
  const perProject = {};
  for (const r of Object.values(md.rows)) {
    if (!r || (r.status && r.status !== 'approved')) continue;
    const p = r.project || '—';
    if (filterProject && p !== filterProject) continue;
    perProject[p] = (perProject[p] || 0) + (Number(r.minutes) || 0);
  }

  const cards = Object.entries(perProject)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([name, minutes]) => `
        <div class="project-mini">
          <div class="title">${escapeHtml(name)}</div>
          <div class="meta">Totaal in maand</div>
          <div class="value">${Math.floor(minutes / 60)}u ${minutes % 60}m</div>
        </div>`
    );

  wrap.innerHTML = cards.length
    ? cards.join('')
    : '<div class="alert alert-light border small mb-0">Geen projecten voor huidig filter.</div>';
}

/** Saldo-badges: verlof (kalenderjaar) en schoolverlof (schooljaar 1/9–31/8). */
function updateLeaveBadges() {
  const badgeLeave = document.getElementById('leaveBalanceBadge');
  const badgeSchool = document.getElementById('schoolLeaveBalanceBadge');
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const colorFor = remaining => (remaining < 0 ? 'bg-danger' : remaining === 0 ? 'bg-warning text-dark' : 'bg-success');

  if (badgeLeave) {
    const allowance = getLeaveAllowanceMinutes();
    if (!allowance) {
      badgeLeave.textContent = 'Verlof saldo: — (stel in)';
      badgeLeave.className = 'badge bg-secondary-subtle text-dark ms-2';
    } else {
      const remaining = allowance - sumTakenMinutesFor(y, LEAVE_SHIFT_NAMES);
      badgeLeave.textContent =
        remaining < 0
          ? `Verlof saldo: -${fmtMins(remaining)} (overschreden)`
          : `Verlof saldo: ${fmtMins(remaining)} over`;
      badgeLeave.className = `badge ms-2 ${colorFor(remaining)}`;
    }
  }

  if (badgeSchool) {
    const allowance = getSchoolLeaveAllowanceMinutes(y, m);
    if (!allowance) {
      badgeSchool.textContent = 'Schoolverlof saldo: — (stel in)';
      badgeSchool.className = 'badge bg-secondary-subtle text-dark ms-2';
    } else {
      const { startISO, endISO, label } = getAcademicYearBounds(y, m);
      const remaining = allowance - sumTakenMinutesForRange(startISO, endISO, SCHOOL_LEAVE_SHIFT_NAMES);
      badgeSchool.textContent =
        remaining < 0
          ? `Schoolverlof saldo: -${fmtMins(remaining)} (overschreden) — ${label}`
          : `Schoolverlof saldo: ${fmtMins(remaining)} over — ${label}`;
      badgeSchool.className = `badge ms-2 ${colorFor(remaining)}`;
    }
  }
}

/**
 * Admin: status van een maand van een gebruiker wijzigen en de gebruiker
 * een bericht sturen (met kopie in de "Verzonden" map van de admin).
 */
async function setMonthStatusFor(uid, y, m, status, comment = '') {
  const adminId = currentUserId;
  const adminName = auth.currentUser?.displayName || dataStore.users[adminId]?.name || 'Admin';

  const prev = dataStore.viewUserId;
  dataStore.viewUserId = uid;
  await setMonthStatus(y, m, status);
  dataStore.viewUserId = prev;

  if (status === 'draft') return;

  const word = status === 'approved' ? 'Goedgekeurd' : 'Afgekeurd';
  const subject = `[Planner] ${word} — ${monthsFull[m]} ${y}`;
  const body = `Je planner voor ${monthsFull[m]} ${y} werd ${word.toLowerCase()}.${comment ? `\n\nOpmerking:\n${comment}` : ''}`;
  const message = {
    threadId: `plan:${uid}:${y}-${m}`,
    kind: 'status',
    from: { uid: adminId, name: adminName, role: 'admin' },
    to: { uid, type: 'user' },
    subject,
    body,
    timestamp: serverTimestamp()
  };
  await addDoc(collection(db, 'users', uid, 'mailbox'), { ...message, system: true, read: false });
  await addDoc(collection(db, 'users', adminId, 'mailbox'), { ...message, system: false, read: true });
}

/** Dropdown met opgeslagen versies van de maand. */
function renderVersionControls() {
  if (!versionSelect) return;
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const versions = getCurrentUserData().monthData?.[y]?.[m]?.versions || {};
  const currentVal = versionSelect.value;

  versionSelect.innerHTML = '<option value="">-- Huidig (Actief) --</option>';
  Object.keys(versions).forEach(vName => {
    const opt = document.createElement('option');
    opt.value = vName;
    opt.textContent = vName;
    versionSelect.appendChild(opt);
  });
  if (currentVal && versions[currentVal]) versionSelect.value = currentVal;
}

// Admin-snelmenu onder de saldo-badges
function loadQuickLeaveValue() {
  // Verlof-saldo wordt (nog) niet per jaar bewaard, maar als één instelling
  const mins = dataStore.users[getActiveUserId()]?.settings?.leaveAllowanceMinutes || 0;
  document.getElementById('quickAdminLeaveHours').value = Math.floor(mins / 60) || '';
}

function loadQuickSchoolValue() {
  const label = document.getElementById('quickSchoolYearSelect').value;
  const map = dataStore.users[getActiveUserId()]?.settings?.schoolLeaveByYear || {};
  document.getElementById('quickAdminSchoolHours').value = Math.floor((map[label] || 0) / 60) || '';
}

/** PDF-export van de gekozen maand. */
/** Hex (#rrggbb of #rgb) → [r, g, b]. */
function hexToRgbArray(hex, fallback = [233, 236, 239]) {
  let h = String(hex || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(h)) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  if (!/^#[0-9a-f]{6}$/i.test(h)) return fallback;
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
}
/** Kleur mengen met wit (t = 0 → kleur, 1 → wit). */
const tint = (rgb, t) => rgb.map(c => Math.round(c + (255 - c) * t));
/** Kleur donkerder maken (t = 0 → kleur, 1 → zwart). */
const shade = (rgb, t) => rgb.map(c => Math.round(c * (1 - t)));
/** Donkere of lichte tekst op een achtergrond. */
const textOn = rgb => (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 150 ? [21, 48, 45] : [255, 255, 255]);

/**
 * Maandrapport als PDF in de stijl van de app:
 * kop in je accentkleur, overzichtskaarten, maandkalender met de shiftkleuren,
 * detailtabel per dag en totalen per project.
 */
function exportMonthPdf() {
  if (!window.jspdf?.jsPDF) return toast('PDF-module nog niet geladen, probeer zo meteen opnieuw', 'warning');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

  const m = Number(monthSelectMain.value);
  const y = Number(yearSelectMain.value);
  const monthName = monthsFull[m];
  const ud = getCurrentUserData();
  const md = ud.monthData?.[y]?.[m];
  if (!md?.rows || !Object.values(md.rows).some(r => r?.shift)) return toast('Geen data voor deze maand', 'warning');

  // --- Kleuren uit het profiel ---
  const accent = hexToRgbArray(
    dataStore.users[currentUserId]?.settings?.accentColor || localStorage.getItem('accentColor') || '#0e7c6b',
    [14, 124, 107]
  );
  const accentDark = shade(accent, 0.35);
  const accentSoft = tint(accent, 0.88);
  const INK = [21, 48, 45];
  const MUTED = [94, 113, 110];
  const LINE = [217, 225, 223];
  const PAPER = [244, 246, 245];
  const RED = [180, 35, 24];
  const GREEN = [31, 122, 77];
  const ORANGE = [194, 92, 0];
  const BLUE = [43, 123, 185];

  const W = pdf.internal.pageSize.getWidth?.() ?? pdf.internal.pageSize.width;
  const H = pdf.internal.pageSize.getHeight?.() ?? pdf.internal.pageSize.height;
  const M = 14; // marge
  const fmtH = mins => `${Math.floor(mins / 60)}u${String(Math.abs(mins) % 60).padStart(2, '0')}`;
  const setFill = c => pdf.setFillColor(c[0], c[1], c[2]);
  const setDraw = c => pdf.setDrawColor(c[0], c[1], c[2]);
  const setText = c => pdf.setTextColor(c[0], c[1], c[2]);
  const font = (style = 'normal', size = 10, color = INK) => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    setText(color);
  };
  const shiftColor = key => hexToRgbArray(ud.shifts?.[key]?.color, [233, 236, 239]);
  const shiftShort = (key, max = 12) => {
    const name = shiftRealName(key, ud);
    return name.length > max ? `${name.slice(0, max - 1)}…` : name;
  };

  // --- Cijfers ---
  const planned = plannedMinutes(md.rows, ud);
  const target = (Number(md.targetHours) || 0) * 60 + (Number(md.targetMinutes) || 0);
  const diff = planned - target;
  const extraTotal = monthExtraMinutes(md.rows, ud);
  const counted = r => r?.shift && (!r.status || r.status === 'approved');
  const stageMonth = Object.values(md.rows).reduce(
    (s, r) => s + (counted(r) && isStageRow(r, ud) ? Number(r.minutes) || 0 : 0),
    0
  );
  const leaveMonth = Object.values(md.rows).reduce(
    (s, r) => s + (counted(r) && LEAVE_TYPES.includes(shiftRealName(r.shift, ud)) ? Number(r.minutes) || 0 : 0),
    0
  );
  const status = getMonthStatus(y, m);
  const statusLabel = STATUS_LABELS[status] || status;
  const userName = ud.name || ud.email || '-';

  // ================= Pagina 1 =================
  // Kop
  setFill(accent);
  pdf.rect(0, 0, W, 38, 'F');
  setFill(accentDark);
  pdf.rect(0, 38, W, 1.2, 'F');
  // Merkteken (prikkaart)
  setFill([255, 255, 255]);
  pdf.roundedRect(M, 9, 11, 13, 1.6, 1.6, 'F');
  setFill(accent);
  pdf.triangle(M + 7.7, 9, M + 11.2, 9, M + 11.2, 11.9, 'F');
  pdf.rect(M + 2.5, 15, 6, 1, 'F');
  pdf.rect(M + 2.5, 18.5, 6, 1, 'F');
  font('bold', 10, tint(accent, 0.75));
  pdf.text('SHIFT PLANNER', M + 15, 13.5);
  font('bold', 22, [255, 255, 255]);
  pdf.text(`${monthName} ${y}`, M + 15, 23);
  font('normal', 10, tint(accent, 0.8));
  pdf.text(userName, M + 15, 30);
  // Statuslabel rechts
  const stColors = {
    draft: [233, 238, 237],
    submitted: [255, 236, 200],
    approved: [214, 239, 226],
    rejected: [253, 220, 216]
  };
  const stText = { draft: MUTED, submitted: [154, 106, 0], approved: GREEN, rejected: RED };
  font('bold', 9);
  const stW = pdf.getTextWidth(statusLabel) + 10;
  setFill(stColors[status] || stColors.draft);
  pdf.roundedRect(W - M - stW, 11, stW, 8, 4, 4, 'F');
  setText(stText[status] || MUTED);
  pdf.text(statusLabel, W - M - stW / 2, 16.4, { align: 'center' });
  font('normal', 8, tint(accent, 0.8));
  pdf.text(`Gemaakt op ${toDisplayDate(todayISO())}`, W - M, 30, { align: 'right' });

  // Overzichtskaarten
  let yPos = 47;
  const cards = [
    {
      label: 'Gepland',
      value: fmtH(planned),
      sub: target ? `van ${fmtH(target)} doel` : 'geen doel ingesteld',
      color: INK
    },
    {
      label: diff >= 0 ? 'Boven doel' : 'Nog te kort',
      value: target ? `${diff >= 0 ? '+' : '-'}${fmtH(Math.abs(diff))}` : '—',
      sub: target ? (diff >= 0 ? 'doel gehaald' : 'om het doel te halen') : '',
      color: !target ? MUTED : diff >= 0 ? GREEN : RED
    },
    {
      label: 'Extra gewerkt',
      value: extraTotal ? `+${fmtH(extraTotal)}` : '0u00',
      sub: 'pauzes en langer gebleven',
      color: extraTotal ? ORANGE : MUTED
    },
    { label: 'Stage', value: fmtH(stageMonth), sub: 'telt niet mee in gepland', color: BLUE },
    { label: 'Verlof / afwezig', value: fmtH(leaveMonth), sub: 'goedgekeurd', color: MUTED }
  ];
  const gap = 3;
  const cw = (W - 2 * M - gap * (cards.length - 1)) / cards.length;
  cards.forEach((c, i) => {
    const x = M + i * (cw + gap);
    setFill(PAPER);
    setDraw(LINE);
    pdf.setLineWidth(0.2);
    pdf.roundedRect(x, yPos, cw, 22, 2.5, 2.5, 'FD');
    font('normal', 7.5, MUTED);
    pdf.text(c.label.toUpperCase(), x + 3.5, yPos + 5.5);
    font('bold', 15, c.color);
    pdf.text(c.value, x + 3.5, yPos + 13.5);
    font('normal', 6.8, MUTED);
    pdf.text(pdf.splitTextToSize(c.sub, cw - 7)[0] || '', x + 3.5, yPos + 18.5);
  });
  yPos += 27;

  // Voortgangsbalk (rood = te kort, groen = gehaald)
  if (target) {
    const barW = W - 2 * M;
    const pct = Math.min(1, planned / Math.max(target, planned, 1));
    setFill(LINE);
    pdf.roundedRect(M, yPos, barW, 3.2, 1.6, 1.6, 'F');
    setFill(diff >= 0 ? GREEN : RED);
    if (pct > 0) pdf.roundedRect(M, yPos, Math.max(3.2, barW * pct), 3.2, 1.6, 1.6, 'F');
    // streepjes per 8 uur
    setDraw([255, 255, 255]);
    pdf.setLineWidth(0.5);
    const scale = Math.max(target, planned);
    for (let t = 480; t < scale; t += 480) {
      const x = M + (barW * t) / scale;
      pdf.line(x, yPos, x, yPos + 3.2);
    }
    yPos += 9;
  }

  // Maandkalender
  font('bold', 11, INK);
  pdf.text('Kalender', M, yPos + 2);
  yPos += 5;
  const days = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
  const colW = (W - 2 * M) / 7;
  setFill(accentSoft);
  pdf.rect(M, yPos, W - 2 * M, 6, 'F');
  days.forEach((d, i) => {
    font('bold', 8, accentDark);
    pdf.text(d, M + i * colW + colW / 2, yPos + 4.1, { align: 'center' });
  });
  yPos += 6;
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  const weeks = Math.ceil((offset + dim) / 7);
  const footerSpace = 26;
  const cellH = Math.min(30, (H - yPos - footerSpace) / weeks);
  const todayIso = todayISO();
  for (let i = 0; i < weeks * 7; i++) {
    const col = i % 7;
    const row = Math.floor(i / 7);
    const x = M + col * colW;
    const yy = yPos + row * cellH;
    const d = i - offset + 1;
    const inMonth = d >= 1 && d <= dim;
    setFill(!inMonth ? PAPER : col >= 5 ? [248, 250, 249] : [255, 255, 255]);
    setDraw(LINE);
    pdf.setLineWidth(0.2);
    pdf.rect(x, yy, colW, cellH, 'FD');
    if (!inMonth) continue;
    const iso = dateKey(y, m, d);
    const holiday = getBelgianHoliday(new Date(y, m, d));
    if (iso === todayIso) {
      setDraw(accent);
      pdf.setLineWidth(0.6);
      pdf.rect(x + 0.3, yy + 0.3, colW - 0.6, cellH - 0.6, 'S');
    }
    font('bold', 8, holiday ? [196, 30, 110] : MUTED);
    pdf.text(String(d), x + 1.8, yy + 3.8);
    if (holiday) {
      font('normal', 5.5, [196, 30, 110]);
      pdf.text(pdf.splitTextToSize(holiday.name, colW - 9)[0], x + colW - 1.5, yy + 3.6, { align: 'right' });
    }
    const keys = listDayKeys(md, iso).filter(k => md.rows[k]?.shift);
    const chipH = 4.3;
    const maxChips = Math.max(1, Math.floor((cellH - 6) / (chipH + 0.8)));
    keys.slice(0, maxChips).forEach((k, n) => {
      const r = md.rows[k];
      const c = shiftColor(r.shift);
      const cy = yy + 5.3 + n * (chipH + 0.8);
      setFill(c);
      pdf.roundedRect(x + 1.2, cy, colW - 2.4, chipH, 0.9, 0.9, 'F');
      setFill(shade(c, 0.3));
      pdf.rect(x + 1.2, cy, 0.7, chipH, 'F');
      if (rowExtraMinutes(r)) {
        setDraw(ORANGE);
        pdf.setLineWidth(0.4);
        pdf.roundedRect(x + 1.2, cy, colW - 2.4, chipH, 0.9, 0.9, 'S');
      }
      const tc = textOn(c);
      font('bold', 5.8, tc);
      pdf.text(shiftShort(r.shift, 11), x + 2.6, cy + 2.95);
      const mins = Number(r.minutes) || 0;
      if (mins) {
        font('normal', 5.6, tc);
        pdf.text(fmtH(mins), x + colW - 2, cy + 2.95, { align: 'right' });
      }
    });
    if (keys.length > maxChips) {
      font('normal', 5.5, MUTED);
      pdf.text(`+${keys.length - maxChips} meer`, x + 1.8, yy + cellH - 1.2);
    }
  }
  yPos += weeks * cellH + 6;

  // Legende van de gebruikte shiften
  const used = [
    ...new Set(
      Object.values(md.rows)
        .filter(r => r?.shift)
        .map(r => r.shift)
    )
  ];
  let lx = M;
  font('normal', 7, MUTED);
  used.forEach(key => {
    const name = shiftRealName(key, ud);
    const w = pdf.getTextWidth(name) + 8;
    if (lx + w > W - M) {
      lx = M;
      yPos += 5;
    }
    setFill(shiftColor(key));
    pdf.roundedRect(lx, yPos - 2.6, 3.2, 3.2, 0.8, 0.8, 'F');
    setText(MUTED);
    pdf.text(name, lx + 4.4, yPos);
    lx += w;
  });

  // ================= Pagina 2+: detail =================
  pdf.addPage();
  const pageHeader = () => {
    setFill(accent);
    pdf.rect(0, 0, W, 16, 'F');
    font('bold', 12, [255, 255, 255]);
    pdf.text(`${monthName} ${y} · details`, M, 10.5);
    font('normal', 9, tint(accent, 0.8));
    pdf.text(userName, W - M, 10.5, { align: 'right' });
  };
  pageHeader();

  const keys = Object.keys(md.rows)
    .filter(k => md.rows[k]?.shift)
    .sort((a, b) => a.slice(0, 10).localeCompare(b.slice(0, 10)));
  const dates = [...new Set(keys.map(k => k.slice(0, 10)))].sort();
  const body = [];
  const meta = [];
  dates.forEach((iso, di) => {
    listDayKeys(md, iso)
      .filter(k => md.rows[k]?.shift)
      .forEach((k, idx) => {
        const r = md.rows[k];
        const d = new Date(`${iso}T12:00:00`);
        const stage = isStageRow(r, ud);
        const st = r.status === 'pending' ? ' (aanvraag)' : r.status === 'rejected' ? ' (afgekeurd)' : '';
        const hasTime = r.start && r.end && !(r.start === '00:00' && r.end === '00:00');
        const extra = rowExtraMinutes(r);
        body.push([
          idx === 0 ? `${daysFull[d.getDay()].slice(0, 2).toLowerCase()} ${String(d.getDate()).padStart(2, '0')}` : '',
          shiftRealName(r.shift, ud) + st,
          r.project || '',
          hasTime ? `${r.start} – ${rowActualEnd(r)}` : '',
          r.break ? `${r.break}'${r.breakWorked ? ' gewerkt' : ''}` : '',
          (Number(r.minutes) ? fmtH(Number(r.minutes)) : '–') + (stage ? ' *' : ''),
          extra ? `+${fmtH(extra)}` : '',
          r.omschrijving || r.description || ''
        ]);
        meta.push({ shift: r.shift, band: di % 2, stage, pending: !!st, weekend: d.getDay() % 6 === 0, extra });
      });
  });

  pdf.autoTable({
    head: [['Dag', 'Shift', 'Project', 'Uren', 'Pauze', 'Duur', 'Extra', 'Notitie']],
    body,
    startY: 22,
    margin: { left: M, right: M, top: 22, bottom: 16 },
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 },
      textColor: INK,
      lineColor: LINE,
      lineWidth: 0
    },
    headStyles: { fillColor: accentSoft, textColor: accentDark, fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 13, fontStyle: 'bold', textColor: MUTED },
      1: { cellWidth: 38, fontStyle: 'bold' },
      2: { cellWidth: 28, textColor: MUTED },
      3: { cellWidth: 24 },
      4: { cellWidth: 17, textColor: MUTED },
      5: { cellWidth: 14, halign: 'right', fontStyle: 'bold' },
      6: { cellWidth: 14, halign: 'right', textColor: ORANGE, fontStyle: 'bold' },
      7: { cellWidth: 'auto', textColor: MUTED, fontSize: 7.5 }
    },
    didParseCell: data => {
      if (data.section !== 'body') return;
      const info = meta[data.row.index];
      if (!info) return;
      data.cell.styles.fillColor = info.band ? [248, 250, 249] : [255, 255, 255];
      if (data.column.index === 1) data.cell.styles.cellPadding = { top: 1.8, bottom: 1.8, left: 6, right: 2 };
      if (info.stage && [1, 5].includes(data.column.index)) data.cell.styles.textColor = BLUE;
      if (info.pending) data.cell.styles.textColor = MUTED;
    },
    didDrawCell: data => {
      if (data.section === 'body' && data.column.index === 1) {
        const info = meta[data.row.index];
        const c = shiftColor(info.shift);
        setFill(c);
        pdf.roundedRect(data.cell.x + 1.6, data.cell.y + data.cell.height / 2 - 1.6, 3.2, 3.2, 0.8, 0.8, 'F');
      }
      if (data.section === 'body' && data.column.index === 0 && data.row.raw[0]) {
        setDraw(LINE);
        pdf.setLineWidth(0.2);
        pdf.line(M, data.cell.y, W - M, data.cell.y);
      }
    },
    didDrawPage: () => {
      if (pdf.internal.getCurrentPageInfo().pageNumber > 2) pageHeader();
    }
  });

  // Totalen per project + uitleg
  let ty = pdf.lastAutoTable.finalY + 8;
  const perProject = {};
  Object.values(md.rows).forEach(r => {
    if (!counted(r)) return;
    const p = r.project || 'Zonder project';
    perProject[p] ||= { mins: 0, extra: 0, stage: 0 };
    if (isStageRow(r, ud)) perProject[p].stage += Number(r.minutes) || 0;
    else perProject[p].mins += Number(r.minutes) || 0;
    perProject[p].extra += isStageRow(r, ud) ? 0 : rowExtraMinutes(r);
  });
  const projRows = Object.entries(perProject)
    .sort((a, b) => b[1].mins + b[1].stage - (a[1].mins + a[1].stage))
    .map(([p, v]) => [p, v.mins ? fmtH(v.mins) : '', v.extra ? `+${fmtH(v.extra)}` : '', v.stage ? fmtH(v.stage) : '']);
  if (ty > H - 60) {
    pdf.addPage();
    pageHeader();
    ty = 24;
  }
  font('bold', 11, INK);
  pdf.text('Totaal per project', M, ty);
  pdf.autoTable({
    head: [['Project', 'Uren', 'Waarvan extra', 'Stage']],
    body: projRows,
    foot: [
      ['Totaal (telt mee)', fmtH(planned), extraTotal ? `+${fmtH(extraTotal)}` : '', stageMonth ? fmtH(stageMonth) : '']
    ],
    startY: ty + 3,
    margin: { left: M, right: M, bottom: 16 },
    theme: 'plain',
    tableWidth: 120,
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2, textColor: INK },
    headStyles: { fillColor: accentSoft, textColor: accentDark, fontStyle: 'bold', fontSize: 7.5 },
    footStyles: { fillColor: PAPER, fontStyle: 'bold', textColor: INK },
    columnStyles: {
      1: { halign: 'right', fontStyle: 'bold' },
      2: { halign: 'right', textColor: ORANGE },
      3: { halign: 'right', textColor: BLUE }
    },
    alternateRowStyles: { fillColor: [250, 251, 251] },
    didParseCell: data => {
      if (data.column.index > 0) data.cell.styles.halign = 'right';
    }
  });
  ty = pdf.lastAutoTable.finalY + 6;
  font('normal', 7, MUTED);
  pdf.text(
    pdf.splitTextToSize(
      '* Stage-uren staan in het blauw en tellen niet mee in "gepland". Oranje = extra gewerkt (doorgewerkte pauze of langer gebleven). ' +
        'Verlof in aanvraag of afgekeurd telt niet mee.',
      W - 2 * M
    ),
    M,
    ty
  );

  // Handtekeningen
  ty += 16;
  if (ty > H - 40) {
    pdf.addPage();
    pageHeader();
    ty = 34;
  }
  const sigW = (W - 2 * M - 10) / 2;
  ['Handtekening medewerker', 'Handtekening verantwoordelijke'].forEach((label, i) => {
    const x = M + i * (sigW + 10);
    setDraw(LINE);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(x, ty, sigW, 22, 2, 2, 'S');
    font('normal', 7.5, MUTED);
    pdf.text(label, x + 3, ty + 5);
    pdf.text('Datum:', x + 3, ty + 19);
  });

  // Voettekst op elke pagina
  const pages = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    setDraw(LINE);
    pdf.setLineWidth(0.2);
    pdf.line(M, H - 11, W - M, H - 11);
    font('normal', 7, MUTED);
    pdf.text(`Shift Planner · ${userName} · ${monthName} ${y}`, M, H - 6.5);
    pdf.text(`Pagina ${p} van ${pages}`, W - M, H - 6.5, { align: 'right' });
  }

  const safe = s =>
    String(s)
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '_');
  pdf.save(`Shiftplanning_${safe(userName) || 'gebruiker'}_${monthName}_${y}.pdf`);
  toast('PDF gedownload', 'success');
}

function bindMonth() {
  const currentYM = () => [Number(yearSelectMain.value), Number(monthSelectMain.value)];
  const ensureMonth = (ud, y, m) => {
    ud.monthData ||= {};
    ud.monthData[y] ||= {};
    ud.monthData[y][m] ||= { targetHours: 0, targetMinutes: 0, rows: {} };
    return ud.monthData[y][m];
  };

  // Maanddoel: tellers meteen bijwerken tijdens het typen, opslaan zodra het veld verlaten wordt
  const onTargetInput = () => {
    const [y, m] = currentYM();
    const md = ensureMonth(getCurrentUserData(), y, m);
    md.targetHours = Math.max(0, Number(monthTargetHours.value) || 0);
    md.targetMinutes = Math.max(0, Number(monthTargetMinutes.value) || 0);
    updateInputTotals();
    renderHistory();
    renderHome();
  };
  const onTargetChange = () => {
    onTargetInput();
    saveMonth(...currentYM());
  };
  [monthTargetHours, monthTargetMinutes].forEach(el => {
    el.addEventListener('input', onTargetInput);
    el.addEventListener('change', onTargetChange);
  });

  // Maand uitsluiten van historiek
  document.getElementById('excludeHistoryToggle')?.addEventListener('change', e => {
    const [y, m] = currentYM();
    ensureMonth(getCurrentUserData(), y, m).excludeFromHistory = e.target.checked;
    saveMonth(y, m);
    renderHistory();
    toast(e.target.checked ? 'Maand telt niet meer mee in historiek' : 'Maand telt weer mee in historiek', 'info');
  });

  // Maand / jaar / projectfilter wisselen
  projectFilterSelect.addEventListener('change', () => {
    renderMonth(...currentYM());
    updateInputTotals();
  });

  const onMonthChange = async () => {
    renderProjectFilterForMonth();
    await generateMonth();
  };
  yearSelectMain.addEventListener('change', onMonthChange);
  monthSelectMain.addEventListener('change', onMonthChange);

  // Maand leegmaken
  document.getElementById('clearMonthBtn')?.addEventListener('click', async () => {
    const [y, m] = currentYM();
    if (warnIfLocked(y, m)) return;
    if (
      !confirm(
        `Weet je zeker dat je ALLE shifts voor ${monthsFull[m]} ${y} wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`
      )
    )
      return;

    const md = ensureMonth(getCurrentUserData(), y, m);
    md.rows = {};
    md.status = 'draft';
    toast(`Planning voor ${monthsFull[m]} ${y} is leeggemaakt.`, 'success');
    renderMonth(y, m);
    await commitMonth(y, m);
  });

  // Gebruiker: maand indienen
  document.getElementById('submitMonthBtn')?.addEventListener('click', async () => {
    const [y, m] = currentYM();
    const status = getMonthStatus(y, m);
    if (status === 'approved') return toast('Maand is al goedgekeurd', 'info');
    if (status === 'submitted') return toast('Maand is al ingediend', 'info');

    await setMonthStatus(y, m, 'submitted');
    toast('Maand ingediend ter goedkeuring', 'success');

    // Bericht naar de admins + bevestiging voor de gebruiker
    const ud = getCurrentUserData();
    const who = ud.name || ud.email || getActiveUserId();
    await broadcastToAdmins(
      `[Planner] Ingediend — ${who} — ${monthsFull[m]} ${y}`,
      `${who} heeft zojuist ${monthsFull[m]} ${y} ingediend.\n\nKies deze gebruiker in de topbalk, open Invoer en wijzig de status via de statusbadge.`,
      'status'
    );
    await sendSystemMail(
      getActiveUserId(),
      `Planner ingediend — ${monthsFull[m]} ${y}`,
      `Je planner voor ${monthsFull[m]} ${y} werd ingediend. Je krijgt een bericht zodra die beoordeeld is.`,
      'status',
      `plan:${getActiveUserId()}:${y}-${m}`
    );
  });

  // Admin: status wijzigen via de statusbadge
  document.getElementById('adminStatusMenu')?.addEventListener('click', async e => {
    const item = e.target.closest('.dropdown-item');
    if (!item) return;
    e.preventDefault();
    if (!isAdmin()) return toast('Alleen admins kunnen de status wijzigen.', 'warning');

    const [y, m] = currentYM();
    const newStatus = item.dataset.status;
    try {
      if (newStatus === 'approved') {
        const comment = prompt('Bericht bij goedkeuring (optioneel):', '');
        if (comment === null) return;
        await setMonthStatusFor(getActiveUserId(), y, m, 'approved', comment);
        toast('Goedgekeurd', 'success');
      } else if (newStatus === 'rejected') {
        const comment = prompt('Reden voor afkeuring (optioneel):', '');
        if (comment === null) return;
        await setMonthStatusFor(getActiveUserId(), y, m, 'rejected', comment);
        toast('Afgekeurd', 'warning');
      } else if (newStatus === 'draft') {
        await setMonthStatusFor(getActiveUserId(), y, m, 'draft');
        toast('Terug naar concept', 'info');
      }
      await renderMonth(y, m);
      updateInputTotals();
      renderHome();
    } catch (err) {
      console.error(err);
      toast('Fout bij status wijziging', 'danger');
    }
  });

  // Admin: saldo instellen via klik op de saldo-badges
  document.addEventListener('click', e => {
    const badge = e.target.closest('#leaveBalanceBadge, #schoolLeaveBalanceBadge');
    if (!badge || !isAdmin()) return;

    if (badge.id === 'leaveBalanceBadge') {
      const yrSelect = document.getElementById('quickLeaveYearSelect');
      if (yrSelect.options.length === 0) {
        const curY = new Date().getFullYear();
        for (let y = curY - 2; y <= curY + 2; y++) {
          yrSelect.insertAdjacentHTML('beforeend', `<option value="${y}">${y}</option>`);
        }
        yrSelect.value = yearSelectMain.value;
      }
      loadQuickLeaveValue();
    } else {
      const schYrSelect = document.getElementById('quickSchoolYearSelect');
      if (schYrSelect.options.length === 0) {
        buildSchoolYearOptions(schYrSelect);
        schYrSelect.value = getAcademicYearBounds(...currentYM()).label;
      }
      loadQuickSchoolValue();
    }
  });

  document.getElementById('quickLeaveYearSelect')?.addEventListener('change', loadQuickLeaveValue);
  document.getElementById('quickSchoolYearSelect')?.addEventListener('change', loadQuickSchoolValue);

  document.getElementById('btnSaveQuickLeave')?.addEventListener('click', async () => {
    if (!isAdmin()) return;
    const ud = getCurrentUserData();
    ud.settings ||= {};
    ud.settings.leaveAllowanceMinutes =
      Math.max(0, Number(document.getElementById('quickAdminLeaveHours').value) || 0) * 60;
    await saveUserData();
    updateLeaveBadges();
    renderHome();
    toast('Verlof saldo opgeslagen', 'success');
  });

  document.getElementById('btnSaveQuickSchoolLeave')?.addEventListener('click', async () => {
    if (!isAdmin()) return;
    const label = document.getElementById('quickSchoolYearSelect').value;
    const ud = getCurrentUserData();
    ud.settings ||= {};
    ud.settings.schoolLeaveByYear ||= {};
    ud.settings.schoolLeaveByYear[label] =
      Math.max(0, Number(document.getElementById('quickAdminSchoolHours').value) || 0) * 60;
    await saveUserData();
    updateLeaveBadges();
    renderHome();
    toast(`Schoolverlof voor ${label} opgeslagen`, 'success');
  });

  // Versies: huidige maand bewaren als versie
  addVersionBtn?.addEventListener('click', async () => {
    const name = prompt("Geef deze versie een naam (bv. 'Optie A'):")?.trim();
    if (!name) return;
    const [y, m] = currentYM();
    const md = ensureMonth(getCurrentUserData(), y, m);
    md.versions ||= {};
    if (md.versions[name] && !confirm(`Versie '${name}' bestaat al. Overschrijven?`)) return;

    md.versions[name] = { timestamp: new Date().toISOString(), rows: structuredClone(md.rows || {}) };
    await saveMonth(y, m);
    renderVersionControls();
    versionSelect.value = name;
    toast(`Versie '${name}' opgeslagen`, 'success');
  });

  // Versies: een bewaarde versie terugzetten
  versionSelect?.addEventListener('change', async () => {
    const selectedName = versionSelect.value;
    if (!selectedName) return;
    const [y, m] = currentYM();
    if (warnIfLocked(y, m)) return renderVersionControls();
    if (
      !confirm(
        `Wil je het actieve rooster overschrijven met '${selectedName}'?\n(Niet-opgeslagen wijzigingen gaan verloren).`
      )
    ) {
      versionSelect.value = '';
      return;
    }

    const md = getCurrentUserData().monthData?.[y]?.[m];
    const savedVer = md?.versions?.[selectedName];
    if (!savedVer?.rows) return;
    md.rows = structuredClone(savedVer.rows);
    toast(`Versie '${selectedName}' geladen`, 'info');
    renderMonth(y, m);
    await commitMonth(y, m);
  });

  // Versies: verwijderen
  delVersionBtn?.addEventListener('click', async () => {
    const selectedName = versionSelect.value;
    if (!selectedName) return toast('Selecteer een versie om te verwijderen', 'warning');
    if (!confirm(`Versie '${selectedName}' definitief verwijderen?`)) return;

    const [y, m] = currentYM();
    const md = getCurrentUserData().monthData?.[y]?.[m];
    if (!md?.versions?.[selectedName]) return;
    delete md.versions[selectedName];
    await saveMonth(y, m);
    versionSelect.value = '';
    renderVersionControls();
    toast('Versie verwijderd', 'success');
  });

  document.getElementById('exportPdfBtn')?.addEventListener('click', exportMonthPdf);
  document.getElementById('exportIcsBtn')?.addEventListener('click', exportMonthIcs);
}

// ======================================================================
// §13  INVOER — KALENDER
// Kalenderweergave, dag-popup en snelle iconen.
// ======================================================================

let currentEditingDateKey = null; // dag die open staat in de dag-popup

/** Maandkalender met shiften per dag, feestdagen, schoolvakanties en favoriete-shift-iconen. */
function renderCalendarGrid(year, month) {
  year = Number(year);
  month = Number(month);
  const grid = document.getElementById('monthlyCalendarGrid');
  if (!grid) return;
  grid.innerHTML = '';

  // Schoolvakantie-label boven de kalender
  const schoolVacation = getSchoolHolidayInfo(year, month);
  const holidayLabel = document.getElementById('schoolHolidayLabel');
  if (holidayLabel) {
    if (schoolVacation) {
      const opts = { month: 'short', day: 'numeric' };
      const text = schoolVacation.fullMonth
        ? schoolVacation.name
        : `${schoolVacation.name}: ${schoolVacation.start.toLocaleDateString('nl-NL', opts)} t/m ${schoolVacation.end.toLocaleDateString('nl-NL', opts)}`;
      holidayLabel.innerHTML = `<div class="school-holiday-tag"><span style="font-size:16px">${schoolVacation.icon}</span> ${text}</div>`;
    } else {
      holidayLabel.innerHTML = '';
    }
  }

  const ud = getCurrentUserData();
  const md = ud.monthData?.[year]?.[month] || { rows: {} };
  const allShifts = ud.shifts || {};
  const favorites = (ud.shiftOrder || Object.keys(allShifts))
    .filter(key => allShifts[key]?.isFavorite)
    .map(key => ({ key, ...allShifts[key] }));

  ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].forEach(d =>
    grid.insertAdjacentHTML('beforeend', `<div class="calendar-header">${d}</div>`)
  );

  // Lege vakjes vóór de 1e (week begint op maandag)
  const firstDay = new Date(year, month, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1;
  for (let i = 0; i < offset; i++) grid.insertAdjacentHTML('beforeend', '<div class="calendar-day disabled"></div>');

  const today = todayISO();
  const workWarnings = computeWorkWarnings(ud);
  if (!lastWorkWarnings) lastWorkWarnings = workWarnings;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const baseKey = dateKey(year, month, d);
    const dateObj = new Date(year, month, d);
    const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
    const isHolidayDay =
      !!schoolVacation &&
      !isWeekend &&
      (schoolVacation.fullMonth || (dateObj >= schoolVacation.start && dateObj <= schoolVacation.end));

    const dayHoliday = getBelgianHoliday(dateObj);
    const holidayHtml = dayHoliday
      ? `<div class="holiday-badge" title="${dayHoliday.name}">${dayHoliday.emoji} <span class="hol-name">${dayHoliday.name}</span></div>`
      : '';

    // Favoriete shiften als klik-icoontjes (alleen als de shift op deze datum geldig is)
    // Meer dan 5? Dan 5 icoontjes + een "⋯"-knop met de rest.
    const dayFavs = favorites.filter(sh => isDateWithin(baseKey, sh.startDate, sh.endDate));
    const visibleFavs = dayFavs.length > QUICK_ICONS_VISIBLE ? dayFavs.slice(0, QUICK_ICONS_VISIBLE) : dayFavs;
    const quickIconsHtml =
      visibleFavs
        .map(
          sh =>
            `<span class="quick-icon-btn" data-shift="${escapeHtml(sh.key)}" title="${escapeHtml(sh.realName || sh.key)}">${SHIFT_ICONS[sh.icon] || '⭐'}</span>`
        )
        .join('') +
      (dayFavs.length > visibleFavs.length
        ? `<button type="button" class="quick-icon-btn quick-more-btn" title="Meer shiften" aria-label="Meer shiften" aria-haspopup="menu">⋯</button>`
        : '');

    // Ingevulde shiften (max. 3 zichtbaar)
    const dayKeys = listDayKeys(md, baseKey).filter(k => md.rows[k]?.shift);
    let shiftsHtml = dayKeys
      .slice(0, 3)
      .map(k => {
        const r = md.rows[k];
        const sh = allShifts[r.shift] || { color: '#e9ecef', realName: r.shift };
        const name = sh.realName || r.shift;
        const short = sh.shortName || name.slice(0, 2);
        const mins = Number(r.minutes) || 0;
        const durationText = mins > 0 ? `${Math.floor(mins / 60)}u${String(mins % 60).padStart(2, '0')}` : '';
        const pending = r.status === 'pending' ? ' ⏳' : '';
        const extra = rowExtraMinutes(r);
        const extraText = [
          r.breakWorked ? 'pauze doorgewerkt' : '',
          Number(r.extraMinutes) ? `${r.extraMinutes} min langer (tot ${rowActualEnd(r)})` : ''
        ]
          .filter(Boolean)
          .join(', ');
        const hoverText = `${name}: ${r.start || '00:00'}–${r.end || '00:00'}, pauze ${r.break || 0} min${extraText ? ` · extra: ${extraText}` : ''}`;
        return `
        <div class="cal-shift-item${extra ? ' has-extra' : ''}" title="${escapeHtml(hoverText)}" style="background:${escapeHtml(sh.color || '#e9ecef')}">
          <span class="name-long">${escapeHtml(name)}${pending}</span><span class="name-short">${escapeHtml(short)}</span>
          ${extra ? `<span class="extra-badge" aria-label="${fmtExtra(extra)} extra">+${extra < 60 ? `${extra}m` : fmtExtra(extra)}</span>` : ''}
          <span class="dur">${durationText}</span>
        </div>`;
      })
      .join('');
    if (dayKeys.length > 3) shiftsHtml += `<div class="cal-more">+${dayKeys.length - 3}</div>`;

    const dayWarnings = workWarnings.get(baseKey) || [];
    const dayEl = document.createElement('div');
    dayEl.className = [
      'calendar-day',
      isWeekend && 'weekend',
      baseKey === today && 'today',
      isHolidayDay && 'school-holiday-bg',
      dayWarnings.length && 'has-warning'
    ]
      .filter(Boolean)
      .join(' ');
    dayEl.setAttribute('role', 'button');
    dayEl.setAttribute('aria-label', `${d} ${monthsFull[month]}`);

    dayEl.innerHTML = `
      <div class="d-flex justify-content-between align-items-start">
        <span class="day-head"><span class="day-number">${d}</span>${
          dayWarnings.length
            ? `<span class="warn-badge" title="${escapeHtml(dayWarnings.map(w => w.text).join('\n'))}" aria-label="Waarschuwing: ${escapeHtml(dayWarnings.map(w => w.text).join(', '))}">⚠️</span>`
            : ''
        }</span>
        <div class="quick-icons-wrapper">${quickIconsHtml}</div>
      </div>
      ${shiftsHtml}
      ${holidayHtml}
    `;

    dayEl.onclick = () => (isPaintMode ? applyPaintShift(baseKey) : openDayEditor(baseKey));
    dayEl.querySelectorAll('.quick-icon-btn').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        if (btn.classList.contains('quick-more-btn'))
          openQuickMoreMenu(btn, baseKey, dayFavs.slice(QUICK_ICONS_VISIBLE));
        else applyShiftDirectly(baseKey, btn.dataset.shift);
      };
    });

    grid.appendChild(dayEl);
  }

  // Laatste week aanvullen met lege grijze vakjes (tot en met zondag)
  const trailing = (7 - ((offset + daysInMonth) % 7)) % 7;
  for (let i = 0; i < trailing; i++) grid.insertAdjacentHTML('beforeend', '<div class="calendar-day disabled"></div>');
}

/** Zwevend menuutje met de overige favoriete shiften van een dag ("⋯"-knop). */
function openQuickMoreMenu(anchor, baseKey, shifts) {
  closeQuickMoreMenu();
  const menu = document.createElement('div');
  menu.id = 'quickMoreMenu';
  menu.className = 'quick-more-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = shifts
    .map(
      sh => `<button type="button" role="menuitem" data-shift="${escapeHtml(sh.key)}">
        <span class="qm-icon">${SHIFT_ICONS[sh.icon] || '⭐'}</span>
        <span class="qm-name">${escapeHtml(sh.realName || sh.key)}</span>
        <span class="qm-time">${sh.start && sh.end && !(sh.start === '00:00' && sh.end === '00:00') ? `${escapeHtml(sh.start)}–${escapeHtml(sh.end)}` : ''}</span>
      </button>`
    )
    .join('');
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
  const top = r.bottom + 6 + h > window.innerHeight ? r.top - h - 6 : r.bottom + 6;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.addEventListener('click', e => {
    const btn = e.target.closest('button[data-shift]');
    if (!btn) return;
    e.stopPropagation();
    closeQuickMoreMenu();
    applyShiftDirectly(baseKey, btn.dataset.shift);
  });
  menu.querySelector('button')?.focus({ preventScroll: true });
  setTimeout(() => {
    document.addEventListener('click', closeQuickMoreMenu, { once: true });
    window.addEventListener('scroll', closeQuickMoreMenu, { once: true, passive: true });
  });
}

function closeQuickMoreMenu() {
  document.getElementById('quickMoreMenu')?.remove();
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeQuickMoreMenu();
});

/** Nieuwe rij-sleutel voor een dag: de datum zelf, of 'datum#2', 'datum#3', … als er al iets staat. */
function newRowKeyForDay(md, baseKey) {
  return md.rows[baseKey] ? `${baseKey}#${nextLineIndex(md, baseKey)}` : baseKey;
}

/**
 * Gekoppelde shift (bv. "MKA 392" → "Stage 392"): voegt de gekoppelde shift toe aan dezelfde dag,
 * met dezelfde uren als de hoofdshift. Niets als die al op die dag staat of op die datum niet geldig is.
 * Geeft de naam van de toegevoegde shift terug (of '').
 */
function addLinkedShift(md, baseKey, mainRow, ud = getCurrentUserData()) {
  const link = ud.shifts?.[mainRow?.shift]?.linkedShift;
  const def = link && ud.shifts?.[link];
  if (!def || link === mainRow.shift) return '';
  if (!isDateWithin(baseKey, def.startDate, def.endDate)) return '';
  if (listDayKeys(md, baseKey).some(k => md.rows[k]?.shift === link)) return '';
  md.rows[newRowKeyForDay(md, baseKey)] = rowFromShift(link, {
    start: mainRow.start,
    end: mainRow.end,
    break: Number(mainRow.break) || 0,
    minutes: minutesBetween(mainRow.start, mainRow.end, mainRow.break),
    omschrijving: mainRow.omschrijving || ''
  });
  return shiftRealName(link, ud);
}

/** Zijn deze twee shiften aan elkaar gekoppeld (in één of beide richtingen)? */
function areLinked(a, b, ud = getCurrentUserData()) {
  return !!a && !!b && a !== b && (ud.shifts?.[a]?.linkedShift === b || ud.shifts?.[b]?.linkedShift === a);
}

/**
 * Uren van een rij doorgeven aan de gekoppelde shift(en) op dezelfde dag:
 * start, einde, pauze, "pauze doorgewerkt" en extra minuten blijven gelijk.
 * Geeft de namen van de bijgewerkte shiften terug.
 */
function syncLinkedRows(md, key, ud = getCurrentUserData()) {
  const src = md?.rows?.[key];
  if (!src?.shift) return [];
  const synced = [];
  listDayKeys(md, key.slice(0, 10)).forEach(k => {
    const r = md.rows[k];
    if (k === key || !areLinked(src.shift, r?.shift, ud)) return;
    r.start = src.start;
    r.end = src.end;
    r.break = Number(src.break) || 0;
    if (src.breakWorked) r.breakWorked = true;
    else delete r.breakWorked;
    if (Number(src.extraMinutes)) r.extraMinutes = Number(src.extraMinutes);
    else delete r.extraMinutes;
    recalcRowMinutes(r);
    synced.push(shiftRealName(r.shift, ud));
  });
  return synced;
}

/** Rij verwijderen, samen met de gekoppelde shift(en) op dezelfde dag. Geeft de verwijderde namen terug. */
function removeRowWithLinked(md, key, ud = getCurrentUserData()) {
  const src = md?.rows?.[key];
  if (!src) return [];
  const names = [shiftRealName(src.shift, ud)];
  listDayKeys(md, key.slice(0, 10)).forEach(k => {
    if (k !== key && areLinked(src.shift, md.rows[k]?.shift, ud)) {
      names.push(shiftRealName(md.rows[k].shift, ud));
      delete md.rows[k];
    }
  });
  delete md.rows[key];
  return names;
}

/** Minuten tussen gepland einde en werkelijk einde (0 als het werkelijke einde niet later is). */
function extraFromActualEnd(plannedEnd, actualEnd) {
  if (!plannedEnd || !actualEnd) return 0;
  const toMin = t => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  let diff = toMin(actualEnd) - toMin(plannedEnd);
  if (diff < 0 && diff > -12 * 60) return 0; // vroeger gestopt: geen extra
  if (diff < 0) diff += 1440; // over middernacht
  return diff;
}

/** Rij opbouwen vanuit een shift-definitie. */
function rowFromShift(shiftKey, extra = {}) {
  const ud = getCurrentUserData();
  const sh = ud.shifts?.[shiftKey] || {};
  const row = {
    project: '',
    shift: shiftKey,
    start: sh.start || '00:00',
    end: sh.end || '00:00',
    break: Number(sh.break) || 0,
    omschrijving: '',
    minutes: minutesBetween(sh.start || '00:00', sh.end || '00:00', sh.break),
    ...extra
  };
  return applyShiftDefaults(row, shiftKey, ud);
}

function ensureMonthData(ud, y, m) {
  ud.monthData ||= {};
  ud.monthData[y] ||= {};
  ud.monthData[y][m] ||= { targetHours: 0, targetMinutes: 0, rows: {} };
  ud.monthData[y][m].rows ||= {};
  return ud.monthData[y][m];
}

/** Na een wijziging aan dagen: alles wat ervan afhangt meteen opnieuw tekenen. */
function refreshAfterRowChange(y, m) {
  announceNewWarnings();
  if (Number(yearSelectMain.value) === y && Number(monthSelectMain.value) === m) renderCalendarGrid(y, m);
  updateInputTotals();
  renderHistory();
  renderHome();
}

/** Wijziging aan een maand: eerst tonen, dan meteen opslaan in Firebase. */
function commitMonth(y, m) {
  refreshAfterRowChange(y, m);
  return saveMonth(y, m);
}

/** <option>-lijst van shiften die op een datum geldig zijn. */
function shiftOptionsHtml(dateISO, selectedKey = '', placeholder = '') {
  const entries = shiftsValidOn([dateISO]);
  if (selectedKey && !entries.some(([k]) => k === selectedKey)) {
    entries.unshift([selectedKey, getCurrentUserData().shifts?.[selectedKey] || { realName: selectedKey }]);
  }
  return (
    (placeholder ? `<option value="">${placeholder}</option>` : '') +
    entries
      .map(([key, sh]) => {
        const label = sh.realName && sh.realName !== key ? `${sh.realName} (${sh.project || 'geen project'})` : key;
        return `<option value="${escapeHtml(key)}" ${key === selectedKey ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      })
      .join('')
  );
}

/** Duur tonen naast start/einde/pauze-velden. */
function showDuration(outputEl, start, end, brk) {
  if (!outputEl) return;
  const mins = minutesBetween(start, end, brk);
  outputEl.textContent = start && end ? `= ${Math.floor(mins / 60)}u${String(mins % 60).padStart(2, '0')}` : '';
}

/** Klik op een favoriet-icoon in de kalender: shift meteen toevoegen aan die dag. */
async function applyShiftDirectly(baseKey, shiftKey) {
  const y = Number(baseKey.slice(0, 4));
  const m = Number(baseKey.slice(5, 7)) - 1;
  if (warnIfLocked(y, m)) return;
  const ud = getCurrentUserData();
  if (!ud.shifts?.[shiftKey]) return;

  const md = ensureMonthData(ud, y, m);
  const row = rowFromShift(shiftKey);
  md.rows[newRowKeyForDay(md, baseKey)] = row;
  const linked = addLinkedShift(md, baseKey, row, ud);
  toast(`${shiftRealName(shiftKey, ud)}${linked ? ` + ${linked}` : ''} toegevoegd`, 'success');
  await commitMonth(y, m);
}

/** Dag-popup: shiften van die dag wisselen, uren aanpassen, verwijderen of toevoegen + notitie. */
function openDayEditor(baseKey) {
  currentEditingDateKey = baseKey;
  renderDayEditor();
  document.getElementById('dayAddForm')?.classList.add('d-none');
  document.getElementById('btnAddExtraShift')?.classList.remove('d-none');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('dayEditorModal')).show();
}

function renderDayEditor() {
  const baseKey = currentEditingDateKey;
  if (!baseKey) return;
  const ud = getCurrentUserData();
  const y = Number(baseKey.slice(0, 4));
  const m = Number(baseKey.slice(5, 7)) - 1;
  const md = ud.monthData?.[y]?.[m] || { rows: {} };
  const locked = isMonthLocked(y, m);
  const dis = locked ? 'disabled' : '';

  const weekday = daysFull[new Date(y, m, Number(baseKey.slice(8, 10))).getDay()];
  const titleEl = document.getElementById('dayEditorTitle');
  if (titleEl) titleEl.textContent = `${weekday} ${toDisplayDate(baseKey)}${locked ? ' · vergrendeld' : ''}`;

  const listContainer = document.getElementById('dayEditorList');
  if (!listContainer) return;

  const warnBox = document.getElementById('dayEditorWarnings');
  if (warnBox) {
    const list = computeWorkWarnings(ud).get(baseKey) || [];
    warnBox.innerHTML = list
      .map(
        w =>
          `<div class="day-warning"><span class="material-icons-outlined" aria-hidden="true">${w.type === 'rest' ? 'bedtime' : 'event_repeat'}</span>${escapeHtml(w.text)}</div>`
      )
      .join('');
  }

  const dayKeys = listDayKeys(md, baseKey).filter(k => md.rows[k]?.shift);
  listContainer.innerHTML = dayKeys.length
    ? dayKeys
        .map(k => {
          const r = md.rows[k];
          const sh = ud.shifts?.[r.shift] || {};
          const mins = Number(r.minutes) || 0;
          const extra = rowExtraMinutes(r);
          return `
      <div class="day-item${extra ? ' has-extra' : ''}" data-key="${k}">
        <div class="day-item-top">
          <span class="swatch" style="background:${escapeHtml(sh.color || '#e9ecef')}"></span>
          <select class="form-select js-day-shift" aria-label="Shift" ${dis}>${shiftOptionsHtml(baseKey, r.shift)}</select>
          <button type="button" class="btn-icon js-day-remove" title="Shift verwijderen" aria-label="Shift verwijderen" ${dis}>
            <span class="material-icons-outlined">delete</span>
          </button>
        </div>
        <div class="time-row">
          <label>Start<input type="time" class="form-control js-day-time" data-field="start" value="${escapeHtml(r.start || '')}" ${dis}></label>
          <label>Einde<input type="time" class="form-control js-day-time" data-field="end" value="${escapeHtml(r.end || '')}" ${dis}></label>
          <label>Pauze<input type="number" min="0" step="5" inputmode="numeric" class="form-control js-day-time" data-field="break" value="${Number(r.break) || 0}" ${dis}></label>
          <output class="duration">= ${Math.floor(mins / 60)}u${String(mins % 60).padStart(2, '0')}</output>
        </div>
        <div class="extra-row">
          <button type="button" class="extra-toggle js-break-worked${r.breakWorked ? ' on' : ''}" aria-pressed="${!!r.breakWorked}" ${dis} ${Number(r.break) ? '' : 'disabled title="Deze shift heeft geen pauze"'}>
            <span class="material-icons-outlined" aria-hidden="true">coffee</span>Pauze doorgewerkt
          </button>
          <label class="extra-min">
            <span class="material-icons-outlined" aria-hidden="true">more_time</span>Werkelijk einde
            <input type="time" class="form-control js-day-extra" value="${Number(r.extraMinutes) ? escapeHtml(rowActualEnd(r)) : ''}" aria-label="Werkelijk einduur (als je langer bleef)" ${dis}>
            ${Number(r.extraMinutes) ? `<button type="button" class="btn-icon js-extra-clear" title="Geen extra tijd" aria-label="Werkelijk einde wissen" ${dis}><span class="material-icons-outlined">close</span></button>` : ''}
          </label>
          ${
            extra
              ? `<span class="extra-summary">+${fmtExtra(extra)} extra${
                  Number(r.extraMinutes)
                    ? ` · gepland tot <small>${escapeHtml(r.end || '')}</small>, gebleven tot ${escapeHtml(rowActualEnd(r))}`
                    : ''
                }</span>`
              : `<span class="extra-hint">Langer gebleven? Vul je echte einduur in (gepland tot ${escapeHtml(r.end || '—')}).</span>`
          }
        </div>
      </div>`;
        })
        .join('')
    : '<p class="empty">Nog geen shiften op deze dag.</p>';

  // Notitie (staat bij elke rij van de dag; we tonen die van de eerste)
  const first = dayKeys.length ? md.rows[dayKeys[0]] : null;
  const noteField = document.getElementById('dayEditorNote');
  if (noteField) {
    noteField.value = first ? first.omschrijving || first.description || '' : '';
    noteField.disabled = locked || !first;
  }
  for (const id of ['btnAddExtraShift', 'btnSaveDayEditor']) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = locked;
  }
}

function bindCalendar() {
  const ymOf = key => [Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1];

  // Vorige / volgende maand
  const stepMonth = delta => {
    let y = Number(yearSelectMain.value);
    let m = Number(monthSelectMain.value) + delta;
    if (m < 0) [m, y] = [11, y - 1];
    if (m > 11) [m, y] = [0, y + 1];
    if (![...yearSelectMain.options].some(o => Number(o.value) === y)) {
      const opt = new Option(y, y);
      if (delta < 0) yearSelectMain.prepend(opt);
      else yearSelectMain.append(opt);
    }
    yearSelectMain.value = y;
    monthSelectMain.value = m;
    monthSelectMain.dispatchEvent(new Event('change'));
  };
  document.getElementById('prevMonthBtn')?.addEventListener('click', () => stepMonth(-1));
  document.getElementById('nextMonthBtn')?.addEventListener('click', () => stepMonth(1));

  const list = document.getElementById('dayEditorList');

  // Shift wisselen: uren en project van de nieuwe shift overnemen
  // Tijdvelden pas verwerken als je het veld verlaat: zo blijft de tijdkiezer open
  // terwijl je eerst het uur en daarna de minuten kiest (anders sluit hij na het uur).
  let pendingDayRender = false;
  const onDayEditorChange = e => {
    if (e.type === 'change' && e.target.type === 'time') return;
    if (e.type === 'focusout') {
      if (e.target.type !== 'time') return;
      const row = e.target.closest('.day-item');
      const [yy, mm] = row ? ymOf(row.dataset.key) : [];
      const r0 = row && getCurrentUserData().monthData?.[yy]?.[mm]?.rows?.[row.dataset.key];
      if (!r0) return;
      const current = e.target.classList.contains('js-day-extra')
        ? Number(r0.extraMinutes)
          ? rowActualEnd(r0)
          : ''
        : r0[e.target.dataset.field] || '';
      if (e.target.value === current) return; // niets veranderd
    }
    const item = e.target.closest('.day-item');
    if (!item) return;
    const key = item.dataset.key;
    const [y, m] = ymOf(key);
    if (warnIfLocked(y, m)) return renderDayEditor();
    const md = getCurrentUserData().monthData?.[y]?.[m];
    const r = md?.rows?.[key];
    if (!r) return;

    if (e.target.classList.contains('js-day-shift')) {
      md.rows[key] = rowFromShift(e.target.value, { omschrijving: r.omschrijving || r.description || '' });
      // Extra gewerkte tijd blijft behouden bij het wisselen van shift
      if (r.breakWorked) md.rows[key].breakWorked = true;
      if (Number(r.extraMinutes)) md.rows[key].extraMinutes = Number(r.extraMinutes);
      recalcRowMinutes(md.rows[key]);
      if (r.attachmentURL)
        Object.assign(md.rows[key], {
          attachmentURL: r.attachmentURL,
          attachmentName: r.attachmentName,
          attachmentPath: r.attachmentPath
        });
      toast(`Gewisseld naar ${shiftRealName(e.target.value)}`, 'success');
    } else if (e.target.classList.contains('js-day-time')) {
      const field = e.target.dataset.field;
      const actualBefore = Number(r.extraMinutes) ? rowActualEnd(r) : '';
      r[field] = field === 'break' ? Math.max(0, Number(e.target.value) || 0) : e.target.value;
      // Gepland einde gewijzigd: het werkelijke einde blijft hetzelfde
      if (field === 'end' && actualBefore) {
        const extra = extraFromActualEnd(r.end, actualBefore);
        if (extra) r.extraMinutes = extra;
        else delete r.extraMinutes;
      }
      recalcRowMinutes(r);
    } else if (e.target.classList.contains('js-day-extra')) {
      const extra = extraFromActualEnd(r.end, e.target.value);
      if (extra) r.extraMinutes = extra;
      else delete r.extraMinutes;
      recalcRowMinutes(r);
      if (extra) toast(`Tot ${e.target.value} gebleven: +${fmtExtra(extra)} extra`, 'success');
      else if (e.target.value) toast(`Niet later dan het geplande einde (${r.end}): geen extra tijd`, 'info');
    } else {
      return;
    }
    if (!e.target.classList.contains('js-day-shift')) syncLinkedRows(md, key);
    // Spring je meteen naar een ander veld in de popup? Dan pas hertekenen als je de lijst verlaat,
    // anders sluit de tijdkiezer van dat volgende veld.
    if (e.type === 'focusout' && e.relatedTarget && list.contains(e.relatedTarget)) pendingDayRender = true;
    else renderDayEditor();
    commitMonth(y, m);
  };
  list?.addEventListener('change', onDayEditorChange);
  list?.addEventListener('focusout', e => {
    onDayEditorChange(e);
    if (pendingDayRender && !(e.relatedTarget && list.contains(e.relatedTarget))) {
      pendingDayRender = false;
      renderDayEditor();
    }
  });

  // Duur live bijwerken tijdens het typen
  list?.addEventListener('input', e => {
    const item = e.target.closest('.day-item');
    if (!item || !e.target.matches('.js-day-time, .js-day-extra')) return;
    const val = f => item.querySelector(`[data-field="${f}"]`).value;
    const worked = item.querySelector('.js-break-worked')?.classList.contains('on');
    const extra = extraFromActualEnd(val('end'), item.querySelector('.js-day-extra')?.value || '');
    const out = item.querySelector('.duration');
    const mins = minutesBetween(val('start'), val('end'), worked ? 0 : val('break')) + extra;
    if (out) out.textContent = `= ${Math.floor(mins / 60)}u${String(mins % 60).padStart(2, '0')}`;
  });

  // Werkelijk einde wissen
  list?.addEventListener('click', e => {
    const btn = e.target.closest('.js-extra-clear');
    if (!btn) return;
    e.preventDefault();
    const key = btn.closest('.day-item').dataset.key;
    const [y, m] = ymOf(key);
    if (warnIfLocked(y, m)) return;
    const md = getCurrentUserData().monthData?.[y]?.[m];
    const r = md?.rows?.[key];
    if (!r) return;
    delete r.extraMinutes;
    recalcRowMinutes(r);
    syncLinkedRows(md, key);
    renderDayEditor();
    commitMonth(y, m);
  });

  // Pauze doorgewerkt aan/uit
  list?.addEventListener('click', e => {
    const btn = e.target.closest('.js-break-worked');
    if (!btn) return;
    const key = btn.closest('.day-item').dataset.key;
    const [y, m] = ymOf(key);
    if (warnIfLocked(y, m)) return;
    const r = getCurrentUserData().monthData?.[y]?.[m]?.rows?.[key];
    if (!r) return;
    if (r.breakWorked) delete r.breakWorked;
    else r.breakWorked = true;
    recalcRowMinutes(r);
    syncLinkedRows(getCurrentUserData().monthData[y][m], key);
    toast(
      r.breakWorked ? `Pauze doorgewerkt: +${fmtExtra(Number(r.break) || 0)}` : 'Pauze weer als pauze geteld',
      'success'
    );
    renderDayEditor();
    commitMonth(y, m);
  });

  // Shift verwijderen
  list?.addEventListener('click', e => {
    const btn = e.target.closest('.js-day-remove');
    if (!btn) return;
    const key = btn.closest('.day-item').dataset.key;
    const [y, m] = ymOf(key);
    if (warnIfLocked(y, m)) return;
    const md = getCurrentUserData().monthData?.[y]?.[m];
    if (!md?.rows?.[key]) return;
    const names = removeRowWithLinked(md, key);
    renderDayEditor();
    commitMonth(y, m);
    toast(`${names.join(' + ')} verwijderd`, 'success');
  });

  // Shift toevoegen binnen de dag-popup
  const addForm = document.getElementById('dayAddForm');
  const addShift = document.getElementById('dayAddShift');
  const addStart = document.getElementById('dayAddStart');
  const addEnd = document.getElementById('dayAddEnd');
  const addBreak = document.getElementById('dayAddBreak');
  const addDuration = document.getElementById('dayAddDuration');
  const updateAddDuration = () => showDuration(addDuration, addStart.value, addEnd.value, addBreak.value);
  const fillAddTimes = () => {
    const sh = getCurrentUserData().shifts?.[addShift.value];
    addStart.value = sh?.start || '';
    addEnd.value = sh?.end || '';
    addBreak.value = sh ? Number(sh.break) || 0 : '';
    updateAddDuration();
  };

  document.getElementById('btnAddExtraShift')?.addEventListener('click', () => {
    addShift.innerHTML = shiftOptionsHtml(currentEditingDateKey, '', 'Kies een shift');
    fillAddTimes();
    addForm.classList.remove('d-none');
    document.getElementById('btnAddExtraShift').classList.add('d-none');
    addShift.focus();
  });
  addShift?.addEventListener('change', fillAddTimes);
  [addStart, addEnd, addBreak].forEach(el => el?.addEventListener('input', updateAddDuration));
  const closeAddForm = () => {
    addForm?.classList.add('d-none');
    document.getElementById('btnAddExtraShift')?.classList.remove('d-none');
  };
  document.getElementById('dayAddCancel')?.addEventListener('click', closeAddForm);
  document.getElementById('dayAddConfirm')?.addEventListener('click', () => {
    const baseKey = currentEditingDateKey;
    if (!addShift.value) return toast('Kies eerst een shift', 'warning');
    const [y, m] = ymOf(baseKey);
    if (warnIfLocked(y, m)) return;
    const md = ensureMonthData(getCurrentUserData(), y, m);
    const note = document.getElementById('dayEditorNote')?.value || '';
    const row = rowFromShift(addShift.value, {
      start: addStart.value,
      end: addEnd.value,
      break: Math.max(0, Number(addBreak.value) || 0),
      minutes: minutesBetween(addStart.value, addEnd.value, addBreak.value),
      omschrijving: note
    });
    md.rows[newRowKeyForDay(md, baseKey)] = row;
    const linked = addLinkedShift(md, baseKey, row);
    closeAddForm();
    renderDayEditor();
    commitMonth(y, m);
    toast(`${shiftRealName(addShift.value)}${linked ? ` + ${linked}` : ''} toegevoegd`, 'success');
  });
  document.getElementById('dayEditorModal')?.addEventListener('hidden.bs.modal', closeAddForm);

  // Notitie bewaren bij alle shiften van die dag (meteen bij verlaten van het veld en via de knop)
  const saveNote = () => {
    const baseKey = currentEditingDateKey;
    if (!baseKey) return;
    const [y, m] = ymOf(baseKey);
    if (isMonthLocked(y, m)) return;
    const md = getCurrentUserData().monthData?.[y]?.[m];
    if (!md) return;
    const note = document.getElementById('dayEditorNote')?.value || '';
    let changed = false;
    listDayKeys(md, baseKey).forEach(k => {
      const r = md.rows[k];
      if (!r?.shift?.trim()) {
        delete md.rows[k]; // lege regel opruimen
        changed = true;
      } else if ((r.omschrijving || r.description || '') !== note || 'description' in r) {
        r.omschrijving = note;
        delete r.description; // oud veld (vroeger gebruikt door de kalender)
        changed = true;
      }
    });
    if (changed) commitMonth(y, m);
  };
  document.getElementById('dayEditorNote')?.addEventListener('change', saveNote);
  document.getElementById('btnSaveDayEditor')?.addEventListener('click', () => {
    saveNote();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('dayEditorModal')).hide();
  });
}

// ======================================================================
// §14  INVOER — TABEL
// Lijstweergave van de maand (rij per dag).
// ======================================================================

/**
 * Tabel van de maand (rij per dag, met dropdowns). Werkt ook de kalender,
 * tellers en vergrendeling bij. De tabel zelf zit in een (ingeklapte) collapse.
 */
async function renderMonth(year, month) {
  const ud = getCurrentUserData();
  const md = ensureMonthData(ud, year, month);
  let changed = false; // alleen opslaan als er automatisch iets aangevuld werd

  const selectedProject = projectFilterSelect.value || '';
  tbody.innerHTML = '';

  monthTargetHours.value = md.targetHours || 0;
  monthTargetMinutes.value = md.targetMinutes || 0;

  // Op slot = ingediend/goedgekeurd (admins mogen altijd bewerken)
  const locked = isMonthLocked(year, month);

  // +/− kolom tonen als: niet op slot EN (maand-instelling of een project staat extra regels toe)
  const showActions = !locked && (userAllowsMultiMonth(ud, year, month) || (ud.projects || []).some(p => p.allowMulti));

  // Zorg dat de kolom-header ook zichtbaar wordt
  const th = document.getElementById('thActions');
  if (th) th.classList.toggle('d-none', !showActions);

  // De tabel (lijstweergave) is ingeklapt: alleen opbouwen als ze open staat (veel sneller)
  const tableVisible = document.getElementById('collapseTable')?.classList.contains('show');

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const baseKey = dateKey(year, month, d);

    if (md.rows[baseKey] && autoAssignProjectIfNeeded(md.rows[baseKey])) changed = true;
    if (!tableVisible) continue;

    // Lege dag → één lege regel tonen zodat je kan typen
    let allKeys = listDayKeys(md, baseKey);
    if (allKeys.length === 0) allKeys = [baseKey];

    // Filter per project (zichtbare lijst)
    const visibleKeys = allKeys.filter(k => {
      const r = md.rows[k];
      if (!selectedProject) return true;
      return (r.project || '') === selectedProject;
    });

    const renderKeys = visibleKeys.length ? visibleKeys : selectedProject ? [] : allKeys;

    for (let idx = 0; idx < renderKeys.length; idx++) {
      const rowKey = renderKeys[idx];

      // Bestaat de rij nog niet: leeg sjabloon (lege tijden i.p.v. 00:00)
      const r = md.rows[rowKey] || {
        project: '',
        shift: '',
        start: '',
        end: '',
        break: 0,
        omschrijving: '',
        minutes: 0
      };

      const dayName = daysFull[new Date(year, month, d).getDay()];

      // Rechten voor + op deze specifieke rij
      const allowByMonth = userAllowsMultiMonth(ud, year, month);
      const allowByProject = r.project ? canAddMultiForProject(r.project) : false;
      const allowThisRow = allowByMonth || allowByProject;

      const tr = document.createElement('tr');

      // HTML voor de knoppen (+ of -)
      const actionsCell = showActions
        ? idx === 0
          ? `<td class="actions-cell">
                 <button type="button" class="btn btn-outline-success btn-line addLineBtn" ${allowThisRow ? '' : 'disabled'} title="Extra regel toevoegen">+</button>
               </td>`
          : `<td class="actions-cell">
                 <button type="button" class="btn btn-outline-danger btn-line delLineBtn" title="Deze regel verwijderen">−</button>
               </td>`
        : '';

      // Status icoon logica
      let statusIconHtml = '<span class="shift-status-icon d-none"></span>';
      if (r.status === 'pending') {
        statusIconHtml =
          '<span class="material-icons-outlined shift-status-icon status-pending" title="In aanvraag">hourglass_top</span>';
      } else if (r.status === 'approved') {
        statusIconHtml =
          '<span class="material-icons-outlined shift-status-icon status-approved" title="Goedgekeurd">check_circle</span>';
      } else if (r.status === 'rejected') {
        statusIconHtml =
          '<span class="material-icons-outlined shift-status-icon status-rejected" title="Afgekeurd">cancel</span>';
      }
      const durationText = rowDurationText(r);

      tr.innerHTML = `
        ${actionsCell}
        <td>${idx === 0 ? dayName : ''}</td>
        <td>${idx === 0 ? `${String(d).padStart(2, '0')}-${String(month + 1).padStart(2, '0')}-${year}` : ''}</td>
        <td><select class="form-select form-select-sm projectSelect"></select></td>
        <td class="d-flex align-items-center gap-1">
          <select class="form-select form-select-sm shiftSelect"></select>
          ${statusIconHtml}
        </td>
        <td><input class="form-control form-control-sm startInput" type="time" value="${escapeHtml(r.start)}"></td>
        <td><input class="form-control form-control-sm endInput" type="time" value="${escapeHtml(r.end)}"></td>
        <td><input class="form-control form-control-sm breakInput" type="number" min="0" value="${Number(r.break) || 0}"></td>
        <td class="d-flex align-items-center gap-1">
            <input class="form-control form-control-sm omschrijvingInput" type="text" value="${escapeHtml(r.omschrijving || r.description || '')}">
            <span 
                class="material-icons-outlined attachment-icon ${r.attachmentURL ? 'has-attachment' : ''}" 
                title="Bijlage beheren" 
                data-key="${rowKey}" 
                data-bs-toggle="modal" 
                data-bs-target="#attachmentModal">
                ${r.attachmentURL ? 'attach_file' : 'attachment'}
            </span>
        </td>
        <td class="dur text-mono">${durationText}</td>`;
      tbody.appendChild(tr);

      // --- Project dropdown ---
      const projSel = tr.querySelector('.projectSelect');
      projSel.innerHTML = '<option value="">--</option>';
      (ud.projects || []).forEach(p => {
        if (isDateWithin(baseKey, p.start || null, p.end || null)) {
          const o = document.createElement('option');
          o.value = p.name;
          o.textContent = p.name;
          projSel.appendChild(o);
        }
      });
      if (r.project) projSel.value = r.project;

      projSel.addEventListener('change', async () => {
        r.project = projSel.value || '';
        saveCell(year, month, rowKey, r, tr);
        await populateShiftSelectForRow(tr, rowKey);
        updateInputTotals();
        debouncedSave();
        renderHistory();

        // Check of de + knop nu aan/uit moet (afhankelijk van projectrechten)
        const addBtn = tr.querySelector('.addLineBtn');
        if (addBtn) {
          const allowByMonth = userAllowsMultiMonth(getCurrentUserData(), year, month);
          const allowByProject = r.project ? canAddMultiForProject(r.project) : false;
          addBtn.disabled = !(allowByMonth || allowByProject);
        }
      });

      await populateShiftSelectForRow(tr, rowKey);

      // Start / einde / pauze aanpassen
      const onTimeChange = (field, value) => {
        r[field] = field === 'break' ? Number(value) || 0 : value;
        recalcRowMinutes(r);
        saveCell(year, month, rowKey, r, tr);
        const mdSync = getCurrentUserData().monthData?.[year]?.[month];
        if (syncLinkedRows(mdSync, rowKey).length) renderMonth(year, month);
        tr.querySelector('.dur').textContent = rowDurationText(r);
        updateInputTotals();
        debouncedSave();
        renderHistory();
      };
      tr.querySelector('.startInput').addEventListener('change', e => onTimeChange('start', e.target.value));
      tr.querySelector('.endInput').addEventListener('change', e => onTimeChange('end', e.target.value));
      tr.querySelector('.breakInput').addEventListener('change', e => onTimeChange('break', e.target.value));
      tr.querySelector('.omschrijvingInput').addEventListener('change', e => {
        r.omschrijving = e.target.value;
        saveCell(year, month, rowKey, r, tr);
        debouncedSave();
        renderHistory();
      });

      // --- Knoppen acties ---
      const addBtn = tr.querySelector('.addLineBtn');
      if (addBtn) {
        addBtn.addEventListener('click', async e => {
          e.preventDefault();
          // Nieuwe lege regel op dezelfde dag (tijden leeg laten)
          md.rows[`${baseKey}#${nextLineIndex(md, baseKey)}`] = {
            project: r.project,
            shift: '',
            start: '',
            end: '',
            break: 0,
            omschrijving: '',
            minutes: 0
          };
          await saveUserData();
          renderMonth(year, month);
          updateInputTotals();
          renderHistory();
        });
      }

      const delBtn = tr.querySelector('.delLineBtn');
      if (delBtn) {
        delBtn.addEventListener('click', async e => {
          e.preventDefault();
          removeRowWithLinked(md, rowKey);
          await saveMonth(year, month);
          renderMonth(year, month);
          updateInputTotals();
          renderHistory();
        });
      }
    }
  }

  if (changed) saveMonth(year, month);
  renderCalendarGrid(year, month);
  updateInputTotals();
  renderHome();

  // Vergrendelen voor gewone gebruikers als de maand ingediend/goedgekeurd is
  tbody.querySelectorAll('select, input').forEach(el => (el.disabled = locked));
  monthTargetHours.disabled = locked;
  monthTargetMinutes.disabled = locked;

  const excludeToggle = document.getElementById('excludeHistoryToggle');
  if (excludeToggle) {
    excludeToggle.checked = md.excludeFromHistory === true;
    excludeToggle.disabled = locked;
  }

  updateMonthStatusBadge();
}

/** Duur-tekst voor een rij (verlof in aanvraag/afgekeurd telt als 0). */
function rowDurationText(r) {
  if (r.status && r.status !== 'approved') return '0u 0min';
  const mins = Number(r.minutes) || 0;
  const extra = rowExtraMinutes(r);
  return `${Math.floor(mins / 60)}u ${mins % 60}min${extra ? ` (+${fmtExtra(extra)} extra)` : ''}`;
}

/** Shift-dropdown van één tabelrij vullen en de keuze verwerken (tijden, project, verlofstatus). */
async function populateShiftSelectForRow(tr, rowKey) {
  const base = rowKey.slice(0, 10); // YYYY-MM-DD (zonder '#2' of '_…')
  const year = Number(base.slice(0, 4));
  const month = Number(base.slice(5, 7)) - 1;

  const ud = getCurrentUserData();
  const md = ud.monthData?.[year]?.[month];
  // Lege dag: tijdelijk object (wordt pas bewaard als er iets gekozen wordt)
  const r = md?.rows?.[rowKey] || { shift: '' };

  const projSel = tr.querySelector('.projectSelect');
  const sel = tr.querySelector('.shiftSelect');

  if (!sel) return;

  sel.innerHTML = '<option value=""></option>';

  const all = ud.shifts || {};
  const order = ud.shiftOrder || Object.keys(all);
  const entries = order.map(n => [n, all[n]]).filter(([, sh]) => !!sh);

  for (const [name, sh] of entries) {
    // Check datum geldigheid
    if (!isDateWithin(base, sh.startDate || null, sh.endDate || null)) continue;

    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = sh.realName || name;

    // Alleen selecteren als r.shift bestaat
    if (r.shift === name) opt.selected = true;

    sel.appendChild(opt);
  }
  sel.addEventListener('change', async () => {
    const chosen = sel.value; // shift-sleutel, bv. "Vroege (Google)"

    if (!chosen) {
      r.shift = '';
      r.project = '';
      projSel.value = '';
      delete r.status;
      saveCell(year, month, rowKey, r, tr);
      debouncedSave();
      updateInputTotals();
      renderHistory();
      return;
    }

    r.shift = chosen;
    debouncedSave();

    // Verlof: admin keurt meteen goed, gewone gebruiker vraagt aan
    const shObj = all[chosen];
    const realName = shiftRealName(chosen, ud);
    if (LEAVE_TYPES.includes(realName)) {
      if (isAdmin()) {
        r.status = 'approved';
      } else {
        r.status = 'pending';
        try {
          await notifyAdminOfPendingLeave(getActiveUserId(), year, month, rowKey, r);
        } catch (e) {
          console.warn('Kon admin niet live notificeren over verlof', e);
        }
      }
    } else {
      delete r.status;
    }

    // Status-icoon bijwerken
    const iconSpan = tr.querySelector('.shift-status-icon');
    if (iconSpan) {
      if (r.status === 'pending') {
        iconSpan.className = 'material-icons-outlined shift-status-icon status-pending';
        iconSpan.textContent = 'hourglass_top';
        iconSpan.title = 'In aanvraag';
      } else if (r.status === 'approved') {
        iconSpan.className = 'material-icons-outlined shift-status-icon status-approved';
        iconSpan.textContent = 'check_circle';
        iconSpan.title = 'Goedgekeurd';
      } else if (r.status === 'rejected') {
        iconSpan.className = 'material-icons-outlined shift-status-icon status-rejected';
        iconSpan.textContent = 'cancel';
        iconSpan.title = 'Afgekeurd';
      } else {
        iconSpan.className = 'shift-status-icon d-none';
        iconSpan.textContent = '';
        iconSpan.title = '';
      }
    }

    // Project: Bench → geen project, vaste koppelingen (Verlof → Eght Care, …), anders project van de shift
    const special = autoProjectForShift(realName);
    if (realName === 'Bench') {
      r.project = '';
    } else if (special) {
      ensureProjectExists(special);
      r.project = special;
    } else {
      if (shObj && shObj.project) {
        const p = (ud.projects || []).find(px => px.name === shObj.project);
        if (p && isDateWithin(base, p.start || null, p.end || null)) {
          r.project = p.name;
        }
      }
    }

    // Project dropdown herladen
    projSel.innerHTML = '<option value="">--</option>';
    (getCurrentUserData().projects || []).forEach(p => {
      if (isDateWithin(base, p.start || null, p.end || null)) {
        const o = document.createElement('option');
        o.value = p.name;
        o.textContent = p.name;
        projSel.appendChild(o);
      }
    });
    setTimeout(() => {
      projSel.value = r.project || '';
    }, 50);

    // Tijden invullen
    if (shObj) {
      r.start = shObj.start || '00:00';
      r.end = shObj.end || '00:00';
      r.break = Number(shObj.break) || 0;
    }
    recalcRowMinutes(r);

    tr.querySelector('.startInput').value = r.start;
    tr.querySelector('.endInput').value = r.end;
    tr.querySelector('.breakInput').value = r.break;

    tr.querySelector('.dur').textContent = rowDurationText(r);

    saveCell(year, month, rowKey, r, tr);
    debouncedSave();
    updateInputTotals();
    renderHistory();

    const addBtn = tr.querySelector('.addLineBtn');
    if (addBtn) {
      const allowByMonth = userAllowsMultiMonth(getCurrentUserData(), year, month);
      const allowByProject = r.project ? canAddMultiForProject(r.project) : false;
      addBtn.disabled = !(allowByMonth || allowByProject);
    }
  });
}

// ======================================================================
// §15  INVOER — SNELLE INVOER & MEERDERE DAGEN
// Snelle invoer-popup en meerdere dagen tegelijk invullen.
// ======================================================================

/** Shiften die op een datum geldig zijn (shiften met een periode eerst). */
function shiftsValidOn(dates) {
  const ud = getCurrentUserData();
  const all = ud.shifts || {};
  const entries = (ud.shiftOrder || Object.keys(all)).filter(k => all[k]).map(k => [k, all[k]]);
  const hasPeriod = ([, sh]) => !!(sh.startDate || sh.endDate);
  return [...entries.filter(hasPeriod), ...entries.filter(e => !hasPeriod(e))].filter(
    ([, sh]) =>
      (!sh.startDate && !sh.endDate) || dates.some(d => isDateWithin(d, sh.startDate || null, sh.endDate || null))
  );
}

function fillShiftSelect(select, entries, placeholder) {
  select.innerHTML = `<option value="">${placeholder}</option>`;
  entries.forEach(([key, sh]) => {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = sh.realName && sh.realName !== key ? `${sh.realName} (${sh.project || 'geen project'})` : key;
    select.appendChild(o);
  });
}

/** Snelle invoer: shift-lijst voor de gekozen datum. */
function populateQuickShifts() {
  const dateStr = quickDate.value;
  if (!dateStr) {
    quickShift.innerHTML = '<option value="">-- Kies shift --</option>';
    return;
  }
  fillShiftSelect(quickShift, shiftsValidOn([dateStr]), '-- Kies shift --');
}

/** Meerdere dagen: shiften die op minstens één gekozen dag geldig zijn. */
function populateMultiDayShifts(selectedDates = []) {
  const sel = document.getElementById('multiShiftName');
  if (sel) fillShiftSelect(sel, shiftsValidOn(selectedDates), 'Kies shift');
}

/** Datums (YYYY-MM-DD) in de gekozen maand waarop al een shift staat. */
function getPlannedDates() {
  const md = getCurrentUserData().monthData?.[Number(yearSelectMain.value)]?.[Number(monthSelectMain.value)];
  const set = new Set();
  for (const [k, r] of Object.entries(md?.rows || {})) {
    const shiftName = (r?.shift || '').trim();
    if (shiftName && shiftName.toLowerCase() !== 'niet ingepland') set.add(k.slice(0, 10));
  }
  return [...set];
}

/** Kleurt in de datumkiezer de dagen die al een shift hebben. */
function highlightPlannedDays(inst, plannedDates = []) {
  if (!inst?.daysContainer) return;
  inst.daysContainer.querySelectorAll('.flatpickr-day').forEach(d => {
    if (!d.dateObj) return;
    const iso = dateKey(d.dateObj.getFullYear(), d.dateObj.getMonth(), d.dateObj.getDate());
    d.classList.toggle('planned-day', plannedDates.includes(iso));
  });
}

/** Datumkiezer (meerdere dagen) voor de gekozen maand. */
function initMultiDayPicker() {
  const year = Number(yearSelectMain.value);
  const month = Number(monthSelectMain.value);
  if (window.multiDayPicker) window.multiDayPicker.destroy();

  window.multiDayPicker = flatpickr('#multiShiftDays', {
    static: true,
    mode: 'multiple',
    dateFormat: 'd-m-Y',
    altInput: true,
    altFormat: 'd F Y',
    locale: flatpickr.l10ns.nl,
    weekNumbers: true,
    minDate: new Date(year, month, 1),
    maxDate: new Date(year, month + 1, 0),
    disableMobile: true,
    defaultDate: [],
    onReady(_, __, inst) {
      setTimeout(() => highlightPlannedDays(inst, getPlannedDates()), 50);
    },
    onMonthChange(_, __, inst) {
      highlightPlannedDays(inst, getPlannedDates());
    },
    onChange(selectedDates) {
      populateMultiDayShifts(selectedDates.map(d => dateKey(d.getFullYear(), d.getMonth(), d.getDate())));
    }
  });
}

/** Snelle invoer openen (standaard voor vandaag, of de getoonde maand als je elders kijkt). */
function openQuickInput(dateISO) {
  if (!dateISO) {
    const today = todayISO();
    const shown = dateKey(Number(yearSelectMain.value), Number(monthSelectMain.value), 1);
    dateISO = today.slice(0, 7) === shown.slice(0, 7) || !yearSelectMain.value ? today : shown;
  }
  quickDate.value = dateISO;
  document.getElementById('quickNote').value = '';
  populateQuickShifts();
  fillQuickTimes();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('quickModal')).show();
}

/** Uren van de gekozen shift invullen in de snelle invoer (aanpasbaar). */
function fillQuickTimes() {
  const sh = getCurrentUserData().shifts?.[quickShift.value];
  document.getElementById('quickStart').value = sh?.start || '';
  document.getElementById('quickEnd').value = sh?.end || '';
  document.getElementById('quickBreak').value = sh ? Number(sh.break) || 0 : '';
  updateQuickDuration();
}

function updateQuickDuration() {
  showDuration(
    document.getElementById('quickDuration'),
    document.getElementById('quickStart').value,
    document.getElementById('quickEnd').value,
    document.getElementById('quickBreak').value
  );
}

function bindQuickInput() {
  quickDate.addEventListener('change', () => {
    const previous = quickShift.value;
    populateQuickShifts();
    if ([...quickShift.options].some(o => o.value === previous)) quickShift.value = previous;
    fillQuickTimes();
  });
  quickShift.addEventListener('change', fillQuickTimes);
  ['quickStart', 'quickEnd', 'quickBreak'].forEach(id =>
    document.getElementById(id)?.addEventListener('input', updateQuickDuration)
  );

  // Snelle invoer opslaan (voegt een shift toe; bestaande shiften op die dag blijven staan)
  document.getElementById('saveQuickBtn')?.addEventListener('click', () => {
    const date = quickDate.value;
    const shift = quickShift.value;
    const note = document.getElementById('quickNote').value;
    if (!date || !shift) return toast('Kies een datum en een shift', 'warning');

    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7)) - 1;
    if (warnIfLocked(y, m)) return;
    const ud = getCurrentUserData();
    if (!ud.shifts?.[shift]) return toast('Deze shift bestaat niet meer', 'danger');

    const start = document.getElementById('quickStart').value;
    const end = document.getElementById('quickEnd').value;
    const brk = Math.max(0, Number(document.getElementById('quickBreak').value) || 0);
    if (!start || !end) return toast('Vul een start- en einduur in', 'warning');

    const md = ensureMonthData(ud, y, m);
    const row = rowFromShift(shift, {
      start,
      end,
      break: brk,
      minutes: minutesBetween(start, end, brk),
      omschrijving: note
    });
    md.rows[newRowKeyForDay(md, date)] = row;
    const linked = addLinkedShift(md, date, row, ud);

    bootstrap.Modal.getInstance(document.getElementById('quickModal'))?.hide();
    toast(`${shiftRealName(shift, ud)}${linked ? ` + ${linked}` : ''} toegevoegd op ${toDisplayDate(date)}`, 'success');
    commitMonth(y, m);
  });

  // "Meerdere dagen"-popup openen
  document.getElementById('multiDayShiftBtn')?.addEventListener('click', () => {
    populateMultiDayShifts();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('multiDayModal')).show();
    setTimeout(initMultiDayPicker, 150); // pas na het openen, anders tekent de kiezer verkeerd
  });

  // Meerdere dagen opslaan (vervangt de hoofdshift van die dagen)
  document.getElementById('saveMultiShift')?.addEventListener('click', async () => {
    try {
      const ud = getCurrentUserData();
      const selectedShift = document.getElementById('multiShiftName').value;
      if (!selectedShift) return toast('Kies eerst een shift', 'warning');
      if (!ud.shifts?.[selectedShift]) return toast('Shift niet gevonden', 'danger');

      // flatpickr geeft "d-m-Y, d-m-Y, …"
      const selectedDates = (document.getElementById('multiShiftDays').value || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean)
        .map(fromDisplayDate);
      if (selectedDates.length === 0) return toast('Kies minstens één dag', 'warning');

      const touched = new Set();
      for (const iso of selectedDates) {
        const y = Number(iso.slice(0, 4));
        const m = Number(iso.slice(5, 7)) - 1;
        if (isMonthLocked(y, m)) continue;
        const md = ensureMonthData(ud, y, m);
        md.rows[iso] = rowFromShift(selectedShift);
        addLinkedShift(md, iso, md.rows[iso], ud);
        touched.add(`${y}-${m}`);
      }
      if (!touched.size) return warnIfLocked(Number(yearSelectMain.value), Number(monthSelectMain.value));

      toast(`${shiftRealName(selectedShift, ud)} ingevuld op ${selectedDates.length} dag(en)`, 'success');
      bootstrap.Modal.getOrCreateInstance(document.getElementById('multiDayModal')).hide();
      for (const ym of touched) {
        const [y, m] = ym.split('-').map(Number);
        commitMonth(y, m);
      }
    } catch (err) {
      console.error(err);
      toast('Er ging iets mis bij opslaan', 'danger');
    }
  });
}

// ======================================================================
// §16  INVOER — VERFMODUS & SCREENSHOT
// Dagen "inkleuren" met favoriete shiften en de kalender als afbeelding bewaren.
// ======================================================================

/** Palet onderaan het scherm voor de verfmodus. */
function initPaintModeUI() {
  if (document.getElementById('paintPalette')) return;
  const palette = document.createElement('div');
  palette.id = 'paintPalette';
  palette.setAttribute('aria-label', 'Verfmodus');
  document.body.appendChild(palette);
}

/** Verfmodus aan/uit. Aan = klikken op een dag zet de gekozen favoriete shift (of wist de dag). */
function togglePaintMode() {
  isPaintMode = !isPaintMode;
  const palette = document.getElementById('paintPalette');
  const btn = document.getElementById('togglePaintBtn');
  btn?.classList.toggle('active', isPaintMode);
  palette.classList.toggle('active', isPaintMode);
  document.body.classList.toggle('paint-mode', isPaintMode);

  if (!isPaintMode) {
    selectedPaintShiftKey = null;
    refreshCalendarIfVisible();
    return;
  }

  // Favorieten die (deels) geldig zijn in de getoonde maand
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const monthStart = dateKey(y, m, 1);
  const monthEnd = dateKey(y, m, new Date(y, m + 1, 0).getDate());
  const ud = getCurrentUserData();
  const allShifts = ud.shifts || {};
  const favs = (ud.shiftOrder || Object.keys(allShifts)).filter(k => {
    const sh = allShifts[k];
    return sh?.isFavorite && !(sh.startDate && sh.startDate > monthEnd) && !(sh.endDate && sh.endDate < monthStart);
  });

  palette.innerHTML = '';
  const addOption = (key, html, bg, title) => {
    const el = document.createElement('div');
    el.className = 'paint-option';
    el.style.background = bg;
    el.innerHTML = html;
    el.title = title;
    el.onclick = () => selectPaintOption(key, el);
    palette.appendChild(el);
    return el;
  };
  const eraser = addOption('eraser', '🗑️', 'var(--surface-2)', 'Dag wissen');
  const options = favs.map(k =>
    addOption(k, SHIFT_ICONS[allShifts[k].icon] || '⭐', allShifts[k].color || '#eee', allShifts[k].realName || k)
  );

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'btn btn-primary btn-sm paint-done';
  done.textContent = 'Klaar';
  done.onclick = togglePaintMode;
  palette.appendChild(done);

  // Standaard de eerste favoriet kiezen (anders de gom)
  if (options.length) selectPaintOption(favs[0], options[0]);
  else selectPaintOption('eraser', eraser);

  showTab('#tab-invoer');
  refreshCalendarIfVisible();
  toast(
    favs.length
      ? 'Verfmodus: kies een shift onderaan en tik op dagen.'
      : 'Verfmodus: markeer eerst shiften als favoriet (bij Shiften) om ze hier te zien.',
    'info'
  );
}

function selectPaintOption(key, element) {
  selectedPaintShiftKey = key;
  document.querySelectorAll('.paint-option').forEach(el => el.classList.remove('selected'));
  element.classList.add('selected');
}

/** Verfmodus: klik op een dag → gekozen shift wordt de (eerste) shift van die dag, of de dag wordt gewist. */
async function applyPaintShift(baseKey) {
  if (!selectedPaintShiftKey) return;
  const y = Number(baseKey.slice(0, 4));
  const m = Number(baseKey.slice(5, 7)) - 1;
  if (warnIfLocked(y, m)) return;
  const ud = getCurrentUserData();
  const md = ensureMonthData(ud, y, m);
  const keys = listDayKeys(md, baseKey);

  if (selectedPaintShiftKey === 'eraser') {
    keys.forEach(k => delete md.rows[k]);
  } else {
    if (!ud.shifts?.[selectedPaintShiftKey]) return;
    const targetKey = keys[0] || baseKey;
    const note = md.rows[targetKey]?.omschrijving || md.rows[targetKey]?.description || '';
    const link = ud.shifts[selectedPaintShiftKey].linkedShift;
    // Gekoppelde shift: de dag wordt precies "hoofdshift + gekoppelde shift"
    if (link && ud.shifts[link]) keys.forEach(k => delete md.rows[k]);
    md.rows[link && ud.shifts[link] ? baseKey : targetKey] = rowFromShift(selectedPaintShiftKey, {
      omschrijving: note
    });
    addLinkedShift(md, baseKey, md.rows[link && ud.shifts[link] ? baseKey : targetKey], ud);
  }

  await commitMonth(y, m);
}

/**
 * html2canvas kent geen moderne kleurnotaties (color-mix → "color(srgb …)").
 * In de kopie voor de schermafbeelding zetten we die om naar gewone rgba().
 */
const COLOR_PROPS = [
  'color',
  'background-color',
  'background-image',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'box-shadow',
  'text-decoration-color'
];
function toRgba(value) {
  return value.replace(
    /color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+))?\)/g,
    (_, r, g, b, a) => {
      const c = v => Math.round(Math.min(1, Math.max(0, Number(v))) * 255);
      return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${a === undefined ? 1 : Number(a)})`;
    }
  );
}
function flattenModernColors(doc) {
  const view = doc.defaultView;
  doc.querySelectorAll('*').forEach(el => {
    const cs = view.getComputedStyle(el);
    COLOR_PROPS.forEach(prop => {
      const v = cs.getPropertyValue(prop);
      if (v && /color\(|color-mix|oklch|oklab|lab\(|lch\(/.test(v)) {
        const fixed = toRgba(v);
        const fallback = prop === 'background-image' || prop === 'box-shadow' ? 'none' : 'transparent';
        el.style.setProperty(prop, /color\(|color-mix|okl|lab\(|lch\(/.test(fixed) ? fallback : fixed, 'important');
      }
    });
  });
}

/** html2canvas pas laden wanneer het nodig is. */
function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/** Kalender als PNG downloaden (met titel, zonder iconen en zonder "vandaag"-markering). */
async function takeScreenshot() {
  const grid = document.getElementById('monthlyCalendarGrid');
  if (!grid) return;
  const titleText = `${monthsFull[Number(monthSelectMain.value)]} ${yearSelectMain.value}`;
  toast('Afbeelding maken...', 'info');

  const originalOverflow = grid.style.overflow;
  grid.style.overflow = 'visible';
  try {
    await loadHtml2Canvas();
    const canvas = await window.html2canvas(grid, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      onclone: clonedDoc => {
        flattenModernColors(clonedDoc);
        clonedDoc.querySelectorAll('.quick-icons-wrapper').forEach(el => (el.style.display = 'none'));
        clonedDoc.querySelector('.calendar-day.today')?.classList.remove('today');

        const titleDiv = clonedDoc.createElement('div');
        titleDiv.innerText = titleText;
        Object.assign(titleDiv.style, {
          gridColumn: '1 / -1',
          textAlign: 'center',
          fontSize: '24px',
          fontWeight: 'bold',
          marginBottom: '15px',
          padding: '10px',
          color: '#333',
          fontFamily: 'sans-serif'
        });
        const clGrid = clonedDoc.getElementById('monthlyCalendarGrid');
        clGrid.insertBefore(titleDiv, clGrid.firstChild);
      }
    });

    const link = document.createElement('a');
    link.download = `Rooster-${titleText.replace(/ /g, '-')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('Afbeelding gedownload!', 'success');
  } catch (err) {
    console.error(err);
    toast('Afbeelding maken mislukt', 'danger');
  } finally {
    grid.style.overflow = originalOverflow;
  }
}

function bindPaint() {
  initPaintModeUI();
  document.getElementById('togglePaintBtn')?.addEventListener('click', togglePaintMode);
  document.getElementById('btnScreenshot')?.addEventListener('click', takeScreenshot);

  // Verfmodus uit bij het wisselen van maand of jaar
  const turnOffPaint = () => {
    if (isPaintMode) togglePaintMode();
  };
  monthSelectMain?.addEventListener('change', turnOffPaint);
  yearSelectMain?.addEventListener('change', turnOffPaint);
}

// ======================================================================
// §17  BIJLAGEN
// Bijlage per shift uploaden, downloaden en verwijderen.
// ======================================================================

const attachmentModal = document.getElementById('attachmentModal');
const currentAttachmentBox = document.getElementById('currentAttachmentBox');
const currentAttachmentName = document.getElementById('currentAttachmentName');
const downloadAttachmentBtn = document.getElementById('downloadAttachmentBtn');
const deleteAttachmentBtn = document.getElementById('deleteAttachmentBtn');
const uploadAttachmentBox = document.getElementById('uploadAttachmentBox');
const uploadBoxLabel = document.getElementById('uploadBoxLabel');
const attachmentUploadInput = document.getElementById('attachmentUploadInput');
const uploadAttachmentBtn = document.getElementById('uploadAttachmentBtn');
const progressContainer = document.getElementById('attachmentUploadProgressContainer');
const progressBar = document.getElementById('attachmentUploadProgress');

let currentRowKey = null; // rij waarvan de bijlage-popup open staat

function attachmentRow() {
  if (!currentRowKey) return {};
  const y = Number(currentRowKey.slice(0, 4));
  const m = Number(currentRowKey.slice(5, 7)) - 1;
  return { y, m, r: getCurrentUserData().monthData?.[y]?.[m]?.rows?.[currentRowKey] };
}

function bindAttachments() {
  // Popup openen: tonen wat er al is
  attachmentModal?.addEventListener('show.bs.modal', e => {
    currentRowKey = e.relatedTarget?.dataset?.key || null;
    const { r } = attachmentRow();

    attachmentUploadInput.value = null;
    uploadAttachmentBtn.classList.add('d-none');
    progressContainer.classList.add('d-none');
    progressBar.style.width = '0%';

    const hasAttachment = !!r?.attachmentURL;
    currentAttachmentBox.classList.toggle('d-none', !hasAttachment);
    uploadAttachmentBox.classList.toggle('d-none', hasAttachment);
    if (hasAttachment) {
      currentAttachmentName.textContent = r.attachmentName || 'Bijlage';
      downloadAttachmentBtn.href = r.attachmentURL;
    } else {
      uploadBoxLabel.textContent = r
        ? 'Nog geen bijlage. Kies een bestand (max 5MB):'
        : 'Kies eerst een shift voor deze dag; daarna kan je een bijlage toevoegen.';
      attachmentUploadInput.disabled = !r;
    }
  });

  attachmentUploadInput?.addEventListener('change', () => {
    const hasFile = attachmentUploadInput.files.length > 0;
    uploadAttachmentBtn.classList.toggle('d-none', !hasFile);
    if (hasFile) uploadBoxLabel.textContent = `Geselecteerd: ${attachmentUploadInput.files[0].name}`;
  });

  // Uploaden
  uploadAttachmentBtn?.addEventListener('click', () => {
    const file = attachmentUploadInput.files[0];
    const { y, m, r } = attachmentRow();
    if (!file || !r) return;
    if (file.size > 5 * 1024 * 1024) return toast('Bestand is te groot (max 5MB)', 'danger');

    const filePath = `attachments/${currentUserId}/${currentRowKey}/${file.name}`;
    progressContainer.classList.remove('d-none');
    uploadAttachmentBtn.classList.add('d-none');

    const uploadTask = uploadBytesResumable(ref(storage, filePath), file);
    uploadTask.on(
      'state_changed',
      snapshot => {
        progressBar.style.width = (snapshot.bytesTransferred / snapshot.totalBytes) * 100 + '%';
      },
      error => {
        console.error('Upload fout:', error);
        toast('Upload mislukt', 'danger');
        progressContainer.classList.add('d-none');
      },
      async () => {
        r.attachmentURL = await getDownloadURL(uploadTask.snapshot.ref);
        r.attachmentName = file.name;
        r.attachmentPath = filePath; // nodig om later correct te verwijderen
        await saveUserData();
        toast('Bijlage opgeslagen!', 'success');
        await renderMonth(y, m);
        bootstrap.Modal.getInstance(attachmentModal)?.hide();
      }
    );
  });

  // Verwijderen
  deleteAttachmentBtn?.addEventListener('click', async () => {
    const { y, m, r } = attachmentRow();
    if (!r?.attachmentURL) return;
    if (!confirm('Weet je zeker dat je deze bijlage wilt verwijderen?')) return;

    const filePath = r.attachmentPath || `attachments/${currentUserId}/${currentRowKey}/${r.attachmentName}`;
    try {
      await deleteObject(ref(storage, filePath));
    } catch (err) {
      // Bestand al weg? Dan toch de verwijzing opruimen.
      if (err?.code !== 'storage/object-not-found') {
        console.error('Verwijderfout:', err);
        return toast('Verwijderen mislukt', 'danger');
      }
    }
    delete r.attachmentURL;
    delete r.attachmentName;
    delete r.attachmentPath;
    await saveMonth(y, m);

    toast('Bijlage verwijderd', 'success');
    await renderMonth(y, m);
    bootstrap.Modal.getInstance(attachmentModal)?.hide();
  });
}

// ======================================================================
// §18  HISTORIEK
// Jaaroverzicht per maand.
// ======================================================================

/** Jaaroverzicht van de actieve gebruiker (jaar = jaar gekozen bij Invoer). */
function renderHistory() {
  const viewUid = getActiveUserId();
  const table = document.getElementById('historyTable');
  if (!viewUid || !table) return;

  const ud = dataStore.users[viewUid] || { name: '-', monthData: {} };
  const year = Number(yearSelectMain.value) || new Date().getFullYear();

  const historiekJaar = document.getElementById('historiekJaar');
  const currentUserHistoriek = document.getElementById('currentUserHistoriek');
  if (historiekJaar) historiekJaar.textContent = year;
  if (currentUserHistoriek) currentUserHistoriek.textContent = ud.name || ud.email || '—';

  const schoolEnabled = ud?.settings?.schoolLeaveEnabled !== false;
  const cols = [
    { key: 'target', title: 'Doel uren' },
    { key: 'planned', title: 'Gepland' },
    { key: 'diff', title: 'Verschil' },
    { key: 'leave', title: 'Verlof' },
    { key: 'sick', title: 'Ziekte' },
    { key: 'bench', title: 'Bench' },
    { key: 'stage', title: 'Stage' },
    ...(schoolEnabled ? [{ key: 'school', title: 'Schoolverlof' }] : []),
    { key: 'holiday', title: 'Feestdag' }
  ];
  const zero = () => Object.fromEntries(cols.map(c => [c.key, 0]));
  const totals = zero();
  const diffClass = v => (v > 0 ? 'text-success' : v < 0 ? 'text-danger' : '');

  let bodyHtml = '';
  for (let m = 0; m < 12; m++) {
    const md = ud.monthData?.[year]?.[m] || { targetHours: 0, targetMinutes: 0, rows: {} };
    const rows = md.rows || {};
    const excluded = md.excludeFromHistory === true;

    const v = zero();
    v.target = (Number(md.targetHours) || 0) * 60 + (Number(md.targetMinutes) || 0);
    v.planned = plannedMinutes(rows, ud);
    v.diff = v.planned - v.target;
    for (const r of Object.values(rows)) {
      if (!r?.shift || r.status === 'rejected') continue;
      const mins = Number(r.minutes) || 0;
      const name = shiftRealName(r.shift, ud);
      if (name === 'Verlof') v.leave += mins;
      if (name === 'Ziekte') v.sick += mins;
      if ((name === 'Schoolverlof' || name === 'School') && 'school' in v) v.school += mins;
      if (name === 'Feestdag') v.holiday += mins;
      if (name === 'Bench') v.bench += mins;
      if (isStageRow(r, ud)) v.stage += mins;
    }

    // Uitgesloten maanden tellen niet mee in het totaal
    if (!excluded) cols.forEach(c => (totals[c.key] += v[c.key]));

    const label = excluded
      ? `${monthsFull[m]} <span class="badge bg-secondary ms-1" style="font-size:0.65rem;">Uitgesloten</span>`
      : monthsFull[m];
    const cells = cols
      .map(c => {
        if (excluded) return '<td>-</td>';
        if (c.key === 'diff') return `<td class="fw-medium ${diffClass(v.diff)}">${fmtDiff(v.diff)}</td>`;
        return `<td>${fmt(v[c.key])}</td>`;
      })
      .join('');
    bodyHtml += `<tr class="${excluded ? 'opacity-50' : ''}"><td>${label}</td>${cells}</tr>`;
  }

  const footCells = cols
    .map(c =>
      c.key === 'diff'
        ? `<th class="${diffClass(totals.diff)}">${fmtDiff(totals.diff)}</th>`
        : `<th>${fmt(totals[c.key])}</th>`
    )
    .join('');

  table.innerHTML = `
    <thead class="table-light"><tr><th>Maand</th>${cols.map(c => `<th>${c.title}</th>`).join('')}</tr></thead>
    <tbody id="historyBody">${bodyHtml}</tbody>
    <tfoot class="table-light"><tr><th>Totaal</th>${footCells}</tr></tfoot>`;
}

function bindHistory() {
  document.querySelector('#navTabs a[href="#tab-historiek"]')?.addEventListener('shown.bs.tab', renderHistory);
}

// ======================================================================
// §19  CONVERTER
// Uren/minuten ↔ decimale uren.
// ======================================================================

const convHours = document.getElementById('convHours');
const convMinutes = document.getElementById('convMinutes');
const decimalInput = document.getElementById('decimalInput');

function updateDecimal() {
  const h = Number(convHours.value) || 0;
  const m = Number(convMinutes.value) || 0;
  decimalInput.value = (h + m / 60).toFixed(2);
}

function updateHM() {
  const total = Math.round((Number(decimalInput.value) || 0) * 60);
  convHours.value = Math.floor(total / 60);
  convMinutes.value = total % 60;
}

function bindConverter() {
  convHours?.addEventListener('input', updateDecimal);
  convMinutes?.addEventListener('input', updateDecimal);
  decimalInput?.addEventListener('input', updateHM);
}

// ======================================================================
// §20  NON-BILLABLE
// Niet-factureerbare uren per maand.
// ======================================================================

const nbMonthSelect = document.getElementById('nbMonthSelect');
const nbYearSelect = document.getElementById('nbYearSelect');
const nbCategorySelect = document.getElementById('nbCategorySelect');
const nbAddCategoryBtn = document.getElementById('nbAddCategoryBtn');
const nbDateInput = document.getElementById('nbDateInput');
const nbHoursInput = document.getElementById('nbHoursInput');
const nbMinutesInput = document.getElementById('nbMinutesInput');
const nbNoteInput = document.getElementById('nbNoteInput');
const nbAddBtn = document.getElementById('nbAddBtn');
const nbTableBody = document.getElementById('nbTableBody');
const nbTotalDisplay = document.getElementById('nbTotalDisplay');

// Standaard categorieën als er nog niets is opgeslagen
const DEFAULT_NB_CATS = ['Administratie', 'Reistijd', 'Interne Meeting', 'Opleiding', 'Ziekte (Kort)'];

/** Jaar- en maandkeuze vullen en op vandaag zetten. */
function initNonBillable() {
  if (!nbYearSelect) return;
  const yNow = new Date().getFullYear();
  nbYearSelect.innerHTML = '';
  for (let y = yNow - 2; y <= yNow + 2; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === yNow) opt.selected = true;
    nbYearSelect.appendChild(opt);
  }
  nbMonthSelect.value = new Date().getMonth();
  nbDateInput.value = todayISO();
}

function renderNbCategories() {
  const cats = getCurrentUserData().nonBillableCategories || DEFAULT_NB_CATS;
  nbCategorySelect.innerHTML = '';
  [...cats].sort().forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    nbCategorySelect.appendChild(opt);
  });
}

/** Lijst van de gekozen maand + maand- en jaartotaal. */
function renderNonBillable() {
  const y = Number(nbYearSelect.value);
  const m = Number(nbMonthSelect.value);
  const ud = getCurrentUserData();
  const items = ud.monthData?.[y]?.[m]?.nonBillable || [];
  items.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const monthMins = items.reduce((sum, it) => sum + (Number(it.minutes) || 0), 0);
  nbTableBody.innerHTML = items.length
    ? items
        .map(
          (item, idx) => `
        <tr>
          <td>${toDisplayDate(item.date)}</td>
          <td><span class="badge bg-light text-dark border">${escapeHtml(item.cat)}</span></td>
          <td>${escapeHtml(item.note || '')}</td>
          <td class="text-mono">${Math.floor((Number(item.minutes) || 0) / 60)}u ${(Number(item.minutes) || 0) % 60}m</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-danger nb-del-btn" data-idx="${idx}">
              <span class="material-icons-outlined" style="font-size:16px">delete</span>
            </button>
          </td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="text-center text-muted">Geen non-billable uren in deze maand.</td></tr>';
  nbTotalDisplay.textContent = fmt(monthMins);

  let yearMins = 0;
  for (let i = 0; i < 12; i++) {
    (ud.monthData?.[y]?.[i]?.nonBillable || []).forEach(it => (yearMins += Number(it.minutes) || 0));
  }
  const yearLabel = document.getElementById('nbYearTotalLabel');
  const yearDisplay = document.getElementById('nbYearTotalDisplay');
  if (yearLabel) yearLabel.textContent = y;
  if (yearDisplay) yearDisplay.textContent = fmt(yearMins);

  nbTableBody.querySelectorAll('.nb-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Verwijderen?')) return;
      items.splice(Number(btn.dataset.idx), 1);
      await saveUserData();
      renderNonBillable();
      toast('Item verwijderd', 'success');
    });
  });
}

function bindNonBillable() {
  initNonBillable();
  nbMonthSelect?.addEventListener('change', renderNonBillable);
  nbYearSelect?.addEventListener('change', renderNonBillable);

  // Nieuwe categorie
  nbAddCategoryBtn?.addEventListener('click', async () => {
    const newCat = prompt('Nieuwe categorie naam:')?.trim();
    if (!newCat) return;
    const ud = getCurrentUserData();
    ud.nonBillableCategories ||= [...DEFAULT_NB_CATS];
    if (ud.nonBillableCategories.includes(newCat)) return toast('Categorie bestaat al', 'warning');

    ud.nonBillableCategories.push(newCat);
    await saveUserData();
    renderNbCategories();
    nbCategorySelect.value = newCat;
    toast(`Categorie '${newCat}' toegevoegd`, 'success');
  });

  // Item toevoegen (bewaard in de maand van de gekozen datum)
  nbAddBtn?.addEventListener('click', async () => {
    const cat = nbCategorySelect.value;
    const date = nbDateInput.value;
    const h = Math.max(0, Number(nbHoursInput.value) || 0);
    const min = Math.max(0, Number(nbMinutesInput.value) || 0);
    if (!cat) return toast('Selecteer een categorie', 'warning');
    if (!date) return toast('Kies een datum', 'warning');
    if (h === 0 && min === 0) return toast('Vul een tijd in', 'warning');

    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7)) - 1;
    const md = ensureMonthData(getCurrentUserData(), y, m);
    md.nonBillable ||= [];
    md.nonBillable.push({ id: Date.now(), date, cat, minutes: h * 60 + min, note: nbNoteInput.value.trim() });
    await saveUserData();

    nbNoteInput.value = '';
    nbHoursInput.value = '';
    nbMinutesInput.value = '';
    nbYearSelect.value = y;
    nbMonthSelect.value = m;
    renderNonBillable();
    toast('Non-billable uren toegevoegd', 'success');
  });

  document.querySelector('#navTabs a[href="#tab-nonbillable"]')?.addEventListener('shown.bs.tab', () => {
    renderNbCategories();
    renderNonBillable();
  });
}

// ======================================================================
// §21  CHAT
// Chat tussen gebruikers en admins (op de opslag van de vroegere mailbox).
// ======================================================================

// De chat gebruikt dezelfde opslag als de vroegere mailbox, zodat de Firestore-regels gelijk blijven:
// - gebruiker: users/{uid}/mailbox (eigen berichten, antwoorden van admins en systeemberichten)
// - admin: 'admin_mail' (berichten van gebruikers) + users/{adminUid}/mailbox (eigen antwoorden)

let mailboxUnsubInbox = null;
let mailboxUnsubSent = null;
let mailboxCacheInbox = [];
let mailboxCacheSent = [];
let chatPeer = null; // admin: uid van het open gesprek ('__system' = meldingen)
const SYSTEM_PEER = '__system';

function updateUnreadBadges(unread) {
  const n = Math.max(0, Number(unread) || 0);
  ['mailUnreadBadge', 'mailSidebarBadge'].forEach(id => {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.textContent = n;
    badge.classList.toggle('d-none', n === 0);
  });
  // Bolletje op de hamburgerknop
  document.getElementById('mailBottomBadge')?.classList.toggle('d-none', n === 0);
}

/* ---------- luisteren ---------- */
function listenMailbox(uid) {
  if (mailboxUnsubInbox) mailboxUnsubInbox();
  if (mailboxUnsubSent) mailboxUnsubSent();
  mailboxUnsubInbox = mailboxUnsubSent = null;
  mailboxCacheInbox = [];
  mailboxCacheSent = [];

  const iAmAdmin = (dataStore.users[uid]?.role || 'user') === 'admin';
  const toItems = (snap, source) =>
    snap.docs.map(d => {
      const data = d.data();
      return { _id: d.id, ...data, _tsIso: normTs(data.timestamp) || new Date().toISOString(), _source: source };
    });

  /** Browsermelding voor nieuwe, ongelezen berichten van iemand anders (niet bij de eerste lading). */
  const notifyNew = (snap, isIncoming) => {
    snap.docChanges().forEach(change => {
      if (change.type !== 'added') return;
      const d = change.doc.data();
      if (d.read || !isIncoming(d)) return;
      const sender = d.system ? 'Shift Planner' : d.fromName || d.from?.name || 'Admin';
      sendBrowserNotification(`Nieuw bericht van ${sender}`, chatSnippet(d));
    });
  };

  let first = true;
  if (iAmAdmin) {
    mailboxUnsubInbox = onSnapshot(
      query(collection(db, 'admin_mail'), orderBy('timestamp', 'desc'), limit(300)),
      snap => {
        if (!first) notifyNew(snap, () => true);
        first = false;
        mailboxCacheInbox = toItems(snap, 'admin_mail');
        renderChat();
      }
    );
    mailboxUnsubSent = onSnapshot(
      query(collection(db, 'users', uid, 'mailbox'), orderBy('timestamp', 'desc'), limit(300)),
      snap => {
        mailboxCacheSent = toItems(snap, 'user_mailbox');
        renderChat();
      }
    );
  } else {
    mailboxUnsubInbox = onSnapshot(
      query(collection(db, 'users', uid, 'mailbox'), orderBy('timestamp', 'desc'), limit(300)),
      snap => {
        if (!first) notifyNew(snap, d => d.from?.uid !== uid);
        first = false;
        mailboxCacheInbox = toItems(snap, 'user_mailbox');
        renderChat();
      }
    );
  }
}

/* ---------- send helpers ---------- */
async function sendSystemMail(uid, subject, body, kind = 'notification', threadId = `sys:${Date.now()}`) {
  await addDoc(collection(db, 'users', uid, 'mailbox'), {
    threadId,
    system: true,
    kind,
    from: { uid: 'noreply', name: 'Shift Planner', role: 'system', email: 'no-reply@local' },
    to: { type: 'user', uid },
    subject,
    body,
    read: false,
    timestamp: serverTimestamp()
  });
}

async function sendUserMessageToAdmins(subject, body, threadId = `conv:${currentUserId}`, kind = 'message') {
  const meUid = currentUserId;
  const me = dataStore.users[meUid];
  const meName = me?.name || me?.email || meUid;
  const meEmail = me?.email || 'onbekend'; // We pakken het e-mailadres mee

  // kopie in eigen mailbox (als 'verzonden') - DIT BLIJFT HETZELFDE
  await addDoc(collection(db, 'users', meUid, 'mailbox'), {
    threadId,
    system: false,
    kind,
    from: { uid: meUid, name: meName, role: 'user' },
    to: { type: 'admin-group' },
    subject,
    body,
    read: true,
    timestamp: serverTimestamp()
  });

  // --- HET FOUTE GEDEELTE IS VERVANGEN ---
  // In plaats van te 'fan-out' naar alle admins (wat mislukt)...

  // ...schrijven we één bericht naar de centrale 'admin_mail' collectie
  await addDoc(collection(db, 'admin_mail'), {
    fromUserId: meUid,
    fromName: meName,
    fromEmail: meEmail, // Handig voor de admin
    subject: subject,
    body: body,
    timestamp: serverTimestamp(),
    read: false, // Ongelezen voor de admin
    kind,
    threadId: threadId // Behoud threadId voor context
  });
}

async function broadcastToAdmins(subject, body, kind = 'status') {
  const meUid = getActiveUserId();
  const me = dataStore.users[meUid];
  const meName = me?.name || me?.email || meUid;
  const meEmail = me?.email || 'onbekend';

  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const threadId = `plan:${meUid}:${y}-${m}`;

  // 1. Kopie in eigen 'verzonden' items
  await addDoc(collection(db, 'users', meUid, 'mailbox'), {
    threadId,
    system: false,
    kind: kind,
    from: { uid: meUid, name: meName, role: 'user' },
    to: { type: 'admin-group' }, // We sturen dit naar de 'admin-group'
    subject,
    body,
    read: true,
    timestamp: serverTimestamp()
  });

  // 2. Schrijf naar de centrale 'admin_mail' collectie
  await addDoc(collection(db, 'admin_mail'), {
    fromUserId: meUid,
    fromName: meName,
    fromEmail: meEmail,
    subject: subject,
    body: body,
    kind: kind,
    timestamp: serverTimestamp(),
    read: false,
    threadId: threadId
  });
}

async function sendAdminReplyToUser(adminUid, userUid, subject, body, kind = 'message') {
  const admin = dataStore.users[adminUid];
  const threadId = `conv:${userUid}`;

  // kopie in admin mailbox
  await addDoc(collection(db, 'users', adminUid, 'mailbox'), {
    threadId,
    system: false,
    kind,
    from: { uid: adminUid, name: admin?.name || admin?.email || 'Admin', role: 'admin' },
    to: { type: 'user-id', uid: userUid },
    subject,
    body,
    read: true,
    timestamp: serverTimestamp()
  });

  // naar de user
  await addDoc(collection(db, 'users', userUid, 'mailbox'), {
    threadId,
    system: false,
    kind,
    from: { uid: adminUid, name: admin?.name || admin?.email || 'Admin', role: 'admin' },
    to: { type: 'user', uid: userUid },
    subject,
    body,
    read: false,
    timestamp: serverTimestamp()
  });
}

async function notifyAdminOfPendingLeave(uid, year, month, rowKey, row) {
  const me = dataStore.users[uid];
  const meName = me?.name || me?.email || uid;
  const meEmail = me?.email || 'onbekend';

  const threadId = `leave:${uid}:${rowKey}`; // Uniek voor deze aanvraag
  const subject = `[Verlof] Nieuwe aanvraag: ${row.shift} op ${rowKey}`;
  const body = `${meName} heeft een nieuwe aanvraag ingediend:
- Shift: ${row.shift}
- Datum: ${rowKey.split('-').reverse().join('-')}
- Omschrijving: ${row.omschrijving || '-'}
${row.attachmentURL ? `\n- BIJLAGE: ${row.attachmentURL}` : ''}
`; // 👈 De backtick sluit hier de variabele af

  // Schrijf naar de centrale 'admin_mail' collectie
  await addDoc(collection(db, 'admin_mail'), {
    fromUserId: uid,
    fromName: meName,
    fromEmail: meEmail,
    subject: subject,
    body: body,
    kind: 'leave_request', // 👈 Nieuw, belangrijk type!
    timestamp: serverTimestamp(),
    read: false,
    threadId: threadId,
    // 👈 Extra data voor de admin (minder belangrijk, maar kan handig zijn)
    requestData: { uid: uid, year: Number(year), month: Number(month), rowKey: rowKey }
  });
}

/* ---------- berichten ordenen ---------- */

/** Korte tekst van een bericht (voor meldingen en het gesprekkenoverzicht). */
function chatSnippet(m) {
  const text = (m.kind === 'chat' ? m.body : m.subject || m.body || '').replace(/\s+/g, ' ').trim();
  return text.length > 70 ? `${text.slice(0, 70)}…` : text;
}

/** Alle berichten als chat-items: wie is de gesprekspartner en is het van mij? */
function chatItems() {
  const me = currentUserId;
  const admin = isAdmin();
  const items = [];
  [...mailboxCacheInbox, ...mailboxCacheSent].forEach(m => {
    // Automatische meldingen staan al bij het belletje; niet dubbel in de chat
    if (m.system && m.kind === 'notification') return;
    let peer;
    let mine = false;
    if (m._source === 'admin_mail') peer = m.fromUserId || '?';
    else if (m.system) peer = SYSTEM_PEER;
    else if (m.from?.uid === me) {
      mine = true;
      peer = admin ? m.to?.uid || '?' : 'admins';
    } else peer = admin ? m.from?.uid || '?' : 'admins';
    if (!admin && peer === SYSTEM_PEER) peer = 'admins'; // gebruiker: systeemberichten in hetzelfde gesprek
    items.push({ ...m, _peer: peer, _mine: mine });
  });
  return items.sort((a, b) => a._tsIso.localeCompare(b._tsIso));
}

const isUnreadIncoming = m => !m._mine && m.read === false;

/** Gesprekken voor de admin: alle gebruikers + wie er al berichten stuurde. */
function chatConversations(items) {
  const convs = new Map();
  const add = (peer, name) => {
    if (!convs.has(peer)) convs.set(peer, { peer, name, last: null, unread: 0 });
    return convs.get(peer);
  };
  Object.entries(dataStore.users).forEach(([uid, u]) => {
    if ((u.role || 'user') !== 'admin') add(uid, u.name || u.email || uid);
  });
  items.forEach(m => {
    const name =
      m._peer === SYSTEM_PEER
        ? 'Shift Planner'
        : dataStore.users[m._peer]?.name || m.fromName || dataStore.users[m._peer]?.email || 'Onbekend';
    const c = add(m._peer, name);
    c.last = m;
    if (isUnreadIncoming(m)) c.unread++;
  });
  return [...convs.values()].sort(
    (a, b) => (b.last?._tsIso || '').localeCompare(a.last?._tsIso || '') || a.name.localeCompare(b.name)
  );
}

/* ---------- tekenen ---------- */
const chatTime = iso => new Date(iso).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
function chatDayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Vandaag';
  if (d.toDateString() === yest.toDateString()) return 'Gisteren';
  return d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
}
/** Tekst veilig tonen, met klikbare links. */
const chatText = t =>
  escapeHtml(t || '').replace(
    /https?:\/\/[^\s<]+/g,
    url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`
  );
const initials = name =>
  (name || '?')
    .split(/\s+/)
    .map(p => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

function renderChat() {
  const items = chatItems();
  const admin = isAdmin();
  updateUnreadBadges(items.filter(isUnreadIncoming).length);

  const listEl = document.getElementById('chatConvList');
  const shell = document.getElementById('chatShell');
  let thread;
  if (admin) {
    const convs = chatConversations(items);
    if (!chatPeer && convs.length && window.matchMedia('(min-width: 992px)').matches) chatPeer = convs[0].peer;
    if (listEl) {
      listEl.innerHTML = convs
        .map(
          c => `
        <button type="button" class="chat-conv${c.peer === chatPeer ? ' active' : ''}" data-peer="${escapeHtml(c.peer)}">
          <span class="chat-avatar${c.peer === SYSTEM_PEER ? ' sys' : ''}">${escapeHtml(initials(c.name))}</span>
          <span class="chat-conv-text">
            <span class="chat-conv-top"><strong>${escapeHtml(c.name)}</strong>${c.last ? `<small>${chatDayLabel(c.last._tsIso) === 'Vandaag' ? chatTime(c.last._tsIso) : new Date(c.last._tsIso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}</small>` : ''}</span>
            <span class="chat-conv-last">${c.last ? `${c.last._mine ? 'Jij: ' : ''}${escapeHtml(chatSnippet(c.last))}` : '<em>Nog geen berichten</em>'}</span>
          </span>
          ${c.unread ? `<span class="nav-badge">${c.unread}</span>` : ''}
        </button>`
        )
        .join('');
    }
    shell?.classList.toggle('show-thread', !!chatPeer);
    const conv = convs.find(c => c.peer === chatPeer);
    thread = chatPeer ? items.filter(m => m._peer === chatPeer) : [];
    document.getElementById('chatTitle').textContent = conv?.name || 'Kies een gesprek';
    document.getElementById('chatSub').textContent =
      chatPeer === SYSTEM_PEER ? 'Automatische meldingen' : dataStore.users[chatPeer]?.email || '';
    document.getElementById('chatAvatar').textContent = initials(conv?.name || '?');
  } else {
    thread = items;
  }
  const canWrite = !admin || (chatPeer && chatPeer !== SYSTEM_PEER);
  document.getElementById('chatForm')?.classList.toggle('d-none', !canWrite);

  const box = document.getElementById('chatMessages');
  if (!box) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (!thread.length) {
    box.innerHTML = `<div class="chat-empty"><span class="material-icons-outlined">forum</span><p>${
      admin && !chatPeer ? 'Kies links een gesprek.' : 'Nog geen berichten. Stuur gerust een eerste bericht.'
    }</p></div>`;
  } else {
    let lastDay = '';
    box.innerHTML = thread
      .map(m => {
        const day = chatDayLabel(m._tsIso);
        const sep = day !== lastDay ? `<div class="chat-day">${day}</div>` : '';
        lastDay = day;
        const subject =
          m.kind !== 'chat' && m.subject ? `<strong class="chat-subject">${escapeHtml(m.subject)}</strong>` : '';
        const body = m.kind !== 'chat' && m.subject === m.body ? '' : chatText(m.body);
        if (m.system && !admin) {
          return `${sep}<div class="chat-notice" data-id="${m._id}">${subject}<span>${body}</span><small>${chatTime(m._tsIso)}</small></div>`;
        }
        const who =
          !m._mine && admin
            ? ''
            : !m._mine
              ? `<span class="chat-who">${escapeHtml(m.from?.name || 'Admin')}</span>`
              : '';
        return `${sep}<div class="chat-row${m._mine ? ' mine' : ''}">
          <div class="chat-bubble${isUnreadIncoming(m) ? ' unread' : ''}" data-id="${m._id}" tabindex="0">
            ${who}${subject}<span class="chat-body">${body}</span>
            <span class="chat-meta">${chatTime(m._tsIso)}${m._mine ? ' <span class="material-icons-outlined">done_all</span>' : ''}</span>
            <button type="button" class="chat-del" data-id="${m._id}" aria-label="Bericht verwijderen"><span class="material-icons-outlined">delete</span></button>
          </div>
        </div>`;
      })
      .join('');
  }
  if (nearBottom || box.dataset.peer !== String(chatPeer)) box.scrollTop = box.scrollHeight;
  box.dataset.peer = String(chatPeer);

  // Open gesprek = gelezen
  if (document.getElementById('tab-mail')?.classList.contains('active')) markThreadRead(thread);
}

/** Ongelezen inkomende berichten van het open gesprek als gelezen markeren. */
function markThreadRead(thread) {
  thread.filter(isUnreadIncoming).forEach(m => {
    m.read = true;
    updateDoc(chatDocRef(m), { read: true }).catch(err => console.warn('Gelezen markeren mislukt', err));
  });
}

function chatDocRef(m) {
  return m._source === 'admin_mail' ? doc(db, 'admin_mail', m._id) : doc(db, 'users', currentUserId, 'mailbox', m._id);
}

/* ---------- versturen ---------- */
async function sendChatMessage(text) {
  const subject = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  if (isAdmin()) {
    if (!chatPeer || chatPeer === SYSTEM_PEER) return;
    await sendAdminReplyToUser(currentUserId, chatPeer, subject, text, 'chat');
  } else {
    await sendUserMessageToAdmins(subject, text, `conv:${currentUserId}`, 'chat');
  }
}

/* ---------- koppelen ---------- */
function bindMailboxUIOnce() {
  if (mailUIBound) return;
  mailUIBound = true;

  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSendBtn');
  const grow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    sendBtn.disabled = !input.value.trim();
  };
  input?.addEventListener('input', grow);
  input?.addEventListener('keydown', e => {
    // Enter verstuurt op de computer; op de iPhone geeft Enter een nieuwe regel
    if (e.key === 'Enter' && !e.shiftKey && !window.matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    grow();
    try {
      await sendChatMessage(text);
      const box = document.getElementById('chatMessages');
      if (box) box.scrollTop = box.scrollHeight;
    } catch (err) {
      console.error(err);
      input.value = text;
      grow();
      toast('Versturen mislukt', 'danger');
    }
  });

  document.getElementById('chatConvList')?.addEventListener('click', e => {
    const btn = e.target.closest('.chat-conv');
    if (!btn) return;
    chatPeer = btn.dataset.peer;
    renderChat();
    input?.focus({ preventScroll: true });
  });
  document.getElementById('chatBackBtn')?.addEventListener('click', () => {
    chatPeer = null;
    renderChat();
  });

  // Tik op een bericht: verwijderknop tonen
  const box = document.getElementById('chatMessages');
  box?.addEventListener('click', async e => {
    const del = e.target.closest('.chat-del');
    if (del) {
      const m = chatItems().find(x => x._id === del.dataset.id);
      if (!m || !confirm('Dit bericht verwijderen?')) return;
      try {
        await deleteDoc(chatDocRef(m));
        mailboxCacheInbox = mailboxCacheInbox.filter(x => x._id !== m._id);
        mailboxCacheSent = mailboxCacheSent.filter(x => x._id !== m._id);
        renderChat();
      } catch (err) {
        console.error(err);
        toast('Verwijderen mislukt', 'danger');
      }
      return;
    }
    if (e.target.closest('a')) return;
    const bubble = e.target.closest('.chat-bubble');
    box.querySelectorAll('.chat-bubble.show-actions').forEach(b => b !== bubble && b.classList.remove('show-actions'));
    bubble?.classList.toggle('show-actions');
  });
}

function bindMail() {
  document.querySelector('a[href="#tab-mail"]')?.addEventListener('shown.bs.tab', () => {
    bindMailboxUIOnce();
    renderChat();
    const box = document.getElementById('chatMessages');
    if (box) box.scrollTop = box.scrollHeight;
  });
}

// ======================================================================
// §22  MELDINGEN
// In-app meldingen, automatische herinneringen en push/browser-meldingen.
// ======================================================================

const notifBtn = document.getElementById('notifBtn');
const notifDropdown = document.getElementById('notifDropdown');
const notifList = document.getElementById('notifList');
const notifBadge = document.getElementById('notifBadge');
const markAllReadBtn = document.getElementById('markAllReadBtn');

let lastVisible = null; // laatste geladen melding (voor "Toon meer")
let notificationsUnsub = null;

const NOTIF_EMPTY_HTML =
  '<li class="notif-empty"><span class="material-icons-outlined" aria-hidden="true">notifications_none</span>Geen meldingen. Alles in orde!</li>';

function notificationItemHtml(n) {
  const d = n.timestamp ? new Date(n.timestamp) : null;
  const time = d
    ? `${chatDayLabel(d.toISOString())} · ${d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}`
    : '';
  return `<span class="notif-dot" aria-hidden="true"></span><div class="notif-body"><div class="notif-text">${escapeHtml(n.text)}</div><div class="notif-time">${time}</div></div>`;
}

/** Live lijst van de laatste 20 meldingen (bel-icoon) + badge. */
function listenToNotifications(uid) {
  if (notificationsUnsub) notificationsUnsub();
  const q = query(collection(db, 'users', uid, 'notifications'), orderBy('timestamp', 'desc'), limit(20));
  let isFirstRun = true; // bij opstarten geen 20 browsermeldingen tonen

  notificationsUnsub = onSnapshot(q, snapshot => {
    const docs = snapshot.docs;
    if (docs.length > 0) lastVisible = docs[docs.length - 1];

    dataStore.notifications = docs.map(d => d.data());
    notifList.innerHTML = '';
    let unread = 0;
    dataStore.notifications.forEach(n => {
      if (!n.read) unread++;
      const li = document.createElement('li');
      li.className = `notif-item${n.read ? '' : ' unread'}`;
      li.innerHTML = notificationItemHtml(n);
      notifList.appendChild(li);
    });

    if (!isFirstRun) {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') sendBrowserNotification('Nieuwe melding', change.doc.data().text);
      });
    }
    isFirstRun = false;

    if (!dataStore.notifications.length) notifList.innerHTML = NOTIF_EMPTY_HTML;
    document.getElementById('markAllReadBtn')?.classList.toggle('d-none', !dataStore.notifications.length);
    notifBadge.textContent = unread;
    notifBadge.classList.toggle('d-none', unread === 0);
    document.getElementById('loadMoreNotifBtn')?.classList.toggle('d-none', docs.length < 20);
    loadHomeNotifications();
  });
}

/** Volgende 20 (oudere) meldingen ophalen. */
async function loadMoreNotifications(uid) {
  if (!lastVisible) return;
  const qMore = query(
    collection(db, 'users', uid, 'notifications'),
    orderBy('timestamp', 'desc'),
    startAfter(lastVisible),
    limit(20)
  );
  const snap = await getDocs(qMore);
  if (snap.empty) {
    document.getElementById('loadMoreNotifBtn')?.classList.add('d-none');
    return;
  }
  snap.forEach(docSnap => {
    const n = docSnap.data();
    const li = document.createElement('li');
    li.className = `notif-item${n.read ? '' : ' unread'}`;
    li.innerHTML = notificationItemHtml(n);
    notifList.appendChild(li);
  });
  lastVisible = snap.docs[snap.docs.length - 1];
}

/** Meldingsvoorkeur van de ingelogde gebruiker (standaard aan). */
function getNotifPref(key) {
  return dataStore.users[currentUserId]?.settings?.notificationPrefs?.[key] !== false;
}

/**
 * Automatische herinneringen voor de ingelogde gebruiker (bij login en daarna elke 24u):
 * lege week, maanddoel < 80%, aflopende projecten, lege dagen; ruimt meldingen > 30 dagen op.
 */
async function autoCheckNotifications() {
  if (!currentUserId || !auth.currentUser) return;
  const uid = currentUserId;
  const ud = dataStore.users[uid];
  if (!ud?.monthData) return;

  const today = new Date();
  const todayKey = todayISO();
  const allRows = Object.values(ud.monthData).flatMap(months =>
    Object.values(months || {}).flatMap(md => Object.entries(md?.rows || {}))
  );

  // 1. Deze week nog niets ingevuld? ("Vrij weekend" telt niet)
  if (getNotifPref('notifyWeeklyEmpty')) {
    const thisWeek = isoWeekId(today);
    const hasShiftThisWeek = allRows.some(([key, r]) => {
      const shiftName = r?.shift?.trim() || '';
      if (!shiftName || shiftName === 'Vrij weekend') return false;
      const [Y, M, D] = key.slice(0, 10).split('-').map(Number);
      return isoWeekId(new Date(Y, M - 1, D)) === thisWeek;
    });
    if (!hasShiftThisWeek) await createUniqueNotification(uid, 'Je hebt deze week nog geen shifts ingevuld.');
  }

  // 2. Maanddoel van deze maand < 80%
  if (getNotifPref('notifyMonthlyGoal')) {
    const md = ud.monthData?.[today.getFullYear()]?.[today.getMonth()];
    const doel = (Number(md?.targetHours) || 0) * 60 + (Number(md?.targetMinutes) || 0);
    if (doel > 0 && plannedMinutes(md?.rows, ud) < doel * 0.8) {
      await createUniqueNotification(uid, 'Je hebt nog minder dan 80% van je maanddoel behaald.');
    }
  }

  // 3. Projecten die binnen 2 weken aflopen
  if (getNotifPref('notifyProjectEnd')) {
    const in14 = new Date(today);
    in14.setDate(in14.getDate() + 14);
    const limitKey = dateKey(in14.getFullYear(), in14.getMonth(), in14.getDate());
    const soon = (ud.projects || []).filter(p => p.end && p.end > todayKey && p.end < limitKey);
    if (soon.length) {
      await createUniqueNotification(uid, `Project(en) bijna afgelopen: ${soon.map(p => p.name).join(', ')}`);
    }
  }

  // 4. Dagen dit jaar met een lege regel (geen shift gekozen)
  if (getNotifPref('notifyDailyEmpty')) {
    const yearPrefix = `${today.getFullYear()}-`;
    const emptyDays = allRows
      .filter(([key, r]) => key.startsWith(yearPrefix) && key.length === 10 && key <= todayKey && !r?.shift?.trim())
      .map(([key]) => key)
      .sort();
    for (const key of emptyDays) {
      await createUniqueNotification(uid, `Geen shift ingevuld op ${toDisplayDate(key)}.`);
    }
  }

  // 5. Meldingen ouder dan 30 dagen opruimen
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const old = await getDocs(
      query(collection(db, 'users', uid, 'notifications'), where('timestamp', '<', thirtyDaysAgo))
    );
    await Promise.all(old.docs.map(d => deleteDoc(d.ref)));
  } catch (err) {
    console.error('Oude meldingen opruimen mislukt:', err.message);
  }
}

// --- Melding de avond vóór je dienst ---

const EVENING_REMINDER_HOUR = 20; // vanaf 20:00 de avond ervoor
let eveningTimer = null;

/** Werk-shiften van een dag (eigen account), gesorteerd. */
function shiftsOnDay(ud, iso) {
  const [y, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1];
  const md = ud?.monthData?.[y]?.[m];
  return listDayKeys(md, iso)
    .map(k => md.rows[k])
    .filter(
      r =>
        r?.shift && (!r.status || r.status === 'approved') && !/vrij|niet ingepland/i.test(shiftRealName(r.shift, ud))
    );
}

/** Tekst zoals "Morgen: MKA 392 08:00–18:00 + Stage 392". */
function tomorrowReminderText(ud) {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const rows = shiftsOnDay(ud, isoOf(t));
  if (!rows.length) return '';
  const parts = rows.map(r => {
    const name = shiftRealName(r.shift, ud);
    const hasTime = r.start && r.end && !(r.start === '00:00' && r.end === '00:00');
    return hasTime ? `${name} ${r.start}–${r.end}` : name;
  });
  // Gekoppelde shiften met dezelfde uren één keer tonen
  const uniq = parts.filter((p, i) => parts.indexOf(p) === i);
  return `Morgen (${daysFull[t.getDay()].toLowerCase()}): ${uniq.join(' + ')}`;
}

/** Herinnering maken als het avond is en je morgen ingepland staat (één keer per dag). */
async function checkEveningReminder() {
  if (!currentUserId || !getNotifPref('notifyEveningBefore')) return;
  if (new Date().getHours() < EVENING_REMINDER_HOUR) return;
  const text = tomorrowReminderText(dataStore.users[currentUserId]);
  if (text) await createUniqueNotification(currentUserId, text);
}

/** Bij het openen meteen controleren en, als de app open blijft, om 20:00 nog eens. */
function startEveningReminder() {
  clearTimeout(eveningTimer);
  checkEveningReminder().catch(err => console.warn('Avondherinnering mislukt', err));
  const at = new Date();
  at.setHours(EVENING_REMINDER_HOUR, 0, 5, 0);
  if (at <= new Date()) at.setDate(at.getDate() + 1);
  eveningTimer = setTimeout(startEveningReminder, at - new Date());
}

/** Agenda-bestand (.ics) van de gekozen maand, met een herinnering om 20:00 de avond ervoor. */
function exportMonthIcs() {
  const ud = getCurrentUserData();
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const md = ud.monthData?.[y]?.[m];
  const pad = n => String(n).padStart(2, '0');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const esc = t =>
    String(t || '')
      .replace(/[\\;,]/g, c => `\\${c}`)
      .replace(/\n/g, '\\n');
  const events = [];
  Object.keys(md?.rows || {})
    .sort()
    .forEach(key => {
      const r = md.rows[key];
      if (!r?.shift || r.status === 'rejected') return;
      const iso = key.slice(0, 10);
      const ymd = iso.replace(/-/g, '');
      const name = shiftRealName(r.shift, ud);
      const hasTime = r.start && r.end && !(r.start === '00:00' && r.end === '00:00');
      const lines = [
        'BEGIN:VEVENT',
        `UID:${ymd}-${esc(key)}-${esc(r.shift).replace(/\s+/g, '_')}@shift-planner`,
        `DTSTAMP:${stamp}`,
        `SUMMARY:${esc(name)}${r.project ? ` (${esc(r.project)})` : ''}`
      ];
      if (hasTime) {
        const end = rowActualEnd(r);
        const endDate = new Date(`${iso}T12:00:00`);
        if (end <= r.start) endDate.setDate(endDate.getDate() + 1);
        const endYmd = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}`;
        lines.push(
          `DTSTART;TZID=Europe/Brussels:${ymd}T${r.start.replace(':', '')}00`,
          `DTEND;TZID=Europe/Brussels:${endYmd}T${end.replace(':', '')}00`
        );
        // Herinnering om 20:00 de avond ervoor
        const [h, mi] = r.start.split(':').map(Number);
        const before = h * 60 + mi + (24 - EVENING_REMINDER_HOUR) * 60;
        lines.push(
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `DESCRIPTION:Morgen ${esc(name)} om ${r.start}`,
          `TRIGGER:-PT${before}M`,
          'END:VALARM'
        );
      } else {
        const next = new Date(`${iso}T12:00:00`);
        next.setDate(next.getDate() + 1);
        lines.push(
          `DTSTART;VALUE=DATE:${ymd}`,
          `DTEND;VALUE=DATE:${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`
        );
      }
      if (r.omschrijving) lines.push(`DESCRIPTION:${esc(r.omschrijving)}`);
      lines.push('END:VEVENT');
      events.push(lines.join('\r\n'));
    });
  if (!events.length) return toast('Geen shiften in deze maand', 'warning');

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Shift Planner//NL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Shift Planner ${monthsFull[m]} ${y}`,
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Brussels',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...events,
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Shifts-${monthsFull[m]}-${y}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`${events.length} shiften klaar voor je agenda (met herinnering de avond ervoor)`, 'success');
}

/** Melding maken (max. één keer per dag dezelfde tekst); die verschijnt bij het belletje, niet in de chat. */
async function createUniqueNotification(uid, text) {
  const colRef = collection(db, 'users', uid, 'notifications');
  const dayKey = todayISO();
  const snap = await getDocs(query(colRef, where('text', '==', text), where('dateKey', '==', dayKey)));
  if (!snap.empty) return;

  await addDoc(colRef, { text, timestamp: new Date().toISOString(), dateKey: dayKey, read: false });
}

/** Melding naar een gebruiker bij een projectwijziging door een admin. */
async function notifyProjectChange(userId, type, projectName, newEndDate = null) {
  const text =
    type === 'added'
      ? `Admin heeft een nieuw project toegevoegd: ${projectName}`
      : `Admin heeft het project "${projectName}" verlengd tot ${newEndDate}`;
  const colRef = collection(db, 'users', userId, 'notifications');
  const dayKey = todayISO();
  const snap = await getDocs(query(colRef, where('text', '==', text), where('dateKey', '==', dayKey)));
  if (snap.empty) await addDoc(colRef, { text, timestamp: new Date().toISOString(), dateKey: dayKey, read: false });
}

const notificationsSupported = () => 'Notification' in window;

/** Toestemming vragen en het push-token bewaren (voor meldingen als de app dicht is). */
async function enableNotifications(uid) {
  if (!notificationsSupported() || !messaging || !('serviceWorker' in navigator)) return;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Service worker in deze map registreren (niet in de root van het domein)
    const swRegistration = await navigator.serviceWorker.register('./firebase-messaging-sw.js', { scope: './' });
    const token = await getToken(messaging, {
      vapidKey: 'BAQfmfk_rwoMDHbDeTU6gdRZBjxWmikZWf_prrddhvW8Pf2hOrLc8QmkMbltWCqxbKfRs3S8ZCB3NOjrGgj2h64',
      serviceWorkerRegistration: swRegistration
    });
    if (token) await updateDoc(doc(db, 'users', uid), { fcmToken: token });
  } catch (err) {
    console.error('Fout bij notificaties:', err);
  }
}

async function requestNotificationPermission() {
  if (!notificationsSupported()) return false;
  return (await Notification.requestPermission()) === 'granted';
}

/** Browsermelding tonen (werkt ook op Android, waar 'new Notification' niet mag). */
async function sendBrowserNotification(title, body) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const options = { body, icon: 'favicon-192x192.png', vibrate: [200, 100, 200] };
  try {
    const n = new Notification(title, options);
    n.onclick = e => {
      e.preventDefault();
      window.focus();
      n.close();
    };
  } catch {
    try {
      const reg = await navigator.serviceWorker?.getRegistration('./');
      await reg?.showNotification(title, options);
    } catch (err) {
      console.warn('Browsermelding niet mogelijk:', err);
    }
  }
}

function bindNotifications() {
  // Push-bericht terwijl de app open staat
  if (messaging) {
    onMessage(messaging, payload => {
      const { title = 'Melding', body = '' } = payload.notification || {};
      toast(`<strong>${escapeHtml(title)}</strong><br>${escapeHtml(body)}`, 'info');
    });
  }

  // Bel-icoon: dropdown openen/sluiten
  notifBtn?.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelectorAll('.dropdown-menu.show').forEach(el => {
      if (el !== notifDropdown) el.classList.remove('show');
    });
    notifDropdown.classList.toggle('show');
  });
  document.addEventListener('click', e => {
    if (notifDropdown && !notifDropdown.contains(e.target) && e.target !== notifBtn) {
      notifDropdown.classList.remove('show');
    }
  });

  // "Alles gelezen" = alle meldingen verwijderen
  markAllReadBtn?.addEventListener('click', async () => {
    if (!currentUserId) return;
    const snap = await getDocs(collection(db, 'users', currentUserId, 'notifications'));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    notifList.innerHTML = NOTIF_EMPTY_HTML;
    markAllReadBtn.classList.add('d-none');
    notifBadge.classList.add('d-none');
    toast('Alle meldingen verwijderd', 'success');
  });

  document.getElementById('loadMoreNotifBtn')?.addEventListener('click', () => loadMoreNotifications(currentUserId));

  // Profiel: knop "Activeer meldingen" (nodig op iPhone/Android)
  const showNotifActive = () => {
    document.getElementById('enableNotifBtn')?.classList.add('d-none');
    const status = document.getElementById('notifStatusText');
    if (status) status.textContent = '✅ Meldingen zijn actief.';
  };
  document.getElementById('enableNotifBtn')?.addEventListener('click', async () => {
    if (await requestNotificationPermission()) {
      toast('Meldingen zijn geactiveerd!', 'success');
      showNotifActive();
      enableNotifications(currentUserId);
    } else {
      toast('Meldingen geweigerd of niet mogelijk in deze browser.', 'warning');
    }
  });
  document.getElementById('profileModal')?.addEventListener('show.bs.modal', () => {
    if (notificationsSupported() && Notification.permission === 'granted') showNotifActive();
  });
}

// ======================================================================
// §23  PROFIEL
// Profiel-popup: naam, thema, voorkeuren en export.
// ======================================================================

// Het profiel hoort altijd bij de INGELOGDE gebruiker, ook als een admin iemand anders bekijkt.
const myData = () => dataStore.users[currentUserId] || {};

/** Eigen instellingen opslaan (los van de gebruiker die bekeken wordt). */
async function saveMySettings() {
  if (!currentUserId) return;
  await trackSave(updateDoc(doc(db, 'users', currentUserId), { settings: myData().settings || {} }));
}

/** Profiel-popup vullen. */
function loadProfileTab() {
  const user = auth.currentUser;
  if (!user) return;
  const ud = myData();

  document.getElementById('profileName').value = user.displayName || ud.name || '';
  document.getElementById('profileEmail').value = user.email || '';
  document.getElementById('profilePhoto').src = user.photoURL || DEFAULT_AVATAR;
  document.getElementById('profileDarkModeToggle').checked = document.documentElement.dataset.bsTheme === 'dark';

  const defaultTabSelect = document.getElementById('profileDefaultTab');
  if (defaultTabSelect) defaultTabSelect.value = ud.settings?.defaultTab || '#tab-home';

  // Gekozen accentkleur aanduiden
  const picker = document.getElementById('profileColorPicker');
  if (picker) {
    const currentColor = localStorage.getItem('accentColor') || ud.settings?.accentColor || '#0d6efd';
    picker
      .querySelectorAll('.color-dot')
      .forEach(dot => dot.classList.toggle('selected', dot.dataset.color === currentColor));
  }

  const prefs = ud.settings?.notificationPrefs || {};
  for (const key of [
    'notifyEveningBefore',
    'notifyDailyEmpty',
    'notifyWeeklyEmpty',
    'notifyMonthlyGoal',
    'notifyProjectEnd'
  ]) {
    const box = document.getElementById(`pref${key[0].toUpperCase()}${key.slice(1)}`);
    if (box) box.checked = prefs[key] !== false;
  }
}

function bindProfile() {
  document.getElementById('profileModal')?.addEventListener('show.bs.modal', loadProfileTab);

  // Naam opslaan (Firebase-profiel + gebruikersdocument)
  document.getElementById('profileSaveBtn')?.addEventListener('click', async () => {
    const user = auth.currentUser;
    const newName = document.getElementById('profileName').value.trim();
    if (!user || !newName) return toast('Vul een naam in', 'warning');
    try {
      await updateProfile(user, { displayName: newName });
      await updateDoc(doc(db, 'users', user.uid), { name: newName });
      myData().name = newName;
      if (getActiveUserId() === currentUserId) renderHome();
      toast('Naam opgeslagen!', 'success');
    } catch (err) {
      console.error('Fout bij opslaan profiel:', err);
      toast('Opslaan mislukt: ' + err.message, 'danger');
    }
  });

  // Donkere modus (per toestel)
  document.getElementById('profileDarkModeToggle')?.addEventListener('change', e => {
    setDarkMode(e.target.checked);
  });

  const setMySetting = async (key, value, message) => {
    const me = myData();
    me.settings ||= {};
    me.settings[key] = value;
    await saveMySettings();
    toast(message, 'success');
  };

  document.getElementById('profileDefaultTab')?.addEventListener('change', async e => {
    await setMySetting('defaultTab', e.target.value, 'Standaard opstart-tabblad opgeslagen');
  });

  document.getElementById('profileNotifPrefs')?.addEventListener('change', async e => {
    if (e.target.type !== 'checkbox') return;
    const prefs = {
      notifyEveningBefore: document.getElementById('prefNotifyEveningBefore').checked,
      notifyDailyEmpty: document.getElementById('prefNotifyDailyEmpty').checked,
      notifyWeeklyEmpty: document.getElementById('prefNotifyWeeklyEmpty').checked,
      notifyMonthlyGoal: document.getElementById('prefNotifyMonthlyGoal').checked,
      notifyProjectEnd: document.getElementById('prefNotifyProjectEnd').checked
    };
    await setMySetting('notificationPrefs', prefs, 'Notificatie-voorkeuren opgeslagen');
    if (prefs.notifyEveningBefore) checkEveningReminder();
  });

  document.getElementById('profileColorPicker')?.addEventListener('click', async e => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    applyAccentColor(dot.dataset.color);
    document.querySelectorAll('#profileColorPicker .color-dot').forEach(d => d.classList.toggle('selected', d === dot));
    await setMySetting('accentColor', dot.dataset.color, 'Accentkleur opgeslagen!');
  });

  // Eigen gegevens downloaden als JSON
  document.getElementById('profileExportBtn')?.addEventListener('click', () => {
    const ud = dataStore.users[currentUserId];
    if (!ud) return toast('Kon gebruikersdata niet vinden.', 'danger');
    const url = URL.createObjectURL(new Blob([JSON.stringify(ud, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `shift_planner_export_${ud.name || 'user'}_${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
    toast('Gegevens worden gedownload!', 'success');
  });
}

// ======================================================================
// §24  ADMIN
// Gebruiker wisselen in de topbalk en rechten.
// ======================================================================

/** Keuzelijst + knoppen (rol, schoolverlof, verwijderen) in de topbalk voor admins. */
function initTopbarAdminSwitcher() {
  const container = document.getElementById('topbarAdminSwitch');
  if (!container) return;

  // Topbalk: compacte knop "gebruiker kiezen" (onzichtbare select erover, zodat de iPhone zijn eigen keuzelijst toont)
  container.innerHTML = `
    <label class="user-pick" title="Gebruiker bekijken">
      <span class="material-icons-outlined" aria-hidden="true">group</span>
      <span id="userPickName" class="user-pick-name">Mijzelf</span>
      <span class="material-icons-outlined user-pick-caret" aria-hidden="true">expand_more</span>
      <select id="topbarUserSelect" aria-label="Gebruiker bekijken"></select>
    </label>`;

  // Balk onder de topbalk zolang je iemand anders bekijkt: naam + beheerknoppen
  let banner = document.getElementById('viewBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'viewBanner';
    banner.className = 'view-banner d-none';
    document.querySelector('.sp-topbar')?.after(banner);
  }
  banner.innerHTML = `
    <span class="material-icons-outlined" aria-hidden="true">visibility</span>
    <span class="view-banner-text">Je bekijkt <strong id="viewBannerName"></strong></span>
    <div id="topbarControls" class="view-banner-tools">
      <select id="topbarRoleSelect" class="form-select form-select-sm" title="Rol wijzigen" aria-label="Rol">
        <option value="user">User</option>
        <option value="admin">Admin</option>
      </select>
      <button id="topbarSchoolBtn" class="btn btn-sm btn-outline-secondary icon-sq" type="button" title="Schoolverlof aan/uit" aria-label="Schoolverlof aan/uit">
        <span class="material-icons-outlined">school</span>
      </button>
      <button id="topbarDeleteBtn" class="btn btn-sm btn-outline-danger icon-sq" type="button" title="Gebruiker verwijderen" aria-label="Gebruiker verwijderen">
        <span class="material-icons-outlined">person_remove</span>
      </button>
      <button id="viewBannerBack" class="btn btn-sm btn-primary" type="button">Terug naar mij</button>
    </div>`;
  container.classList.remove('d-none');

  const select = document.getElementById('topbarUserSelect');
  const roleSelect = document.getElementById('topbarRoleSelect');
  const schoolBtn = document.getElementById('topbarSchoolBtn');
  const deleteBtn = document.getElementById('topbarDeleteBtn');

  const refreshUserList = () => {
    select.innerHTML = '<option value="">Mijzelf</option>';
    Object.entries(dataStore.users)
      .filter(([uid]) => uid !== currentUserId)
      .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''))
      .forEach(([uid, u]) => {
        const opt = document.createElement('option');
        opt.value = uid;
        opt.textContent = u.name || u.email || uid;
        if (uid === dataStore.viewUserId) opt.selected = true;
        select.appendChild(opt);
      });
  };

  const updateControlState = uid => {
    const u = uid && dataStore.users[uid];
    const name = u ? u.name || u.email || uid : 'Mijzelf';
    banner.classList.toggle('d-none', !u);
    container.classList.toggle('viewing-other', !!u);
    document.getElementById('userPickName').textContent = name;
    document.getElementById('viewBannerName').textContent = name;
    if (!u) return;
    roleSelect.value = u.role || 'user';
    const schoolEnabled = u.settings?.schoolLeaveEnabled !== false;
    schoolBtn.className = `btn btn-sm icon-sq ${schoolEnabled ? 'btn-success text-white' : 'btn-outline-secondary'}`;
  };

  refreshUserList();
  updateControlState(select.value);

  document.getElementById('viewBannerBack').onclick = () => {
    select.value = '';
    select.dispatchEvent(new Event('change'));
  };

  // Andere gebruiker bekijken/bewerken
  select.onchange = async () => {
    const targetUid = select.value || null;
    toast(
      targetUid
        ? `Beheer actief voor ${dataStore.users[targetUid]?.name || 'gebruiker'}`
        : 'Beheer teruggezet naar jezelf',
      targetUid ? 'primary' : 'info'
    );
    updateControlState(targetUid);
    await renderUserDataAsAdmin(targetUid);
  };

  roleSelect.onchange = async () => {
    const uid = select.value;
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'users', uid), { role: roleSelect.value });
      dataStore.users[uid].role = roleSelect.value;
      toast('Rol aangepast', 'success');
    } catch (err) {
      console.error(err);
      toast('Fout bij rol', 'danger');
    }
  };

  schoolBtn.onclick = async () => {
    const uid = select.value;
    if (!uid) return;
    const u = dataStore.users[uid];
    u.settings ||= {};
    const newState = u.settings.schoolLeaveEnabled === false; // omdraaien (standaard = aan)
    try {
      await updateDoc(doc(db, 'users', uid), { 'settings.schoolLeaveEnabled': newState });
      u.settings.schoolLeaveEnabled = newState;
      updateControlState(uid);
      applySchoolLeaveVisibility();
      toast(`Schoolverlof ${newState ? 'AAN' : 'UIT'}`, 'success');
    } catch (err) {
      console.error(err);
      toast('Fout', 'danger');
    }
  };

  deleteBtn.onclick = async () => {
    const uid = select.value;
    if (!uid) return;
    if (!confirm('Weet je zeker dat je deze gebruiker wilt verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
    try {
      await deleteDoc(doc(db, 'users', uid));
      delete dataStore.users[uid];
      select.value = '';
      updateControlState(null);
      await renderUserDataAsAdmin(null);
      refreshUserList();
      toast('Gebruiker verwijderd', 'success');
    } catch (err) {
      console.error(err);
      toast('Verwijderen mislukt', 'danger');
    }
  };
}

/** Admin: alle schermen tonen voor een andere gebruiker (null = jezelf). */
async function renderUserDataAsAdmin(uid) {
  if (uid && !dataStore.users[uid]) {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) dataStore.users[uid] = snap.data();
  }
  dataStore.viewUserId = uid && uid !== currentUserId ? uid : null;
  listenActiveUserDoc();

  renderProjects();
  renderShifts();
  populateFilterShiftYears();
  renderProjectFilterForMonth();
  await generateMonth();
}

/** Schoolverlof aan/uit: onderdelen tonen of verbergen en alles herberekenen. */
function applySchoolLeaveVisibility() {
  const enabled = getCurrentUserData()?.settings?.schoolLeaveEnabled !== false;
  document.querySelectorAll('.school-leave-section').forEach(el => (el.style.display = enabled ? '' : 'none'));
  renderMonth(Number(yearSelectMain.value), Number(monthSelectMain.value));
  renderHistory();
}

// --- App op het beginscherm ---

let deferredInstallPrompt = null;

/** Offline-ondersteuning + uitleg om de app op het beginscherm te zetten. */
function initInstallable() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./firebase-messaging-sw.js', { scope: './' }).catch(() => {});
  }
  const hint = document.getElementById('installHint');
  if (!hint) return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem('installHintDismissed') === '1';
  } catch {
    /* geen opslag beschikbaar */
  }
  if (standalone || dismissed) return;

  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (isIos) hint.classList.remove('d-none');

  // Android/Chrome/Edge: echte installatieknop
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.getElementById('installHowTo').textContent = 'Opent sneller, schermvullend en ook zonder internet.';
    document.getElementById('installBtn')?.classList.remove('d-none');
    hint.classList.remove('d-none');
  });
  document.getElementById('installBtn')?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    hint.classList.add('d-none');
  });
  window.addEventListener('appinstalled', () => hint.classList.add('d-none'));
  document.getElementById('installClose')?.addEventListener('click', () => {
    hint.classList.add('d-none');
    try {
      localStorage.setItem('installHintDismissed', '1');
    } catch {
      /* geen opslag beschikbaar */
    }
  });
}

/** Snelkoppelingen van het app-icoon (lang indrukken): #snel en #invoer. */
function handleLaunchShortcut() {
  const hash = location.hash;
  if (!hash) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (hash === '#snel') {
    showTab('#tab-invoer');
    openQuickInput();
  } else if (hash === '#invoer') showTab('#tab-invoer');
}

// ======================================================================
// §25  START
// ======================================================================

function initApp() {
  bindAuth();
  bindLayout();
  bindHome();
  bindProjects();
  bindShifts();
  bindMonth();
  bindCalendar();
  bindQuickInput();
  bindPaint();
  bindAttachments();
  bindHistory();
  bindConverter();
  bindNonBillable();
  bindMail();
  bindNotifications();
  bindProfile();
  initInstallable();
}

initApp();
