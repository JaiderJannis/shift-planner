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
 *   §21  MAILBOX — Berichten tussen gebruikers en admins.
 *   §22  MELDINGEN — In-app meldingen, automatische herinneringen en push/browser-meldingen.
 *   §23  PROFIEL — Profiel-popup: naam, thema, voorkeuren en export.
 *   §24  ADMIN — Gebruiker wisselen in de topbalk, rechten en team-rooster.
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

const SHIFT_ICONS = {
  light_mode: '☀️',
  wb_twilight: '🌅',
  bedtime: '🌙',
  schedule: '🕒',
  star: '⭐',
  school: '🎓',
  medical_services: '🏥',
  flight: '✈️',
  bench: '🪑',
  feestdag: '🎉',
  teammeeting: '👥',
  niet_ingepland: '❌',
  vrij_weekend: '😎',
  stage: '🏫'
};

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

function formatWhen(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('nl-BE');
  } catch {
    return '';
  }
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

  // Sorteer chronologisch op het STARTUUR van de shift
  return keys.sort((a, b) => {
    const rowA = monthData.rows[a];
    const rowB = monthData.rows[b];

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

function recalcRowMinutes(r) {
  r.minutes = minutesBetween(r.start, r.end, r.break);
}

function saveCell(year, month, key, r, tr) {
  const ud = getCurrentUserData();
  ud.monthData = ud.monthData || {};
  ud.monthData[year] = ud.monthData[year] || {};
  ud.monthData[year][month] = ud.monthData[year][month] || { targetHours: 0, targetMinutes: 0, rows: {} };
  ud.monthData[year][month].rows[key] = { ...r, minutes: r.minutes || minutesBetween(r.start, r.end, r.break) };
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

/** Admin-onderdelen tonen voor admins (team-rooster + gebruikerswissel in de topbalk). */
function revealAdminIfNeeded() {
  if (!isAdmin()) return;
  document.body.classList.add('is-admin');
  document.getElementById('adminRoosterTabBtn')?.classList.remove('d-none');
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
    updateMonthStatusBadge();
    enableNotifications(user.uid);

    // Meldingen: live lijst + dagelijkse automatische controle
    listenToNotifications(user.uid);
    await autoCheckNotifications();
    notificationInterval = setInterval(autoCheckNotifications, 24 * 60 * 60 * 1000);

    // Mailbox
    bindMailboxUIOnce();
    listenMailbox(user.uid);

    // Opstart-tabblad uit het profiel
    if (ud?.settings?.defaultTab) showTab(ud.settings.defaultTab);
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
    <div class="meter-ruler" style="--tick:${tick.toFixed(2)}%" role="progressbar" aria-valuemin="0"
         aria-valuemax="${target}" aria-valuenow="${planned}" aria-label="${fmt(planned)} van ${fmt(target)}">
      <div class="fill${state ? ` ${state}` : ''}" style="width:${pct.toFixed(1)}%"></div>
    </div>
    ${opts.caption === false ? '' : '<p class="meter-caption">Elk streepje is 8 uur.</p>'}`;
}

const STAGE = { start: '2026-09-28', end: '2027-01-31', targetMinutes: 450 * 60 }; // werkplekleren PXL

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
  renderMeter(document.getElementById('homeMeter'), planned, target);
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

  loadHomeNotifications();
  initAnnouncements();
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
  const labels = {
    light_mode: 'Zon',
    wb_twilight: 'Schemer',
    bedtime: 'Maan',
    schedule: 'Klok',
    school: 'School',
    medical_services: 'Ziekte',
    flight: 'Verlof',
    bench: 'Bench',
    feestdag: 'Feestdag',
    teammeeting: 'Teammeeting',
    niet_ingepland: 'Niet ingepland',
    vrij_weekend: 'Vrij weekend',
    stage: 'Stage'
  };
  return Object.entries(labels)
    .map(
      ([value, label]) =>
        `<option value="${value}" ${selected === value ? 'selected' : ''}>${SHIFT_ICONS[value]}${withLabels ? ' ' + label : ''}</option>`
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
  );
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
        endDate: document.getElementById('newShiftEndDate').value || null
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
  renderMeter(el, plannedMinutes(md.rows, ud), doel);
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
function exportMonthPdf() {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

  const m = Number(monthSelectMain.value);
  const y = Number(yearSelectMain.value);
  const monthName = monthsFull[m];
  const ud = getCurrentUserData();
  const md = ud.monthData?.[y]?.[m];

  if (!md?.rows || Object.keys(md.rows).length === 0) return toast('Geen data voor deze maand', 'warning');

  // Kop
  const pageWidth = pdf.internal.pageSize.width;
  pdf.setFillColor(13, 110, 253);
  pdf.rect(0, 0, pageWidth, 25, 'F');
  pdf.setFontSize(16);
  pdf.setTextColor(255, 255, 255);
  pdf.text('Shift Planner', 14, 15);
  pdf.setFontSize(11);
  pdf.text(`${monthName} ${y}`, pageWidth - 50, 15);
  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(9);
  pdf.text(`Gebruiker: ${ud.name || ud.email || '-'}`, 14, 32);

  // Tabel (lege rijen overslaan)
  const body = Object.entries(md.rows)
    .filter(([, r]) => r?.shift)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, r]) => {
      const mins = Number(r.minutes) || 0;
      const status = r.status === 'pending' ? ' (aanvraag)' : r.status === 'rejected' ? ' (afgekeurd)' : '';
      return [
        toDisplayDate(key.slice(0, 10)),
        r.project || '-',
        shiftRealName(r.shift, ud) + status,
        r.start || '',
        r.end || '',
        r.break || 0,
        `${Math.floor(mins / 60)}u ${mins % 60}m`,
        r.omschrijving || r.description || ''
      ];
    });

  pdf.autoTable({
    head: [['Datum', 'Project', 'Shift', 'Start', 'Einde', 'Pauze', 'Duur', 'Omschrijving']],
    body,
    startY: 43,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.5, lineWidth: 0.1 },
    headStyles: { fillColor: [13, 110, 253], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 249, 252] },
    margin: { left: 8, right: 8 },
    tableWidth: 'auto',
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 30 },
      2: { cellWidth: 25 },
      3: { cellWidth: 15 },
      4: { cellWidth: 15 },
      5: { cellWidth: 12 },
      6: { cellWidth: 18 },
      7: { cellWidth: 'auto' }
    },
    didDrawPage: () => {
      pdf.setFontSize(8);
      pdf.setTextColor(120);
      pdf.text(`Pagina ${pdf.internal.getNumberOfPages()}`, pageWidth - 30, pdf.internal.pageSize.height - 8);
    }
  });

  // Samenvatting (zelfde berekening als in de app)
  const total = plannedMinutes(md.rows, ud);
  const doel = (Number(md.targetHours) || 0) * 60 + (Number(md.targetMinutes) || 0);
  const short = v => `${Math.floor(v / 60)}u ${v % 60}m`;
  const endY = pdf.lastAutoTable.finalY + 6;
  pdf.setFontSize(11);
  pdf.setTextColor(13, 110, 253);
  pdf.text('Maandoverzicht', 14, endY);
  pdf.setTextColor(0, 0, 0);
  pdf.setFontSize(9);
  pdf.text(`Doel: ${short(doel)}`, 20, endY + 5);
  pdf.text(`Gepland: ${short(total)}`, 20, endY + 10);
  pdf.text(`Verschil: ${(total - doel >= 0 ? '+' : '-') + short(Math.abs(total - doel))}`, 20, endY + 15);

  pdf.save(`Shiftplanning_${ud.name || 'gebruiker'}_${monthName}_${y}.pdf`);
  toast('PDF geëxporteerd', 'success');
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
    const quickIconsHtml = favorites
      .filter(sh => isDateWithin(baseKey, sh.startDate, sh.endDate))
      .map(
        sh =>
          `<span class="quick-icon-btn" data-shift="${escapeHtml(sh.key)}" title="${escapeHtml(sh.realName || sh.key)}">${SHIFT_ICONS[sh.icon] || '⭐'}</span>`
      )
      .join('');

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
        const hoverText = `${name}: ${r.start || '00:00'}–${r.end || '00:00'}, pauze ${r.break || 0} min`;
        return `
        <div class="cal-shift-item" title="${escapeHtml(hoverText)}" style="background:${escapeHtml(sh.color || '#e9ecef')}">
          <span class="name-long">${escapeHtml(name)}${pending}</span><span class="name-short">${escapeHtml(short)}</span>
          <span class="dur">${durationText}</span>
        </div>`;
      })
      .join('');
    if (dayKeys.length > 3) shiftsHtml += `<div class="cal-more">+${dayKeys.length - 3}</div>`;

    const dayEl = document.createElement('div');
    dayEl.className = [
      'calendar-day',
      isWeekend && 'weekend',
      baseKey === today && 'today',
      isHolidayDay && 'school-holiday-bg'
    ]
      .filter(Boolean)
      .join(' ');
    dayEl.setAttribute('role', 'button');
    dayEl.setAttribute('aria-label', `${d} ${monthsFull[month]}`);

    dayEl.innerHTML = `
      <div class="d-flex justify-content-between align-items-start">
        <span class="day-number">${d}</span>
        <div class="quick-icons-wrapper">${quickIconsHtml}</div>
      </div>
      ${shiftsHtml}
      ${holidayHtml}
    `;

    dayEl.onclick = () => (isPaintMode ? applyPaintShift(baseKey) : openDayEditor(baseKey));
    dayEl.querySelectorAll('.quick-icon-btn').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        applyShiftDirectly(baseKey, btn.dataset.shift);
      };
    });

    grid.appendChild(dayEl);
  }
}

/** Nieuwe rij-sleutel voor een dag: de datum zelf, of 'datum#2', 'datum#3', … als er al iets staat. */
function newRowKeyForDay(md, baseKey) {
  return md.rows[baseKey] ? `${baseKey}#${nextLineIndex(md, baseKey)}` : baseKey;
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
  md.rows[newRowKeyForDay(md, baseKey)] = rowFromShift(shiftKey);
  toast(`${shiftRealName(shiftKey, ud)} toegevoegd`, 'success');
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

  const dayKeys = listDayKeys(md, baseKey).filter(k => md.rows[k]?.shift);
  listContainer.innerHTML = dayKeys.length
    ? dayKeys
        .map(k => {
          const r = md.rows[k];
          const sh = ud.shifts?.[r.shift] || {};
          const mins = Number(r.minutes) || 0;
          return `
      <div class="day-item" data-key="${k}">
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
  list?.addEventListener('change', e => {
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
      if (r.attachmentURL)
        Object.assign(md.rows[key], {
          attachmentURL: r.attachmentURL,
          attachmentName: r.attachmentName,
          attachmentPath: r.attachmentPath
        });
      toast(`Gewisseld naar ${shiftRealName(e.target.value)}`, 'success');
    } else if (e.target.classList.contains('js-day-time')) {
      const field = e.target.dataset.field;
      r[field] = field === 'break' ? Math.max(0, Number(e.target.value) || 0) : e.target.value;
      r.minutes = minutesBetween(r.start, r.end, r.break);
    } else {
      return;
    }
    renderDayEditor();
    commitMonth(y, m);
  });

  // Duur live bijwerken tijdens het typen
  list?.addEventListener('input', e => {
    const item = e.target.closest('.day-item');
    if (!item || !e.target.classList.contains('js-day-time')) return;
    const val = f => item.querySelector(`[data-field="${f}"]`).value;
    showDuration(item.querySelector('.duration'), val('start'), val('end'), val('break'));
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
    const name = shiftRealName(md.rows[key].shift);
    delete md.rows[key];
    renderDayEditor();
    commitMonth(y, m);
    toast(`${name} verwijderd`, 'success');
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
    md.rows[newRowKeyForDay(md, baseKey)] = rowFromShift(addShift.value, {
      start: addStart.value,
      end: addEnd.value,
      break: Math.max(0, Number(addBreak.value) || 0),
      minutes: minutesBetween(addStart.value, addEnd.value, addBreak.value),
      omschrijving: note
    });
    closeAddForm();
    renderDayEditor();
    commitMonth(y, m);
    toast(`${shiftRealName(addShift.value)} toegevoegd`, 'success');
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
          delete md.rows[rowKey];
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
  return `${Math.floor(mins / 60)}u ${mins % 60}min`;
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
    md.rows[newRowKeyForDay(md, date)] = rowFromShift(shift, {
      start,
      end,
      break: brk,
      minutes: minutesBetween(start, end, brk),
      omschrijving: note
    });

    bootstrap.Modal.getInstance(document.getElementById('quickModal'))?.hide();
    toast(`${shiftRealName(shift, ud)} toegevoegd op ${toDisplayDate(date)}`, 'success');
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
        ensureMonthData(ud, y, m).rows[iso] = rowFromShift(selectedShift);
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
    md.rows[targetKey] = rowFromShift(selectedPaintShiftKey, { omschrijving: note });
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
// §21  MAILBOX
// Berichten tussen gebruikers en admins.
// ======================================================================

// Gewone gebruiker: users/{uid}/mailbox. Admin: inbox = gedeelde 'admin_mail', verzonden = eigen mailbox.
const mailListBody = document.getElementById('mailListBody');
const mailDetail = document.getElementById('mailDetail');
const mailToSelect = document.getElementById('mailToSelect');
const mailSubjectInput = document.getElementById('mailSubjectInput');
const mailBodyInput = document.getElementById('mailBodyInput');

let mailboxUnsubInbox = null;
let mailboxUnsubSent = null;
let mailboxCacheInbox = [];
let mailboxCacheSent = [];
let mailboxCache = []; // alle berichten samen
let mailFolder = 'inbox'; // 'inbox' | 'sent'
let composeThreadId = null; // bij antwoorden: zelfde gesprek

/** Afzender-uid van een bericht (admin_mail gebruikt 'fromUserId'). */
const mailSenderUid = m => m.from?.uid || m.fromUserId || '';
/** Leesbare afzender. */
const mailSenderName = m =>
  m.system ? 'Shift Planner (noreply)' : m.fromName || m.from?.name || m.fromEmail || m.from?.email || '—';

function updateUnreadBadges(unread) {
  const n = Math.max(0, Number(unread) || 0);
  ['mailUnreadBadge', 'mailSidebarBadge'].forEach(id => {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.textContent = n;
    badge.classList.toggle('d-none', n === 0);
  });
  // Op de iPhone: bolletje op "Meer"
  document.getElementById('mailBottomBadge')?.classList.toggle('d-none', n === 0);
}

/* ---------- mailbox listen ---------- */
function listenMailbox(uid) {
  // 1. Stop vorige listeners
  if (mailboxUnsubInbox) mailboxUnsubInbox();
  if (mailboxUnsubSent) mailboxUnsubSent();
  mailboxCacheInbox = [];
  mailboxCacheSent = [];

  const me = dataStore.users[uid];
  const iAmAdmin = (me?.role || 'user') === 'admin';

  if (iAmAdmin) {
    // --- ADMIN: Luistert naar TWEE bronnen ---

    // Bron 1: De 'admin_mail' collectie (voor de Inbox)
    const inboxColRef = collection(db, 'admin_mail');
    const qyInbox = query(inboxColRef, orderBy('timestamp', 'desc'), limit(200));

    let isFirstLoadAdmin = true; // 🛑 Vlag om meldingen bij opstarten te blokkeren

    mailboxUnsubInbox = onSnapshot(qyInbox, snap => {
      // A. NOTIFICATIE LOOP (Nieuw)
      if (!isFirstLoadAdmin) {
        snap.docChanges().forEach(change => {
          if (change.type === 'added') {
            const d = change.doc.data();
            // Als het ongelezen is, stuur melding
            if (!d.read) {
              const sender = d.fromName || d.from?.name || 'Onbekend';
              const subject = d.subject || '(Geen onderwerp)';

              // Stuur browser melding
              sendBrowserNotification(`Nieuw bericht van ${sender}`, subject);
            }
          }
        });
      }

      // B. Lijst opbouwen
      mailboxCacheInbox = snap.docs.map(d => {
        const data = d.data();
        return { _id: d.id, ...data, _tsIso: normTs(data.timestamp), _source: 'admin_mail' };
      });

      mergeAndRenderMail();

      isFirstLoadAdmin = false; // 🛑 Vlag uitzetten na eerste keer
    });

    // Bron 2: Hun EIGEN mailbox (voor Verzonden items) -> Geen notificaties nodig
    const sentColRef = collection(db, 'users', uid, 'mailbox');
    const qySent = query(sentColRef, orderBy('timestamp', 'desc'), limit(200));
    mailboxUnsubSent = onSnapshot(qySent, snap => {
      mailboxCacheSent = snap.docs.map(d => ({
        _id: d.id,
        ...d.data(),
        _tsIso: normTs(d.data().timestamp),
        _source: 'user_mailbox'
      }));
      mergeAndRenderMail();
    });
  } else {
    // --- GEWONE USER: Luistert naar ÉÉN bron ---
    const userColRef = collection(db, 'users', uid, 'mailbox');
    const qyUser = query(userColRef, orderBy('timestamp', 'desc'), limit(200));

    let isFirstLoadUser = true; // 🛑 Vlag om meldingen bij opstarten te blokkeren

    mailboxUnsubInbox = onSnapshot(qyUser, snap => {
      // A. NOTIFICATIE LOOP (Nieuw)
      if (!isFirstLoadUser) {
        snap.docChanges().forEach(change => {
          if (change.type === 'added') {
            const d = change.doc.data();

            // Check: bericht voor mij? ongelezen? niet van mijzelf?
            const isForMe = d.to?.uid === uid || d.to?.type === 'user';
            const notFromMe = d.from?.uid !== uid;

            if (!d.read && isForMe && notFromMe) {
              const sender = d.system ? 'Shift Planner' : d.from?.name || 'Admin';
              const subject = d.subject || '(Geen onderwerp)';

              // Stuur browser melding
              sendBrowserNotification(`Nieuw bericht van ${sender}`, subject);
            }
          }
        });
      }

      // B. BESTAANDE UI LOGICA
      mailboxCacheInbox = snap.docs.map(d => ({
        _id: d.id,
        ...d.data(),
        _tsIso: normTs(d.data().timestamp),
        _source: 'user_mailbox'
      }));
      mailboxCacheSent = [];
      mergeAndRenderMail();

      isFirstLoadUser = false; // 🛑 Vlag uitzetten
    });
  }
}

function prepareComposeOptions() {
  mailToSelect.innerHTML = '';
  if (isAdmin()) {
    // admin → kies user (excl admins)
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = 'Kies gebruiker…';
    mailToSelect.appendChild(opt0);
    Object.entries(dataStore.users).forEach(([uid, u]) => {
      if ((u.role || 'user') === 'admin') return;
      const o = document.createElement('option');
      o.value = `user:${uid}`;
      o.textContent = u.name || u.email || uid;
      mailToSelect.appendChild(o);
    });
  } else {
    // user → admins
    const o = document.createElement('option');
    o.value = 'admin-group';
    o.textContent = 'Admins';
    mailToSelect.appendChild(o);
  }
}

function prepareComposeToCounterparty(m) {
  prepareComposeOptions();
  mailToSelect.value = isAdmin() ? `user:${mailSenderUid(m)}` : 'admin-group';
  mailSubjectInput.value = m.subject?.startsWith('Re: ') ? m.subject : `Re: ${m.subject || ''}`;
  mailBodyInput.value = '';
  composeThreadId = m.threadId || `conv:${mailSenderUid(m) || currentUserId}`;
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

async function sendUserMessageToAdmins(subject, body, threadId = `conv:${currentUserId}`) {
  const meUid = currentUserId;
  const me = dataStore.users[meUid];
  const meName = me?.name || me?.email || meUid;
  const meEmail = me?.email || 'onbekend'; // We pakken het e-mailadres mee

  // kopie in eigen mailbox (als 'verzonden') - DIT BLIJFT HETZELFDE
  await addDoc(collection(db, 'users', meUid, 'mailbox'), {
    threadId,
    system: false,
    kind: 'message',
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

async function sendAdminReplyToUser(adminUid, userUid, subject, body) {
  const admin = dataStore.users[adminUid];
  const threadId = `conv:${userUid}`;

  // kopie in admin mailbox
  await addDoc(collection(db, 'users', adminUid, 'mailbox'), {
    threadId,
    system: false,
    kind: 'message',
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
    kind: 'message',
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

/* ---------- actions ---------- */
async function markMailRead(messageId, val = true) {
  const uid = currentUserId;

  // 1. Zoek het bericht in je lokale geheugen
  const msg = mailboxCache.find(m => m._id === messageId);
  if (!msg) return; // Het is al weg, stop.

  // 2. Bepaal waar het bericht zou moeten staan in de database
  let docRef;
  if (msg._source === 'admin_mail') {
    docRef = doc(db, 'admin_mail', messageId);
  } else {
    docRef = doc(db, 'users', uid, 'mailbox', messageId);
  }

  try {
    // 3. Probeer de status te updaten naar 'gelezen'
    await updateDoc(docRef, { read: !!val });
  } catch (err) {
    // 4. Vang de fout op als het bericht niet bestaat
    if (err.code === 'not-found') {
      // GEBRUIKERSVRIENDELIJKE MELDING:
      toast('Dit bericht is niet meer gevonden en wordt verwijderd.', 'warning');

      // Verwijder het spookbericht uit alle lokale lijsten
      mailboxCache = mailboxCache.filter(x => x._id !== messageId);
      mailboxCacheInbox = mailboxCacheInbox.filter(x => x._id !== messageId);
      mailboxCacheSent = mailboxCacheSent.filter(x => x._id !== messageId);

      // Ververs de lijst op het scherm
      renderMailList();

      // Maak het lees-scherm leeg als dat bericht open stond
      const detailEl = document.getElementById('mailDetail');
      if (detailEl && detailEl.dataset.openId === messageId) {
        detailEl.innerHTML = '<div class="text-muted small">Selecteer een bericht…</div>';
      }
      return;
    } else {
      // Echte fouten (zoals geen internet/permissie) wel loggen
      console.error('Fout bij markMailRead:', err);
    }
  }

  // 5. Als alles goed ging: update lokaal ook naar 'gelezen'
  const m = mailboxCache.find(x => x._id === messageId);
  if (m) m.read = !!val;
  renderMailList();
}

async function deleteMail(messageId) {
  const uid = currentUserId;

  // Bron opzoeken (admin_mail of eigen mailbox)
  const msg = mailboxCache.find(m => m._id === messageId);
  if (!msg) return; // Bericht al weg

  let docRef;
  if (msg._source === 'admin_mail') {
    docRef = doc(db, 'admin_mail', messageId);
  } else {
    docRef = doc(db, 'users', uid, 'mailbox', messageId);
  }

  await deleteDoc(docRef); // 👈 Gebruik het juiste pad

  // Cache updates (lokaal)
  mailboxCache = mailboxCache.filter(x => x._id !== messageId);
  mailboxCacheInbox = mailboxCacheInbox.filter(x => x._id !== messageId);
  mailboxCacheSent = mailboxCacheSent.filter(x => x._id !== messageId);

  renderMailList();
  if (mailDetail.dataset?.openId === messageId) {
    mailDetail.innerHTML = '<div class="text-muted small">Selecteer een bericht…</div>';
    delete mailDetail.dataset.openId;
  }
}

function mergeAndRenderMail() {
  // Voeg de twee caches (inbox en sent) samen
  const combined = new Map();
  [...mailboxCacheInbox, ...mailboxCacheSent].forEach(m => {
    combined.set(m._id, m);
  });
  mailboxCache = Array.from(combined.values());
  renderMailList();
}

/* ---------- render ---------- */
function filteredMessages() {
  const uid = currentUserId; // mailbox is altijd van de ingelogde gebruiker
  const items = mailboxCache.slice().sort((a, b) => (b._tsIso || '').localeCompare(a._tsIso || ''));

  if (mailFolder === 'sent') {
    // verzonden = door mij (niet system)
    return items.filter(m => m.from?.uid === uid && !m.system);
  }
  // inbox = alles dat NIET door mij is gestuurd óf system
  return items.filter(m => m.from?.uid !== uid || m.system);
}

function renderMailList() {
  const msgs = filteredMessages();
  mailListBody.innerHTML = '';

  let unread = 0;
  msgs.forEach(m => {
    if (!m.read && mailFolder === 'inbox') unread++;
  });

  updateUnreadBadges(unread);

  msgs.forEach(m => {
    let displayName = '—';
    if (mailFolder === 'sent') {
      // In Verzonden map, toon de 'To' (Naar)
      if (m.to?.type === 'admin-group') {
        displayName = 'Admins';
      } else if (m.to?.uid && dataStore.users[m.to.uid]) {
        displayName = dataStore.users[m.to.uid].name || dataStore.users[m.to.uid].email; // Admin naar user
      } else if (m.to?.name) {
        displayName = m.to.name;
      } else {
        displayName = 'Onbekend';
      }
    } else {
      displayName = mailSenderName(m);
    }

    const tr = document.createElement('tr');
    tr.className = m.read ? '' : 'fw-semibold';
    tr.innerHTML = `
      <td>${escapeHtml(displayName)}</td>
      <td><a href="#" class="js-open" data-id="${m._id}">${escapeHtml(m.subject || '(geen onderwerp)')}</a></td>
      <td class="text-end"><span class="mail-meta">${formatWhen(m._tsIso)}</span></td>
      <td class="text-end">
        <button class="btn btn-sm ${m.read ? 'btn-outline-secondary' : 'btn-outline-primary'} me-1 js-toggle" data-id="${m._id}">
          ${m.read ? 'Ongelezen' : 'Gelezen'}
        </button>
        <button class="btn btn-sm btn-outline-danger js-del" data-id="${m._id}">
          <span class="material-icons-outlined" style="font-size:16px">delete</span>
        </button>
      </td>
    `;
    mailListBody.appendChild(tr);
  });
}

function openMail(m) {
  if (!m) return;
  if (!m.read) {
    markMailRead(m._id, true);
    m.read = true;
  }

  const fromName = escapeHtml(mailSenderName(m));
  const actions = `
    <div class="d-flex gap-2">
      <button class="btn btn-outline-secondary btn-sm js-mark-unread" data-id="${m._id}">Markeer ongelezen</button>
      <button class="btn btn-outline-danger btn-sm js-del" data-id="${m._id}">
        <span class="material-icons-outlined" style="font-size:16px">delete</span>
      </button>
      ${m.system ? '' : '<button class="btn btn-outline-primary btn-sm js-reply" data-id="' + m._id + '"><span class="material-icons-outlined">reply</span> Antwoorden</button>'}
    </div>`;

  mailDetail.innerHTML = `
    <div class="d-flex justify-content-between align-items-start">
      <div>
        <div class="fw-semibold">${escapeHtml(m.subject || '(geen onderwerp)')}</div>
        <div class="mail-meta">Van: ${fromName} • ${formatWhen(m._tsIso)}</div>
      </div>
      ${actions}
    </div>
    <hr class="my-2">
    <div style="white-space:pre-wrap">${escapeHtml(m.body || '')}</div>
  `;
  mailDetail.dataset.openId = m._id;
}

/* ---------- once-only UI binding ---------- */
function bindMailboxUIOnce() {
  if (mailUIBound) return;
  mailUIBound = true;

  const nav = document.getElementById('mailFolderNav');
  const compBtn = document.getElementById('mailComposeBtn');
  const refBtn = document.getElementById('mailRefreshBtn');
  const cancBtn = document.getElementById('mailCancelBtn');
  const sndBtn = document.getElementById('mailSendBtn');
  const delAllBtn = document.getElementById('mailDeleteAllBtn');
  const markAllBtn = document.getElementById('mailMarkAllReadBtn');
  const compCard = document.getElementById('mailComposeCard');

  // Folder switch
  nav?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-folder]');
    if (!btn) return;
    mailFolder = btn.dataset.folder; // 'inbox' or 'sent'

    const inboxBtn = document.getElementById('mailTabInbox');
    const sentBtn = document.getElementById('mailTabSent');

    if (mailFolder === 'sent') {
      inboxBtn.classList.remove('active', 'btn-outline-primary');
      inboxBtn.classList.add('btn-outline-secondary');
      sentBtn.classList.add('active', 'btn-outline-primary');
      sentBtn.classList.remove('btn-outline-secondary');
    } else {
      inboxBtn.classList.add('active', 'btn-outline-primary');
      inboxBtn.classList.remove('btn-outline-secondary');
      sentBtn.classList.remove('active', 'btn-outline-primary');
      sentBtn.classList.add('btn-outline-secondary');
    }

    const titleEl = document.getElementById('mailListTitle');
    if (titleEl) titleEl.textContent = mailFolder === 'sent' ? 'Verzonden' : 'Inbox';

    renderMailList();
    const detailEl = document.getElementById('mailDetail');
    if (detailEl) detailEl.innerHTML = '<div class="text-muted small">Selecteer een bericht…</div>';
  });

  // Compose
  compBtn?.addEventListener('click', () => {
    compCard?.classList.toggle('d-none');
    if (!compCard?.classList.contains('d-none')) {
      prepareComposeOptions();
      const subj = document.getElementById('mailSubjectInput');
      const body = document.getElementById('mailBodyInput');
      if (subj) subj.value = '';
      if (body) body.value = '';
      composeThreadId = null;
    }
  });

  cancBtn?.addEventListener('click', () => {
    compCard?.classList.add('d-none');
    composeThreadId = null;
  });

  sndBtn?.addEventListener('click', async () => {
    const toSelect = document.getElementById('mailToSelect');
    const subjInput = document.getElementById('mailSubjectInput');
    const bodyInput = document.getElementById('mailBodyInput');

    const toVal = toSelect?.value;
    const subject = (subjInput?.value || '').trim();
    const body = (bodyInput?.value || '').trim();

    if (!toVal || !subject || !body) return toast('Vul aan: geadresseerde, onderwerp en bericht', 'warning');

    const meUid = currentUserId; // afzender is altijd de ingelogde gebruiker
    try {
      if (isAdmin()) {
        const userUid = toVal.startsWith('user:') ? toVal.split(':')[1] : null;
        if (!userUid) return toast('Kies gebruiker', 'warning');
        await sendAdminReplyToUser(meUid, userUid, subject, body);
        toast('Bericht verzonden aan gebruiker', 'success');
      } else {
        await sendUserMessageToAdmins(subject, body, composeThreadId || `conv:${meUid}`);
        toast('Bericht verzonden aan admins', 'success');
      }
      compCard?.classList.add('d-none');
      composeThreadId = null;
    } catch (e) {
      console.error(e);
      toast('Versturen mislukt', 'danger');
    }
  });

  // Refresh
  refBtn?.addEventListener('click', () => {
    if (currentUserId) listenMailbox(currentUserId);
  });

  // Delete All
  delAllBtn?.addEventListener('click', async () => {
    const uid = currentUserId;
    if (!uid) return;
    const folderName = mailFolder === 'sent' ? 'verzonden items' : 'inbox';
    const messagesToDelete = filteredMessages();

    if (messagesToDelete.length === 0) return toast(`Er zijn geen berichten in je ${folderName}.`, 'info');
    if (
      !confirm(
        `Weet je zeker dat je alle ${messagesToDelete.length} berichten in je ${folderName} permanent wilt verwijderen?`
      )
    )
      return;

    try {
      const deletions = messagesToDelete.map(m => {
        let docRef;
        if (m._source === 'admin_mail') {
          docRef = doc(db, 'admin_mail', m._id);
        } else {
          docRef = doc(db, 'users', uid, 'mailbox', m._id);
        }
        return deleteDoc(docRef);
      });
      await Promise.all(deletions);
      toast(`Alle berichten verwijderd.`, 'success');
      const detailEl = document.getElementById('mailDetail');
      if (detailEl) {
        detailEl.innerHTML = '<div class="text-muted small">Selecteer een bericht…</div>';
        delete detailEl.dataset.openId;
      }
    } catch (err) {
      console.error('Fout:', err);
      toast('Er ging iets mis.', 'danger');
    }
  });

  // Mark All Read
  markAllBtn?.addEventListener('click', async () => {
    const uid = currentUserId;
    if (!uid) return;
    if (!confirm('Alle berichten in de inbox als gelezen markeren?')) return;

    const unreadInbox = mailboxCache.filter(m => (m.from?.uid !== uid || m.system) && m.read === false);
    if (unreadInbox.length === 0) return toast('Geen ongelezen berichten', 'info');

    try {
      const updates = unreadInbox.map(m => {
        let docRef;
        if (m._source === 'admin_mail') {
          docRef = doc(db, 'admin_mail', m._id);
        } else {
          docRef = doc(db, 'users', uid, 'mailbox', m._id);
        }
        return updateDoc(docRef, { read: true });
      });
      await Promise.all(updates);
      toast(`Gemarkeerd als gelezen`, 'success');
    } catch (err) {
      console.error('Fout:', err);
      toast('Er ging iets mis.', 'danger');
    }
  });

  // Lijst en Detail click listeners (Delegation)
  const listBody = document.getElementById('mailListBody');
  listBody?.addEventListener('click', async e => {
    const aOpen = e.target.closest('a.js-open');
    const bTog = e.target.closest('button.js-toggle');
    const bDel = e.target.closest('button.js-del');

    if (aOpen) {
      e.preventDefault();
      const msg =
        filteredMessages().find(x => x._id === aOpen.dataset.id) || mailboxCache.find(x => x._id === aOpen.dataset.id);
      if (msg) openMail(msg);
    } else if (bTog) {
      const id = bTog.dataset.id;
      const msg = mailboxCache.find(x => x._id === id);
      await markMailRead(id, !msg?.read);
    } else if (bDel) {
      const id = bDel.dataset.id;
      if (!confirm('Dit bericht verwijderen?')) return;
      await deleteMail(id);
      toast('Bericht verwijderd', 'success');
    }
  });

  const detailEl = document.getElementById('mailDetail');
  detailEl?.addEventListener('click', e => {
    const markUn = e.target.closest('.js-mark-unread');
    const delBtn = e.target.closest('.js-del');
    const reply = e.target.closest('.js-reply');

    if (markUn) {
      markMailRead(markUn.dataset.id, false);
      toast('Gemarkeerd als ongelezen', 'success');
    } else if (delBtn) {
      if (!confirm('Dit bericht verwijderen?')) return;
      deleteMail(delBtn.dataset.id).then(() => toast('Bericht verwijderd', 'success'));
    } else if (reply) {
      const id = reply.dataset.id;
      const msg = mailboxCache.find(x => x._id === id);
      if (!msg) return;
      compCard?.classList.remove('d-none');
      prepareComposeToCounterparty(msg);
      // Scroll naar compose
      if (compCard) window.scrollTo({ top: compCard.offsetTop - 80, behavior: 'smooth' });
    }
  });
}

function bindMail() {
  // activeer bij login / gebruikerswissel
  document.querySelector('a[href="#tab-mail"]')?.addEventListener('shown.bs.tab', () => {
    bindMailboxUIOnce();
    if (currentUserId) listenMailbox(currentUserId);
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

function notificationItemHtml(n) {
  const time = n.timestamp ? new Date(n.timestamp).toLocaleString('nl-BE') : '';
  return `<div>${escapeHtml(n.text)}</div><div class="text-muted small">${time}</div>`;
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
      li.className = `mb-1 p-1 rounded ${n.read ? '' : 'bg-light unread'}`;
      li.innerHTML = notificationItemHtml(n);
      notifList.appendChild(li);
    });

    if (!isFirstRun) {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') sendBrowserNotification('Nieuwe melding', change.doc.data().text);
      });
    }
    isFirstRun = false;

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
    li.className = `mb-1 p-1 rounded ${n.read ? '' : 'bg-light unread'}`;
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

/** Melding maken (max. één keer per dag dezelfde tekst) + kopie als systeembericht in de mailbox. */
async function createUniqueNotification(uid, text) {
  const colRef = collection(db, 'users', uid, 'notifications');
  const dayKey = todayISO();
  const snap = await getDocs(query(colRef, where('text', '==', text), where('dateKey', '==', dayKey)));
  if (!snap.empty) return;

  await addDoc(colRef, { text, timestamp: new Date().toISOString(), dateKey: dayKey, read: false });
  await sendSystemMail(uid, 'Notificatie', text, 'notification');
}

/** Melding + bericht naar een gebruiker bij een projectwijziging door een admin. */
async function notifyProjectChange(userId, type, projectName, newEndDate = null) {
  const text =
    type === 'added'
      ? `Admin heeft een nieuw project toegevoegd: ${projectName}`
      : `Admin heeft het project "${projectName}" verlengd tot ${newEndDate}`;
  const colRef = collection(db, 'users', userId, 'notifications');
  const dayKey = todayISO();
  const snap = await getDocs(query(colRef, where('text', '==', text), where('dateKey', '==', dayKey)));
  if (snap.empty) await addDoc(colRef, { text, timestamp: new Date().toISOString(), dateKey: dayKey, read: false });
  await sendSystemMail(userId, 'Projectupdate', text, 'notification');
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
    notifList.innerHTML = '';
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
  for (const key of ['notifyDailyEmpty', 'notifyWeeklyEmpty', 'notifyMonthlyGoal', 'notifyProjectEnd']) {
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
      notifyDailyEmpty: document.getElementById('prefNotifyDailyEmpty').checked,
      notifyWeeklyEmpty: document.getElementById('prefNotifyWeeklyEmpty').checked,
      notifyMonthlyGoal: document.getElementById('prefNotifyMonthlyGoal').checked,
      notifyProjectEnd: document.getElementById('prefNotifyProjectEnd').checked
    };
    await setMySetting('notificationPrefs', prefs, 'Notificatie-voorkeuren opgeslagen');
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
// Gebruiker wisselen in de topbalk, rechten en team-rooster.
// ======================================================================

/** Keuzelijst + knoppen (rol, schoolverlof, verwijderen) in de topbalk voor admins. */
function initTopbarAdminSwitcher() {
  const container = document.getElementById('topbarAdminSwitch');
  if (!container) return;

  container.innerHTML = `
    <div class="d-flex align-items-center gap-2">
      <select id="topbarUserSelect" class="form-select form-select-sm" aria-label="Gebruiker bekijken"></select>
      <div id="topbarControls" class="d-none d-flex align-items-center gap-2 border-start ps-2 ms-1">
        <select id="topbarRoleSelect" class="form-select form-select-sm" style="width: auto;" title="Rol wijzigen">
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <button id="topbarSchoolBtn" class="btn btn-sm btn-outline-secondary d-flex align-items-center justify-content-center"
                style="width: 32px; height: 31px;" title="Schoolverlof Aan/Uit">
          <span class="material-icons-outlined" style="font-size:18px">school</span>
        </button>
        <button id="topbarDeleteBtn" class="btn btn-sm btn-outline-danger d-flex align-items-center justify-content-center"
                style="width: 32px; height: 31px;" title="Gebruiker verwijderen">
          <span class="material-icons-outlined" style="font-size:18px">person_remove</span>
        </button>
      </div>
    </div>
  `;
  container.classList.remove('d-none');

  const select = document.getElementById('topbarUserSelect');
  const controls = document.getElementById('topbarControls');
  const roleSelect = document.getElementById('topbarRoleSelect');
  const schoolBtn = document.getElementById('topbarSchoolBtn');
  const deleteBtn = document.getElementById('topbarDeleteBtn');

  const refreshUserList = () => {
    select.innerHTML = '<option value="">-- Mijzelf --</option>';
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
    controls.classList.toggle('d-none', !u);
    if (!u) return;
    roleSelect.value = u.role || 'user';
    const schoolEnabled = u.settings?.schoolLeaveEnabled !== false;
    schoolBtn.className = `btn btn-sm ${schoolEnabled ? 'btn-success text-white' : 'btn-outline-secondary'} d-flex align-items-center justify-content-center`;
  };

  refreshUserList();
  updateControlState(select.value);

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

// --- Team-rooster ---

/** Vaste pastelkleur op basis van een tekst. */
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash % 360)}, 70%, 80%)`;
}

/** Kleur/afkorting van een shift in het team-rooster. */
function getShiftStyle(shiftKey, userShifts = {}) {
  const shiftDef = userShifts?.[shiftKey] || null;
  const name = shiftDef?.realName || shiftKey;
  const sLower = name.toLowerCase();
  const letter = shiftDef?.shortName || name.substring(0, 2).toUpperCase();

  // Eigen kleur gaat voor (#e9ecef = standaard grijs)
  if (shiftDef?.color && shiftDef.color !== '#e9ecef') {
    return {
      class: '',
      style: `background-color: ${shiftDef.color}; color: #000; font-weight:600; border:1px solid rgba(0,0,0,0.1);`,
      letter,
      label: name,
      isGlobal: false
    };
  }

  // Vaste kleuren voor bekende shiften
  if (['ziekte', 'ziek'].includes(sLower)) return { class: 'bg-shift-sick', letter, label: 'Ziekte', isGlobal: true };
  if (['verlof', 'feestdag'].includes(sLower))
    return { class: 'bg-shift-leave', letter: 'V', label: 'Verlof', isGlobal: true };
  if (['school', 'schoolverlof'].includes(sLower))
    return { class: 'bg-shift-school', letter: 'S', label: 'School', isGlobal: true };
  if (sLower === 'stage') return { class: 'bg-shift-stage', letter: 'St', label: 'Stage', isGlobal: true };
  if (sLower === 'bench') return { class: '', letter: '-', label: 'Bench', isGlobal: true };
  if (sLower.includes('vroege')) return { class: 'bg-shift-vroege', letter, label: 'Vroege', isGlobal: true };
  if (sLower.includes('late')) return { class: 'bg-shift-late', letter, label: 'Late', isGlobal: true };
  if (sLower.includes('nacht')) return { class: 'bg-shift-nacht', letter, label: 'Nacht', isGlobal: true };
  if (sLower.includes('vrij weekend'))
    return { class: 'bg-shift-normal', letter: 'Vw', label: 'Vrij weekend', isGlobal: true };
  if (sLower.includes('dag')) return { class: 'bg-shift-dag', letter, label: 'Dagdienst', isGlobal: true };

  return {
    class: '',
    style: `background-color: ${stringToColor(name)}; color: #333; font-weight:600;`,
    letter,
    label: name,
    isGlobal: false
  };
}

function initRoosterSelectors() {
  const rMonth = document.getElementById('roosterMonth');
  const rYear = document.getElementById('roosterYear');
  if (!rMonth || !rYear) return;

  if (rMonth.options.length === 0) {
    rMonth.innerHTML = monthsFull.map((m, i) => `<option value="${i}">${m}</option>`).join('');
    rMonth.value = new Date().getMonth();
  }
  if (rYear.options.length === 0) {
    const yNow = new Date().getFullYear();
    for (let y = yNow - 1; y <= yNow + 2; y++) {
      rYear.insertAdjacentHTML('beforeend', `<option value="${y}" ${y === yNow ? 'selected' : ''}>${y}</option>`);
    }
  }
  rMonth.onchange = renderTeamRooster;
  rYear.onchange = renderTeamRooster;

  const refreshBtn = document.getElementById('refreshRoosterBtn');
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      toast('Rooster verversen...', 'info');
      await loadAllUsers();
      renderTeamRooster();
    };
  }
}

/** Team-rooster: per gebruiker een rij, per dag de (eerste) shift + legende. */
function renderTeamRooster() {
  const rBody = document.getElementById('roosterBody');
  const rHead = document.getElementById('roosterHeaderRow');
  const rLegend = document.getElementById('roosterLegendContainer');
  if (!rBody || !rHead) return;

  const year = Number(document.getElementById('roosterYear').value);
  const month = Number(document.getElementById('roosterMonth').value);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const globalShifts = new Map();
  const userSpecificShifts = new Map();

  let headerHtml = '<th style="min-width:150px; background:#fff; position:sticky; left:0; z-index:30;">Werknemer</th>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dayIndex = new Date(year, month, d).getDay();
    const isWeekend = dayIndex === 0 || dayIndex === 6;
    headerHtml += `
      <th class="${isWeekend ? 'bg-light text-muted' : ''}" style="min-width:35px; font-weight:normal; font-size:0.8rem;">
        <div>${d}</div><div>${daysFull[dayIndex].charAt(0)}</div>
      </th>`;
  }
  rHead.innerHTML = headerHtml;

  rBody.innerHTML = '';
  Object.values(dataStore.users)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .forEach(u => {
      const userName = escapeHtml(u.name || (u.email || '').split('@')[0] || '?');
      const rows = u.monthData?.[year]?.[month]?.rows || {};
      let rowHtml = `<th style="background:#fff; position:sticky; left:0; z-index:20;">${userName}</th>`;

      for (let d = 1; d <= daysInMonth; d++) {
        const key = dateKey(year, month, d);
        const firstKey = listDayKeys({ rows }, key).find(k => rows[k]?.shift);
        const rowData = firstKey ? rows[firstKey] : null;
        let cell = '<td class="rooster-cell"><div class="rooster-content"></div></td>';

        if (rowData) {
          const style = getShiftStyle(rowData.shift, u.shifts);
          const tooltip = escapeHtml(`${style.label} (${rowData.start} - ${rowData.end})`);
          cell = `<td class="rooster-cell ${style.class}" style="${style.style || ''}" title="${tooltip}"><div class="rooster-content">${escapeHtml(style.letter)}</div></td>`;
          if (style.letter !== '-') {
            if (style.isGlobal) globalShifts.set(style.label, style);
            else {
              if (!userSpecificShifts.has(userName)) userSpecificShifts.set(userName, new Map());
              userSpecificShifts.get(userName).set(style.label, style);
            }
          }
        }
        rowHtml += cell;
      }
      const tr = document.createElement('tr');
      tr.innerHTML = rowHtml;
      rBody.appendChild(tr);
    });

  if (!rLegend) return;
  const badge = (s, extra = '') =>
    `<span class="badge ${s.class || ''} border text-dark" style="font-weight:normal; font-size:0.75rem; ${s.style || ''}">${escapeHtml(s.letter)}${extra}</span>`;
  let legendHtml = '';
  if (globalShifts.size) {
    legendHtml +=
      '<div class="mb-2"><small class="text-muted fw-bold">Algemeen:</small><div class="d-flex flex-wrap gap-3 small mt-1">' +
      [...globalShifts.values()]
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(s => `<div class="d-flex align-items-center gap-1">${badge(s)} <span>${escapeHtml(s.label)}</span></div>`)
        .join('') +
      '</div></div>';
  }
  if (userSpecificShifts.size) {
    if (globalShifts.size) legendHtml += '<hr class="my-2">';
    legendHtml +=
      '<div class="mb-2"><small class="text-muted fw-bold">Specifiek per gebruiker:</small><div class="row g-2 mt-1">';
    userSpecificShifts.forEach((shiftsMap, userName) => {
      const badges = [...shiftsMap.values()]
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(s => badge(s, ` = ${escapeHtml(s.label)}`))
        .join(' ');
      legendHtml += `
        <div class="col-12 col-md-auto">
          <div class="d-flex align-items-center flex-wrap gap-2 small bg-light p-1 px-2 rounded border">
            <strong class="text-nowrap me-1">${userName}:</strong> ${badges}
          </div>
        </div>`;
    });
    legendHtml += '</div></div>';
  }
  rLegend.innerHTML = legendHtml || '<small class="text-muted fst-italic">Geen shiften gepland deze maand.</small>';
}

function bindAdmin() {
  document.querySelector('#navTabs a[href="#tab-team-rooster"]')?.addEventListener('shown.bs.tab', () => {
    initRoosterSelectors();
    renderTeamRooster();
  });
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
  bindAdmin();
}

initApp();
