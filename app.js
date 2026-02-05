import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
// A. De Firestore imports (zonder storage)
import {
  getFirestore,
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

// B. De Storage imports (in een nieuw blok)
import { 
  getStorage, 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject,
  uploadBytesResumable
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js';

    // ===== Firebase config (jouw bestaande waarden) =====
    const firebaseConfig = {
      apiKey: "AIzaSyB8uHwRXCe1iV7z6T80YPxEbeB64qdMpNY",
      authDomain: "shift-planner-dc7ad.firebaseapp.com",
      projectId: "shift-planner-dc7ad",
      storageBucket: "shift-planner-dc7ad.firebasestorage.app",
      messagingSenderId: "719441527396",
      appId: "1:719441527396:web:de87d6f950fe23702a5571"
    };

    // ===== App init =====
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const storage = getStorage(app);

// ======= State =======
    let currentUserId = null;
    let mailUIBound = false;
    let notificationInterval = null;
    let editingProjectIndex = null;
    
    // --- NIEUWE VARIABELEN HIER NAARTOE VERPLAATST ---
    let isPaintMode = false;
    let selectedPaintShiftKey = null;
    
    // --------------------------------------------------

    const dataStore = { 
      users: {}, 
      currentUser: null,
      notifications: [] 
    };
    let saveTimer = null; 
    const debouncedSave = () => {
      clearTimeout(saveTimer); 
      saveTimer = setTimeout(() => {
        saveUserData(); 
        console.log("DB: Data opgeslagen (met vertraging).");
      }, 2000); 
    };
    // ======= Elements =======
    const sidebar = document.getElementById('sidebar');
    const main = document.getElementById('main');
    const logoutBtn = document.getElementById('logoutBtn');
    const currentUserName = document.getElementById('currentUserName');
    const adminTabBtn = document.getElementById('adminTabBtn');

// activeer bij login / gebruikerswissel
document.querySelector('a[href="#tab-mail"]')?.addEventListener('shown.bs.tab', () => {
  bindMailboxUIOnce();
  // 👈 FIX: Gebruik altijd de ID van de ingelogde user, niet de bekeken user
  if (currentUserId) listenMailbox(currentUserId); 
});

    // Tabs: Shifts
    const filterShiftYear = document.getElementById('filterShiftYear');
    const shiftTableBody = document.getElementById('shiftTableBody');

    // Invoer elements
    const monthSelectMain = document.getElementById('monthSelectMain');
    const yearSelectMain = document.getElementById('yearSelectMain');
    const projectFilterSelect = document.getElementById('projectFilterSelect');
    const monthTargetHours = document.getElementById('monthTargetHours');
    const monthTargetMinutes = document.getElementById('monthTargetMinutes');
    const tbody = document.getElementById('tbody');

    // Historiek
    const historyBody = document.getElementById('historyBody');
    const historiekJaar = document.getElementById('historiekJaar');
    const currentUserHistoriek = document.getElementById('currentUserHistoriek');

    // Admin
    const adminUserSelect = document.getElementById('adminUserSelect');
    const roleSelect = document.getElementById('roleSelect');
    const addUserBtn = document.getElementById('addUserBtn');
    const updateRoleBtn = document.getElementById('updateRoleBtn');
    const removeUserBtn = document.getElementById('removeUserBtn');
    const activeUserLabel = document.getElementById('activeUserLabel');
    const projectTableBody = document.getElementById('projectTableBody');
    const newProjectName = document.getElementById('newProjectName');
    const newProjectStart = document.getElementById('newProjectStart');
    const newProjectEnd = document.getElementById('newProjectEnd');
    const addProjectBtn = document.getElementById('addProjectBtn');
    const auditLog = document.getElementById('auditLog');
    const adminApprovalTabBtn = document.getElementById('adminApprovalTabBtn');
    const approvalUserSelect = document.getElementById('approvalUserSelect');
    const approvalYearSelect = document.getElementById('approvalYearSelect');
    const approvalActiveUserLabel = document.getElementById('approvalActiveUserLabel');
    const approvalYearlyOverview = document.getElementById('approvalYearlyOverview');
    const adminLeaveTabBtn = document.getElementById('adminLeaveTabBtn');
    const leaveRequestTableBody = document.getElementById('leaveRequestTableBody');
    const refreshLeaveRequestsBtn = document.getElementById('refreshLeaveRequestsBtn');

    // Shift modal fields
    const newShiftName = document.getElementById('newShiftName');
    const newShiftStart = document.getElementById('newShiftStart');
    const newShiftEnd = document.getElementById('newShiftEnd');
    const newShiftBreak = document.getElementById('newShiftBreak');
    const newShiftProjectSelect = document.getElementById('newShiftProjectSelect');
    const newShiftStartDate = document.getElementById('newShiftStartDate');
    const newShiftEndDate = document.getElementById('newShiftEndDate');
    const addShiftBtn = document.getElementById('addShiftBtn');

    // Quick input
    const quickDate = document.getElementById('quickDate');
    const quickShift = document.getElementById('quickShift');
    const quickNote = document.getElementById('quickNote');
    const saveQuickBtn = document.getElementById('saveQuickBtn');
// --- helpers: mapping & automatische projecttoewijzing ---
const SPECIAL_PROJECT_MAP = {
  'Verlof': 'Eght Care',
  'Ziekte': 'Eght Care',
  'Teammeeting': 'Eght Care',
  'School': 'PXL Verpleegkunde Hasselt',
  'Schoolverlof': 'PXL Verpleegkunde Hasselt'
};
function isValidProject(name) {
  const ud = getCurrentUserData();
  return !!(ud.projects || []).find(p => p.name === name);
}
function autoProjectForShift(shiftName){
  return SPECIAL_PROJECT_MAP[shiftName] || null;
}
    // ======= UI helpers =======
    const daysFull = ["Zondag","Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag"];
    const monthsFull = ["Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"];
    const LEAVE_SHIFT_NAMES = ['Verlof'];              // telt mee als "verlof"
const SCHOOL_LEAVE_SHIFT_NAMES = ['Schoolverlof']; // telt mee als "schoolverlof"
    const toast = (msg, type='primary') => {
      const el = document.createElement('div');
      el.className = `toast align-items-center text-bg-${type} border-0 position-fixed bottom-0 end-0 m-3`;
      el.role = 'alert'; el.ariaLive='assertive'; el.ariaAtomic='true';
      el.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
      document.body.appendChild(el);
      new bootstrap.Toast(el, { delay: 2500 }).show();
      el.addEventListener('hidden.bs.toast', ()=> el.remove());
    };

    const dateKey = (y,m,d)=> `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const toDisplayDate = iso => !iso ? '-' : iso.split('-').reverse().join('-');
    const fromDisplayDate = disp => {const [d,m,y]=disp.split('-'); return `${y}-${m}-${d}`;};
    const minutesBetween = (s,e,b)=> {
      if(!s||!e) return 0;
      const [sh,sm]=s.split(':').map(Number), [eh,em]=e.split(':').map(Number);
      let mins = (eh*60+em) - (sh*60+sm) - (Number(b)||0);
      if(mins<0) mins+=1440;
      return mins;
    };
    const isDateWithin = (iso, start, end) => {
      const d = iso?.replaceAll('-',''); if(!d) return false;
      const s = start? start.replaceAll('-',''): null;
      const e = end? end.replaceAll('-',''): null;
      if(s && d < s) return false; if(e && d > e) return false; return true;
    };
// ===== per gebruiker per maand =====
function ensureUserMonthlyMap(ud){
  ud.settings ||= {};
  ud.settings.multiByMonth ||= {}; // { 'YYYY-MM': true }
  return ud.settings.multiByMonth;
}
function userAllowsMultiMonth(ud, year, month){ // month: 0..11
  const key = `${year}-${String(month+1).padStart(2,'0')}`;
  return !!(ud.settings?.multiByMonth?.[key]);
}
function canAddMultiForProject(projectName) {
  const ud = getCurrentUserData();
  if (!projectName) return false;
  const p = (ud.projects || []).find(px => px.name === projectName);
  return !!p?.allowMulti;
}
function listDayKeys(monthData, dateKey) {
  if (!monthData || !monthData.rows) return [];
  
  // Filter alle keys die BEGINNEN met de datum string
  return Object.keys(monthData.rows)
    .filter(k => k === dateKey || k.startsWith(dateKey + '_'))
    .sort(); // Sorteer zodat ze netjes op volgorde staan
}
function nextLineIndex(md, baseKey) {
  const keys = listDayKeys(md, baseKey);
  let n = 2;
  while (keys.includes(`${baseKey}#${n}`)) n++;
  return n;
}
// ===== HOME DASHBOARD =====
function fmt(mins){ return `${Math.floor(mins/60)}u ${mins%60}min`; }

// ✅ DEZE FUNCTIE IS NU "GRATIS" EN LEEST UIT DE CACHE
function loadHomeNotifications() {
  try {
    if (!currentUserId) return;
    const listEl = document.getElementById('homeNotifList');
    if (!listEl) return;

    // Haal de eerste 5 meldingen op uit de dataStore (die al geladen is)
    const notifications = dataStore.notifications.slice(0, 5);

    listEl.innerHTML = '';
    if (notifications.length === 0) {
      listEl.innerHTML = '<li class="text-muted small">Geen meldingen.</li>';
      return;
    }
    
    notifications.forEach(n => {
      const when = n.timestamp ? new Date(n.timestamp).toLocaleString('nl-BE') : '';
      listEl.insertAdjacentHTML('beforeend',
        `<li class="small mb-1">${n.text}<br><span class="text-muted">${when}</span></li>`);
    });
  } catch(e){ console.error(e); }
}
function renderHome() {
  const ud = getCurrentUserData();
  const name = ud.name || ud.email || '-';
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const md = ud.monthData?.[y]?.[m] || { rows:{}, targetHours:0, targetMinutes:0 };

  // header
  const userEl = document.getElementById('homeUserName');
  if (userEl) userEl.textContent = name;
  const monthNameEl = document.getElementById('homeMonthName');
  if (monthNameEl) monthNameEl.textContent = `${monthsFull[m]} ${y}`;

  // totals
  const planned = Object.values(md.rows || {}).reduce((s, r) => {
  if (r.status && r.status !== 'approved') {
    return s; // Tel niet mee (pending/rejected)
  }
  return s + (Number(r.minutes) || 0);
}, 0);
  const target  = (Number(md.targetHours)||0)*60 + (Number(md.targetMinutes)||0);
  const diff    = planned - target;
  const pct     = target > 0 ? Math.min(100, Math.round(planned/target*100)) : 0;

  const elP = document.getElementById('homeMonthPlanned');
  const elT = document.getElementById('homeMonthTarget');
  const elD = document.getElementById('homeMonthDiff');
  if (elP) elP.textContent = fmt(planned);
  if (elT) elT.textContent = fmt(target);
  if (elD) elD.textContent = `${diff>=0?'+':''}${fmt(Math.abs(diff))}`;

  const bar = document.getElementById('homeMonthProgress');
  const barLbl = document.getElementById('homeMonthProgressLabel');
  if (bar) {
    bar.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(pct));
    bar.classList.remove('bg-success','bg-warning');
    bar.classList.add(planned >= target && target>0 ? 'bg-success' : 'bg-warning');
    if (barLbl) barLbl.textContent = `${pct}%`;
  }

  // status badge
  const st = document.getElementById('homeMonthStatus');
  if (st) {
    const status = getMonthStatus(y, m);
    st.textContent =
      status==='draft'     ? 'Concept' :
      status==='submitted' ? 'Ingediend' :
      status==='approved'  ? 'Goedgekeurd' : 'Afgekeurd';
    st.className = 'badge';
    st.classList.add(
      status==='approved'  ? 'bg-success' :
      status==='submitted' ? 'bg-primary' :
      status==='rejected'  ? 'bg-danger' : 'bg-secondary-subtle','text-dark'
    );
  }

  // verlof chips
  const leaveAllow = getLeaveAllowanceMinutes();
  const leaveTaken = sumTakenMinutesFor(y, LEAVE_SHIFT_NAMES);
  const leaveRemain = leaveAllow - leaveTaken;
  const leaveEl = document.getElementById('homeLeave');
  if (leaveEl) {
    leaveEl.textContent = !leaveAllow
  ? 'Verlof: niet ingesteld'
  : (leaveRemain >= 0
      ? `Verlof: ${fmt(leaveRemain)} over`
      : `Verlof: -${fmt(Math.abs(leaveRemain))} overschreden`);
    leaveEl.className = `badge ${leaveRemain<0 ? 'bg-danger' : (leaveAllow? 'bg-success':'bg-secondary-subtle text-dark')}`;
  }

const schAllow = getSchoolLeaveAllowanceMinutes(y, m);
const { startISO, endISO, label } = getAcademicYearBounds(y, m);
const schTaken = sumTakenMinutesForRange(startISO, endISO, SCHOOL_LEAVE_SHIFT_NAMES);
const schRemain = schAllow - schTaken;

const schEl = document.getElementById('homeSchoolLeave');
if (schEl) {
  if (!schAllow) {
    schEl.textContent = 'Schoolverlof: niet ingesteld — ' + label;
    schEl.className = 'badge bg-secondary-subtle text-dark';
  } else {
    schEl.textContent = schRemain >= 0
      ? `Schoolverlof: ${fmt(schRemain)} over — ${label}`
      : `Schoolverlof: -${fmt(Math.abs(schRemain))} overschreden — ${label}`;
    schEl.className = `badge ${schRemain < 0 ? 'bg-danger' : (schRemain === 0 ? 'bg-warning text-dark' : 'bg-success')}`;
  }
}

  // actieve projecten (vandaag)
  const todayISO = new Date().toISOString().slice(0,10);
  const projWrap = document.getElementById('homeProjects');
  if (projWrap) {
    const list = (ud.projects||[]).filter(p => isDateWithin(todayISO, p.start||null, p.end||null));
    if (!list.length) {
      projWrap.innerHTML = '<div class="text-muted small">Geen actieve projecten vandaag.</div>';
    } else {
      projWrap.innerHTML = list.map(p => `
        <div class="col-12 col-sm-6 col-md-4">
          <div class="border rounded p-2 h-100">
            <div class="fw-semibold">${p.name}</div>
            <div class="text-muted small">${toDisplayDate(p.start)} – ${toDisplayDate(p.end)}</div>
          </div>
        </div>`).join('');
    }
  }

  // laatste meldingen
  loadHomeNotifications();
  initAnnouncements();
}

// Snelkoppelingen op Home
document.getElementById('homeBtnQuickInput')?.addEventListener('click', () => {
  new bootstrap.Modal(document.getElementById('quickModal')).show();
});
document.getElementById('homeBtnNewShift')?.addEventListener('click', () => {
  new bootstrap.Modal(document.getElementById('shiftModal')).show();
});
document.getElementById('homeBtnGoInvoer')?.addEventListener('click', () => {
  const a = document.querySelector('a[href="#tab-invoer"]');
  if (a) new bootstrap.Tab(a).show();
});
// ======= Maandstatus helpers (global) =======
// status: 'draft' | 'submitted' | 'approved' | 'rejected'
function getMonthStatus(y, m){
  const ud = getCurrentUserData();
  return ud.monthData?.[y]?.[m]?.status || 'draft';
}

async function setMonthStatus(y, m, status){
  const ud = getCurrentUserData();
  ud.monthData ||= {};
  ud.monthData[y] ||= {};
  ud.monthData[y][m] ||= { targetHours:0, targetMinutes:0, rows:{} };
  ud.monthData[y][m].status = status;
  await saveUserData();
  updateMonthStatusBadge();
}

function updateMonthStatusBadge(){
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const status = getMonthStatus(y,m);
  const badge = document.getElementById('monthStatusBadge');
  const submitBtn = document.getElementById('submitMonthBtn');
  
  if (!badge) return;

  // 1. Badge tekst en kleur (zoals voorheen)
  badge.className = 'badge badge-status';
  if (status==='draft'){ badge.classList.add('badge-draft'); badge.textContent='Concept'; }
  if (status==='submitted'){ badge.classList.add('badge-submitted'); badge.textContent='Ingediend'; }
  if (status==='approved'){ badge.classList.add('badge-approved'); badge.textContent='Goedgekeurd'; }
  if (status==='rejected'){ badge.classList.add('badge-rejected'); badge.textContent='Afgekeurd'; }

  // 2. BEPALEN WIE ER KIJKT (De Fix)
  // We kijken naar de rol van de ECHTE ingelogde user (currentUserId),
  // niet naar de user die we aan het bekijken zijn.
  const loggedInUser = dataStore.users[currentUserId];
  const iAmAdmin = loggedInUser && loggedInUser.role === 'admin';

  // 3. Verberg knoppen ALLEEN als:
  // - De status 'submitted' of 'approved' is
  // - EN de kijker GEEN admin is.
  const hide = (status === 'submitted' || status === 'approved') && !iAmAdmin;

  // 4. Knoppen aanpassen
  if (submitBtn){
    // Als admin zie je de knop altijd, maar we kunnen hem uitschakelen als hij al 'approved' is
    // om verwarring te voorkomen, of gewoon altijd tonen. 
    // Volgens jouw wens: "Admin moet knoppen altijd zien".
    
    // We verbergen hem alleen voor gewone users als hij vaststaat.
    submitBtn.classList.toggle('d-none', hide);
    submitBtn.disabled = hide; 
  }

  // De knop "Invoer meerdere dagen"
const mBtn = document.getElementById('multiDayShiftBtn');
  
  if (mBtn){
    mBtn.classList.toggle('d-none', hide);
    mBtn.disabled = hide;
  }
}
// ======= Auth =======
onAuthStateChanged(auth, async (user) => {
    // Stop alle intervals als we uitloggen
    if (notificationInterval) clearInterval(notificationInterval);

    // ✅ Kleur laden (instant)
    const savedColor = localStorage.getItem('accentColor');
    if (savedColor) {
        applyAccentColor(savedColor);
    }

    // 1. GEEN GEBRUIKER? REDIRECT!
    if (!user) {
        window.location.replace('index.html');
        return; // Stop hier
    }

    // 2. WEL EEN GEBRUIKER? TOON DE APP!
    document.body.classList.add('auth-checked');
    requestNotificationPermission();
    currentUserId = user.uid;

    // --- Veilige update van gebruikersnaam ---
    const nameEl = document.getElementById('currentUserName');
    if (nameEl) {
        nameEl.textContent = user.displayName || user.email;
    }

    // --- Profielfoto in topbar ---
    const topPhotoEl = document.getElementById('topbarProfilePhoto');
    if (topPhotoEl && user.photoURL) {
        topPhotoEl.src = user.photoURL;
    } else if (topPhotoEl) {
        // Fallback
        topPhotoEl.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgZmlsbD0iY3VycmVudENvbG9yIiBjbGFzcz0iYmkgYmktcGVyc29uLWZpbGwiIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZD0iTTMgMTQgczEtMiAyLTIgMiAyIDIgMiAyLTItMi0yem01LTAiLz48cGF0aCBkPSJNODguNUM4IDcuNjcgNy4zMyA3IDYuNSA3UzUgNy42NyA1IDguNSA1LjY3IDEwIDYuNSAxMFM4IDkuMzMgOCA4LjV6bS0yIDBjMCAxLjExLS44OSAyLTIgMnMtMi0uODktMi0yIC44OS0yIDItMiAyIC44OSAyIDJ6bS0yLTNjLTMuMTQ2IDAtNS41IDIuNTM2LTUuNSA1LjVWMTloMTJ2LTIuNWMwLTIuOTY0LTIuMzU0LTUuNS01LjUtNS41eiIvPjwvc3ZnPg==';
    }

    await ensureUserDoc(user);
    await loadAllUsers();

    // ✅ Sidebar & accentkleur
    const ud = getCurrentUserData();
    if (ud?.settings?.accentColor) {
        applyAccentColor(ud.settings.accentColor);
    }

    if (ud?.settings?.sidebarCollapsed) {
        const sb = document.getElementById('sidebar');
        const mn = document.getElementById('main');
        if (sb) sb.classList.add('collapsed');
        if (mn) mn.classList.add('collapsed');
    }

    initSelectors();
    renderAll();
    await revealAdminIfNeeded();
    updateMonthStatusBadge();
    updateLeaveBadges();
    renderHome();

    // -----------------------------------------------------------
    // HIER ZAT DE FOUT: De '});' die hier stond is verwijderd
    // Zodat de code hieronder nog steeds toegang heeft tot 'user'
    // -----------------------------------------------------------

    // --- NIEUWE NOTIFICATIE LOGICA ---
    listenToNotifications(user.uid); // Start de listener

    // 🕒 Start automatische meldingensysteem
    await autoCheckNotifications(); // 1. Direct uitvoeren na login

    // 🔁 Herhaal automatisch elke 24 uur (86400000 ms)
    notificationInterval = setInterval(async () => {
        await autoCheckNotifications();
    }, 86400000);
    // --- EINDE NIEUWE LOGICA ---

    // --- NIEUWE MAILBOX LOGICA ---
    bindMailboxUIOnce();
    listenMailbox(user.uid);
    // --- EINDE NIEUWE LOGICA ---

    // ✅ Opstart-tabblad instellen
    try {
        if (ud?.settings?.defaultTab) {
            const tabLink = document.querySelector(`a[href="${ud.settings.defaultTab}"]`);
            if (tabLink) {
                bootstrap.Tab.getOrCreateInstance(tabLink).show();
            }
        }
    } catch (e) {
        console.warn("Kon standaard tab niet laden:", e);
    }

});

    logoutBtn?.addEventListener('click', async ()=>{
  await signOut(auth);
  window.location.href = 'index.html'; // 👈 redirect in plaats van reload
});

    async function ensureUserDoc(user){
      const ref = doc(db, 'users', user.uid);
      const snap = await getDoc(ref);
      if(!snap.exists()){
        await setDoc(ref, { email: user.email, name: user.displayName || user.email.split('@')[0], role:'user', shifts:{}, monthData:{}, projects:[], shiftOrder:[] });
      } else {
        const data = snap.data(), updates={};
        if(!('email' in data)) updates.email = user.email;
        if(!('name' in data)) updates.name = user.displayName || user.email.split('@')[0];
        if(!('role' in data)) updates.role = 'user';
        if(!('shifts' in data)) updates.shifts = {};
        if(!('monthData' in data)) updates.monthData = {};
        if(!('projects' in data)) updates.projects = [];
        if(!('shiftOrder' in data)) updates.shiftOrder = [];
        if(Object.keys(updates).length) await updateDoc(ref, updates);
      }
    }
function getActiveUserId() {
  // NIEUW: Kijk eerst naar de variabele die de Topbar instelt
  if (dataStore.viewUserId) return dataStore.viewUserId;
  
  // OUD: Dit mag weg of blijven als fallback, maar mag niet crashen
  const oldSelect = document.getElementById('adminUserSelect');
  if (oldSelect && oldSelect.value) return oldSelect.value;

  // FALLBACK: Gewoon de ingelogde gebruiker
  return currentUserId;
}
    // ======= Data loading/saving =======
    async function loadAllUsers(){
      const meRef = doc(db,'users', currentUserId);
      const meSnap = await getDoc(meRef);
      const me = meSnap.data();
      dataStore.users = {};
      if(me.role === 'admin'){
        const qs = await getDocs(collection(db,'users'));
        qs.forEach(d=> dataStore.users[d.id] = d.data());
      } else {
        dataStore.users[currentUserId] = me;
      }
      dataStore.currentUser = currentUserId;
    }

async function saveUserData(){
  const id = getActiveUserId();
  if (!id) return;
  const ref = doc(db,'users', id);
  await setDoc(ref, dataStore.users[id], { merge: true });
}

   function getCurrentUserData() {
  const id = getActiveUserId();
  if (!id) return { shifts:{}, monthData:{}, projects:[], shiftOrder:[] };
  if (!dataStore.users[id]) dataStore.users[id] = { shifts:{}, monthData:{}, projects:[], shiftOrder:[] };
  return dataStore.users[id];
}

    // ======= UI init =======
function initSelectors(){
  const yearSelect = document.getElementById('yearSelectMain');
  const monthSelect = document.getElementById('monthSelectMain');

  // 🛑 VEILIGHEIDSCHECK: Als de elementen er niet zijn, stop direct.
  if (!yearSelect || !monthSelect) {
    console.warn("initSelectors: Kon yearSelectMain of monthSelectMain niet vinden.");
    return;
  }

  // Jaren vullen
  const yNow = new Date().getFullYear();
  yearSelect.innerHTML = '';
  for (let y = yNow - 2; y <= yNow + 3; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === yNow) opt.selected = true;
    yearSelect.appendChild(opt);
  }

  // Huidige maand selecteren
  const mNow = new Date().getMonth();
  monthSelect.value = String(mNow);
}
// ==========================================
// FIX: FOUTMELDING NULL (Veilige check)
// ==========================================
async function revealAdminIfNeeded(){
      const id = getActiveUserId();
      if(!id) return;

      const meSnap = await getDoc(doc(db,'users', id));
      if (!meSnap.exists()) return;
      
      const role = meSnap.data().role;
      
      if(role === 'admin'){ 
        // We gebruiken '?.list' (optional chaining) of een if-check
        // zodat hij NIET crasht als je de knoppen hebt verwijderd.
        
        const btnAdmin = document.getElementById('adminTabBtn');
        if (btnAdmin) btnAdmin.classList.remove('d-none');

        const btnAppr = document.getElementById('adminApprovalTabBtn');
        if (btnAppr) btnAppr.classList.remove('d-none');

        const btnLeave = document.getElementById('adminLeaveTabBtn');
        if (btnLeave) btnLeave.classList.remove('d-none');

        const btnHome = document.getElementById('adminHomeTabBtn');
        if (btnHome) btnHome.classList.remove('d-none');
        
        const btnRooster = document.getElementById('adminRoosterTabBtn');
        if (btnRooster) btnRooster.classList.remove('d-none');
        // Activeer de wisselaar naast de bel
    initTopbarAdminSwitcher();
  }
}
// ✅ 2. De nieuwe functie voor de topbar-wisselaar
function initTopbarAdminSwitcher() {
  const container = document.getElementById('topbarAdminSwitch');
  if (!container) return;

  container.innerHTML = `
    <div class="d-flex align-items-center gap-2">   
      <select id="topbarUserSelect" class="form-select form-select-sm" style="width: auto; max-width: 180px;"></select>
      
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

  // --- A. Vul de lijst ---
  const refreshUserList = () => {
    select.innerHTML = '<option value="">-- Mijzelf --</option>';
    const users = Object.entries(dataStore.users).sort((a, b) => 
      (a[1].name || '').localeCompare(b[1].name || '')
    );
    users.forEach(([uid, u]) => {
      if (uid === currentUserId) return; 
      const opt = document.createElement('option');
      opt.value = uid;
      opt.textContent = u.name || u.email || uid;
      if (uid === dataStore.viewUserId) opt.selected = true;
      select.appendChild(opt);
    });
  };
  refreshUserList();

  // --- B. Update UI Helper ---
  const updateControlState = (uid) => {
    // 1. Label in Admin tab bijwerken (zodat je ziet wie je edit)
    const adminLabel = document.getElementById('adminSettingsName');
    if (adminLabel) {
        const uName = uid ? (dataStore.users[uid]?.name || uid) : "Mijzelf";
        adminLabel.textContent = uName;
        // Geef visueel aan als het niet jezelf is
        adminLabel.className = uid ? "text-primary fw-bold" : "text-muted";
    }

    // 2. Velden in Admin tab verversen (Verlof uren etc.)
    if (typeof hydrateAdminLeaveInputsFor === 'function') {
        hydrateAdminLeaveInputsFor(uid || currentUserId);
    }
    
    // 3. Knoppen in Topbar tonen/verbergen
    if (!uid) {
      controls.classList.add('d-none');
      return;
    }
    
    const u = dataStore.users[uid];
    if (!u) return;
    controls.classList.remove('d-none');
    roleSelect.value = u.role || 'user';
    
    const schoolEnabled = u.settings?.schoolLeaveEnabled !== false;
    schoolBtn.className = schoolEnabled 
      ? 'btn btn-sm btn-success text-white d-flex align-items-center justify-content-center' 
      : 'btn btn-sm btn-outline-secondary d-flex align-items-center justify-content-center';
  };

  // Initialiseren
  updateControlState(select.value);

  // --- C. Event: Wisselen ---
  select.onchange = async () => {
    const targetUid = select.value;
    dataStore.viewUserId = targetUid || null;

    if (!targetUid) {
      toast('Beheer teruggezet naar jezelf', 'info');
    } else {
      toast(`Beheer actief voor ${dataStore.users[targetUid]?.name || 'gebruiker'}`, 'primary');
    }
    
    updateControlState(targetUid);
    await renderUserDataAsAdmin(targetUid || currentUserId);
  };

  // --- D. Event: Rol ---
  roleSelect.onchange = async () => {
    const uid = select.value;
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'users', uid), { role: roleSelect.value });
      dataStore.users[uid].role = roleSelect.value;
      toast(`Rol aangepast`, 'success');
    } catch (err) { console.error(err); toast('Fout bij rol', 'danger'); }
  };

  // --- E. Event: Schoolverlof ---
  schoolBtn.onclick = async () => {
    const uid = select.value;
    if (!uid) return;
    const u = dataStore.users[uid]; u.settings ||= {};
    const newState = !(u.settings.schoolLeaveEnabled !== false);
    try {
      await updateDoc(doc(db, 'users', uid), { 'settings.schoolLeaveEnabled': newState });
      u.settings.schoolLeaveEnabled = newState;
      updateControlState(uid);
      if (typeof applySchoolLeaveVisibility === 'function') applySchoolLeaveVisibility();
      toast(`Schoolverlof ${newState ? 'AAN' : 'UIT'}`, 'success');
    } catch (err) { console.error(err); toast('Fout', 'danger'); }
  };

  // --- F. Event: Verwijderen (NIEUW) ---
  deleteBtn.onclick = async () => {
    const uid = select.value;
    if (!uid) return;
    if (!confirm('Weet je zeker dat je deze gebruiker wilt verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;

    try {
      await deleteDoc(doc(db, 'users', uid));
      delete dataStore.users[uid]; // Verwijder lokaal
      
      // Reset view naar jezelf
      select.value = "";
      dataStore.viewUserId = null;
      updateControlState(null);
      await renderUserDataAsAdmin(currentUserId);
      
      // Lijst verversen
      refreshUserList();
      
      toast('Gebruiker verwijderd', 'success');
    } catch (err) {
      console.error(err);
      toast('Verwijderen mislukt', 'danger');
    }
  };
}

// ======= Projects =======
function renderProjects() {
  const ud = getCurrentUserData();
  const projectTableBody = document.getElementById('projectTableBody');
  const newShiftProjectSelect = document.getElementById('newShiftProjectSelect');
  const projectFilterSelect = document.getElementById('projectFilterSelect');

  if (!projectTableBody) return;

  // Sorteren op startdatum
  const list = (ud.projects || []).slice().sort((a, b) => {
    const as = a.start ? new Date(a.start) : new Date('1900-01-01');
    const bs = b.start ? new Date(b.start) : new Date('1900-01-01');
    if (as.getTime() !== bs.getTime()) return as - bs;
    const ae = a.end ? new Date(a.end) : new Date('9999-12-31');
    const be = b.end ? new Date(b.end) : new Date('9999-12-31');
    return ae - be;
  });

  // Tabel en dropdowns resetten
  projectTableBody.innerHTML = '';
  if (newShiftProjectSelect) newShiftProjectSelect.innerHTML = '<option value="">Geen project</option>';
  if (projectFilterSelect) projectFilterSelect.innerHTML = '<option value="">Alle projecten</option>';

  list.forEach((p, idx) => {
    const tr = document.createElement('tr');
    if (p.allowMulti === undefined) p.allowMulti = false;

    // We bouwen de rij op
    tr.innerHTML = `
      <td>
        <div class="d-flex align-items-center">
            <div>
                <strong class="text-dark">${p.name}</strong>
            </div>
        </div>
      </td>
      <td><span class="badge bg-light text-dark border">${toDisplayDate(p.start)}</span></td>
      <td><span class="badge bg-light text-dark border">${toDisplayDate(p.end)}</span></td>
      <td class="text-end">
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
        </div>
      </td>`;
    
    projectTableBody.appendChild(tr);

    // Dropdowns vullen
    if (newShiftProjectSelect) {
      const o1 = document.createElement('option'); o1.value = p.name; o1.textContent = p.name; newShiftProjectSelect.appendChild(o1);
    }
    if (projectFilterSelect) {
      const o2 = document.createElement('option'); o2.value = p.name; o2.textContent = p.name; projectFilterSelect.appendChild(o2);
    }
  });

  // ✨ NIEUW: Auto-datum invullen bij kiezen project in Shift Modal
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

  // Button acties koppelen
  projectTableBody.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ud = getCurrentUserData();
      // Zoek het originele index nummer in de ongesorteerde lijst op basis van object vergelijking
      // (Omdat 'list' gesorteerd is, komt 'idx' niet meer overeen met ud.projects)
      const clickedItem = list[Number(btn.dataset.idx)];
      const realIdx = ud.projects.indexOf(clickedItem);
      
      if (realIdx === -1) return;
      const p = ud.projects[realIdx];

      const action = btn.dataset.act;

      if (action === 'edit') {
        // ✨ BEWERK LOGICA ✨
        editingProjectIndex = realIdx; // Onthoud welk project we bewerken
        
        // Vul de modal
        document.getElementById('modalProjectName').value = p.name;
        document.getElementById('modalProjectStart').value = p.start || '';
        document.getElementById('modalProjectEnd').value = p.end || '';
        
        // Update titel van modal (optioneel)
        document.querySelector('#projectModal .modal-title').textContent = "Project Bewerken";

        // Open modal
        new bootstrap.Modal(document.getElementById('projectModal')).show();
      } 
      else if (action === 'extend') {
        const v = prompt('Nieuwe einddatum (DD-MM-YYYY):', toDisplayDate(p.end) || '');
        if (!v) return;
        p.end = fromDisplayDate(v);
        await saveUserData();
        renderProjects();
        renderProjectFilterForMonth(); // Update ook filters
        renderMonth(Number(yearSelectMain.value), Number(monthSelectMain.value));
        toast('Project verlengd', 'success');
      } 
      else if (action === 'delete') {
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

  // ✨ NIEUW: Auto-datum invullen bij kiezen project in Shift Modal ✨
  if (newShiftProjectSelect) {
      newShiftProjectSelect.onchange = () => {
        const selectedName = newShiftProjectSelect.value;
        const p = list.find(proj => proj.name === selectedName);
        
        const startInput = document.getElementById('newShiftStartDate');
        const endInput = document.getElementById('newShiftEndDate');

        if (p) {
            // Als het project datums heeft, vul ze in
            if (p.start && startInput) startInput.value = p.start;
            if (p.end && endInput) endInput.value = p.end;
        } else {
            // Als "Geen project" is gekozen, velden leegmaken
            if (startInput) startInput.value = '';
            if (endInput) endInput.value = '';
        }
      };
  }

// --- NIEUWE LOGICA: OPSLAAN VIA MODAL ---
// (Vervangt de oude addProjectBtn logica)

document.getElementById('saveProjectBtn')?.addEventListener('click', async () => {
  // Haal waarden uit de modal inputs
  const nameInput = document.getElementById('modalProjectName');
  const startInput = document.getElementById('modalProjectStart');
  const endInput = document.getElementById('modalProjectEnd');
  
  const name = nameInput.value.trim();
  if (!name) return toast('Vul een projectnaam in', 'warning');

  const ud = getCurrentUserData();
  ud.projects = ud.projects || [];

  if (editingProjectIndex !== null) {
    // === UPDATE BESTAAND PROJECT ===
    const existing = ud.projects[editingProjectIndex];
    
    // Check of naam gewijzigd is (voor notificatie)
    const oldName = existing.name;
    const nameChanged = oldName !== name;

    // Update waarden
    existing.name = name;
    existing.start = startInput.value || null;
    existing.end = endInput.value || null;
    
    // Als de naam veranderd is, moeten we misschien bestaande shiften/uren ook updaten? 
    // Voor nu laten we dat zo (shiften slaan de projectnaam op als string).
    
    toast('Project gewijzigd', 'success');
  } else {
    // === NIEUW PROJECT TOEVOEGEN ===
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

  // Resetten en sluiten wordt afgehandeld door de 'hidden.bs.modal' listener hieronder
  const modalEl = document.getElementById('projectModal');
  const modal = bootstrap.Modal.getInstance(modalEl);
  modal.hide();

  renderProjects();
  renderProjectFilterForMonth();
});

// Zorg dat de velden leeg zijn als je de modal opent
document.getElementById('projectModal')?.addEventListener('hidden.bs.modal', () => {
  // 1. Velden leegmaken
  const nameInput = document.getElementById('modalProjectName');
  const startInput = document.getElementById('modalProjectStart');
  const endInput = document.getElementById('modalProjectEnd');
  const multiInput = document.getElementById('modalProjectMulti');

  if(nameInput) nameInput.value = '';
  if(startInput) startInput.value = '';
  if(endInput) endInput.value = '';
  if(multiInput) multiInput.checked = false;

  // 2. Reset de 'edit modus' variabele
  editingProjectIndex = null;

  // 3. Zet de titel terug naar 'Nieuw Project' (voor de volgende keer)
  const title = document.querySelector('#projectModal .modal-title');
  if(title) title.textContent = "Nieuw Project";
});
// ==========================================
// FIX: SLEPEN & SORTEREN (Drag & Drop hersteld)
// ==========================================

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
      if(id) updateDoc(doc(db,'users',id), { shiftOrder: order });
  }

  const filterShiftYear = document.getElementById('filterShiftYear');
  const selectedYear = filterShiftYear?.value ? Number(filterShiftYear.value) : null;
  const isAdminUser = (ud.role === 'admin');

  // UI Checks
  const divShort = document.getElementById('divShiftShort');
  const divColor = document.getElementById('divShiftColor');
  const divName  = document.getElementById('divShiftName');
  if (divShort && divColor && divName) {
    if (isAdminUser) {
      divShort.classList.remove('d-none');
      divColor.classList.remove('d-none');
      divName.className = 'col-md-5'; 
    } else {
      divShort.classList.add('d-none');
      divColor.classList.add('d-none');
      divName.className = 'col-md-9'; 
    }
  }

  // Tabel leegmaken
  const shiftTableBody = document.getElementById('shiftTableBody');
  if(!shiftTableBody) return;
  shiftTableBody.innerHTML = '';

  order.forEach(name => {
    const sh = shifts[name];
    if (!sh) return;

    if (selectedYear) {
      const startY = sh.startDate ? new Date(sh.startDate).getFullYear() : null;
      const endY = sh.endDate ? new Date(sh.endDate).getFullYear() : null;
      if ((startY && endY && (selectedYear < startY || selectedYear > endY)) ||
          (startY && !endY && selectedYear < startY) ||
          (!startY && endY && selectedYear > endY)) return;
    }

    const tr = document.createElement('tr');
    tr.dataset.key = name; // Nodig voor het sorteren!
    
    // Variabelen
    const projectBadge = sh.project 
        ? `<span class="badge bg-light text-dark border">${sh.project}</span>` 
        : '<span class="text-muted small">-</span>';

    const periodText = (sh.startDate || sh.endDate) 
        ? `<small>${sh.startDate || '...'} <span class="text-muted">t/m</span> ${sh.endDate || '...'}</small>` 
        : '<span class="text-muted small">-</span>';

    // 7 Kolommen (Met sleep-icoon in de eerste kolom)
    tr.innerHTML = `
      <td>
        <div class="d-flex align-items-center">
            <span class="handle material-icons-outlined text-muted me-2" style="cursor: grab; font-size: 18px;">drag_indicator</span>
            
            <span class="dot" style="background:${sh.color || '#ccc'}; width:12px; height:12px; display:inline-block; border-radius:50%; margin-right:10px;"></span>
            <div>
                <strong class="text-dark">${sh.realName || name}</strong>
                ${sh.shortName ? `<div class="small text-muted">${sh.shortName}</div>` : ''}
            </div>
        </div>
      </td>

      <td>${sh.start || '00:00'}</td>
      <td>${sh.end || '00:00'}</td>
      <td>${sh.break || 0}</td>
      <td>${projectBadge}</td>
      <td>${periodText}</td>

      <td class="text-end">
        <div class="btn-group">
          <button class="btn btn-sm btn-outline-secondary btn-edit" title="Bewerken"><span class="material-icons-outlined" style="font-size:16px">edit</span></button>
          <button class="btn btn-sm btn-outline-danger btn-del" title="Verwijderen"><span class="material-icons-outlined" style="font-size:16px">delete</span></button>
          <button class="btn btn-sm btn-outline-primary btn-copy" title="Kopiëren"><span class="material-icons-outlined" style="font-size:16px">content_copy</span></button>
        </div>
      </td>
    `;

    // Events
    tr.querySelector('.btn-del').onclick = async () => {
      if(!confirm(`Shift "${sh.realName || name}" verwijderen?`)) return;
      delete ud.shifts[name];
      ud.shiftOrder = ud.shiftOrder.filter(n => n !== name);
      const id = getActiveUserId();
      if(id) await updateDoc(doc(db,'users',id), { shifts: ud.shifts, shiftOrder: ud.shiftOrder });
      renderShifts();
      toast('Verwijderd', 'success');
    };

    tr.querySelector('.btn-copy').onclick = async () => {
        const copyName = name + " (Kopie)";
        ud.shifts[copyName] = { ...sh, realName: (sh.realName || name) + " (Kopie)" };
        ud.shiftOrder.push(copyName);
        const id = getActiveUserId();
        if(id) await updateDoc(doc(db,'users',id), { shifts: ud.shifts, shiftOrder: ud.shiftOrder });
        renderShifts();
        toast('Gekopieerd', 'success');
    };

    tr.querySelector('.btn-edit').onclick = () => {
        const modalEl = document.getElementById('shiftModal');
        modalEl.dataset.editingKey = name; 

        const newShiftName = document.getElementById('newShiftName');
        newShiftName.value = sh.realName || name;
        if(document.getElementById('newShiftShort')) document.getElementById('newShiftShort').value = sh.shortName || '';
        if(document.getElementById('newShiftColor')) document.getElementById('newShiftColor').value = sh.color || '#e9ecef';
        
        document.getElementById('newShiftStart').value = sh.start || '00:00';
        document.getElementById('newShiftEnd').value = sh.end || '00:00';
        document.getElementById('newShiftBreak').value = sh.break || 0;
        document.getElementById('newShiftProjectSelect').value = sh.project || '';
        document.getElementById('newShiftStartDate').value = sh.startDate || '';
        document.getElementById('newShiftEndDate').value = sh.endDate || '';

        new bootstrap.Modal(modalEl).show();
    };

    shiftTableBody.appendChild(tr);
  });

  // START DE SORTEER FUNCTIE
  initShiftSortable();
}

// Hulpfunctie om sorteren mogelijk te maken
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
      const newOrder = [];
      el.querySelectorAll('tr').forEach(row => {
          if (row.dataset.key) newOrder.push(row.dataset.key);
      });
      
      ud.shiftOrder = newOrder;
      
      // Opslaan
      const id = getActiveUserId();
      if(id) {
          await updateDoc(doc(db,'users',id), { shiftOrder: newOrder });
          toast('Nieuwe volgorde opgeslagen', 'success');
      }
    }
  });
  
  el.dataset.sortableInitialized = 'true';
}
// 2. OPSLAAN KNOP (Veilige versie zonder 'const' conflict)
const saveBtnUnique = document.getElementById('addShiftBtn');
if (saveBtnUnique) {
    const newBtn = saveBtnUnique.cloneNode(true);
    saveBtnUnique.parentNode.replaceChild(newBtn, saveBtnUnique);

    newBtn.addEventListener('click', async () => {
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

      // Oude verwijderen bij naamwijziging
      if (oldKey && oldKey !== uniqueKey) {
          delete ud.shifts[oldKey];
          const idx = ud.shiftOrder.indexOf(oldKey);
          if (idx !== -1) ud.shiftOrder[idx] = uniqueKey;
      }

      // Nieuwe opslaan
      ud.shifts[uniqueKey] = {
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

      // FORCEER UPDATE
      const id = getActiveUserId();
      if (id) {
          await updateDoc(doc(db, 'users', id), { 
              shifts: ud.shifts,
              shiftOrder: ud.shiftOrder
          });
      }

      renderShifts();
      bootstrap.Modal.getInstance(modalEl).hide();
      delete modalEl.dataset.editingKey;
      
      newShiftName.value = '';
      document.getElementById('newShiftBreak').value = 0;
      document.getElementById('newShiftStartDate').value = '';
      document.getElementById('newShiftEndDate').value = '';
      if(document.getElementById('newShiftShort')) document.getElementById('newShiftShort').value = '';

      toast('Shift opgeslagen', 'success');
    });
}
    filterShiftYear.addEventListener('change', ()=> renderShifts());

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
      
      // 🔥 FIX: Ververs de lijst direct, zodat de filtering (2026) werkt!
      renderShifts();
  }
}
// ======= Invoer (maand) =======
function renderProjectFilterForMonth(){
  const ud = getCurrentUserData();
  const y = Number(yearSelectMain.value), m = Number(monthSelectMain.value);
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const monthStart = `${y}-${String(m+1).padStart(2,'0')}-01`.replaceAll('-','');
  const monthEnd = `${y}-${String(m+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`.replaceAll('-','');

  projectFilterSelect.innerHTML = '<option value="">Alle projecten</option>';

  const list = (ud.projects || [])
    .slice()
    .sort((a,b) => {
      const as = a.start ? new Date(a.start) : new Date('1900-01-01');
      const bs = b.start ? new Date(b.start) : new Date('1900-01-01');
      if (as.getTime() !== bs.getTime()) return as - bs;
      return (a.name || '').localeCompare(b.name || '');
    });

  list.forEach(p => {
    const ps = (p.start || '0000-01-01').replaceAll('-','');
    const pe = (p.end || '9999-12-31').replaceAll('-','');
    if (ps <= monthEnd && pe >= monthStart) {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.name;
      projectFilterSelect.appendChild(o);
    }
  });
}

    async function generateMonth(){
      const y = Number(yearSelectMain.value), m = Number(monthSelectMain.value);
      const ud = getCurrentUserData();
      ud.monthData = ud.monthData || {};
      ud.monthData[y] = ud.monthData[y] || {};
      if(!ud.monthData[y][m]) ud.monthData[y][m] = { targetHours:0, targetMinutes:0, rows:{} };
      await renderMonth(y,m); updateInputTotals(); renderHome(); renderHistory(); renderVersionControls();
    }
// ✅ Automatische koppeling van project aan shift bij herladen
function autoAssignProjectIfNeeded(r) {
  const sp = autoProjectForShift(r.shift);
  if (sp && (!r.project || r.project === '' || !isValidProject(r.project))) {
    ensureProjectExists(sp);
    r.project = sp;
  }
}
async function renderMonth(year, month){
  const ud = getCurrentUserData();
  ud.monthData[year] ||= {};
  ud.monthData[year][month] ||= { targetHours:0, targetMinutes:0, rows:{} };
  const md = ud.monthData[year][month];

  const selectedProject = projectFilterSelect.value || '';
  tbody.innerHTML = '';

  monthTargetHours.value = md.targetHours || 0;
  monthTargetMinutes.value = md.targetMinutes || 0;

  // 1. BEPAAL OF WE DE ACTIE-KNOPPEN (+) TONEN
  const statusNow = getMonthStatus(year, month);
  
  // Check of de INGELOGDE gebruiker admin is (niet de gebruiker die we bekijken)
  const loggedInUser = dataStore.users[currentUserId];
  const iAmAdmin = loggedInUser && loggedInUser.role === 'admin';

  // Als je Admin bent, is de maand voor jou nooit 'op slot'
  const locked = !iAmAdmin && (statusNow==='approved' || statusNow==='submitted');

  // Toon acties als: (niet op slot) EN (instelling staat aan OF project staat het toe)
  const showActions = !locked && ( 
    userAllowsMultiMonth(ud, year, month) || 
    (ud.projects||[]).some(p => p.allowMulti) 
  );

  // Zorg dat de kolom-header ook zichtbaar wordt
  const th = document.getElementById('thActions');
  if (th) th.classList.toggle('d-none', !showActions);

  const daysInMonth = new Date(year, month+1, 0).getDate();
  for(let d=1; d<=daysInMonth; d++){
    const baseKey = dateKey(year, month, d);
    
    // 1. FIX: Geen automatische 00:00 aanmaak meer!
    if (md.rows[baseKey]) {
      autoAssignProjectIfNeeded(md.rows[baseKey]);
    }

    // 2. Haal de sleutels op (gebruik 'let' zodat we kunnen aanpassen)
    let allKeys = listDayKeys(md, baseKey);

    // 3. Als er GEEN gegevens zijn, doen we alsof er 1 lege regel is (zodat je kan typen)
    if (allKeys.length === 0) {
        allKeys = [baseKey];
    }

    // Filter per project (zichtbare lijst)
    const visibleKeys = allKeys.filter(k => {
      const r = md.rows[k];
      if (!selectedProject) return true;
      return (r.project || '') === selectedProject;
    });

    const renderKeys = visibleKeys.length ? visibleKeys : (selectedProject ? [] : allKeys);

    for (let idx = 0; idx < renderKeys.length; idx++) {
            const rowKey = renderKeys[idx];
      
      // 🔥 FIX: Als de rij niet bestaat, gebruik een LEEG sjabloon.
      // We gebruiken lege strings '' i.p.v. '00:00' zodat het vakje écht leeg is.
      let r = md.rows[rowKey];
      if (!r) {
          r = { project:'', shift:'', start:'', end:'', break:0, omschrijving:'', minutes:0 };
          // Als we een project moeten voorstellen, doen we dat hier virtueel
          if (typeof autoAssignProjectIfNeeded === 'function') autoAssignProjectIfNeeded(r);
      }

      const dayName = daysFull[new Date(year, month, d).getDay()];

      // Rechten voor + op deze specifieke rij
      const allowByMonth   = userAllowsMultiMonth(ud, year, month);
      const allowByProject = r.project ? canAddMultiForProject(r.project) : false;
      const allowThisRow   = allowByMonth || allowByProject;

      const tr = document.createElement('tr');

      // HTML voor de knoppen (+ of -)
      const actionsCell = showActions
        ? (idx === 0
            ? `<td class="actions-cell">
                 <button type="button" class="btn btn-outline-success btn-line addLineBtn" ${allowThisRow ? '' : 'disabled'} title="Extra regel toevoegen">+</button>
               </td>`
            : `<td class="actions-cell">
                 <button type="button" class="btn btn-outline-danger btn-line delLineBtn" data-key="${rowKey}" title="Deze regel verwijderen">−</button>
               </td>`
          )
        : '';
      
      // Status icoon logica
      let statusIconHtml = '<span class="shift-status-icon d-none"></span>'; 
      if (r.status === 'pending') {
        statusIconHtml = '<span class="material-icons-outlined shift-status-icon status-pending" title="In aanvraag">hourglass_top</span>';
      } else if (r.status === 'approved') {
        statusIconHtml = '<span class="material-icons-outlined shift-status-icon status-approved" title="Goedgekeurd">check_circle</span>';
      } else if (r.status === 'rejected') {
        statusIconHtml = '<span class="material-icons-outlined shift-status-icon status-rejected" title="Afgekeurd">cancel</span>';
      }
      const isPendingOrRejected = r.status && r.status !== 'approved';
      const durationText = isPendingOrRejected 
        ? '0u 0min' 
        : `${Math.floor(r.minutes/60)}u ${r.minutes%60}min`;

      tr.innerHTML = `
        ${actionsCell}
        <td>${idx === 0 ? dayName : ''}</td>
        <td>${idx === 0 ? `${String(d).padStart(2,'0')}-${String(month+1).padStart(2,'0')}-${year}` : ''}</td>
        <td><select class="form-select form-select-sm projectSelect"></select></td>
        <td class="d-flex align-items-center gap-1">
          <select class="form-select form-select-sm shiftSelect"></select>
          ${statusIconHtml}
        </td>
        <td><input class="form-control form-control-sm startInput" type="time" value="${r.start}"></td>
        <td><input class="form-control form-control-sm endInput" type="time" value="${r.end}"></td>
        <td><input class="form-control form-control-sm breakInput" type="number" min="0" value="${r.break}"></td>
        <td class="d-flex align-items-center gap-1">
            <input class="form-control form-control-sm omschrijvingInput" type="text" value="${r.omschrijving}">
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
      (ud.projects || []).forEach(p=>{
        if (isDateWithin(baseKey, p.start || null, p.end || null)) {
          const o = document.createElement('option'); o.value=p.name; o.textContent=p.name; projSel.appendChild(o);
        }
      });
      if(r.project) projSel.value = r.project;

      projSel.addEventListener('change', async ()=>{
        r.project = projSel.value || '';
        saveCell(year, month, rowKey, r, tr);
        await populateShiftSelectForRow(tr, rowKey);
        updateInputTotals();
        debouncedSave();

        // Check of de + knop nu aan/uit moet (afhankelijk van projectrechten)
        const addBtn = tr.querySelector('.addLineBtn');
        if (addBtn) {
          const allowByMonth   = userAllowsMultiMonth(getCurrentUserData(), year, month);
          const allowByProject = r.project ? canAddMultiForProject(r.project) : false;
          addBtn.disabled = !(allowByMonth || allowByProject);
        }
      });

      await populateShiftSelectForRow(tr, rowKey);

      // --- Event Listeners voor inputs ---
      tr.querySelector('.startInput').addEventListener('change', e=>{
        r.start = e.target.value; recalcRowMinutes(r);
        saveCell(year, month, rowKey, r, tr);
        const isPendingOrRejected = r.status && r.status !== 'approved';
        tr.querySelector('.dur').textContent = isPendingOrRejected ? '0u 0min' : `${Math.floor(r.minutes/60)}u ${r.minutes%60}min`;
        updateInputTotals(); debouncedSave(); renderHistory();
      });
      tr.querySelector('.endInput').addEventListener('change', e=>{
        r.end = e.target.value; recalcRowMinutes(r);
        saveCell(year, month, rowKey, r, tr);
        const isPendingOrRejected = r.status && r.status !== 'approved';
        tr.querySelector('.dur').textContent = isPendingOrRejected ? '0u 0min' : `${Math.floor(r.minutes/60)}u ${r.minutes%60}min`;
        updateInputTotals(); debouncedSave(); renderHistory();
      });
      tr.querySelector('.breakInput').addEventListener('change', e=>{
        r.break = Number(e.target.value)||0; recalcRowMinutes(r);
        saveCell(year, month, rowKey, r, tr);
        const isPendingOrRejected = r.status && r.status !== 'approved';
        tr.querySelector('.dur').textContent = isPendingOrRejected ? '0u 0min' : `${Math.floor(r.minutes/60)}u ${r.minutes%60}min`;
        updateInputTotals(); debouncedSave(); renderHistory();
      });
      tr.querySelector('.omschrijvingInput').addEventListener('change', e=>{
        r.omschrijving = e.target.value; saveCell(year, month, rowKey, r, tr); debouncedSave(); renderHistory();
      });

      // --- Knoppen acties ---
      const addBtn = tr.querySelector('.addLineBtn');
      if (addBtn) {
        addBtn.addEventListener('click', async (e) => {
          e.preventDefault(); 
          const idxNew = nextLineIndex(md, baseKey);
          const newKey = `${baseKey}#${idxNew}`;
          // 🔥 FIX: Maak een nieuwe regel aan, maar laat de tijden LEEG ('')
md.rows[newKey] = { project: r.project, shift:'', start:'', end:'', break:0, omschrijving:'', minutes:0 };
          await saveUserData();
          renderMonth(year, month);
          updateInputTotals(); renderHistory();
        });
      }
      
      const delBtn = tr.querySelector('.delLineBtn');
      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          const k = delBtn.dataset.key;
          delete md.rows[k];
          await saveUserData();
          renderMonth(year, month);
          updateInputTotals(); renderHistory();
        });
      }
    } 
  }

  await saveUserData();
  renderCalendarGrid(year, month);
  updateRemainingHours();
  updateInputTotals();
  renderProjectSummary(); 
  updateLeaveBadges(); 
  renderHome();

  // Velden vergrendelen als het geen admin is EN de status is submitted/approved
  const statusLocked = (getMonthStatus(year, month)==='approved' || getMonthStatus(year, month)==='submitted');
  const lockedNow = statusLocked && !iAmAdmin; // 👈 Admin mag altijd bewerken
  
  tbody.querySelectorAll('select, input').forEach(el => { el.disabled = lockedNow; });

  if (monthTargetHours) monthTargetHours.disabled = lockedNow;
  if (monthTargetMinutes) monthTargetMinutes.disabled = lockedNow;
  if (projectFilterSelect) projectFilterSelect.disabled = lockedNow;

  updateMonthStatusBadge();
}
// Functie om de kalender te tekenen met de gekozen iconen
// Globale variabele om te weten welke dag we bewerken
let currentEditingDateKey = null;

// ==========================================
// 1. DE KALENDER (Met Favorieten Icoontjes)
// ==========================================
function renderCalendarGrid(year, month) {
  const grid = document.getElementById('monthlyCalendarGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const ud = getCurrentUserData();
  const md = ud.monthData?.[year]?.[month] || { rows: {} };
  
  // 1. Shiften & Favorieten ophalen
  const allShifts = ud.shifts || {};
  const order = ud.shiftOrder || Object.keys(allShifts);
  const favorites = order
    .filter(key => allShifts[key] && allShifts[key].isFavorite)
    .map(key => ({ key, ...allShifts[key] }));

  // 2. EMOJI MAPPING
  // Vertaal de "oude" icoon-namen naar emojis
  const ICON_MAP = {
    'light_mode': '☀️',
    'wb_twilight': '🌅',
    'bedtime': '🌙',
    'schedule': '🕒',
    'star': '⭐',
    'school': '🎓',
    'medical_services': '🏥',
    'flight': '✈️',
    'bench': '🪑',
    'feestdag': '🎉',
    'teammeeting': '👥',
    'niet_ingepland': '❌',
    'vrij_weekend': '😎'
  };

 // Headers
 ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].forEach(d => 
    grid.insertAdjacentHTML('beforeend', `<div class="calendar-header">${d}</div>`)
  );

  const firstDay = new Date(year, month, 1).getDay();
  const offset = (firstDay === 0) ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < offset; i++) grid.insertAdjacentHTML('beforeend', '<div class="calendar-day disabled"></div>');

  const todayDate = new Date();
  const isCurrentMonth = (todayDate.getFullYear() === Number(year) && todayDate.getMonth() === Number(month));
  const currentDayNum = todayDate.getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const baseKey = dateKey(year, month, d);
    const dateObj = new Date(year, month, d);
    const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
    const isToday = (isCurrentMonth && d === currentDayNum);

    // Emoji knopjes
    const quickIconsHtml = favorites.map(sh => {
      if (!isDateWithin(baseKey, sh.startDate, sh.endDate)) return '';
      const emoji = ICON_MAP[sh.icon] || '⭐';
      const hoverText = sh.realName || sh.key;
      return `<span class="quick-icon-btn" data-shift="${sh.key}" title="${hoverText}">${emoji}</span>`;
    }).join('');

    // Shift balkjes
    const dayKeys = listDayKeys(md, baseKey);
    let shiftsHtml = '';
    
    dayKeys.slice(0, 3).forEach(k => {
      const r = md.rows[k];
      if (!r.shift) return; 
      const sh = ud.shifts[r.shift] || { color: '#ccc', realName: r.shift };
      
      let durationText = '';
      if (r.minutes && r.minutes > 0) {
          const h = Math.floor(r.minutes / 60);
          const m = r.minutes % 60;
          const mStr = m < 10 ? `0${m}` : m;
          durationText = `${h}u${mStr}`;
      }
      
      shiftsHtml += `
        <div class="cal-shift-item d-flex justify-content-between align-items-center" 
             style="background:${sh.color || '#eee'}; border-left:3px solid rgba(0,0,0,0.2); padding-right:4px;">
          <span style="overflow:hidden; text-overflow:ellipsis;">${sh.realName || r.shift}</span>
          <span style="font-size:1em; font-weight:bold; margin-left:6px; white-space:nowrap; color:#000;">
            ${durationText}
          </span>
        </div>`;
    });

    const realCount = dayKeys.filter(k => md.rows[k].shift).length;
    if (realCount > 3) shiftsHtml += `<div style="font-size:9px; text-align:center; color:#999;">+${realCount - 3}</div>`;

    const dayEl = document.createElement('div');
    dayEl.className = `calendar-day ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''}`;
    
    // Voeg 'paint-cursor' toe als mode aan staat voor visuele feedback
    if (typeof isPaintMode !== 'undefined' && isPaintMode) {
        dayEl.style.cursor = 'cell'; 
    }

    dayEl.innerHTML = `
      <div class="d-flex justify-content-between align-items-start">
        <span class="day-number">${d}</span>
        <div class="quick-icons-wrapper">${quickIconsHtml}</div>
      </div>
      <div class="d-flex flex-column gap-1 mt-1" style="overflow:hidden;">${shiftsHtml}</div>
    `;

    // 🔥 DE KLIK LOGICA 🔥
    dayEl.onclick = () => {
        // Als verf-modus aan staat -> VERVEN!
        if (typeof isPaintMode !== 'undefined' && isPaintMode) {
            applyPaintShift(baseKey);
        } else {
            // Anders -> Popup openen
            openDayEditor(baseKey);
        }
    };

    // Quick icons (sterretjes) blijven altijd werken
    dayEl.querySelectorAll('.quick-icon-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation(); 
        const shiftKey = btn.dataset.shift;
        applyShiftDirectly(baseKey, shiftKey);
      };
    });

    grid.appendChild(dayEl);
  }
}
// ==========================================
// 2. HELPER: DIRECT OPSLAAN (Voor icoontjes)
// ==========================================
async function applyShiftDirectly(dateKey, shiftKey) {
  const [y, mStr] = dateKey.split('-');
  const m = Number(mStr) - 1;
  const ud = getCurrentUserData();
  const sh = ud.shifts[shiftKey];
  
  if (!sh) return;
  // Zorg dat de maandstructuur bestaat (voor de zekerheid)
  ud.monthData = ud.monthData || {};
  ud.monthData[y] = ud.monthData[y] || {};
  ud.monthData[y][m] = ud.monthData[y][m] || { targetHours:0, targetMinutes:0, rows:{} };
  const md = ud.monthData[y][m];

  // 1. BEPAAL DE SLEUTEL
  // Bestaat de basis datum al? Maak dan een unieke extra sleutel aan.
  let targetKey = dateKey;
  if (md.rows[dateKey]) {
    targetKey = `${dateKey}_${Date.now()}`; // Bv: 2024-02-01_1715699...
  }
  // We moeten de minuten expliciet uitrekenen, anders snapt de balk het niet
  const mins = minutesBetween(sh.start, sh.end, sh.break);

  // 2. OPSLAAN
  md.rows[targetKey] = {
    project: sh.project || '',
    shift: shiftKey,
    start: sh.start,
    end: sh.end,
    break: sh.break,
    description: '',
    minutes: mins
  };

  // 3. UPDATEN
  renderCalendarGrid(y, m);
  updateInputTotals();
  await saveUserData();
  toast(`${sh.realName || shiftKey} toegevoegd`, 'success');
}

// ==========================================
// 3. POPUP: DAG BEWERKEN (Notities & Extra Lijnen)
// ==========================================
function openDayEditor(dateKey) {
  currentEditingDateKey = dateKey;
  const ud = getCurrentUserData();
  const [y, mStr] = dateKey.split('-');
  const m = Number(mStr) - 1;
  const md = ud.monthData?.[y]?.[m] || { rows: {} };

  const titleEl = document.getElementById('dayEditorTitle');
  if (titleEl) titleEl.textContent = `Bewerken: ${dateKey}`;
  
  const listContainer = document.getElementById('dayEditorList');
  if (!listContainer) return; 
  
  listContainer.innerHTML = '';
  
  // Haal shiften op en filter de spook-regels (lege shiften) eruit
  let dayKeys = listDayKeys(md, dateKey).filter(k => md.rows[k].shift);
  
  if (dayKeys.length === 0) {
    listContainer.innerHTML = '<span class="text-muted small fst-italic">Nog geen shiften.</span>';
  } else {
    dayKeys.forEach(k => {
      const r = md.rows[k];
      const sh = ud.shifts[r.shift] || { color: '#ccc', realName: r.shift };
      
      const rowDiv = document.createElement('div');
      rowDiv.className = 'p-2 border rounded bg-light mb-2'; // Iets ruimer kader
      
      // We bouwen een blokje met:
      // Boven: Naam + Verwijder knop
      // Onder: Start - Einde - Pauze inputs
      rowDiv.innerHTML = `
        <div class="d-flex align-items-center justify-content-between mb-2">
            <div class="d-flex align-items-center gap-2">
               <span class="dot" style="background:${sh.color || '#ccc'}; width:10px; height:10px; border-radius:50%;"></span>
               <strong>${sh.realName || r.shift}</strong>
            </div>
            <button class="btn btn-outline-danger btn-sm p-0 px-2" title="Verwijder" onclick="removeShiftFromDay('${k}')">
              <span class="material-icons-outlined" style="font-size:16px; vertical-align: middle;">delete</span>
            </button>
        </div>
        
        <div class="d-flex gap-2 align-items-end">
            <div style="flex:1;">
                <label class="form-label mb-0" style="font-size:0.75rem; color:#666;">Start</label>
                <input type="time" class="form-control form-control-sm" 
                       value="${r.start || '00:00'}" 
                       onchange="updateShiftTime('${k}', 'start', this.value)">
            </div>
            <div style="flex:1;">
                <label class="form-label mb-0" style="font-size:0.75rem; color:#666;">Einde</label>
                <input type="time" class="form-control form-control-sm" 
                       value="${r.end || '00:00'}" 
                       onchange="updateShiftTime('${k}', 'end', this.value)">
            </div>
            <div style="width: 60px;">
                <label class="form-label mb-0" style="font-size:0.75rem; color:#666;">Pauze</label>
                <input type="number" class="form-control form-control-sm" 
                       value="${r.break || 0}" 
                       onchange="updateShiftTime('${k}', 'break', this.value)">
            </div>
        </div>
      `;
      listContainer.appendChild(rowDiv);
    });
  }

  // Notitie veld
  const firstKey = dayKeys[0];
  const noteField = document.getElementById('dayEditorNote');
  if (noteField) noteField.value = firstKey ? (md.rows[firstKey].description || '') : '';

  const modalEl = document.getElementById('dayEditorModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

// Event Listeners voor de Popup
document.getElementById('btnAddExtraShift')?.addEventListener('click', () => {
  bootstrap.Modal.getInstance(document.getElementById('dayEditorModal')).hide();
  quickDate.value = currentEditingDateKey; 
  populateQuickShifts();
  new bootstrap.Modal(document.getElementById('quickModal')).show();
});

// ==========================================
// FIX: VERWIJDEREN (Forceer update in database)
// ==========================================
window.removeShiftFromDay = async (uniqueKey) => {
  if (!uniqueKey) return;
  const [yStr, mStr] = uniqueKey.split('-');
  const y = Number(yStr); // 2026 (Als getal!)
  const m = Number(mStr) - 1;
  const ud = getCurrentUserData();
  
  // Bestaat de shift nog?
  if (ud.monthData?.[y]?.[m]?.rows?.[uniqueKey]) {
    
    // 1. Verwijder hem lokaal uit het geheugen
    delete ud.monthData[y][m].rows[uniqueKey];
    
    // 2. FORCEER DE DATABASE UPDATE
    // saveUserData() werkt niet goed voor verwijderen (door merge).
    // updateDoc vervangt de hele lijst van deze maand en gooit het écht weg.
    const id = getActiveUserId();
    if (id) {
       const ref = doc(db, 'users', id);
       await updateDoc(ref, {
           [`monthData.${y}.${m}.rows`]: ud.monthData[y][m].rows
       });
    }

    // 3. UI Verversen
    renderCalendarGrid(y, m);
    updateInputTotals();
    
    // Herlaad popup als die open staat
    const popup = document.getElementById('dayEditorModal');
    if (popup && popup.classList.contains('show')) {
        openDayEditor(currentEditingDateKey);
    }
    
    toast('Shift verwijderd', 'success');
  }
};

// ==========================================
// FIX: OPSLAAN KNOP (Met Database Forceer-functie)
// ==========================================
const saveDayEditorBtn = document.getElementById('btnSaveDayEditor');

if (saveDayEditorBtn) {
  // Oude listeners verwijderen
  const newBtn = saveDayEditorBtn.cloneNode(true);
  saveDayEditorBtn.parentNode.replaceChild(newBtn, saveDayEditorBtn);

  newBtn.addEventListener('click', async () => {
    const dateKey = currentEditingDateKey; 
    if (!dateKey) return;

    const [yStr, mStr] = dateKey.split('-');
    const y = Number(yStr); // Belangrijk voor blauwe licht
    const m = Number(mStr) - 1;
    
    const ud = getCurrentUserData();
    if (!ud.monthData) ud.monthData = {};
    if (!ud.monthData[y]) ud.monthData[y] = {};
    if (!ud.monthData[y][m]) ud.monthData[y][m] = { rows: {} };

    const md = ud.monthData[y][m];
    const note = document.getElementById('dayEditorNote')?.value || '';
    const dayKeys = listDayKeys(md, dateKey);
    
    // Schoonmaak: Verwijder lege spoken
    dayKeys.forEach(k => {
        const r = md.rows[k];
        if (!r.shift || r.shift.trim() === '') {
            delete md.rows[k]; // Lokaal verwijderen
        } else {
            r.description = note;
        }
    });

    // FORCEER DE UPDATE (zodat verwijderingen ook in Firebase gebeuren)
    const id = getActiveUserId();
    if (id) {
        const ref = doc(db, 'users', id);
        await updateDoc(ref, {
            [`monthData.${y}.${m}.rows`]: md.rows
        });
    }
    
    // UI Verversen
    renderCalendarGrid(y, m);
    updateInputTotals();
    renderHistory();
    
    // Sluit popup
    const modalEl = document.getElementById('dayEditorModal');
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.hide();

    toast('Opgeslagen', 'success');
  });
}
// ==========================================
// 4. PROFIEL INSTELLINGEN (Icoontjes Kiezen)
// ==========================================
function renderProfileShiftSettings() {
  const container = document.getElementById('profileShiftSettingsBody');
  if (!container) return;
  const ud = getCurrentUserData();
  container.innerHTML = '';

  // Bepaal het huidige jaar
  const currentYear = new Date().getFullYear();

  // Gebruik de opgeslagen volgorde
  const allShifts = ud.shifts || {};
  const order = ud.shiftOrder || Object.keys(allShifts);

  order.forEach(key => {
    const sh = allShifts[key];
    if (!sh) return; // Skip als shift verwijderd is

    // --- FILTER: IS DEZE SHIFT RELEVANT? ---
    // 1. Heeft hij GEEN start/einddatum? Dan altijd tonen (is een algemene shift)
    const isAlwaysValid = !sh.startDate && !sh.endDate;
    
    // 2. Heeft hij WEL een datum? Check of het huidige jaar erin valt.
    let isValidThisYear = false;
    if (sh.startDate || sh.endDate) {
        const startY = sh.startDate ? parseInt(sh.startDate.substring(0, 4)) : 0;
        const endY = sh.endDate ? parseInt(sh.endDate.substring(0, 4)) : 9999;
        
        // Als het huidige jaar (bv. 2026) binnen de periode valt OF gelijk is
        if (currentYear >= startY && currentYear <= endY) {
            isValidThisYear = true;
        }
    }

    // Als hij niet algemeen is EN niet voor dit jaar is -> overslaan
    if (!isAlwaysValid && !isValidThisYear) {
        return; 
    }
    // ----------------------------------------

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="dot" style="background:${sh.color || '#ccc'}; width:10px; height:10px; display:inline-block; border-radius:50%; margin-right:8px;"></span>
        <strong>${sh.realName || key}</strong>
      </td>
      <td>
        <select class="form-select form-select-sm js-profile-icon" data-shift="${key}">
          <option value="light_mode" ${sh.icon === 'light_mode' ? 'selected' : ''}>☀️ Zon</option>
          <option value="wb_twilight" ${sh.icon === 'wb_twilight' ? 'selected' : ''}>🌅 Schemer</option>
          <option value="bedtime" ${sh.icon === 'bedtime' ? 'selected' : ''}>🌙 Maan</option>
          <option value="schedule" ${sh.icon === 'schedule' ? 'selected' : ''}>🕒 Klok</option>
          <option value="school" ${sh.icon === 'school' ? 'selected' : ''}>🎓 School</option>
          <option value="medical_services" ${sh.icon === 'medical_services' ? 'selected' : ''}>🏥 Ziekte</option>
          <option value="flight" ${sh.icon === 'flight' ? 'selected' : ''}>✈️ Verlof</option>
          <option value="bench" ${sh.icon === 'bench' ? 'selected' : ''}>🪑 Bench</option>
          <option value="feestdag" ${sh.icon === 'feestdag' ? 'selected' : ''}>🎉 Feestdag</option>
          <option value="teammeeting" ${sh.icon === 'teammeeting' ? 'selected' : ''}>👥 Teammeeting</option>
          <option value="niet_ingepland" ${sh.icon === 'niet_ingepland' ? 'selected' : ''}>❌ Niet ingepland</option>
          <option value="vrij_weekend" ${sh.icon === 'vrij_weekend' ? 'selected' : ''}>😎 Vrij weekend</option>  
        </select>
      </td>
      <td class="text-center">
        <input type="checkbox" class="form-check-input js-profile-fav" data-shift="${key}" ${sh.isFavorite ? 'checked' : ''}>
      </td>
    `;
    container.appendChild(tr);
  });

  container.onchange = async (e) => {
    const target = e.target;
    const sKey = target.dataset.shift;
    if (!sKey) return;
    
    // Update data
    if (target.classList.contains('js-profile-icon')) ud.shifts[sKey].icon = target.value;
    if (target.classList.contains('js-profile-fav')) ud.shifts[sKey].isFavorite = target.checked;
    
    await saveUserData();
    
    // Ververs kalender direct
    const y = Number(document.getElementById('yearSelectMain')?.value);
    const m = Number(document.getElementById('monthSelectMain')?.value);
    if (y && !isNaN(m)) renderCalendarGrid(y, m);
    
    toast('Instelling opgeslagen', 'success');
  };
}
async function populateShiftSelectForRow(tr, rowKey){
  const base = rowKey.split('#')[0];                   // YYYY-MM-DD
  const [yStr, mStr, dStr] = base.split('-');
  const year = Number(yStr), month = Number(mStr)-1;

  const ud = getCurrentUserData();
  // Veilige check of de maand bestaat
  const md = ud.monthData?.[year]?.[month];
  
  // 🔥 DE BELANGRIJKE FIX: 
  // Als de rij niet bestaat (omdat hij leeg is), gebruik een dummy object.
  // Dit voorkomt de "Reading 'shift' of undefined" fout waardoor je vastliep.
  const r = md?.rows?.[rowKey] || { shift: '' };

  const projSel = tr.querySelector('.projectSelect');
  const sel = tr.querySelector('.shiftSelect');
  
  if (!sel) return; // Veiligheid voor als het element niet gevonden wordt

  sel.innerHTML = '<option value=""></option>';

  const all = ud.shifts || {};
  const order = ud.shiftOrder || Object.keys(all);
  const entries = order.map(n=> [n, all[n]]).filter(([,sh])=> !!sh);

  for(const [name, sh] of entries){
    // Check datum geldigheid
    if(!isDateWithin(base, sh.startDate || null, sh.endDate || null)) continue;
    
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = sh.realName || name;
    
    // Alleen selecteren als r.shift bestaat
    if(r.shift === name) opt.selected = true;
    
    sel.appendChild(opt);
  }
  sel.addEventListener('change', async ()=>{
    const chosen = sel.value; // Dit pakt de unieke ID (bv "Vroege (Google)")
    const all = ud.shifts || {};
    
    if (!chosen) {
      r.shift = ''; r.project = ''; projSel.value = '';
      delete r.status; 
      saveCell(year, month, rowKey, r, tr); debouncedSave(); updateInputTotals(); renderHistory();
      return;
    }

    r.shift = chosen; // Sla de unieke ID op
    debouncedSave();

    // Verlof logica
    const isLeaveType = ['Verlof', 'Schoolverlof', 'Ziekte', 'Feestdag'].includes(chosen); // Let op: dit checkt nu op ID
    
    // Checken of de 'realName' misschien een verloftype is (als de ID uniek is gemaakt)
    const shObj = all[chosen];
    const realName = shObj ? (shObj.realName || chosen) : chosen;
    const isRealLeaveType = ['Verlof', 'Schoolverlof', 'Ziekte', 'Feestdag'].includes(realName);

    if (isRealLeaveType) {
      if (isAdmin()) {
        r.status = 'approved';
      } else {
        r.status = 'pending';
        try {
          await notifyAdminOfPendingLeave(getActiveUserId(), year, month, rowKey, r);
        } catch(e) {
          console.warn("Kon admin niet live notificeren over verlof", e);
        }
      }
    } else {
      delete r.status;
    }

    // Icoon update
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

    // Auto project logica
    // We checken zowel de unieke ID als de schone naam voor de zekerheid
    if (['Bench'].includes(realName)) {
      r.project = '';
      saveCell(year, month, rowKey, r, tr);
      debouncedSave();
    } 
    else if (['Schoolverlof','School'].includes(realName)) {
      ensureProjectExists('PXL Verpleegkunde Hasselt');
      r.project = 'PXL Verpleegkunde Hasselt';
      saveCell(year, month, rowKey, r, tr);
      debouncedSave();
    } 
    else if (['Verlof','Teammeeting','Ziekte'].includes(realName)) {
      ensureProjectExists('Eght Care');
      r.project = 'Eght Care';
      saveCell(year, month, rowKey, r, tr);
      debouncedSave();
    } 
    else {
      // Normale projectkoppeling uit de shift settings
      if (shObj && shObj.project) {
        const p = (ud.projects||[]).find(px => px.name===shObj.project);
        if (p && isDateWithin(base, p.start||null, p.end||null)) {
          r.project = p.name;
        }
      }
    }

    // Project dropdown herladen
    projSel.innerHTML = '<option value="">--</option>';
    (getCurrentUserData().projects || []).forEach(p=>{
      if(isDateWithin(base, p.start || null, p.end || null)){
        const o = document.createElement('option');
        o.value = p.name; o.textContent = p.name; projSel.appendChild(o);
      }
    });
    setTimeout(()=> { projSel.value = r.project || ''; }, 50);

    // Tijden invullen
    if (shObj) {
      r.start = shObj.start || '00:00';
      r.end   = shObj.end   || '00:00';
      r.break = Number(shObj.break) || 0;
    }
    recalcRowMinutes(r);
    
    tr.querySelector('.startInput').value = r.start;
    tr.querySelector('.endInput').value = r.end;
    tr.querySelector('.breakInput').value = r.break;

    const isPendingOrRejected = r.status && r.status !== 'approved';
    tr.querySelector('.dur').textContent = isPendingOrRejected
      ? '0u 0min'
      : `${Math.floor(r.minutes/60)}u ${r.minutes%60}min`;

    saveCell(year, month, rowKey, r, tr);
    debouncedSave();
    updateInputTotals();
    renderHistory();

    const addBtn = tr.querySelector('.addLineBtn');
    if (addBtn) {
      const allowByMonth   = userAllowsMultiMonth(getCurrentUserData(), year, month);
      const allowByProject = r.project ? canAddMultiForProject(r.project) : false;
      addBtn.disabled = !(allowByMonth || allowByProject);
    }
  });
}
async function ensureProjectExists(name){
  const ud = getCurrentUserData();
  ud.projects = ud.projects || [];
  let p = ud.projects.find(p=> p.name===name);
  if(!p){
    // Oneindige geldigheid (altijd zichtbaar)
    ud.projects.push({ name, start: "2000-01-01", end: "2099-12-31" });
    saveUserData();
    renderProjects(); // meteen toevoegen aan alle dropdowns
  }
}

    function recalcRowMinutes(r){ r.minutes = minutesBetween(r.start, r.end, r.break); }
    function saveCell(year, month, key, r, tr){
      const ud = getCurrentUserData();
      ud.monthData = ud.monthData || {}; ud.monthData[year] = ud.monthData[year] || {};
      ud.monthData[year][month] = ud.monthData[year][month] || { targetHours:0, targetMinutes:0, rows:{} };
      ud.monthData[year][month].rows[key] = { ...r, minutes: r.minutes || minutesBetween(r.start, r.end, r.break) };
    }
function updateInputTotals(){
  const y = Number(yearSelectMain.value), m = Number(monthSelectMain.value);
  const ud = getCurrentUserData();
  const md = ud.monthData?.[y]?.[m] || { targetHours:0, targetMinutes:0, rows:{} };

  // 1. Maand-totaal berekenen (balk onderaan)
  const total = Object.values(md.rows || {}).reduce((s, r) => {
    // Ook hier: Tel alles mee, tenzij expliciet afgekeurd
    if (r.status === 'rejected') return s; 
    return s + (Number(r.minutes) || 0);
  }, 0);

  const target = (md.targetHours||0)*60 + (md.targetMinutes||0);
  
  // 2. Footer balk updaten
  updateRemainingHours();
  
  // 3. ✅ BADGES UPDATEN (Dit zorgt dat het getal bovenaan verspringt)
  if (typeof updateLeaveBadges === 'function') {
    updateLeaveBadges(); 
  }
  
  // 4. Project samenvatting updaten
  if (typeof renderProjectSummary === 'function') {
    renderProjectSummary();
  }
}
    // live target updates
    monthTargetHours.addEventListener('input', async ()=>{
      const y = Number(yearSelectMain.value), m = Number(monthSelectMain.value);
      const ud = getCurrentUserData();
      ud.monthData[y][m].targetHours = Number(monthTargetHours.value)||0;
      debouncedSave(); updateInputTotals(); renderHistory();
    });
    monthTargetMinutes.addEventListener('input', async ()=>{
      const y = Number(yearSelectMain.value), m = Number(monthSelectMain.value);
      const ud = getCurrentUserData();
      ud.monthData[y][m].targetMinutes = Number(monthTargetMinutes.value)||0;
      debouncedSave(); updateInputTotals(); renderHistory();
    });

    projectFilterSelect.addEventListener('change', ()=> { renderMonth(Number(yearSelectMain.value), Number(monthSelectMain.value)); updateInputTotals(); renderProjectSummary(); });

    yearSelectMain.addEventListener('change', async ()=> {
  renderProjectFilterForMonth();
  await generateMonth();
  updateLeaveBadges();
  renderProjectSummary();
});
    monthSelectMain.addEventListener('change', async ()=> { renderProjectFilterForMonth(); generateMonth(); });
    // ======= Quick input =======
    quickDate.addEventListener('change', populateQuickShifts);
    function populateQuickShifts(){
      const ud = getCurrentUserData();
      quickShift.innerHTML = '<option value="">-- Kies shift --</option>';
      const all = ud.shifts || {};
      const order = ud.shiftOrder || Object.keys(all);
      const dateStr = quickDate.value; if(!dateStr) return;
      const withPeriod = [], without = [];
      order.forEach(n=> { const sh = all[n]; if(!sh) return; if(sh.startDate || sh.endDate) withPeriod.push([n,sh]); else without.push([n,sh]); });
      [...withPeriod, ...without].forEach(([n,sh])=>{
        if(!isDateWithin(dateStr, sh.startDate||null, sh.endDate||null)) return;
        const o = document.createElement('option'); o.value=n; o.textContent=n; quickShift.appendChild(o);
      });
    }

 // ==========================================
// 1. FIX VOOR OPSLAAN KNOP (Met 'sh' hersteld)
// ==========================================
const btnQuick = document.getElementById('saveQuickBtn');
if (btnQuick) {
  btnQuick.addEventListener('click', async () => {
    const date = document.getElementById('quickDate').value;
    const shift = document.getElementById('quickShift').value;
    const note = document.getElementById('quickNote').value;

    if (!date || !shift) return toast('Kies minstens een datum en shift', 'warning');

    const y = Number(date.split('-')[0]);
    const m = Number(date.split('-')[1]) - 1;
    const ud = getCurrentUserData();

    ud.monthData = ud.monthData || {};
    ud.monthData[y] = ud.monthData[y] || {};
    ud.monthData[y][m] = ud.monthData[y][m] || { targetHours: 0, targetMinutes: 0, rows: {} };

    // --- DE FIX VOOR OVERSCHRIJVEN ---
    let key = date;
    if (ud.monthData[y][m].rows[key]) {
      key = `${date}_${Date.now()}`;
    }
    // ---------------------------------

    // --- DE FIX VOOR 'sh is not defined' ---
    const sh = ud.shifts[shift]; // <--- DEZE REGEL WAS WEG!
    
    if (!sh) {
        console.error("Shift niet gevonden:", shift);
        return toast("Fout: Shift data niet gevonden", "danger");
    }
    // ---------------------------------------

    const minutes = minutesBetween(sh.start, sh.end, sh.break);

    let project = sh.project || '';
    const sp = autoProjectForShift(shift);
    if (sp) {
      ensureProjectExists(sp);
      project = sp;
    }

    ud.monthData[y][m].rows[key] = {
      project,
      shift,
      start: sh.start,
      end: sh.end,
      break: sh.break,
      omschrijving: note,
      minutes
    };

    await saveUserData();
    renderMonth(y, m);
    updateInputTotals();
    renderHistory();
    updateRemainingHours();

    bootstrap.Modal.getInstance(document.getElementById('quickModal')).hide();
    
    // Ververs dag-details als die open staat
    if (typeof openDayEditor === 'function') {
       const editor = document.getElementById('dayEditorModal');
       if (editor && editor.classList.contains('show')) openDayEditor(date);
    }

    toast('Extra shift toegevoegd', 'success');
  });
}
// ======= Historiek =======
function renderHistory() {
  // Bepaal welke gebruiker we tonen (admin kan een andere user kiezen)
  const viewUid = dataStore.viewUserId || dataStore.currentUser;
  if (!viewUid) return;

  const ud = dataStore.users[viewUid] || { name: '-', monthData: {} };
  const year = Number(yearSelectMain.value) || new Date().getFullYear();

  // ✅ Titel updaten boven de tabel
  const historiekJaar = document.getElementById('historiekJaar');
  const currentUserHistoriek = document.getElementById('currentUserHistoriek');
  if (historiekJaar) historiekJaar.textContent = year;
  if (currentUserHistoriek)
    currentUserHistoriek.textContent = ud.name || ud.email || '—';

  // Kies kolomvolgorde — let: schoolverlof komt NA bench
  const cols = [
    { key: 'monthLabel', title: 'Maand' },
    { key: 'target', title: 'Doel uren' },
    { key: 'planned', title: 'Gepland' },
    { key: 'diff', title: 'Verschil' },
    { key: 'leave', title: 'Verlof' },
    { key: 'sick', title: 'Ziekte' },
    { key: 'bench', title: 'Bench' },
    { key: 'school', title: 'Schoolverlof' },
    { key: 'holiday', title: 'Feestdag' }
  ];

  // Check of schoolverlof voor deze user actief is; standaard true
  const schoolEnabled = !!(ud?.settings?.schoolLeaveEnabled ?? true);

  // Als schoolverlof uit, filter die kolom weg
  const visibleCols = cols.filter(c => c.key !== 'school' || schoolEnabled);

  // Bouw tabel HTML
  const table = document.getElementById('historyTable');
  if (!table) {
    console.warn('historyTable niet gevonden (id="historyTable" ontbreekt in HTML)');
    return;
  }

  // header
  const theadHtml = `<thead class="table-light"><tr>${visibleCols.map(c => `<th>${c.title}</th>`).join('')}</tr></thead>`;

  // body
  let bodyHtml = '<tbody>';
  let totals = { target:0, planned:0, diff:0, leave:0, sick:0, school:0, holiday:0, bench:0 };

  for (let m = 0; m < 12; m++) {
    const md = ud.monthData?.[year]?.[m] || { targetHours:0, targetMinutes:0, rows:{} };
    const target = (md.targetHours||0)*60 + (md.targetMinutes||0);
    const rows = md.rows || {};
    const planned = Object.values(rows).reduce((s, r) => {
  if (r.status && r.status !== 'approved') {
    return s; // Tel niet mee (pending/rejected)
  }
  return s + (r.minutes || 0);
}, 0);

    // specifieke categorie-sommen
    let leave = 0, sick = 0, school = 0, holiday = 0, bench = 0;
    
    Object.values(rows).forEach(r => {
      // Als de shift is afgekeurd, tellen we hem nergens mee
      if (r.status === 'rejected') return;

      const sID = (r.shift || '').trim();
      if (!sID) return;

      // --- DE FIX: Zoek de "Echte Naam" op ---
      // We kijken in de instellingen (ud.shifts) wat de basisnaam is.
      // Hierdoor wordt "Verlof (Eght Care)" herkend als "Verlof".
      const shiftDef = ud.shifts?.[sID];
      const realName = shiftDef ? (shiftDef.realName || sID) : sID;

      // Nu vergelijken we met realName in plaats van sID
      if (realName === 'Verlof') leave += Number(r.minutes)||0;
      if (realName === 'Ziekte') sick += Number(r.minutes)||0;
      if (realName === 'Schoolverlof' || realName === 'School') school += Number(r.minutes)||0;
      if (realName === 'Feestdag') holiday += Number(r.minutes)||0;
      if (realName === 'Bench') bench += Number(r.minutes)||0;
    });
    const diff = planned - target;

    // push totals
    totals.target += target;
    totals.planned += planned;
    totals.diff += diff;
    totals.leave += leave;
    totals.sick += sick;
    totals.school += school;
    totals.holiday += holiday;
    totals.bench += bench;

    const rowMap = {
      monthLabel: monthsFull[m],
      target: `${Math.floor(target/60)}u ${target%60}min`,
      planned: `${Math.floor(planned/60)}u ${planned%60}min`,
      // === REGEL 1 AANGEPAST ===
      diff: `${diff > 0 ? '+' : (diff < 0 ? '-' : '')}${Math.floor(Math.abs(diff)/60)}u ${Math.abs(diff)%60}min`,
      leave: `${Math.floor(leave/60)}u ${leave%60}min`,
      sick: `${Math.floor(sick/60)}u ${sick%60}min`,
      bench: `${Math.floor(bench/60)}u ${bench%60}min`,
      school: `${Math.floor(school/60)}u ${school%60}min`,
      holiday: `${Math.floor(holiday/60)}u ${holiday%60}min`
    };
    
    // We bouwen de cellen nu op met een check voor de 'diff' kolom
    const rowCells = visibleCols.map(c => {
      if (c.key === 'diff') {
        const diffValue = diff; // 'diff' is hier berekend
        const diffText = rowMap[c.key]; // De opgemaakte string (bv: "+10u 0min")
        
        let colorClass = '';
        if (diffValue > 0) {
          colorClass = 'text-success'; // Bootstrap groen
        } else if (diffValue < 0) {
          colorClass = 'text-danger'; // Bootstrap rood
        }
        // Voeg ook fw-medium toe voor leesbaarheid
        return `<td class="fw-medium ${colorClass}">${diffText}</td>`;
      }
      // Andere kolommen
      return `<td>${rowMap[c.key] || ''}</td>`;
    }).join('');
    
    bodyHtml += `<tr>${rowCells}</tr>`;
  }

  bodyHtml += '</tbody>';

  // footer (totaal)
  const footerMap = {
    target: `${Math.floor(totals.target/60)}u ${totals.target%60}min`,
    planned: `${Math.floor(totals.planned/60)}u ${totals.planned%60}min`,
    // === REGEL 2 AANGEPAST ===
    diff: `${totals.diff > 0 ? '+' : (totals.diff < 0 ? '-' : '')}${Math.floor(Math.abs(totals.diff)/60)}u ${Math.abs(totals.diff)%60}min`,
    leave: `${Math.floor(totals.leave/60)}u ${totals.leave%60}min`,
    sick: `${Math.floor(totals.sick/60)}u ${totals.sick%60}min`,
    bench: `${Math.floor(totals.bench/60)}u ${totals.bench%60}min`,
    school: `${Math.floor(totals.school/60)}u ${totals.school%60}min`,
    holiday: `${Math.floor(totals.holiday/60)}u ${totals.holiday%60}min`
  };
  
  // Zelfde logica voor de footer
  const tfootCells = visibleCols.map(c => {
    if (c.key === 'monthLabel') return `<th>Totaal</th>`;

    if (c.key === 'diff') {
      const diffValue = totals.diff; // De totale 'diff'
      const diffText = footerMap[c.key]; // De opgemaakte string
      
      let colorClass = '';
      if (diffValue > 0) {
        colorClass = 'text-success';
      } else if (diffValue < 0) {
        colorClass = 'text-danger';
      }
      return `<th class="${colorClass}">${diffText}</th>`;
    }
    
    // Andere kolommen
    return `<th>${footerMap[c.key] || ''}</th>`;
  }).join('');

  const tfootHtml = `<tfoot class="table-light"><tr>${tfootCells}</tr></tfoot>`;

  // zet alles in de table
  table.innerHTML = `${theadHtml}${bodyHtml}${tfootHtml}`;

  // behoud dezelfde tbody id voor compatibiliteit
  const newTbody = table.querySelector('tbody');
  if (newTbody) newTbody.id = 'historyBody';
}

/***** ========== MAILBOX — COMPLETE ========== *****/
const mailListBody    = document.getElementById('mailListBody');
const mailDetail      = document.getElementById('mailDetail');
const mailRefreshBtn  = document.getElementById('mailRefreshBtn');
const mailComposeBtn  = document.getElementById('mailComposeBtn');
const mailComposeCard = document.getElementById('mailComposeCard');
const mailToSelect    = document.getElementById('mailToSelect');
const mailSubjectInput= document.getElementById('mailSubjectInput');
const mailBodyInput   = document.getElementById('mailBodyInput');
const mailSendBtn     = document.getElementById('mailSendBtn');
const mailCancelBtn   = document.getElementById('mailCancelBtn');
const mailUnreadBadge = document.getElementById('mailUnreadBadge');
const mailSidebarBadge= document.getElementById('mailSidebarBadge');
const mailFolderNav   = document.getElementById('mailFolderNav');
const mailMarkAllReadBtn = document.getElementById('mailMarkAllReadBtn');
const mailDeleteAllBtn = document.getElementById('mailDeleteAllBtn');

let mailboxUnsubInbox = null;
let mailboxUnsubSent = null;
let mailboxCacheInbox = [];
let mailboxCacheSent = [];
let mailboxCache = [];         // alle berichten (snapshot)
let mailFolder   = 'inbox'; // 'inbox' | 'sent'
let composeThreadId = null; // reply flow

/* ---------- helpers ---------- */
function normTs(ts){
  if (!ts) return '';
  if (typeof ts?.toDate === 'function') return ts.toDate().toISOString();
  if (typeof ts === 'string') return ts;
  return '';
}
function formatWhen(ts){
  if (!ts) return '';
  try { return new Date(ts).toLocaleString('nl-BE'); } catch { return ''; }
}
function updateUnreadBadges(unread) {
  const n = Math.max(0, Number(unread) || 0);
  [mailUnreadBadge, mailSidebarBadge].forEach(badge => {
    if (!badge) return;
    if (n > 0) { badge.textContent = n; badge.classList.remove('d-none'); }
    else       { badge.classList.add('d-none'); }
  });
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
    const qyInbox = query(inboxColRef, orderBy('timestamp','desc'), limit(200));
    
    let isFirstLoadAdmin = true; // 🛑 Vlag om meldingen bij opstarten te blokkeren

    mailboxUnsubInbox = onSnapshot(qyInbox, (snap) => {
      let hasNewLeaveRequest = false; 

      // A. NOTIFICATIE LOOP (Nieuw)
      if (!isFirstLoadAdmin) {
        snap.docChanges().forEach((change) => {
          if (change.type === "added") {
            const d = change.doc.data();
            // Als het ongelezen is, stuur melding
            if (!d.read) {
              const sender = d.fromName || d.from?.name || "Onbekend";
              const subject = d.subject || "(Geen onderwerp)";
              
              // Stuur browser melding
              if (typeof sendBrowserNotification === 'function') {
                  sendBrowserNotification(`Nieuw bericht van ${sender}`, subject);
              }
            }
          }
        });
      }

      // B. BESTAANDE UI LOGICA
      mailboxCacheInbox = snap.docs.map(d => {
        const data = d.data();
        if (data.kind === 'leave_request' && data.read === false) {
          hasNewLeaveRequest = true; 
        }
        return { _id:d.id, ...data, _tsIso: normTs(data.timestamp), _source: 'admin_mail' };
      });
      
      mergeAndRenderMail(); 

      // C. LIVE TAB UPDATE LOGICA
      if (hasNewLeaveRequest) {
        const isVerlofTabActive = document.querySelector('a[href="#tab-verlofbeheer"]')?.classList.contains('active');
        if (isVerlofTabActive) {
          console.log("Live update: Nieuwe verlofaanvraag gedetecteerd.");
          toast('Nieuwe verlofaanvraag!', 'info');
          (async () => {
             await loadAllUsers(); 
             if(typeof loadAndRenderLeaveRequests === 'function') loadAndRenderLeaveRequests();
          })();
        }
      }

      isFirstLoadAdmin = false; // 🛑 Vlag uitzetten na eerste keer
    });

    // Bron 2: Hun EIGEN mailbox (voor Verzonden items) -> Geen notificaties nodig
    const sentColRef = collection(db, 'users', uid, 'mailbox');
    const qySent = query(sentColRef, orderBy('timestamp','desc'), limit(200));
    mailboxUnsubSent = onSnapshot(qySent, (snap) => {
      mailboxCacheSent = snap.docs.map(d => ({ _id:d.id, ...d.data(), _tsIso: normTs(d.data().timestamp), _source: 'user_mailbox' }));
      mergeAndRenderMail(); 
    });

  } else {
    // --- GEWONE USER: Luistert naar ÉÉN bron ---
    const userColRef = collection(db, 'users', uid, 'mailbox');
    const qyUser = query(userColRef, orderBy('timestamp','desc'), limit(200));

    let isFirstLoadUser = true; // 🛑 Vlag om meldingen bij opstarten te blokkeren

    mailboxUnsubInbox = onSnapshot(qyUser, (snap) => {
      
      // A. NOTIFICATIE LOOP (Nieuw)
      if (!isFirstLoadUser) {
        snap.docChanges().forEach((change) => {
          if (change.type === "added") {
            const d = change.doc.data();
            
            // Check: bericht voor mij? ongelezen? niet van mijzelf?
            const isForMe = d.to?.uid === uid || d.to?.type === 'user'; 
            const notFromMe = d.from?.uid !== uid; 

            if (!d.read && isForMe && notFromMe) {
               const sender = d.system ? "Shift Planner" : (d.from?.name || "Admin");
               const subject = d.subject || "(Geen onderwerp)";
               
               // Stuur browser melding
               if (typeof sendBrowserNotification === 'function') {
                   sendBrowserNotification(`Nieuw bericht van ${sender}`, subject);
               }
            }
          }
        });
      }

      // B. BESTAANDE UI LOGICA
      mailboxCacheInbox = snap.docs.map(d => ({ _id:d.id, ...d.data(), _tsIso: normTs(d.data().timestamp), _source: 'user_mailbox' }));
      mailboxCacheSent = []; 
      mergeAndRenderMail(); 

      isFirstLoadUser = false; // 🛑 Vlag uitzetten
    });
  }
}

/* ---------- compose ---------- */
function isAdmin() {
  const me = dataStore.users[getActiveUserId()];
  return (me?.role || 'user') === 'admin';
}
function prepareComposeOptions() {
  mailToSelect.innerHTML = '';
  if (isAdmin()) {
    // admin → kies user (excl admins)
    const opt0 = document.createElement('option');
    opt0.value = ''; opt0.textContent = 'Kies gebruiker…';
    mailToSelect.appendChild(opt0);
    Object.entries(dataStore.users).forEach(([uid,u]) => {
      if ((u.role || 'user') === 'admin') return;
      const o = document.createElement('option');
      o.value = `user:${uid}`; o.textContent = u.name || u.email || uid;
      mailToSelect.appendChild(o);
    });
  } else {
    // user → admins
    const o = document.createElement('option');
    o.value = 'admin-group'; o.textContent = 'Admins';
    mailToSelect.appendChild(o);
  }
}
function prepareComposeToCounterparty(m) {
  prepareComposeOptions();
  if (isAdmin()) {
    mailToSelect.value = `user:${m.from?.uid || ''}`;
  } else {
    mailToSelect.value = 'admin-group';
  }
  mailSubjectInput.value = m.subject?.startsWith('Re: ') ? m.subject : `Re: ${m.subject || ''}`;
  mailBodyInput.value = '';
  composeThreadId = m.threadId || `conv:${m.from?.uid || getActiveUserId()}`;
}

/* ---------- send helpers ---------- */
async function sendSystemMail(uid, subject, body, kind = "notification", threadId = `sys:${Date.now()}`) {
  await addDoc(collection(db, "users", uid, "mailbox"), {
    threadId,
    system: true,
    kind,
    from: { uid: "noreply", name: "Shift Planner", role: "system", email: "no-reply@local" },
    to:   { type: "user", uid },
    subject,
    body,
    read: false,
    timestamp: serverTimestamp()
  });
}

async function sendUserMessageToAdmins(subject, body, threadId=`conv:${getActiveUserId()}`) {
  const meUid = getActiveUserId();
  const me = dataStore.users[meUid];
  const meName = me?.name || me?.email || meUid;
  const meEmail = me?.email || 'onbekend'; // We pakken het e-mailadres mee

  // kopie in eigen mailbox (als 'verzonden') - DIT BLIJFT HETZELFDE
  await addDoc(collection(db, 'users', meUid, 'mailbox'), {
    threadId, system:false, kind:'message',
    from:{ uid: meUid, name: meName, role:'user' },
    to:{ type:'admin-group' },
    subject, body, read:true,
    timestamp: serverTimestamp()
  });

  // ...schrijven we één bericht naar de centrale 'admin_mail' collectie
  await addDoc(collection(db, "admin_mail"), {
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
    from:{ uid: meUid, name: meName, role:'user' },
    to:{ type:'admin-group' }, 
    subject, body, read:true,
    timestamp: serverTimestamp()
  });

  // 2. Schrijf naar de centrale 'admin_mail' collectie
  await addDoc(collection(db, "admin_mail"), {
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
  const user  = dataStore.users[userUid];
  const threadId = `conv:${userUid}`;

  // kopie in admin mailbox
  await addDoc(collection(db,'users', adminUid, 'mailbox'), {
    threadId, system:false, kind:'message',
    from: { uid:adminUid, name: admin?.name || admin?.email || 'Admin', role:'admin' },
    to:   { type:'user-id', uid:userUid },
    subject, body, read:true, timestamp: serverTimestamp()
  });

  // naar de user
  await addDoc(collection(db,'users', userUid, 'mailbox'), {
    threadId, system:false, kind:'message',
    from: { uid:adminUid, name: admin?.name || admin?.email || 'Admin', role:'admin' },
    to:   { type:'user', uid:userUid },
    subject, body, read:false, timestamp: serverTimestamp()
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
`; 

  // Schrijf naar de centrale 'admin_mail' collectie
  await addDoc(collection(db, "admin_mail"), {
      fromUserId: uid,
      fromName: meName,
      fromEmail: meEmail,
      subject: subject,
      body: body,
      kind: 'leave_request', 
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
  
  // ⬇️ FIX: Vind het bericht in de cache om de bron te kennen
  const msg = mailboxCache.find(m => m._id === messageId);
  if (!msg) return; // Bericht al weg

  let docRef;
  if (msg._source === 'admin_mail') {
    docRef = doc(db, 'admin_mail', messageId);
  } else {
    docRef = doc(db, 'users', uid, 'mailbox', messageId);
  }

  await updateDoc(docRef, { read: !!val }); 
  
  // Cache update (lokaal)
  const m = mailboxCache.find(x => x._id === messageId);
  if (m) m.read = !!val;
  renderMailList();
}
async function deleteMail(messageId) {
  const uid = currentUserId; 
  
  // ⬇️ FIX: Vind het bericht in de cache om de bron te kennen
  const msg = mailboxCache.find(m => m._id === messageId);
  if (!msg) return; // Bericht al weg

  let docRef;
  if (msg._source === 'admin_mail') {
    docRef = doc(db, 'admin_mail', messageId);
  } else {
    docRef = doc(db, 'users', uid, 'mailbox', messageId);
  }

  await deleteDoc(docRef); 
  
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
  const uid = currentUserId; 
  const items = mailboxCache
    .slice()
    .sort((a,b)=> (b._tsIso||'').localeCompare(a._tsIso||''));

  if (mailFolder === 'sent') {
    // verzonden = door mij (niet system)
    return items.filter(m => (m.from?.uid === uid) && !m.system);
  }
  // inbox = alles dat NIET door mij is gestuurd óf system
  return items.filter(m => (m.from?.uid !== uid) || m.system);
}

function renderMailList() {
  const msgs = filteredMessages();
  mailListBody.innerHTML = '';

  let unread = 0;
  msgs.forEach(m => { if (!m.read && mailFolder === 'inbox') unread++; });

  updateUnreadBadges(unread);

  msgs.forEach(m => {
    // 👇 HIER IS DE FIX: Kijkt nu naar de 'Verzonden' map
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
      // In Inbox, toon de 'From' (Van)
      displayName = m.system ? 'Shift Planner (noreply)' : (m.fromName || m.from?.name || m.fromEmail || m.from?.email || '—');
    }

    const tr = document.createElement('tr');
    tr.className = m.read ? '' : 'fw-semibold';
    tr.innerHTML = `
      <td>${displayName}</td>
      <td><a href="#" class="js-open" data-id="${m._id}">${m.subject || '(geen onderwerp)'}</a></td>
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
  if (!m.read) { markMailRead(m._id, true); m.read = true; }

  const fromName = m.system ? 'Shift Planner (noreply)' : (m.from?.name || m.from?.email || '—');
  const actions = `
    <div class="d-flex gap-2">
      <button class="btn btn-outline-secondary btn-sm js-mark-unread" data-id="${m._id}">Markeer ongelezen</button>
      <button class="btn btn-outline-danger btn-sm js-del" data-id="${m._id}">
        <span class="material-icons-outlined" style="font-size:16px">delete</span>
      </button>
      ${m.system ? '' : '<button class="btn btn-outline-primary btn-sm js-reply" data-id="'+m._id+'"><span class="material-icons-outlined">reply</span> Antwoorden</button>'}
    </div>`;

  mailDetail.innerHTML = `
    <div class="d-flex justify-content-between align-items-start">
      <div>
        <div class="fw-semibold">${m.subject || '(geen onderwerp)'}</div>
        <div class="mail-meta">Van: ${fromName} • ${formatWhen(m._tsIso)}</div>
      </div>
      ${actions}
    </div>
    <hr class="my-2">
    <div style="white-space:pre-wrap">${m.body || ''}</div>
  `;
  mailDetail.dataset.openId = m._id;
}

/* ---------- once-only UI binding ---------- */
function bindMailboxUIOnce() {
  if (typeof mailUIBound === 'undefined') window.mailUIBound = false;
  if (mailUIBound) return;
  mailUIBound = true;

  // ✅ FIX: Haal elementen hier lokaal op (voorkomt initialization errors)
  const nav = document.getElementById('mailFolderNav');
  const compBtn = document.getElementById('mailComposeBtn');
  const refBtn = document.getElementById('mailRefreshBtn');
  const cancBtn = document.getElementById('mailCancelBtn');
  const sndBtn = document.getElementById('mailSendBtn');
  const delAllBtn = document.getElementById('mailDeleteAllBtn');
  const markAllBtn = document.getElementById('mailMarkAllReadBtn');
  const compCard = document.getElementById('mailComposeCard');
  
  // Folder switch
  nav?.addEventListener('click', (e) => {
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
    if (titleEl) titleEl.textContent = (mailFolder === 'sent') ? 'Verzonden' : 'Inbox';
  
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

    const toVal   = toSelect?.value;
    const subject = (subjInput?.value || '').trim();
    const body    = (bodyInput?.value || '').trim();
    
    if (!toVal || !subject || !body) return toast('Vul aan: geadresseerde, onderwerp en bericht', 'warning');

    const meUid = getActiveUserId();
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
    const uid = getActiveUserId();
    if (uid) listenMailbox(uid);
  });

  // Delete All
  delAllBtn?.addEventListener('click', async () => {
    const uid = currentUserId; 
    if (!uid) return;
    const folderName = (mailFolder === 'sent') ? 'verzonden items' : 'inbox';
    const messagesToDelete = filteredMessages(); 

    if (messagesToDelete.length === 0) return toast(`Er zijn geen berichten in je ${folderName}.`, 'info');
    if (!confirm(`Weet je zeker dat je alle ${messagesToDelete.length} berichten in je ${folderName} permanent wilt verwijderen?`)) return;

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
      console.error("Fout:", err);
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
      console.error("Fout:", err);
      toast('Er ging iets mis.', 'danger');
    }
  });

  // Lijst en Detail click listeners (Delegation)
  const listBody = document.getElementById('mailListBody');
  listBody?.addEventListener('click', async (e) => {
    const aOpen = e.target.closest('a.js-open');
    const bTog  = e.target.closest('button.js-toggle');
    const bDel  = e.target.closest('button.js-del');
    
    if (aOpen) {
      e.preventDefault();
      const msg = filteredMessages().find(x => x._id === aOpen.dataset.id) || mailboxCache.find(x => x._id === aOpen.dataset.id);
      if (msg) openMail(msg);
    }
    else if (bTog) {
      const id = bTog.dataset.id;
      const msg = mailboxCache.find(x => x._id === id);
      await markMailRead(id, !(msg?.read));
    }
    else if (bDel) {
      const id = bDel.dataset.id;
      if (!confirm('Dit bericht verwijderen?')) return;
      await deleteMail(id);
      toast('Bericht verwijderd', 'success');
    }
  });

  const detailEl = document.getElementById('mailDetail');
  detailEl?.addEventListener('click', (e) => {
    const markUn = e.target.closest('.js-mark-unread');
    const delBtn = e.target.closest('.js-del');
    const reply  = e.target.closest('.js-reply');

    if (markUn) {
      markMailRead(markUn.dataset.id, false);
      toast('Gemarkeerd als ongelezen', 'success');
    }
    else if (delBtn) {
      if (!confirm('Dit bericht verwijderen?')) return;
      deleteMail(delBtn.dataset.id).then(()=> toast('Bericht verwijderd', 'success'));
    }
    else if (reply) {
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

/* ---------- init on tab show ---------- */
document.querySelector('a[href="#tab-mail"]')?.addEventListener('shown.bs.tab', () => {
  bindMailboxUIOnce();
  const uid = getActiveUserId();
  if (uid) listenMailbox(uid);
});
// USERMAIL – gewone user kan dit veilig
async function sendUserMail(db, adminUid, subject, body) {
  await addDoc(collection(db, "users", adminUid, "mailbox"), {
    threadId: `user:${Date.now()}`,
    system: false, kind: "message",
    from: { uid: getActiveUserId(), name: currentUserName, role: "user" },
    to:   { type: "admin", uid: adminUid },
    subject, body,
    read: false,
    timestamp: serverTimestamp()
  });
}
/***** ========== /MAILBOX ========== *****/
// ✅ NIEUW: Helper voor verlof-status mail
async function notifyUserOfLeaveStatus(uid, rowData, dateKey, status) {
  const adminId = auth.currentUser.uid;
  const adminName = auth.currentUser.displayName || "Admin";
  const { shift, omschrijving } = rowData;
  const dateStr = dateKey.split('-').reverse().join('-'); // ISO -> DD-MM-YYYY

  let subject = '';
  let body = '';

  if (status === 'approved') {
    subject = `[Planner] Verlof Goedgekeurd: ${shift} op ${dateStr}`;
    body = `Je aanvraag voor ${shift} op ${dateStr} is goedgekeurd.`;
  } else {
    subject = `[Planner] Verlof Afgekeurd: ${shift} op ${dateStr}`;
    body = `Je aanvraag voor ${shift} op ${dateStr} is helaas afgekeurd.`;
  }

  const threadId = `leave:${uid}:${dateKey}`;

  // 1. Mail naar user
  await addDoc(collection(db, "users", uid, "mailbox"), {
    threadId, system: true, kind: "status",
    from: { uid: adminId, name: adminName, role: 'admin' },
    to: { uid: uid, type: "user" },
    subject, body, read: false,
    timestamp: serverTimestamp()
  });

  // 2. Kopie in admin's "Verzonden" map
  await addDoc(collection(db, "users", adminId, "mailbox"), {
    threadId, system: false, kind: "status",
    from: { uid: adminId, name: adminName, role: 'admin' },
    to: { uid: uid, type: "user" },
    subject, body, read: true,
    timestamp: serverTimestamp()
  });
}
/***** ========== PROFIEL TABBLAD ========== *****/

    // 1. Functie om de velden te vullen
    function loadProfileTab() {
      const user = auth.currentUser;
      if (!user) return;

      // Vul naam en e-mail in
      document.getElementById('profileName').value = user.displayName || '';
      document.getElementById('profileEmail').value = user.email || '';

      // Vul profielfoto in de MODAL in
      const photoEl = document.getElementById('profilePhoto');
      if (user.photoURL) {
        photoEl.src = user.photoURL;
      } else {
        // Fallback (standaard anonieme avatar)
        photoEl.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iY3VycmVudENvbG9yIiBjbGFzcz0iYmkgYmktcGVyc29uLWZpbGwiIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZD0iTTMgMTQgczEtMiAyLTIgMiAyIDIgMiAyLTItMi0yem01LTAiLz48cGF0aCBkPSJNODguNUM4IDcuNjcgNy4zMyA3IDYuNSA3UzUgNy42NyA1IDguNSA1LjY3IDEwIDYuNSAxMFM4IDkuMzMgOCA4LjV6bS0yIDBjMCAxLjExLS44OSAyLTIgMnMtMi0uODktMi0yIC44OS0yIDItMiAyIC44OSAyIDJ6bS0yLTNjLTMuMTQ2IDAtNS41IDIuNTM2LTUuNSA1LjVWMTloMTJ2LTIuNWMwLTIuOTY0LTIuMzU0LTUuNS01LjUtNS41eiIvPjwvc3ZnPg==';
      }

      // Zet de Dark Mode schakelaar in de juiste stand
      const toggle = document.getElementById('profileDarkModeToggle');
      toggle.checked = document.body.classList.contains('dark-mode');
      // ✅ HIER TOEVOEGEN: Sidebar-vinkje instellen
      const ud = getCurrentUserData();
      const sidebarToggle = document.getElementById('profileSidebarToggle');
      if (sidebarToggle) {
        sidebarToggle.checked = !!ud?.settings?.sidebarCollapsed;
     }

      // ✅ HIER TOEVOEGEN: Standaard tabblad & Notificaties instellen
      
      // 1. Standaard tabblad
      const defaultTabSelect = document.getElementById('profileDefaultTab');
      if (defaultTabSelect) {
        defaultTabSelect.value = ud?.settings?.defaultTab || '#tab-home'; // Fallback naar Home
      }
// ✅ HIER TOEVOEGEN: Markeer het geselecteerde kleurbolletje
      const picker = document.getElementById('profileColorPicker');
      if (picker) {
        // Haal huidige kleur op (uit localStorage, met fallback naar Firestore)
        const currentColor = localStorage.getItem('accentColor') || ud?.settings?.accentColor || '#0d6efd';
        
        // Verwijder 'selected' van alle bolletjes
        picker.querySelectorAll('.color-dot').forEach(dot => dot.classList.remove('selected'));
        
        // Voeg 'selected' toe aan de juiste
        const activeDot = picker.querySelector(`.color-dot[data-color="${currentColor}"]`);
        if (activeDot) {
          activeDot.classList.add('selected');
        }
      }
      // EINDE TOEVOEGING
      // 2. Notificatie vinkjes
      const prefs = ud?.settings?.notificationPrefs || {};
      document.getElementById('prefNotifyDailyEmpty').checked = prefs.notifyDailyEmpty !== false;
      document.getElementById('prefNotifyWeeklyEmpty').checked = prefs.notifyWeeklyEmpty !== false;
      document.getElementById('prefNotifyMonthlyGoal').checked = prefs.notifyMonthlyGoal !== false;
      document.getElementById('prefNotifyProjectEnd').checked = prefs.notifyProjectEnd !== false;
      // EINDE TOEVOEGING
      renderProfileShiftSettings();
    }

    // 2. Koppel de laad-functie aan het 'show' event van de modal
    const profileModalEl = document.getElementById('profileModal');
    profileModalEl?.addEventListener('show.bs.modal', loadProfileTab);


    // 3. Knop: Naam opslaan
    document.getElementById('profileSaveBtn')?.addEventListener('click', async () => {
      const user = auth.currentUser;
      const newName = document.getElementById('profileName').value.trim();
      if (!user || !newName) return toast('Vul een naam in', 'warning');

      try {
        // Stap A: Update Firebase Auth profiel
        await updateProfile(user, { displayName: newName });

        // Stap B: Update naam in Firestore database (voor Admin paneel)
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, { name: newName });

        // Stap C: Update de UI direct
        document.getElementById('currentUserName').textContent = newName;
        document.getElementById('homeUserName').textContent = newName;

        toast('Naam opgeslagen!', 'success');
      } catch (err) {
        console.error("Fout bij opslaan profiel:", err);
        toast('Opslaan mislukt: ' + err.message, 'danger');
      }
    });

    // 4. Schakelaar: Donkere Modus (NIEUW)
    // Eerst controleren bij het laden van de pagina
    const prefersDark = localStorage.getItem('darkMode') === 'true';
    if (prefersDark) document.body.classList.add('dark-mode');

    // Dan de knop in de modal koppelen
    document.getElementById('profileDarkModeToggle')?.addEventListener('change', (e) => {
      const active = e.target.checked;
      document.body.classList.toggle('dark-mode', active);
      localStorage.setItem('darkMode', active);
    });
// ✅ HIER TOEVOEGEN: Schakelaar: Sidebar voorkeur
    document.getElementById('profileSidebarToggle')?.addEventListener('change', async (e) => {
      const active = e.target.checked;
      const ud = getCurrentUserData();
      ud.settings ||= {};
      ud.settings.sidebarCollapsed = active;
      
      // Pas UI direct aan
      sidebar.classList.toggle('collapsed', active);
      main.classList.toggle('collapsed', active);
      
      // Sla op in Firestore (niet met 'debouncedSave' want dit is een directe actie)
      await saveUserData(); 
      toast('Sidebar-voorkeur opgeslagen', 'success');
    });
// ✅ HIER TOEVOEGEN: Dropdown: Standaard opstart-tabblad
    document.getElementById('profileDefaultTab')?.addEventListener('change', async (e) => {
      const newTab = e.target.value;
      const ud = getCurrentUserData();
      ud.settings ||= {};
      ud.settings.defaultTab = newTab;
      
      await saveUserData(); 
      toast('Standaard opstart-tabblad opgeslagen', 'success');
    });

// ✅ HIER TOEVOEGEN: Fieldset: Notificatie voorkeuren (delegated)
    document.getElementById('profileNotifPrefs')?.addEventListener('change', async (e) => {
      // Reageer alleen op de vinkjes zelf
      if (e.target.type !== 'checkbox') return; 

      const ud = getCurrentUserData();
      ud.settings ||= {};
      
      // Lees ALLE vinkjes in de fieldset en sla ze op als een object
      const prefs = {
        notifyDailyEmpty: document.getElementById('prefNotifyDailyEmpty').checked,
        notifyWeeklyEmpty: document.getElementById('prefNotifyWeeklyEmpty').checked,
        notifyMonthlyGoal: document.getElementById('prefNotifyMonthlyGoal').checked,
        notifyProjectEnd: document.getElementById('prefNotifyProjectEnd').checked,
      };
      
      ud.settings.notificationPrefs = prefs;
      
      await saveUserData(); 
      toast(`Notificatie-voorkeuren opgeslagen`, 'success');
    });
// ✅ HIER TOEVOEGEN: Klik-listener voor Accentkleur
    document.getElementById('profileColorPicker')?.addEventListener('click', async (e) => {
      const dot = e.target.closest('.color-dot');
      if (!dot) return; // Klik was niet op een bolletje

      const newColor = dot.dataset.color;

      // 1. Update de UI direct
      applyAccentColor(newColor);

      // 2. Update de "selected" class in de modal
      document.querySelectorAll('#profileColorPicker .color-dot').forEach(d => d.classList.remove('selected'));
      dot.classList.add('selected');

      // 3. Sla op in Firestore
      const ud = getCurrentUserData();
      ud.settings ||= {};
      ud.settings.accentColor = newColor;
      await saveUserData();
      
      toast('Accentkleur opgeslagen!', 'success');
    });
// ✅ HIER TOEVOEGEN: Knop: Exporteer Mijn Gegevens
    document.getElementById('profileExportBtn')?.addEventListener('click', () => {
      try {
        // 1. Haal de data op van de HUIDIGE ingelogde gebruiker
        // We gebruiken currentUserId, NIET getActiveUserId(), want je exporteert altijd JEZELF.
        const ud = dataStore.users[currentUserId];
        if (!ud) {
          return toast('Kon gebruikersdata niet vinden.', 'danger');
        }

        // 2. Converteer data naar een JSON-string
        // null, 2 zorgt voor een "mooie" (leesbare) JSON-opmaak
        const dataStr = JSON.stringify(ud, null, 2);

        // 3. Maak een Blob (een 'bestand' in het geheugen)
        const blob = new Blob([dataStr], { type: "application/json" });

        // 4. Maak een download-link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        
        // 5. Stel de bestandsnaam in
        const ymd = new Date().toISOString().slice(0, 10); // Bv. 2025-11-02
        a.download = `shift_planner_export_${ud.name || 'user'}_${ymd}.json`;

        // 6. "Klik" op de link om de download te starten
        document.body.appendChild(a);
        a.click();

        // 7. Opruimen
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        toast('Gegevens worden gedownload!', 'success');
      
      } catch (err) {
        console.error("Fout bij exporteren:", err);
        toast('Export mislukt: ' + err.message, 'danger');
      }
    });
    // ==========================================
// ADMIN: WISSELEN VAN GEBRUIKER (Cruciaal)
// ==========================================
// ✅ DEZE FUNCTIE ZORGT DAT ALLES HERLADEN WORDT NA EEN WISSEL
window.renderUserDataAsAdmin = async function(uid) {
  // 1. Zorg dat we de data van deze gebruiker hebben
  if (!dataStore.users[uid]) {
     const snap = await getDoc(doc(db, 'users', uid));
     if (snap.exists()) {
       dataStore.users[uid] = snap.data();
     }
  }
  
  // 2. Zet de actieve view user (zodat alle andere functies weten naar wie we kijken)
  dataStore.viewUserId = uid;
  
  // 3. Update alle schermen met de data van DEZE user
  renderProjects();
  renderShifts();
  if(typeof populateFilterShiftYears === 'function') populateFilterShiftYears();
  renderProjectFilterForMonth();
  await generateMonth(); // Herlaadt maandoverzicht
  renderHistory();       // Herlaadt historiek
  
  // 4. Update Admin specifieke velden (zoals verlof saldo inputs)
  if (typeof hydrateAdminLeaveInputsFor === 'function') {
    hydrateAdminLeaveInputsFor(uid);
  }

  // 5. Update labels zodat je ziet wie je bewerkt
  const u = dataStore.users[uid];
  const name = u ? (u.name || u.email || uid) : "Onbekend";
  
  const lblAdmin = document.getElementById('activeUserLabel');
  if (lblAdmin) lblAdmin.textContent = name;
  
  const lblApprove = document.getElementById('approvalActiveUserLabel');
  if (lblApprove) lblApprove.textContent = name;
  
  const settingsName = document.getElementById('adminSettingsName');
  if (settingsName) {
     settingsName.textContent = name;
     settingsName.className = uid ? "text-primary fw-bold" : "text-muted";
  }
  
  // 6. Ververs mailbox knop (om verwarring te voorkomen)
  // (Optioneel: je zou hier mailbox ook kunnen switchen, maar dat is complexer)
}

// ==========================================
// VERLOF HELPERS (Schoolverlof & Gewoon verlof)
// ==========================================

// --- 1. Gewoon Verlof (Jaarlijks potje) ---
function getLeaveAllowanceMinutes() {
  const ud = getCurrentUserData();
  const y = Number(yearSelectMain.value);
  // Haal op uit settings (standaard 0 als niet ingesteld)
  return (ud.settings?.leaveAllowance?.[y] || 0) * 60; 
}

// --- 2. Schoolverlof (Academiejaar: Sept t/m Aug) ---
function getSchoolLeaveAllowanceMinutes(calendarYear, monthIndex) {
  // Bepaal welk academiejaar dit is.
  // Sept(8) t/m Dec(11) hoort bij startjaar = calendarYear
  // Jan(0) t/m Aug(7) hoort bij startjaar = calendarYear - 1
  const startYear = (monthIndex >= 8) ? calendarYear : calendarYear - 1;
  const key = `${startYear}-${startYear+1}`; // bv "2024-2025"

  const ud = getCurrentUserData();
  // Haal op uit settings (uren * 60)
  return (ud.settings?.schoolLeaveAllowance?.[key] || 0) * 60;
}

// Helper: Grenzen van academiejaar bepalen
function getAcademicYearBounds(calendarYear, monthIndex) {
  const startYear = (monthIndex >= 8) ? calendarYear : calendarYear - 1;
  const endYear = startYear + 1;
  
  return {
    label: `${startYear}-${endYear}`, // Voor weergave
    startISO: `${startYear}-09-01`,   // 1 sept
    endISO:   `${endYear}-08-31`      // 31 aug
  };
}

// --- 3. Tellers (Hoeveel is er al opgenomen?) ---

// Telt minuten voor een lijst shiftnamen binnen het HUIDIGE kalenderjaar (voor gewoon verlof)
function sumTakenMinutesFor(year, shiftNames) {
  const ud = getCurrentUserData();
  let total = 0;
  
  // Loop door alle maanden van dit jaar
  for (let m = 0; m < 12; m++) {
    const md = ud.monthData?.[year]?.[m];
    if (!md || !md.rows) continue;

    Object.values(md.rows).forEach(r => {
      // Alleen goedgekeurde of (indien admin) pending tellen?
      // Meestal tellen we alles behalve 'rejected'
      if (r.status === 'rejected') return;
      
      const sName = (r.shift || '').trim();
      if (!sName) return;

      // Check of de shiftnaam (of "echte naam") in de lijst staat
      const def = ud.shifts?.[sName];
      const real = def ? (def.realName || sName) : sName;
      
      if (shiftNames.includes(real)) {
        total += Number(r.minutes) || 0;
      }
    });
  }
  return total;
}

// Telt minuten voor een lijst shiftnamen binnen een EXACTE datum range (voor schoolverlof)
function sumTakenMinutesForRange(startISO, endISO, shiftNames) {
  const ud = getCurrentUserData();
  let total = 0;
  
  // Converteer range naar getallen voor snelle check
  const sInt = parseInt(startISO.replaceAll('-',''));
  const eInt = parseInt(endISO.replaceAll('-',''));

  // We moeten door meerdere jaren loopen (maximaal 2: startjaar en eindjaar van range)
  const startY = parseInt(startISO.substring(0,4));
  const endY   = parseInt(endISO.substring(0,4));

  for (let y = startY; y <= endY; y++) {
    if (!ud.monthData?.[y]) continue;
    
    // Loop door maanden
    for (let m = 0; m < 12; m++) {
      const md = ud.monthData[y][m];
      if (!md || !md.rows) continue;
      
      // Loop door rijen
      Object.entries(md.rows).forEach(([key, r]) => {
        // key is bv "2024-09-01" of "2024-09-01_123"
        const datePart = key.split('_')[0]; 
        const dInt = parseInt(datePart.replaceAll('-',''));

        // Check datum range
        if (dInt < sInt || dInt > eInt) return;

        if (r.status === 'rejected') return;

        const sName = (r.shift || '').trim();
        if (!sName) return;

        const def = ud.shifts?.[sName];
        const real = def ? (def.realName || sName) : sName;
        
        if (shiftNames.includes(real)) {
          total += Number(r.minutes) || 0;
        }
      });
    }
  }
  return total;
}

// ==========================================
// ADMIN: INPUTS VULLEN (Verlof Instellingen)
// ==========================================
// Deze functie vult de inputvelden in het "Admin Instellingen" tabblad
// met de huidige saldo's van de geselecteerde gebruiker.
function hydrateAdminLeaveInputsFor(uid) {
  const ud = dataStore.users[uid];
  if (!ud) return;

  const year = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  
  // 1. Gewoon Verlof (Huidig Jaar)
  const leaveInput = document.getElementById('adminLeaveAllowanceInput');
  if (leaveInput) {
      // Ophalen (in uren)
      const uren = ud.settings?.leaveAllowance?.[year] || 0;
      leaveInput.value = uren;
  }

  // 2. Schoolverlof (Huidig Academiejaar)
  const schoolInput = document.getElementById('adminSchoolLeaveInput');
  const schoolLabel = document.getElementById('adminSchoolLeaveLabel'); // label voor het jaar
  if (schoolInput) {
      const { label, startISO } = getAcademicYearBounds(year, m);
      const key = label; // bv "2024-2025"
      
      // Update label zodat admin ziet welk jaar hij bewerkt
      if(schoolLabel) schoolLabel.textContent = `Schoolverlof (${label})`;
      
      const uren = ud.settings?.schoolLeaveAllowance?.[key] || 0;
      schoolInput.value = uren;
      
      // Sla de key op in het input element voor bij het opslaan
      schoolInput.dataset.yearKey = key; 
  }
}

// ==========================================
// OPSLAAN KNOPPEN ADMIN (Events)
// ==========================================

// 1. Gewoon Verlof Opslaan
document.getElementById('adminSaveLeaveBtn')?.addEventListener('click', async () => {
    const uid = dataStore.viewUserId || currentUserId; // Wie bewerken we?
    const val = document.getElementById('adminLeaveAllowanceInput').value;
    const year = Number(yearSelectMain.value);
    
    const u = dataStore.users[uid];
    u.settings ||= {};
    u.settings.leaveAllowance ||= {};
    u.settings.leaveAllowance[year] = Number(val);
    
    await updateDoc(doc(db, 'users', uid), { 
        [`settings.leaveAllowance.${year}`]: Number(val) 
    });
    
    renderHome(); // Ververs dashboard
    renderHistory(); // Ververs historiek
    toast(`Verlof (${year}) opgeslagen voor ${u.name||'user'}`, 'success');
});

// 2. Schoolverlof Opslaan
document.getElementById('adminSaveSchoolLeaveBtn')?.addEventListener('click', async () => {
    const uid = dataStore.viewUserId || currentUserId;
    const input = document.getElementById('adminSchoolLeaveInput');
    const val = input.value;
    const key = input.dataset.yearKey; // "2024-2025"
    
    if (!key) return; // Veiligheid

    const u = dataStore.users[uid];
    u.settings ||= {};
    u.settings.schoolLeaveAllowance ||= {};
    u.settings.schoolLeaveAllowance[key] = Number(val);
    
    await updateDoc(doc(db, 'users', uid), { 
        [`settings.schoolLeaveAllowance.${key}`]: Number(val) 
    });
    
    renderHome();
    renderHistory();
    toast(`Schoolverlof (${key}) opgeslagen`, 'success');
});

// ==========================================
// INIT: Start alles op
// ==========================================
// Als het document geladen is, maar we wachten eigenlijk op Auth state change.
// Dit is een vangnet voor als script modules raar laden.
console.log("App.js volledig geladen.");
