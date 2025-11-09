import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
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

        // ======= State =======
    let currentUserId = null;
    let notificationInterval = null;
    const dataStore = { 
      users: {}, 
      currentUser: null,
      notifications: [] // 👈 VOEG DEZE REGEL TOE
    };
    let saveTimer = null; // Timer voor het vertraagd opslaan
    const debouncedSave = () => {
      clearTimeout(saveTimer); // Stop de vorige timer
      saveTimer = setTimeout(() => {
        saveUserData(); // Sla nu pas echt op
        console.log("DB: Data opgeslagen (met vertraging).");
      }, 2000); // Wacht 2 seconden (2000ms)
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
function listDayKeys(md, baseKey) {
  const rows = md?.rows || {};
  return Object.keys(rows)
    .filter(k => k === baseKey || k.startsWith(baseKey + '#'))
    .sort((a, b) => a.localeCompare(b, 'nl'));
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
  const planned = Object.values(md.rows||{}).reduce((s,r)=> s + (Number(r.minutes)||0), 0);
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

  badge.className = 'badge badge-status';
  if (status==='draft'){ badge.classList.add('badge-draft'); badge.textContent='Concept'; }
  if (status==='submitted'){ badge.classList.add('badge-submitted'); badge.textContent='Ingediend'; }
  if (status==='approved'){ badge.classList.add('badge-approved'); badge.textContent='Goedgekeurd'; }
  if (status==='rejected'){ badge.classList.add('badge-rejected'); badge.textContent='Afgekeurd'; }

  const hide = (status==='submitted' || status==='approved') && !isAdmin();
  if (submitBtn){
    submitBtn.classList.toggle('d-none', hide);
    submitBtn.disabled = hide;
  }

  if (multiDayShiftBtn){
    multiDayShiftBtn.classList.toggle('d-none', hide);  // ✅ “Invoer meerdere dagen” ook verbergen
    multiDayShiftBtn.disabled = hide;
  }
}
    // ======= Auth =======
onAuthStateChanged(auth, async (user)=>{
      //Stop alle intervals als we uitloggen
      if (notificationInterval) clearInterval(notificationInterval);
// ✅ HIER TOEVOEGEN (BOVENAAN): Laad kleur uit localStorage (instant)
      const savedColor = localStorage.getItem('accentColor');
      if (savedColor) {
        applyAccentColor(savedColor);
      }
      // EINDE TOEVOEGING

      if(!user){
        // Voor demo: toon eenvoudige melding
        currentUserName.textContent = 'Niet ingelogd';
        toast('Geen gebruiker ingelogd. Redirect naar login…', 'warning');
        // Je kan hier een loginpagina openen of FirebaseUI integreren.
        return;
      }
currentUserId = user.uid; 
      currentUserName.textContent = user.displayName || user.email;

      // ✅ PLAATS DEZE CODE HIER
      const topPhotoEl = document.getElementById('topbarProfilePhoto');
      if (topPhotoEl && user.photoURL) {
        topPhotoEl.src = user.photoURL;
      } else if (topPhotoEl) {
        // Fallback als er geen Google foto is (icoontje)
        topPhotoEl.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgZmlsbD0iI2NjYyIgY2xhc3M9ImJpIGJpLXBlcnNvbi1jaXJjbGUiIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZD0iTTExIDZhMyAzIDAgMTEtNiAwIDMgMyAwIDAxNiAwIi8+PHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMDggYTEuNSAxLjUgMCAwMC0xLjUgMS41VjE0YWguNWExLjUgMS41IDAgMDAxLjUtMS41VjkuNWEzIDMgMCAwMS41NTYtMS45OTEuNDk5LjQ5OSAwIDAwLS40NzEtLjAwMkExLjUgMS41IDAgMDA4IDEzLjQ5NnYxLjAxOEM4IDE1Ni44ODQgMTYgNS41IDE2SDIuNUEEuNSAxLjUgMCAwMTQgMTQuNUgxdjEuNUMxIDE1LjYxMiAxLjA0IDE2IDEuMzU3IDE2aDExLjI4NkMxMy45NiAxNiAxNCAxNS42MTIgMTQgMTUuNXYtMS41aC0zYTEuNSAxLjUgMCAwMS0xLjUtMS41VjEyYTEuNSAxLjUgMCAwMS4yNy0uODQ0LjQ5OS40OTkgMCAwMC0uNDctLjAwNkExLjUgMS41IDAgMDAtOCAxMy41MXYxLjAxOGMwIDEuMzczIDEuMTI3IDIuNSA2LjUgMi41aDNBNy41IDcuNSAwIDAwOCAwdjNhMy41IDMuNSAwIDAwLTQgNC41djNBMi41IDIuNSAwIDAwLjUgMTN2LjVhMS41IDEuNSAwIDAwLTEuNSAxLjVaIi8+PC9zdmc+';
      }
      await ensureUserDoc(user);
      await loadAllUsers();
      
      // ✅ HIER TOEVOEGEN: Sidebar & accentkleur-voorkeur toepassen
      const ud = getCurrentUserData();
      // ✅ HIER AANPASSEN: Laad kleur uit Firestore (als sync)
      // (Vervang de 'savedColor' check als die al bestaat)
      if (ud?.settings?.accentColor) {
        applyAccentColor(ud.settings.accentColor);
      }
      // EINDE AANPASSING
      if (ud?.settings?.sidebarCollapsed) {
          sidebar.classList.add('collapsed');
          main.classList.add('collapsed');
      }
      // ✅ HIER TOEVOEGEN: Opstart-tabblad instellen
      try {
        if (ud?.settings?.defaultTab) {
          const tabLink = document.querySelector(`a[href="${ud.settings.defaultTab}"]`);
          if (tabLink) {
            // Verberg de standaard 'Home' tab
            document.getElementById('tab-home').classList.remove('show', 'active');
            document.querySelector('a[href="#tab-home"]').classList.remove('active');
            
            // Toon de gekozen tab
            new bootstrap.Tab(tabLink).show();
          }
        }
      } catch (e) {
        console.warn("Kon standaard tab niet laden:", e);
      }
      // EINDE TOEVOEGING
      initSelectors();
      renderAll();
      await revealAdminIfNeeded();
      updateMonthStatusBadge();
      updateLeaveBadges();
      renderHome();
      
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
  return dataStore.viewUserId || dataStore.currentUser;
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
  // years
  const yNow = new Date().getFullYear();
  yearSelectMain.innerHTML = '';
  for (let y = yNow - 2; y <= yNow + 3; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === yNow) opt.selected = true;
    yearSelectMain.appendChild(opt);
  }

  // ⇩ huidige maand selecteren (0..11)
  const mNow = new Date().getMonth();
  monthSelectMain.value = String(mNow);
}
    async function revealAdminIfNeeded(){
      const meSnap = await getDoc(doc(db,'users', currentUserId));
      const role = meSnap.data().role;
      if(role === 'admin'){ 
        adminTabBtn.classList.remove('d-none');
        adminApprovalTabBtn.classList.remove('d-none'); 
      }
      renderAdminMonthlyMulti();
    }

    // ======= Projects =======
    function renderProjects(){
      const ud = getCurrentUserData();
      const list = (ud.projects || []).slice().sort((a,b)=>{
        const as = a.start? new Date(a.start): new Date('1900-01-01');
        const bs = b.start? new Date(b.start): new Date('1900-01-01');
        if(as.getTime() !== bs.getTime()) return as - bs;
        const ae = a.end? new Date(a.end): new Date('9999-12-31');
        const be = b.end? new Date(b.end): new Date('9999-12-31');
        return ae - be;
      });

      // table
      projectTableBody.innerHTML = '';
      newShiftProjectSelect.innerHTML = '<option value="">Geen project</option>';
      projectFilterSelect.innerHTML = '<option value="">Alle projecten</option>';

      list.forEach((p, idx)=>{
        const tr = document.createElement('tr');
       // default-flag voor bestaande projecten
if (p.allowMulti === undefined) p.allowMulti = false;

tr.innerHTML = `
  <td>${p.name}</td>
  <td>${toDisplayDate(p.start)}</td>
  <td>${toDisplayDate(p.end)}</td>
  <td class="text-end">
    <button
      class="btn btn-sm ${p.allowMulti ? 'btn-success' : 'btn-outline-secondary'} me-1"
      data-idx="${idx}" data-act="toggle-multi-btn"
      title="Sta extra lijnen toe voor dit project"
    >
      ${p.allowMulti ? 'Extra lijn: aan' : 'Extra lijn: uit'}
    </button>
    <button class="btn btn-sm btn-warning me-1" data-idx="${idx}" data-act="extend">Verleng</button>
    <button class="btn btn-sm btn-danger" data-idx="${idx}" data-act="delete">Verwijder</button>
  </td>`;
        projectTableBody.appendChild(tr);

        const o1 = document.createElement('option'); o1.value=p.name; o1.textContent=p.name; newShiftProjectSelect.appendChild(o1);
        const o2 = document.createElement('option'); o2.value=p.name; o2.textContent=p.name; projectFilterSelect.appendChild(o2);
      });

      // actions
// actions
projectTableBody.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', async () => {
    const ud = getCurrentUserData();
    const idx = Number(btn.dataset.idx);
    const p = ud.projects[idx];
    if (!p) return;

    if (btn.dataset.act === 'toggle-multi-btn') {
      // toggle
      p.allowMulti = !p.allowMulti;
      await saveUserData();

      // (optioneel) audit
      try { writeAudit(getActiveUserId(), { action:'project.toggleMulti', context:{ name: p.name }, to: p.allowMulti }); } catch {}

      // UI opnieuw tekenen (zowel projectenlijst als invoertabel, zodat de +-knoppen direct goed staan)
      renderProjects();
      renderMonth(Number(yearSelectMain.value), Number(monthSelectMain.value));
      toast(`Extra lijn ${p.allowMulti ? 'ingeschakeld' : 'uitgeschakeld'} voor ${p.name}`, 'success');
      return;
    }

    if (btn.dataset.act === 'extend') {
      const v = prompt('Nieuwe einddatum (DD-MM-YYYY):', toDisplayDate(p.end) || '');
      if (!v) return;
      p.end = fromDisplayDate(v);

      await saveUserData();
      renderProjects();
      renderMonth(Number(yearSelectMain.value), Number(monthSelectMain.value));
      toast('Project verlengd', 'success');

      // 🔔 Melding naar alle gebruikers (behalve admin zelf)
      const qs = await getDocs(collection(db, 'users'));
      for (const u of qs.docs) {
        if (u.id !== currentUserId) {
          await notifyProjectChange(u.id, 'extended', p.name, v);
        }
      }
    } else if (btn.dataset.act === 'delete') {
      if (!confirm('Project verwijderen?')) return;
      ud.projects.splice(idx, 1);
      await saveUserData();
      renderProjects();
      renderProjectFilterForMonth();
      renderMonth(Number(yearSelectMain.value), Number(monthSelectMain.value));
      toast('Project verwijderd', 'danger');
    }
  });
});
// toggle "extra lijn" per project
projectTableBody.querySelectorAll('input[data-act="toggle-multi"]').forEach(chk => {
  chk.addEventListener('change', async () => {
    const ud = getCurrentUserData();
    const idx = Number(chk.dataset.idx);
    const p = ud.projects[idx];
    if (!p) return;
    p.allowMulti = !!chk.checked;
    await saveUserData();
    toast(`Extra lijn ${p.allowMulti ? 'toegestaan' : 'uitgeschakeld'} voor ${p.name}`, 'success');
  });
});
    }

addProjectBtn?.addEventListener('click', async () => {
  const name = newProjectName.value.trim();
  if (!name) return toast('Vul projectnaam in', 'warning');

  const ud = getCurrentUserData();
  ud.projects = ud.projects || [];
  ud.projects.push({
    name,
    start: newProjectStart.value || null,
    end: newProjectEnd.value || null
  });

  await saveUserData();

  newProjectName.value = '';
  newProjectStart.value = '';
  newProjectEnd.value = '';

  renderProjects();
  renderProjectFilterForMonth();
  toast('Project toegevoegd', 'success');

  // 🔔 Melding naar alle gebruikers (behalve admin zelf)
  const qs = await getDocs(collection(db, 'users'));
  for (const u of qs.docs) {
    if (u.id !== currentUserId) {
      await notifyProjectChange(u.id, 'added', name);
    }
  }
});
    // ======= Shifts =======
function renderShifts() {
  const ud = getCurrentUserData();
  const shifts = ud.shifts || {};
  const order = ud.shiftOrder && ud.shiftOrder.length ? ud.shiftOrder : Object.keys(shifts);

  const selectedYear = filterShiftYear.value ? Number(filterShiftYear.value) : null;

  // Leegmaken
  shiftTableBody.innerHTML = '';

  // Opnieuw opbouwen
  order.forEach(name => {
    const sh = shifts[name];
    if (!sh) return;

    // ✅ Filteren op gekozen jaar
    if (selectedYear) {
      const startY = sh.startDate ? new Date(sh.startDate).getFullYear() : null;
      const endY = sh.endDate ? new Date(sh.endDate).getFullYear() : null;

      // Geen overlap → overslaan
      if (
        (startY && endY && (selectedYear < startY || selectedYear > endY)) ||
        (startY && !endY && selectedYear < startY) ||
        (!startY && endY && selectedYear > endY)
      ) {
        return;
      }
    }

    const tr = document.createElement('tr');
    tr.dataset.name = name;
    tr.setAttribute('draggable', true);
    tr.innerHTML = `
      <td class="fw-medium">
        <span class="material-icons-outlined drag-handle me-1" style="cursor:grab;">drag_indicator</span>${name}
      </td>
      <td class="text-mono">${sh.start || ''}</td>
      <td class="text-mono">${sh.end || ''}</td>
      <td>${sh.break || 0}</td>
      <td>${sh.project || ''}</td>
      <td>${toDisplayDate(sh.startDate)} → ${toDisplayDate(sh.endDate)}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-warning me-1" data-name="${name}" data-act="edit">Bewerk</button>
        <button class="btn btn-sm btn-danger" data-name="${name}" data-act="delete">Verwijder</button>
      </td>`;
    shiftTableBody.appendChild(tr);
  });

  // ✅ Activeer SortableJS
  if (shiftTableBody.sortableInstance) {
    shiftTableBody.sortableInstance.destroy();
  }

  shiftTableBody.sortableInstance = new Sortable(shiftTableBody, {
    handle: '.drag-handle',
    animation: 150,
    fallbackOnBody: true,
    swapThreshold: 0.65,
    ghostClass: 'bg-light',
    onEnd: async (evt) => {
      const newOrder = Array.from(shiftTableBody.querySelectorAll('tr')).map(tr => tr.dataset.name);
      ud.shiftOrder = newOrder;
      await saveUserData();
      toast('Volgorde opgeslagen', 'success');
    }
  });

  // acties
  shiftTableBody.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act, name = btn.dataset.name;
      if (act === 'delete') {
        if (!confirm(`Shift ${name} verwijderen?`)) return;
        delete ud.shifts[name];
        ud.shiftOrder = (ud.shiftOrder || []).filter(n => n !== name);
        await saveUserData();
        renderShifts();
      } else if (act === 'edit') {
        const sh = ud.shifts[name];
        newShiftName.value = name;
        newShiftStart.value = sh.start || '08:00';
        newShiftEnd.value = sh.end || '16:00';
        newShiftBreak.value = sh.break || 0;
        newShiftProjectSelect.value = sh.project || '';
        newShiftStartDate.value = sh.startDate || '';
        newShiftEndDate.value = sh.endDate || '';
        delete ud.shifts[name];
        await saveUserData();
        new bootstrap.Modal(document.getElementById('shiftModal')).show();
      }
    });
  });
}

    addShiftBtn?.addEventListener('click', async ()=>{
      const name = newShiftName.value.trim(); if(!name) return toast('Vul shift naam in','warning');
      const ud = getCurrentUserData();
      ud.shifts = ud.shifts || {};
      ud.shifts[name] = {
        start: newShiftStart.value || '00:00',
        end: newShiftEnd.value || '00:00',
        break: Number(newShiftBreak.value) || 0,
        project: newShiftProjectSelect.value || null,
        startDate: newShiftStartDate.value || null,
        endDate: newShiftEndDate.value || null
      };
      ud.shiftOrder = ud.shiftOrder || [];
      if(!ud.shiftOrder.includes(name)) ud.shiftOrder.push(name);
      await saveUserData(); renderShifts();
      bootstrap.Modal.getInstance(document.getElementById('shiftModal')).hide();
      newShiftName.value=''; newShiftBreak.value=0; newShiftStartDate.value=''; newShiftEndDate.value='';
      toast('Shift opgeslagen','success');
    });

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

  filterShiftYear.innerHTML = '<option value="">Alle jaren</option>';
  sortedYears.forEach(y => {
    const o = document.createElement('option');
    o.value = y;
    o.textContent = y;
    filterShiftYear.appendChild(o);
  });

  // Automatisch huidig jaar selecteren (indien aanwezig)
  const currentYear = new Date().getFullYear();
  if (sortedYears.includes(currentYear)) {
    filterShiftYear.value = currentYear;
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
      await renderMonth(y,m); updateInputTotals(); renderHome(); renderHistory();
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

  // lock & tonen acties-kolom
  const statusNow = getMonthStatus(year, month);
  const locked = (statusNow==='approved' || statusNow==='submitted');

  const showActions =
    !locked && ( userAllowsMultiMonth(ud, year, month) || (ud.projects||[]).some(p => p.allowMulti) );
  document.getElementById('thActions')?.classList.toggle('d-none', !showActions);

  const daysInMonth = new Date(year, month+1, 0).getDate();
  for(let d=1; d<=daysInMonth; d++){
    const baseKey = dateKey(year, month, d);
    if (!md.rows[baseKey]) {
      md.rows[baseKey] = { project:'', shift:'', start:'00:00', end:'00:00', break:0, omschrijving:'', minutes:0 };
    } else {
      autoAssignProjectIfNeeded(md.rows[baseKey]);
    }

    const allKeys = listDayKeys(md, baseKey);

    // Filter per project (zichtbare lijst)
    const visibleKeys = allKeys.filter(k => {
      const r = md.rows[k];
      if (!selectedProject) return true;
      return (r.project || '') === selectedProject;
    });

    const renderKeys = visibleKeys.length ? visibleKeys : (selectedProject ? [] : allKeys);

    for (let idx = 0; idx < renderKeys.length; idx++) {
      const rowKey = renderKeys[idx];
      const r = md.rows[rowKey];
      const dayName = daysFull[new Date(year, month, d).getDay()];

      // rechten voor + op deze rij
      const allowByMonth   = userAllowsMultiMonth(ud, year, month);
      const allowByProject = r.project ? canAddMultiForProject(r.project) : false;
      const allowThisRow   = allowByMonth || allowByProject;

      const tr = document.createElement('tr');

      const actionsCell = showActions
        ? (idx === 0
            ? `<td class="actions-cell">
                 <button class="btn btn-outline-success btn-line addLineBtn" ${allowThisRow ? '' : 'disabled'} title="Extra regel toevoegen">+</button>
               </td>`
            : `<td class="actions-cell">
                 <button class="btn btn-outline-danger btn-line delLineBtn" data-key="${rowKey}" title="Deze regel verwijderen">−</button>
               </td>`
          )
        : '';

      tr.innerHTML = `
        ${actionsCell}
        <td>${idx === 0 ? dayName : ''}</td>
        <td>${idx === 0 ? `${String(d).padStart(2,'0')}-${String(month+1).padStart(2,'0')}-${year}` : ''}</td>
        <td><select class="form-select form-select-sm projectSelect"></select></td>
        <td><select class="form-select form-select-sm shiftSelect"></select></td>
        <td><input class="form-control form-control-sm startInput" type="time" value="${r.start}"></td>
        <td><input class="form-control form-control-sm endInput" type="time" value="${r.end}"></td>
        <td><input class="form-control form-control-sm breakInput" type="number" min="0" value="${r.break}"></td>
        <td><input class="form-control form-control-sm omschrijvingInput" type="text" value="${r.omschrijving}"></td>
        <td class="dur text-mono">${Math.floor(r.minutes/60)}u ${r.minutes%60}min</td>`;
      tbody.appendChild(tr);

      // project dropdown (gefilterd op datum)
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

        // + opnieuw (de)activeren
        const addBtn = tr.querySelector('.addLineBtn');
        if (addBtn) {
          const allowByMonth   = userAllowsMultiMonth(getCurrentUserData(), year, month);
          const allowByProject = r.project ? canAddMultiForProject(r.project) : false;
          addBtn.disabled = !(allowByMonth || allowByProject);
        }
      });

      await populateShiftSelectForRow(tr, rowKey);

      tr.querySelector('.startInput').addEventListener('change', e=>{
        r.start = e.target.value; recalcRowMinutes(r);
        saveCell(year, month, rowKey, r, tr);
        tr.querySelector('.dur').textContent = `${Math.floor(r.minutes/60)}u ${r.minutes%60}min`;
        updateInputTotals(); debouncedSave(); renderHistory();
      });
      tr.querySelector('.endInput').addEventListener('change', e=>{
        r.end = e.target.value; recalcRowMinutes(r);
        saveCell(year, month, rowKey, r, tr);
        tr.querySelector('.dur').textContent = `${Math.floor(r.minutes/60)}u ${r.minutes%60}min`;
        updateInputTotals(); debouncedSave(); renderHistory();
      });
      tr.querySelector('.breakInput').addEventListener('change', e=>{ // 👈 'input' is 'change' geworden
        r.break = Number(e.target.value)||0; recalcRowMinutes(r);
        saveCell(year, month, rowKey, r, tr);
        tr.querySelector('.dur').textContent = `${Math.floor(r.minutes/60)}u ${r.minutes%60}min`;
        updateInputTotals(); debouncedSave(); renderHistory();
      });
      tr.querySelector('.omschrijvingInput').addEventListener('change', e=>{
        r.omschrijving = e.target.value; saveCell(year, month, rowKey, r, tr); debouncedSave(); renderHistory();
      });

      // + / − handlers
      const addBtn = tr.querySelector('.addLineBtn');
      if (addBtn) {
        addBtn.addEventListener('click', async () => {
          const idxNew = nextLineIndex(md, baseKey);
          const newKey = `${baseKey}#${idxNew}`;
          md.rows[newKey] = { project: r.project, shift:'', start:'00:00', end:'00:00', break:0, omschrijving:'', minutes:0 };
          await saveUserData();
          renderMonth(year, month);
          updateInputTotals(); renderHistory();
        });
      }
      const delBtn = tr.querySelector('.delLineBtn');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
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
  updateRemainingHours();
  renderProjectSummary(); 
  updateLeaveBadges(); 
  renderHome();

// 🔒 velden vergrendelen bij submitted/approved
const statusLocked = (getMonthStatus(year, month)==='approved' || getMonthStatus(year, month)==='submitted');
  const lockedNow = statusLocked && !isAdmin(); // 👈 HIER AANGEPAST
  
  // 1. Vergrendel de tabel-rijen
  tbody.querySelectorAll('select, input').forEach(el => { el.disabled = lockedNow; });

  // 2. Vergrendel ook de "Doel" velden en de project filter
  if (monthTargetHours) monthTargetHours.disabled = lockedNow;
  if (monthTargetMinutes) monthTargetMinutes.disabled = lockedNow;
  if (projectFilterSelect) projectFilterSelect.disabled = lockedNow;

  // 3. De knoppen (Indienen, etc.) worden beheerd door deze functie
  updateMonthStatusBadge();
}

async function populateShiftSelectForRow(tr, rowKey){
  const base = rowKey.split('#')[0];                   // YYYY-MM-DD
  const [yStr, mStr, dStr] = base.split('-');
  const year = Number(yStr), month = Number(mStr)-1;

  const ud = getCurrentUserData();
  const md = ud.monthData[year][month];
  const r = md.rows[rowKey];

  const projSel = tr.querySelector('.projectSelect');
  const sel = tr.querySelector('.shiftSelect');
  sel.innerHTML = '<option value=""></option>';

  const all = ud.shifts || {};
  const order = ud.shiftOrder || Object.keys(all);
  const entries = order.map(n=> [n, all[n]]).filter(([,sh])=> !!sh);

  for(const [name, sh] of entries){
    if(!isDateWithin(base, sh.startDate || null, sh.endDate || null)) continue;
    const o = document.createElement('option');
    o.value = name; o.textContent = name; if(r.shift===name) o.selected = true; sel.appendChild(o);
  }

  sel.addEventListener('change', async ()=>{
    const chosen = sel.value;
    const all = ud.shifts || {};
    if (!chosen) {
      r.shift = ''; r.project = ''; projSel.value = '';
      saveCell(year, month, rowKey, r, tr); debouncedSave(); updateInputTotals(); renderHistory();
      return;
    }

    r.shift = chosen;
    debouncedSave();

    // auto project (jouw bestaande logica)
    if (['Bench'].includes(chosen)) {
      r.project = '';
      saveCell(year, month, rowKey, r, tr);
      debouncedSave();
    } 
    else if (['Schoolverlof','School'].includes(chosen)) {
      ensureProjectExists('PXL Verpleegkunde Hasselt');
      r.project = 'PXL Verpleegkunde Hasselt';
      saveCell(year, month, rowKey, r, tr);
      debouncedSave();
    } 
    else if (['Verlof','Teammeeting','Ziekte'].includes(chosen)) {
      ensureProjectExists('Eght Care');
      r.project = 'Eght Care';
      saveCell(year, month, rowKey, r, tr);
      debouncedSave();
    } 
    else {
      const sh = all[chosen];
      if (sh && sh.project) {
        const p = (ud.projects||[]).find(px => px.name===sh.project);
        if (p && isDateWithin(base, p.start||null, p.end||null)) {
          r.project = p.name;
        }
      }
    }

    // project dropdown herladen
    projSel.innerHTML = '<option value="">--</option>';
    (getCurrentUserData().projects || []).forEach(p=>{
      if(isDateWithin(base, p.start || null, p.end || null)){
        const o = document.createElement('option');
        o.value = p.name; o.textContent = p.name; projSel.appendChild(o);
      }
    });
    setTimeout(()=> { projSel.value = r.project || ''; }, 50);

    // tijden/pauze invullen
    const sh = all[chosen];
    if (sh) {
      r.start = sh.start || '00:00';
      r.end   = sh.end   || '00:00';
      r.break = Number(sh.break) || 0;
    }
    recalcRowMinutes(r);
    tr.querySelector('.startInput').value = r.start;
    tr.querySelector('.endInput').value = r.end;
    tr.querySelector('.breakInput').value = r.break;
    tr.querySelector('.dur').textContent = `${Math.floor(r.minutes/60)}u ${r.minutes%60}min`;

    saveCell(year, month, rowKey, r, tr);
    debouncedSave();
    updateInputTotals();

    // + opnieuw (de)activeren
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
      const total = Object.values(md.rows||{}).reduce((s,r)=> s + (r.minutes||0), 0);
      const target = (md.targetHours||0)*60 + (md.targetMinutes||0);
      const diff = total - target;
      updateRemainingHours();
      updateLeaveBadges();
      renderProjectSummary(); // ✅ toegevoegd
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

    saveQuickBtn.addEventListener('click', async ()=>{
  const date = quickDate.value, shift = quickShift.value, note = quickNote.value;
  if(!date || !shift) return toast('Kies minstens een datum en shift','warning');
  const y = Number(date.split('-')[0]), m = Number(date.split('-')[1]) - 1, key = date;
  const ud = getCurrentUserData();
  ud.monthData = ud.monthData || {}; ud.monthData[y] = ud.monthData[y] || {};
  ud.monthData[y][m] = ud.monthData[y][m] || { targetHours:0, targetMinutes:0, rows:{} };
  const sh = ud.shifts[shift];
  const minutes = minutesBetween(sh.start, sh.end, sh.break);

  // ✅ Automatische projecttoewijzing
let project = sh?.project || '';
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
  toast('Snelle invoer toegevoegd','success');
});

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
    const planned = Object.values(rows).reduce((s, r) => s + (r.minutes||0), 0);

    // specifieke categorie-sommen
    let leave = 0, sick = 0, school = 0, holiday = 0, bench = 0;
    Object.values(rows).forEach(r => {
      const s = (r.shift || '').trim();
      if (!s) return;
      if (s === 'Verlof') leave += Number(r.minutes)||0;
      if (s === 'Ziekte') sick += Number(r.minutes)||0;
      if (s === 'Schoolverlof' || s === 'School') school += Number(r.minutes)||0;
      if (s === 'Feestdag') holiday += Number(r.minutes)||0;
      if (s === 'Bench') bench += Number(r.minutes)||0;
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
      diff: `${diff>=0?'+':''}${Math.floor(Math.abs(diff)/60)}u ${Math.abs(diff)%60}min`,
      leave: `${Math.floor(leave/60)}u ${leave%60}min`,
      sick: `${Math.floor(sick/60)}u ${sick%60}min`,
      bench: `${Math.floor(bench/60)}u ${bench%60}min`,
      school: `${Math.floor(school/60)}u ${school%60}min`,
      holiday: `${Math.floor(holiday/60)}u ${holiday%60}min`
    };

    bodyHtml += `<tr>${visibleCols.map(c => `<td>${rowMap[c.key] || ''}</td>`).join('')}</tr>`;
  }

  bodyHtml += '</tbody>';

  // footer (totaal)
  const footerMap = {
    target: `${Math.floor(totals.target/60)}u ${totals.target%60}min`,
    planned: `${Math.floor(totals.planned/60)}u ${totals.planned%60}min`,
    diff: `${totals.diff>=0?'+':''}${Math.floor(Math.abs(totals.diff)/60)}u ${Math.abs(totals.diff)%60}min`,
    leave: `${Math.floor(totals.leave/60)}u ${totals.leave%60}min`,
    sick: `${Math.floor(totals.sick/60)}u ${totals.sick%60}min`,
    bench: `${Math.floor(totals.bench/60)}u ${totals.bench%60}min`,
    school: `${Math.floor(totals.school/60)}u ${totals.school%60}min`,
    holiday: `${Math.floor(totals.holiday/60)}u ${totals.holiday%60}min`
  };

  const tfootCells = visibleCols.map(c => {
    if (c.key === 'monthLabel') return `<th>Totaal</th>`;
    return `<th>${footerMap[c.key] || ''}</th>`;
  }).join('');

  const tfootHtml = `<tfoot class="table-light"><tr>${tfootCells}</tr></tfoot>`;

  // zet alles in de table
  table.innerHTML = `${theadHtml}${bodyHtml}${tfootHtml}`;

  // behoud dezelfde tbody id voor compatibiliteit
  const newTbody = table.querySelector('tbody');
  if (newTbody) newTbody.id = 'historyBody';
}
// === Verlof / Schoolverlof instellingen en badges ===
const LEAVE_SHIFT_NAMES = ['Verlof'];              // telt mee als "verlof"
const SCHOOL_LEAVE_SHIFT_NAMES = ['Schoolverlof']; // telt mee als "schoolverlof"

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
function sumTakenMinutesFor(year, shiftNames) {
  const ud = getCurrentUserData();
  let total = 0;
  const months = ud.monthData?.[year] || {};
  Object.values(months).forEach(md => {
    Object.values(md?.rows || {}).forEach(r => {
      const s = (r?.shift || '').trim();
      if (s && shiftNames.includes(s)) total += Number(r.minutes) || 0;
    });
  });
  return total;
}
function fmtMins(mins) {
  const a = Math.abs(mins);
  return `${Math.floor(a/60)}u ${a%60}min`;
}

// === Schooljaar helpers ===
// Geeft grenzen van het schooljaar terug voor de huidig geselecteerde maand/jaar
function getAcademicYearBounds(y, m /* 0..11 */) {
  const startYear = (m >= 8) ? y : y - 1;   // 8 = september
  const endYear   = startYear + 1;
  const startISO  = `${startYear}-09-01`;
  const endISO    = `${endYear}-08-31`;
  return { startISO, endISO, label: `${startYear}-${endYear}` };
}

// Sommeer minuten voor opgegeven shifts binnen [startISO, endISO]
function sumTakenMinutesForRange(startISO, endISO, shiftNames) {
  const ud = getCurrentUserData();
  let total = 0;
  for (const months of Object.values(ud.monthData || {})) {
    for (const md of Object.values(months || {})) {
      for (const [key, r] of Object.entries(md?.rows || {})) {
        const sName = (r?.shift || '').trim();
        if (!sName || !shiftNames.includes(sName)) continue;
        if (isDateWithin(key, startISO, endISO)) {
          total += Number(r.minutes) || 0;
        }
      }
    }
  }
  return total;
}
function buildSchoolYearOptions(selectEl) {
  if (!selectEl) return;
  const now = new Date();
  const yNow = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1; // sept = 8
  const years = [];
  for (let y = yNow - 3; y <= yNow + 3; y++) {
    years.push(`${y}-${y+1}`);
  }
  selectEl.innerHTML = '';
  years.forEach(label => {
    const opt = document.createElement('option');
    opt.value = label;
    opt.textContent = label;
    selectEl.appendChild(opt);
  });
}
// === Verlof / Schoolverlof badges (met schooljaar-logica) ===
function updateLeaveBadges() {
  const badgeLeave  = document.getElementById('leaveBalanceBadge');
  const badgeSchool = document.getElementById('schoolLeaveBalanceBadge');

  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);

  // ---- Gewoon verlof (kalenderjaar, ongewijzigd) ----
  if (badgeLeave) {
    const allowance = getLeaveAllowanceMinutes();
    if (!allowance) {
      badgeLeave.textContent = 'Verlof saldo: — (stel in)';
      badgeLeave.className = 'badge bg-secondary-subtle text-dark ms-2';
    } else {
      const taken = sumTakenMinutesFor(y, LEAVE_SHIFT_NAMES);
      const remaining = allowance - taken;
      const over = remaining < 0;
      badgeLeave.textContent = over
        ? `Verlof saldo: -${fmtMins(remaining)} (overschreden)`
        : `Verlof saldo: ${fmtMins(remaining)} over`;
      badgeLeave.className = `badge ms-2 ${over ? 'bg-danger' : (remaining === 0 ? 'bg-warning text-dark' : 'bg-success')}`;
    }
  }

  // ---- Schoolverlof (schooljaar 1/9–31/8) ----
  if (badgeSchool) {
    const allowance = getSchoolLeaveAllowanceMinutes(y, m);
    if (!allowance) {
      badgeSchool.textContent = 'Schoolverlof saldo: — (stel in)';
      badgeSchool.className = 'badge bg-secondary-subtle text-dark ms-2';
    } else {
      const { startISO, endISO, label } = getAcademicYearBounds(y, m);
      const taken = sumTakenMinutesForRange(startISO, endISO, SCHOOL_LEAVE_SHIFT_NAMES);
      const remaining = allowance - taken;
      const over = remaining < 0;
      badgeSchool.textContent = over
        ? `Schoolverlof saldo: -${fmtMins(remaining)} (overschreden) — ${label}`
        : `Schoolverlof saldo: ${fmtMins(remaining)} over — ${label}`;
      badgeSchool.className = `badge ms-2 ${over ? 'bg-danger' : (remaining === 0 ? 'bg-warning text-dark' : 'bg-success')}`;
    }
  }
}

// === Admin: velden tonen/opslaan ===
function hydrateAdminLeaveInputsFor(uid) {
  const prev = dataStore.viewUserId;
  dataStore.viewUserId = uid;

  const ud = getCurrentUserData();

  // kalenderjaar-verlof (zoals je al had)
  const i1 = document.getElementById('adminLeaveHours');
  if (i1) i1.value = Math.floor((ud?.settings?.leaveAllowanceMinutes || 0) / 60) || '';
document.getElementById('adminSaveLeaveBtn')?.addEventListener('click', async () => {
  const uid = adminUserSelect?.value || getActiveUserId();
  if (!uid) return toast('Geen gebruiker geselecteerd', 'warning');

  const prev = dataStore.viewUserId; dataStore.viewUserId = uid;
  const ud = getCurrentUserData(); ud.settings ||= {};

  const hours = Math.max(0, Number(document.getElementById('adminLeaveHours')?.value || 0));
  ud.settings.leaveAllowanceMinutes = hours * 60;

  await saveUserData();
  dataStore.viewUserId = prev;
  updateLeaveBadges(); renderHome();
  toast('Verlof (kalenderjaar) opgeslagen', 'success');
});

document.getElementById('adminResetLeaveBtn')?.addEventListener('click', async () => {
  const uid = adminUserSelect?.value || getActiveUserId();
  if (!uid) return toast('Geen gebruiker geselecteerd', 'warning');

  const prev = dataStore.viewUserId; dataStore.viewUserId = uid;
  const ud = getCurrentUserData(); ud.settings ||= {};
  delete ud.settings.leaveAllowanceMinutes;

  await saveUserData();
  dataStore.viewUserId = prev;

  hydrateAdminLeaveInputsFor(uid);
  updateLeaveBadges(); renderHome();
  toast('Kalenderjaar-verlof leeggemaakt', 'info');
});
  // schooljaar-verlof
  const yearSel = document.getElementById('adminSchoolYearSelect');
  const schoolHoursInput = document.getElementById('adminSchoolLeaveHours');
  if (yearSel && schoolHoursInput) {
    if (!yearSel.options.length) buildSchoolYearOptions(yearSel);
    const label = yearSel.value; // bv "2024-2025"
    const map = ud?.settings?.schoolLeaveByYear || {};
    const mins = Number(map[label] || 0);
    schoolHoursInput.value = mins ? Math.floor(mins / 60) : '';
  }

  dataStore.viewUserId = prev;
}

document.getElementById('adminSchoolYearSelect')?.addEventListener('change', () => {
  const uid = adminUserSelect?.value || getActiveUserId();
  if (uid) hydrateAdminLeaveInputsFor(uid);
});

document.getElementById('adminSaveSchoolLeaveBtn')?.addEventListener('click', async () => {
  const uid = adminUserSelect?.value || getActiveUserId();
  if (!uid) return toast('Geen gebruiker geselecteerd', 'warning');

  const prev = dataStore.viewUserId;
  dataStore.viewUserId = uid;

  const ud = getCurrentUserData();
  ud.settings ||= {};
  ud.settings.schoolLeaveByYear ||= {};

  const label = document.getElementById('adminSchoolYearSelect')?.value;
  const hours = Math.max(0, Number(document.getElementById('adminSchoolLeaveHours')?.value || 0));

  if (!label) {
    dataStore.viewUserId = prev;
    return toast('Kies een schooljaar', 'warning');
  }

  ud.settings.schoolLeaveByYear[label] = hours * 60; // bewaar in minuten
  await saveUserData();

  dataStore.viewUserId = prev;
  updateLeaveBadges();
  renderHome();
  toast(`Schoolverlof opgeslagen voor ${label}`, 'success');
});

document.getElementById('adminResetSchoolLeaveBtn')?.addEventListener('click', async () => {
  const uid = adminUserSelect?.value || getActiveUserId();
  if (!uid) return toast('Geen gebruiker geselecteerd', 'warning');

  const prev = dataStore.viewUserId;
  dataStore.viewUserId = uid;

  const ud = getCurrentUserData();
  const label = document.getElementById('adminSchoolYearSelect')?.value;
  if (ud?.settings?.schoolLeaveByYear && label in ud.settings.schoolLeaveByYear) {
    delete ud.settings.schoolLeaveByYear[label];
    await saveUserData();
  }

  dataStore.viewUserId = prev;
  hydrateAdminLeaveInputsFor(uid);
  updateLeaveBadges();
  renderHome();
  toast(`Schoolverlof leeggemaakt voor ${label}`, 'info');
});

// === Project-samenvatting (zichtbare maand) ===
function renderProjectSummaryForVisibleMonth() 
{
  const wrap = document.getElementById('projectSummary');
  if (!wrap) return;

  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const ud = getCurrentUserData();
  const md = ud.monthData?.[y]?.[m] || { rows:{} };

  const map = new Map(); // project -> minuten
  Object.values(md.rows || {}).forEach(r => {
    const mins = Number(r?.minutes) || 0;
    if (mins <= 0) return;
    const key = (r?.project || '').trim() || '— Geen project';
    map.set(key, (map.get(key) || 0) + mins);
  });

  if (map.size === 0) {
    wrap.innerHTML = '<div class="alert alert-light border small mb-0">Nog geen minuten in deze maand.</div>';
    return;
  }

  const items = [...map.entries()]
    .sort((a,b)=> b[1]-a[1])
    .map(([name, mins]) => {
      const h = Math.floor(mins/60), min = mins%60;
      return `
        <div class="project-mini">
          <div class="meta">Project</div>
          <div class="title">${name}</div>
          <div class="value">${h}u ${min}min</div>
        </div>`;
    });

  wrap.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-2">
      <h6 class="mb-0">Project-samenvatting</h6>
      <span class="text-muted small">totaal minuten per project (zichtbare maand)</span>
    </div>
    ${items.join('')}
  `;
}

// ======= Admin =======
// Gebruikerslijst renderen
async function renderAdminUserSelect() {
  // Leegmaken (als ze bestaan)
  if (adminUserSelect) adminUserSelect.innerHTML = '<option value="">-- Kies gebruiker --</option>';
  if (approvalUserSelect) approvalUserSelect.innerHTML = '<option value="">-- Kies gebruiker --</option>';

  const qs = await getDocs(collection(db, 'users'));
  qs.forEach(d => {
    const u = d.data();
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${u.name || u.email || d.id} (${u.role || 'user'})`;
    
    // Voeg toe aan beide selects (indien ze bestaan)
    if (adminUserSelect) adminUserSelect.appendChild(opt.cloneNode(true));
    if (approvalUserSelect) approvalUserSelect.appendChild(opt.cloneNode(true));
  });

  // Update de "Actief:" labels (indien ze bestaan)
  const activeName = dataStore.users[currentUserId]?.name || currentUserName.textContent || '-';
  if (activeUserLabel) activeUserLabel.textContent = activeName;
  if (approvalActiveUserLabel) approvalActiveUserLabel.textContent = activeName;
}
document.querySelector('a[href="#tab-admin"]')?.addEventListener('shown.bs.tab', () => {
  buildSchoolYearOptions(document.getElementById('adminSchoolYearSelect'));
  const uid = adminUserSelect?.value || getActiveUserId();
  if (uid) hydrateAdminLeaveInputsFor(uid); // vult waarden in
});
// ✅ Gebruiker selecteren zonder adminstatus te verliezen
adminUserSelect?.addEventListener('change', async () => {
  const uid = adminUserSelect.value;
  if (!uid) return;

  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) {
      toast('Gebruiker niet gevonden', 'warning');
      return;
    }

    const u = snap.data();
    // Plaats de gebruiker tijdelijk in dataStore voor weergave
    dataStore.users[uid] = u;

    // UI labels bijwerken
    activeUserLabel.textContent = u.name || u.email || uid;
    roleSelect.value = u.role || 'user';
    document.getElementById('currentUserName').textContent = u.name || u.email || uid;
    document.getElementById('currentUserHistoriek').textContent = u.name || u.email || uid;

    // We tonen enkel hun data (zonder rechten te verliezen)
    await renderUserDataAsAdmin(uid);
    toast(`Beheer actief voor ${u.name || uid}`, 'primary');
  } catch (err) {
    console.error(err);
    toast('Fout bij laden van gebruiker', 'danger');
  }
});

// ✅ Alleen UI renderen voor geselecteerde gebruiker
async function renderUserDataAsAdmin(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return;
  const u = snap.data();

  // Tijdelijk: toon deze data in invoer & historiek
  dataStore.users[uid] = u;
  dataStore.viewUserId = uid;

  renderProjects();
  renderShifts();
  populateFilterShiftYears();
  renderProjectFilterForMonth();
  generateMonth();
  renderHistory();
}

// ✅ Rol bijwerken
updateRoleBtn?.addEventListener('click', async () => {
  const uid = adminUserSelect.value;
  const newRole = roleSelect.value;
  if (!uid) return toast('Geen gebruiker geselecteerd', 'warning');

  try {
    await updateDoc(doc(db, 'users', uid), { role: newRole });
    toast(`Rol aangepast naar ${newRole}`, 'success');
    await renderAdminUserSelect();
  } catch (err) {
    console.error(err);
    toast('Fout bij rol aanpassen — controleer Firestore-regels', 'danger');
  }
});

// ✅ Gebruiker verwijderen
removeUserBtn?.addEventListener('click', async () => {
  const uid = adminUserSelect.value;
  if (!uid) return toast('Geen gebruiker geselecteerd', 'warning');
  if (uid === currentUserId) return toast('Je kunt jezelf niet verwijderen', 'warning');
  if (!confirm('Weet je zeker dat je deze gebruiker wilt verwijderen?')) return;

  try {
    await deleteDoc(doc(db, 'users', uid));
    toast('Gebruiker verwijderd', 'danger');
    await renderAdminUserSelect();
    dataStore.viewUserId = null;
  } catch (err) {
    console.error(err);
    toast('Fout bij verwijderen — controleer Firestore-regels', 'danger');
  }
});

    // ======= Converter =======
    const convHours = document.getElementById('convHours');
    const convMinutes = document.getElementById('convMinutes');
    const decimalInput = document.getElementById('decimalInput');
    function updateDecimal(){
      const h = Number(convHours.value)||0, m = Number(convMinutes.value)||0;
      decimalInput.value = (h + m/60).toFixed(2);
    }
    function updateHM(){
      const dec = Number(decimalInput.value)||0;
      const h = Math.floor(dec), m = Math.round((dec-h)*60);
      convHours.value = h; convMinutes.value = m;
    }
    convHours.addEventListener('input', updateDecimal);
    convMinutes.addEventListener('input', updateDecimal);
    decimalInput.addEventListener('input', updateHM);

    
    document.getElementById('sidebarToggle').addEventListener('click', ()=>{
      sidebar.classList.toggle('collapsed'); main.classList.toggle('collapsed');
    });
    document.getElementById('sidebarMobile').addEventListener('click', ()=>{
      sidebar.classList.toggle('show');
    });
    // ======= Admin tab =======
    document.querySelector('a[href="#tab-admin"]')
  ?.addEventListener('shown.bs.tab', renderAdminMonthlyMulti);
  // ✅ NIEUW: Listeners voor Goedkeuring Tab
document.querySelector('a[href="#tab-goedkeuring"]')?.addEventListener('shown.bs.tab', () => {
  // Zet het jaarveld
  if (approvalYearSelect) approvalYearSelect.value = new Date().getFullYear();
  
  // Render de (lege) kaarten
  const uid = approvalUserSelect.value;
  const year = Number(approvalYearSelect.value);
  if (uid) {
    renderApprovalOverview(uid, year);
  } else {
    approvalYearlyOverview.innerHTML = '<div class="col-12"><div class="alert alert-info">Selecteer een gebruiker om het jaaroverzicht te zien.</div></div>';
  }
});

approvalUserSelect?.addEventListener('change', async () => {
  const uid = approvalUserSelect.value;
  const year = Number(approvalYearSelect.value);

  if (!uid) {
    approvalYearlyOverview.innerHTML = '<div class="col-12"><div class="alert alert-info">Selecteer een gebruiker om het jaaroverzicht te zien.</div></div>';
    approvalActiveUserLabel.textContent = '-';
    return;
  }

  // Haal gebruikerdata op als we die nog niet hebben (voor de naam)
  if (!dataStore.users[uid]) {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      dataStore.users[uid] = snap.data();
    }
  }
  
  const u = dataStore.users[uid] || { name: 'Onbekend' };
  approvalActiveUserLabel.textContent = u.name || u.email || uid;
  
  // Render het overzicht
  renderApprovalOverview(uid, year);
});
    // close sidebar on nav click (mobile)
    document.querySelectorAll('#navTabs .nav-link').forEach(a=>{
      a.addEventListener('click', ()=> sidebar.classList.remove('show'));
    });

    // ======= Render all =======
    function renderAll(){
      renderProjects();
      renderShifts();
      populateFilterShiftYears();
      renderProjectFilterForMonth();
      generateMonth();
      renderAdminUserSelect();
      renderAdminMonthlyMulti();
      updateRemainingHours();
      updateLeaveBadges();
      renderHome();

    }
     // ✅ Plaats DIT hier:
document.getElementById('exportPdfBtn')?.addEventListener('click', async () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const monthIndex = Number(document.getElementById('monthSelectMain').value);
  const year = document.getElementById('yearSelectMain').value;
  const monthName = monthsFull[monthIndex];
  const ud = getCurrentUserData();
  const md = ud.monthData?.[year]?.[monthIndex];

  if (!md || !md.rows || Object.keys(md.rows).length === 0) {
    return toast('Geen data voor deze maand', 'warning');
  }
  // === Header met branding ===
  const pageWidth = doc.internal.pageSize.width;
  doc.setFillColor(13, 110, 253);
  doc.rect(0, 0, pageWidth, 25, 'F');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text('Shift Planner', 14, 15);
  doc.setFontSize(11);
  doc.text(`${monthName} ${year}`, pageWidth - 50, 15);

  // Gebruikersinfo
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.text(`Gebruiker: ${ud.name || ud.email || '-'}`, 14, 32);
  doc.text(`Exportdatum: ${new Date().toLocaleDateString('nl-BE')}`, 14, 37);

  // === Data voorbereiden ===
  const body = Object.entries(md.rows)
    .sort(([a], [b]) => a.localeCompare(b)) // chronologisch sorteren
    .map(([key, r]) => {
      const date = key.split('-').reverse().join('-');
      const duration = `${Math.floor(r.minutes / 60)}u ${r.minutes % 60}m`;
      return [
        date,
        r.project || '-',
        r.shift || '-',
        r.start || '',
        r.end || '',
        r.break || 0,
        duration,
        r.omschrijving || ''
      ];
    });

  // === AutoTable met compacte styling ===
  doc.autoTable({
    head: [['Datum', 'Project', 'Shift', 'Start', 'Einde', 'Pauze', 'Duur', 'Omschrijving']],
    body,
    startY: 43,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 1.5,
      lineWidth: 0.1
    },
    headStyles: { fillColor: [13, 110, 253], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 249, 252] },
    margin: { left: 8, right: 8 },
    tableWidth: 'auto',
    columnStyles: {
      0: { cellWidth: 20 }, // datum
      1: { cellWidth: 30 }, // project
      2: { cellWidth: 25 }, // shift
      3: { cellWidth: 15 }, // start
      4: { cellWidth: 15 }, // einde
      5: { cellWidth: 12 }, // pauze
      6: { cellWidth: 18 }, // duur
      7: { cellWidth: 'auto' } // omschrijving
    },
    didDrawPage: (data) => {
      const pageCount = doc.internal.getNumberOfPages();
      const pageHeight = doc.internal.pageSize.height;
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(`Pagina ${pageCount}`, pageWidth - 30, pageHeight - 8);
    }
  });

  // === Samenvatting onder tabel ===
  const total = Object.values(md.rows).reduce((s, r) => s + (r.minutes || 0), 0);
  const doel = ((md.targetHours || 0) * 60) + (md.targetMinutes || 0);
  const diff = total - doel;
  const fmt = v => `${Math.floor(v / 60)}u ${v % 60}m`;
  const endY = doc.lastAutoTable.finalY + 6;

  doc.setFontSize(11);
  doc.setTextColor(13, 110, 253);
  doc.text('Maandoverzicht', 14, endY);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.text(`Doel: ${fmt(doel)}`, 20, endY + 5);
  doc.text(`Gepland: ${fmt(total)}`, 20, endY + 10);
  doc.text(`Verschil: ${(diff >= 0 ? '+' : '-') + fmt(Math.abs(diff))}`, 20, endY + 15);

  // === PDF genereren ===
  const filename = `Shiftplanning_${ud.name || 'gebruiker'}_${monthName}_${year}.pdf`;
  doc.save(filename);
  toast('PDF geëxporteerd', 'success');
});
// 🔁 Shift toepassen op meerdere dagen
const multiShiftName = document.getElementById('multiShiftName');
const multiShiftStart = document.getElementById('multiShiftStart');
const multiShiftEnd = document.getElementById('multiShiftEnd');
const multiShiftDays = document.getElementById('multiShiftDays');
const multiDayShiftBtn = document.getElementById('multiDayShiftBtn');

// 🔵 Herkleur direct alle ingeplande dagen opnieuw
const plannedDates = Object.keys(
  getCurrentUserData()?.monthData?.[yearSelectMain.value]?.[monthSelectMain.value]?.rows || {}
);
if (window.multiDayPicker) {
  highlightPlannedDays(window.multiDayPicker, plannedDates);
}
// 🔔 In-app notificaties
const notifBtn = document.getElementById('notifBtn');
const notifDropdown = document.getElementById('notifDropdown');
const notifList = document.getElementById('notifList');
const notifBadge = document.getElementById('notifBadge');
const markAllReadBtn = document.getElementById('markAllReadBtn');

notifBtn?.addEventListener('click', (e) => {
  e.stopPropagation(); // voorkom dat klik buiten dropdown het meteen sluit

  // Sluit andere openstaande dropdowns
  document.querySelectorAll('.dropdown-menu.show').forEach(el => {
    if (el !== notifDropdown) el.classList.remove('show');
  });

  notifDropdown.classList.toggle('show');
});

// Klik buiten dropdown → sluit hem
document.addEventListener('click', (e) => {
  if (!notifDropdown.contains(e.target) && e.target !== notifBtn) {
    notifDropdown.classList.remove('show');
  }
});

markAllReadBtn?.addEventListener('click', async () => {
  if (!currentUserId) return;

  const colRef = collection(db, 'users', currentUserId, 'notifications');
  const snap = await getDocs(colRef);

  // 🔥 Verwijder alle meldingen
  const batchDeletes = snap.docs.map(d => deleteDoc(d.ref));
  await Promise.all(batchDeletes);

  // UI opschonen
  notifList.innerHTML = '';
  notifBadge.classList.add('d-none');

  toast('Alle meldingen verwijderd', 'success');
});
let lastVisible = null; // houdt bij tot waar we geladen hebben

// 🔁 Laad de eerste reeks meldingen
// 🔁 Laad de eerste reeks meldingen
function listenToNotifications(uid) {
  const colRef = collection(db, 'users', uid, 'notifications');
  const q = query(colRef, orderBy('timestamp', 'desc'), limit(20));

  onSnapshot(q, (snapshot) => {
    notifList.innerHTML = '';
    let unread = 0;
    
    dataStore.notifications = []; // 👈 VOEG DEZE REGEL TOE (Cache legen)

    const docs = snapshot.docs;
    lastVisible = docs[docs.length - 1]; // laatste document bewaren

    snapshot.forEach((docSnap) => {
      const n = docSnap.data();
      dataStore.notifications.push(n); // 👈 VOEG DEZE REGEL TOE (Cache vullen)
      
      const time = n.timestamp ? new Date(n.timestamp).toLocaleString('nl-BE') : '';
      if (!n.read) unread++;
      const li = document.createElement('li');
      li.className = `mb-1 p-1 rounded ${n.read ? '' : 'bg-light unread'}`;
      li.innerHTML = `
        <div>${n.text}</div>
        <div class="text-muted small">${time}</div>
      `;
      notifList.appendChild(li);
    });

    notifBadge.textContent = unread;
    notifBadge.classList.toggle('d-none', unread === 0);

    // Toon 'Toon meer' als er minstens 20 meldingen zijn
    document.getElementById('loadMoreNotifBtn').classList.toggle('d-none', docs.length < 20);
    
    loadHomeNotifications(); // 👈 VOEG DEZE REGEL TOE (Homepagina bijwerken)
  });
}

// 📥 Extra meldingen ophalen
async function loadMoreNotifications(uid) {
  if (!lastVisible) return;
  const colRef = collection(db, 'users', uid, 'notifications');
  const qMore = query(
    colRef,
    orderBy('timestamp', 'desc'),
    startAfter(lastVisible),
    limit(20)
  );

  const snap = await getDocs(qMore);
  if (snap.empty) {
    document.getElementById('loadMoreNotifBtn').classList.add('d-none');
    return;
  }

  snap.forEach((docSnap) => {
    const n = docSnap.data();
    const time = n.timestamp ? new Date(n.timestamp).toLocaleString('nl-BE') : '';
    const li = document.createElement('li');
    li.className = `mb-1 p-1 rounded ${n.read ? '' : 'bg-light unread'}`;
    li.innerHTML = `
      <div>${n.text}</div>
      <div class="text-muted small">${time}</div>
    `;
    notifList.appendChild(li);
  });

  lastVisible = snap.docs[snap.docs.length - 1]; // update naar nieuw einde
}

// 🎛️ Koppel knop aan event
document.getElementById('loadMoreNotifBtn')?.addEventListener('click', async () => {
  await loadMoreNotifications(currentUserId);
});
// helpers bovenin
function getISOWeekParts(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;           // ma=1..zo=7
  d.setUTCDate(d.getUTCDate() + 4 - day);   // naar donderdag
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}
function isoWeekId(date) {
  const { week, year } = getISOWeekParts(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
// ✅ HIER TOEVOEGEN: Helper om notificatie voorkeur te checken (default = true)
    function getNotifPref(key) {
      const ud = getCurrentUserData();
      if (!ud.settings || !ud.settings.notificationPrefs) {
        return true; // Bestaat niet? Standaard aan.
      }
      // Als de key is opgeslagen als 'false', geef 'false'.
      // Als de key 'true' is of nog niet bestaat (undefined), geef 'true'.
      return ud.settings.notificationPrefs[key] !== false; 
    }
// ✅ HIER TOEVOEGEN: Helper om Hex naar RGB om te zetten (voor CSS variabelen)
    function hexToRgb(hex) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `${r}, ${g}, ${b}`;
    }

    // ✅ HIER TOEVOEGEN: Functie die de kleur daadwerkelijk toepast
    function applyAccentColor(hex) {
      if (!hex) return; // Geen kleur, doe niets

      const rgb = hexToRgb(hex);
      const lightBg = `rgba(${rgb}, 0.15)`; // Iets lichter voor hovers
      const darkText = `rgba(${rgb}, 0.7)`; // Voor donkere tekst op lichte hover

      // 1. Schrijf de CSS-regels
      const cssRules = `
        :root {
          --bs-primary: ${hex};
          --bs-primary-rgb: ${rgb};
          --bs-primary-text-emphasis: ${hex};
          --bs-primary-bg-subtle: ${lightBg};
          --bs-primary-border-subtle: ${hex};
        }
        
        /* === ALGEMENE OVERRIDES === */
        .sp-sidebar { background: ${hex} !important; }
        .sp-sidebar .nav-link.active, 
        .sp-sidebar .nav-link:hover { background: rgba(255,255,255, 0.18) !important; }
        .chip { color: ${hex}; background-color: ${lightBg}; }
        .chip .dot { background-color: ${hex}; }
        .badge-submitted { color: ${hex}; background-color: ${lightBg}; }
        .form-check-input:checked {
            background-color: ${hex};
            border-color: ${hex};
        }
        .flatpickr-day.selected, .flatpickr-day.selected:hover {
            background: ${hex};
            border-color: ${hex};
        }

        /* === KNOPPEN OVERRIDES (DEZE WAREN HET PROBLEEM) === */
        .btn-primary {
          --bs-btn-bg: ${hex};
          --bs-btn-border-color: ${hex};
          --bs-btn-hover-bg: ${darkText};
          --bs-btn-hover-border-color: ${darkText};
          --bs-btn-active-bg: ${darkText};
          --bs-btn-active-border-color: ${darkText};
          --bs-btn-disabled-bg: ${hex};
          --bs-btn-disabled-border-color: ${hex};
        }
        .btn-outline-primary {
          --bs-btn-color: ${hex};
          --bs-btn-border-color: ${hex};
          --bs-btn-hover-bg: ${hex};
          --bs-btn-hover-color: #fff;
          --bs-btn-active-bg: ${hex};
          --bs-btn-active-color: #fff;
          --bs-btn-disabled-color: ${hex};
          --bs-btn-disabled-border-color: ${hex};
        }
        .btn-outline-primary.active { /* Voor de Mailbox tabs */
          background-color: ${hex};
          color: #fff;
        }

        /* === SPECIFIEKE KNOPPEN (BEHOUDEN HUN KLEUR) === */
        /* PDF Knop (blijft rood) */
        #exportPdfBtn {
          color: var(--bs-danger);
          border-color: var(--bs-danger);
        }
        #exportPdfBtn:hover {
          color: #fff;
          background-color: var(--bs-danger);
          border-color: var(--bs-danger);
        }

        /* Indienen Knop (blijft groen) */
        #submitMonthBtn {
          color: var(--bs-success);
          border-color: var(--bs-success);
        }
        #submitMonthBtn:hover {
          color: #fff;
          background-color: var(--bs-success);
          border-color: var(--bs-success);
        }
        
        /* Snelle Invoer Knop (blijft oranje) */
        #quickTopBtn {
          border-color: #fd7e14 !important;
          color: #fd7e14 !important;
        }
        #quickTopBtn:hover {
          background-color: #fd7e14 !important;
          color: #fff !important;
        }

        /* Donkere modus overrides */
        body.dark-mode .sp-sidebar { background: #111 !important; }
      `;

      // 2. Injecteer in de <style> tag die we in de <head> hebben gemaakt
      document.getElementById('accent-color-overrides').innerHTML = cssRules;

      // 3. Sla op in localStorage voor snelle laadtijd (voorkomt "knipperen")
      localStorage.setItem('accentColor', hex);
    }
// 🔔 Automatisch meldingsysteem — controleert volledige jaar
async function autoCheckNotifications() {
  // 0. 🛑 VERBETERDE CONTROLE
  // Check niet alleen de variabele, maar ook de ECHTE auth status
  if (!currentUserId || !auth.currentUser) {
    console.log("autoCheckNotifications: Gestopt, geen (actief) ingelogde gebruiker.");
    return; // Stop de functie als het token verlopen is
  }
  const uid = currentUserId;
  // Zorg dat we een UID hebben VOORDAT we verder gaan
  if (!uid) {
    console.warn("autoCheckNotifications: Gestopt, geen UID.");
    return;
  }
  
  const ud = getCurrentUserData();
  if (!ud || !ud.monthData) return;

  const today = new Date();
  const currentYear = today.getFullYear();

// 🔹 1. Controleer of gebruiker deze week nog niets heeft ingevoerd
if (getNotifPref('notifyWeeklyEmpty')) {
  const thisWeek = isoWeekId(new Date());
  let hasShiftThisWeek = false;
  const yearMap = ud.monthData || {};

  // Loop alle jaren/maanden/rijen af
  for (const yStr of Object.keys(yearMap)) {
    const months = yearMap[yStr] || {};
    for (const mStr of Object.keys(months)) {
      const rowsObj = months[mStr]?.rows || {};
      for (const key of Object.keys(rowsObj)) {
        const [Y, M, D] = key.split('-').map(Number);
        const rowDate = new Date(Y, M - 1, D);

        // ✅ Negeer "Vrij weekend"
        const shiftName = rowsObj[key]?.shift?.trim() || '';
        const filled = shiftName && shiftName !== 'Vrij weekend';

        if (isoWeekId(rowDate) === thisWeek && filled) {
          hasShiftThisWeek = true;
          break;
        }
      }
      if (hasShiftThisWeek) break;
    }
    if (hasShiftThisWeek) break;
  }

  if (!hasShiftThisWeek) {
    await createUniqueNotification(uid, 'Je hebt deze week nog geen shifts ingevuld.');
  }
}
const currentMonthData = ud.monthData?.[currentYear]?.[today.getMonth()] || { rows: {}, targetHours: 0, targetMinutes: 0 };
const md = currentMonthData;
  // 🔹 2. Controleer maanddoel vs. werkelijk (alleen huidige maand)
  if (getNotifPref('notifyMonthlyGoal')) {
  const doel = (md.targetHours || 0) * 60 + (md.targetMinutes || 0);
  const gepland = Object.values(md.rows || {}).reduce((s, r) => s + (r.minutes || 0), 0);
  if (doel > 0 && gepland < doel * 0.8) {
    await createUniqueNotification(uid, 'Je hebt nog minder dan 80% van je maanddoel behaald.');
  }
}
  // 🔹 3. Controleer of projecten binnenkort aflopen
if (getNotifPref('notifyProjectEnd')) {
  const soon = ud.projects?.filter(p => {
    if (!p.end) return false;
    const end = new Date(p.end);
    const diff = (end - today) / (1000 * 60 * 60 * 24);
    return diff > 0 && diff < 14; // binnen 2 weken
  });
  if (soon?.length) {
    const names = soon.map(p => p.name).join(', ');
    await createUniqueNotification(uid, `Project(en) bijna afgelopen: ${names}`);
  }
}
// 🔹 4. Controleer ALLE dagen van het huidige jaar (alleen echte lege dagen)
if (getNotifPref('notifyDailyEmpty')) {
const startOfYear = new Date(today.getFullYear(), 0, 1);
const endOfYear = new Date(today);

for (let d = new Date(startOfYear); d <= endOfYear; d.setDate(d.getDate() + 1)) {
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const rows = ud.monthData?.[y]?.[m]?.rows || {};
  const r = rows[key];

  // ⛔ Geen maanddata of geen rij → overslaan
  if (!ud.monthData?.[y]?.[m] || !r) continue;

  // ⛔ Toekomstige dagen overslaan
  if (d > today) continue;

  // ⛔ Vrije shifts overslaan
  const skipShifts = ['Vrij weekend', 'Verlof', 'Ziekte', 'Feestdag', 'Schoolverlof', 'School', 'Bench'];
  const shiftName = (r?.shift || '').trim();
  const isEmpty = !shiftName;
  const isSkipped = skipShifts.includes(shiftName);

  if (isEmpty && !isSkipped) {
    await createUniqueNotification(
      uid,
      `Geen shift ingevuld op ${String(day).padStart(2, '0')}-${String(m + 1).padStart(2, '0')}-${y}.`
    );
  }
}
}
    // 🔹 5. Automatisch opruimen van meldingen ouder dan 30 dagen
  try {
    const notifCol = collection(db, 'users', uid, 'notifications');
    const nowClean = new Date();
    
    // Bepaal de datum van 30 dagen geleden
    const thirtyDaysAgo = new Date(nowClean.getTime() - (30 * 24 * 60 * 60 * 1000)).toISOString();

    // 1. Vraag Firestore om ALLEEN de oude documenten te sturen
    const q = query(notifCol, where("timestamp", "<", thirtyDaysAgo));
    const oldNotifSnap = await getDocs(q); // 👈 LEEST ALLEEN OUDE MELDINGEN

    // 2. Verwijder de resultaten
    oldNotifSnap.forEach(async (docSnap) => {
      console.log(`🧹 Oude melding verwijderd (${docSnap.data().text})`);
      await deleteDoc(docSnap.ref);
    });

  } catch (err) {
    // Vang de permissie-fout op en log deze, maar laat de app niet crashen
    // ⚠️ DIT BLOK ONTBRAK
    console.error(`PERMISSION ERROR in autoCheckNotifications (UID: ${uid}):`, err.message);
  }
}
// ⚙️ Helper
async function createUniqueNotification(uid, text) {
  const colRef = collection(db, 'users', uid, 'notifications');
  const todayKey = new Date().toISOString().slice(0, 10);
  const q = query(colRef, where('text', '==', text), where('dateKey', '==', todayKey));
  const snap = await getDocs(q);
  if (!snap.empty) return;

  await addDoc(colRef, {
    text,
    timestamp: new Date().toISOString(),
    dateKey: todayKey,
    read: false
  });

  // ➕ Log ook als "noreply"-mail in de inbox
  await sendSystemMail(
    uid,
    'Notificatie',
    text,
    'notification'
  );

  console.log('🔔 Automatische melding + mail aangemaakt:', text);
}
// 🔔 Stuur melding naar gebruiker bij projectwijziging (door admin)
async function notifyProjectChange(userId, type, projectName, newEndDate = null) {
  const colRef = collection(db, 'users', userId, 'notifications');
  const todayKey = new Date().toISOString().slice(0, 10);
  let text = '';

  if (type === 'added') {
    text = `Admin heeft een nieuw project toegevoegd: ${projectName}`;
  } else if (type === 'extended') {
    text = `Admin heeft het project "${projectName}" verlengd tot ${newEndDate}`;
  }

  const q = query(colRef, where('text', '==', text), where('dateKey', '==', todayKey));
  const snap = await getDocs(q);
  if (snap.empty) {
    await addDoc(colRef, { text, timestamp: new Date().toISOString(), dateKey: todayKey, read: false });
  }

  // ✉️ Mail erbij
  await sendSystemMail(userId, 'Projectupdate', text, 'notification');
  console.log('🔔 Melding + mail gestuurd naar gebruiker:', text);
}

// 🔄 Loading overlay
function showLoading(show = true) {
  document.getElementById('loadingOverlay').classList.toggle('d-none', !show);
}

// 🎯 Resterende uren-teller
function updateRemainingHours() {
  const alertBox = document.getElementById('remainingHoursAlert');
  if (!alertBox) return;

  const year = parseInt(yearSelectMain.value);
  const month = parseInt(monthSelectMain.value);
  const ud = getCurrentUserData();
  const monthData = ud?.monthData?.[year]?.[month];
  if (!monthData) {
    alertBox.classList.add('d-none');
    return;
  }

  const doel = (monthData.targetHours || 0) * 60 + (monthData.targetMinutes || 0);
  const gepland = Object.values(monthData.rows || {}).reduce((s, r) => s + (r.minutes || 0), 0);
  const verschil = doel - gepland;
  const pct = doel > 0 ? Math.round((gepland / doel) * 100) : 0;

  // 🔹 Bereken tekst voor resterende of extra uren
  let resterendTekst = '';
  if (verschil > 0) {
    const uren = Math.floor(verschil / 60);
    const min = verschil % 60;
    resterendTekst = `🕓 <b>Resterend:</b> ${uren}u ${min}min`;
  } else if (verschil < 0) {
    const extra = Math.abs(verschil);
    const uren = Math.floor(extra / 60);
    const min = extra % 60;
    resterendTekst = `✅ <b>Meer uren:</b> ${uren}u ${min}min`;
  } else {
    resterendTekst = `✅ <b>Doel exact behaald!</b>`;
  }

  // 🔹 Kleur aanpassen volgens voortgang
  alertBox.classList.remove('alert-danger', 'alert-success');
  if (pct >= 100) {
    alertBox.classList.add('alert-success'); // groen
  } else {
    alertBox.classList.add('alert-danger'); // rood
  }

  // 🔹 HTML samenstellen
  alertBox.innerHTML = `
    🎯 <b>Doel:</b> ${Math.floor(doel / 60)}u ${doel % 60}min 
    &nbsp;|&nbsp; ⏱ <b>Gepland:</b> ${Math.floor(gepland / 60)}u ${gepland % 60}min 
    &nbsp;|&nbsp; ${resterendTekst}
  `;
  alertBox.classList.remove('d-none');
}
// 💡 Laat de balk zweven — maar schuif omhoog bij paginabodem
document.addEventListener('DOMContentLoaded', () => {
  const alertBox = document.getElementById('remainingHoursAlert');
  if (!alertBox) return;

  const TOPBAR_H = 70;
  const getThreshold = () => Math.max(0, alertBox.offsetTop - TOPBAR_H);
  let threshold = getThreshold();

  const toggleFloating = () => {
    const shouldFloat = window.scrollY > threshold;
    alertBox.classList.toggle('floating', shouldFloat);

    const scrollBottom = window.innerHeight + window.scrollY;
    const pageHeight = document.body.offsetHeight;

    if (pageHeight - scrollBottom < 120) {
      alertBox.style.bottom = `${120 - (pageHeight - scrollBottom)}px`;
    } else {
      alertBox.style.bottom = '1rem';
    }
  };

  // ✅ direct forceren bij laden
  alertBox.style.position = "fixed";
  alertBox.style.bottom = "1rem";
  alertBox.style.left = "50%";
  alertBox.style.transform = "translateX(-50%)";
  alertBox.style.zIndex = "2000";

  // hercontrole na 0,5s
  setTimeout(() => {
    alertBox.style.position = "fixed";
    alertBox.style.bottom = "1rem";
    alertBox.style.left = "50%";
    alertBox.style.transform = "translateX(-50%)";
  }, 500);

  toggleFloating();
  window.addEventListener('scroll', toggleFloating, { passive: true });
  window.addEventListener('resize', () => {
    threshold = getThreshold();
    toggleFloating();
  });
});
// ✅ Fix: resterende uren-balk altijd onderaan direct bij laden
document.addEventListener("DOMContentLoaded", () => {
  const alertBox = document.getElementById("remainingHoursAlert");
  if (!alertBox) return;

  // Direct forceren
  alertBox.style.position = "fixed";
  alertBox.style.bottom = "1rem";
  alertBox.style.left = "50%";
  alertBox.style.transform = "translateX(-50%)";
  alertBox.style.zIndex = "2000";

  // Hercontrole na 0,5s (voor het geval DOM later rendert)
  setTimeout(() => {
    alertBox.style.position = "fixed";
    alertBox.style.bottom = "1rem";
    alertBox.style.left = "50%";
    alertBox.style.transform = "translateX(-50%)";
  }, 500);
});
// ➕ Helper: controleer of een shiftperiode overlapt met een maand
function monthOverlapsPeriod(year, month0, startISO, endISO) {
  const monthStart = new Date(year, month0, 1);
  const monthEnd   = new Date(year, month0 + 1, 0);
  const start = startISO ? new Date(startISO) : null;
  const end   = endISO   ? new Date(endISO)   : null;
  if (!start && !end) return true;
  const s = start || new Date('1900-01-01');
  const e = end   || new Date('9999-12-31');
  return !(e < monthStart || s > monthEnd);
}
// 🟡 Kleurt de dagen die al een shift hebben
function highlightPlannedDays(inst, plannedDates = []) {
  if (!inst || !inst.daysContainer) return;

  inst.daysContainer.querySelectorAll('.flatpickr-day').forEach(d => {
    if (!d.dateObj) return;
    const yyyy = d.dateObj.getFullYear();
    const mm   = String(d.dateObj.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.dateObj.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`; 

    if (plannedDates.includes(dateStr)) {
      d.classList.add('planned-day');
    } else {
      d.classList.remove('planned-day');
    }
  });
}
function populateMultiDayShifts(selectedDates = []) {
  const ud = getCurrentUserData();
  const sel = document.getElementById('multiShiftName');
  sel.innerHTML = '<option value="">Kies shift</option>';

  const all = ud.shifts || {};
  const order = ud.shiftOrder || Object.keys(all);

  order.forEach(name => {
    const sh = all[name];
    if (!sh) return;

    // toon shift als er GEEN periode is, of als ten minste één dag binnen de periode valt
    const match = !sh.startDate && !sh.endDate ||
      selectedDates.some(d => isDateWithin(d, sh.startDate || null, sh.endDate || null));

    if (match) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      sel.appendChild(o);
    }
  });
}

// 🔄 Kleurt de geplande dagen opnieuw na opslaan
async function refreshPlannedDays() {
  const year = Number(document.getElementById("yearSelectMain").value);
  const month = Number(document.getElementById("monthSelectMain").value);
  const ud = getCurrentUserData();
  const maandData = ud?.monthData?.[year]?.[month]?.rows || {};
  const plannedDates = Object.keys(maandData).filter(d => !!maandData[d]?.shift);

  if (window.multiDayPicker) {
    highlightPlannedDays(window.multiDayPicker, plannedDates);
  }
}

// --- Geeft alle ingeplande datums terug in ISO-formaat ---
function getPlannedDates() {
  const ud = getCurrentUserData();
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const md = ud.monthData?.[y]?.[m];
  if (!md || !md.rows) return [];
  const set = new Set();
  for (const [k, r] of Object.entries(md.rows)) {
    const base = k.split('#')[0]; // strip extra-lijn suffix
    const shiftName = (r?.shift || '').trim();
    if (shiftName && shiftName.toLowerCase() !== 'niet ingepland') {
      set.add(base);
    }
  }
  return [...set];
}

/* === Kalender voor invoer meerdere dagen === */
function initMultiDayPicker() {
  const year = Number(document.getElementById("yearSelectMain").value);
  const month = Number(document.getElementById("monthSelectMain").value);
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
if (window.multiDayPicker) window.multiDayPicker.destroy();
  const ud = getCurrentUserData();
  const maandData = ud?.monthData?.[year]?.[month]?.rows || {};
  const plannedDates = Object.keys(maandData).filter(d => !!maandData[d]?.shift);

  console.log("✅ Planned dates:", plannedDates);

window.multiDayPicker = flatpickr("#multiShiftDays", {
  static: true,
  mode: "multiple",
  dateFormat: "d-m-Y",
  altInput: true,
  altFormat: "d F Y",
  locale: flatpickr.l10ns.nl,
  weekNumbers: true,
  minDate: start,
  maxDate: end,
  disableMobile: true,
  defaultDate: [],

  // ✅ Eerste dag correct kleuren bij laden
onReady(_, __, inst) {
  setTimeout(() => highlightPlannedDays(inst, getPlannedDates()), 50);
},
onMonthChange(_, __, inst) {
  highlightPlannedDays(inst, getPlannedDates());
},
onChange(selectedDates) {
  const isoDates = selectedDates.map(d => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;   // no toISOString()
  });
  populateMultiDayShifts(isoDates);
},
});
setTimeout(markPlannedDays, 100);

function markPlannedDays() {
  const ud = getCurrentUserData();
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const md = ud.monthData?.[y]?.[m] || {};
  const planned = Object.keys(md.rows || {}).filter(k => md.rows[k].shift);

  document.querySelectorAll('.calendar-day').forEach(dayEl => {
    const date = dayEl.dataset?.date;
    if (!date) return;
    if (planned.includes(date)) {
      dayEl.classList.add('planned-day');
    } else {
      dayEl.classList.remove('planned-day');
    }
  });
}
  // 🟡 extra aanroep om te garanderen dat dag 1 direct mee kleurt
  highlightPlannedDays(window.multiDayPicker, plannedDates);
}

/* === Eventlisteners === */
// 🟢 Open de "Meerdere dagen" modal
document.getElementById("multiDayShiftBtn")?.addEventListener("click", () => {
  const modalEl = document.getElementById("multiDayModal");
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  // 1. Bereid de shift-lijst VOOR
  populateMultiDayShifts();
  
  // 2. Toon de modal
  modal.show();

  // 3. Initialiseer de kalender met een korte vertraging (dit is de fix)
  setTimeout(initMultiDayPicker, 150);
}); // <-- NU CORRECT GEPLAATST

// 💾 Opslaan van meerdere dagen
document.getElementById('saveMultiShift').addEventListener('click', async () => {
  try {
    const ud = getCurrentUserData();
    const dateInput = document.getElementById('multiShiftDays');
    const shiftSelect = document.getElementById('multiShiftName');

    const selectedShift = shiftSelect.value;
    if (!selectedShift) {
      toast('Kies eerst een shift', 'warning');
      return;
    }

  // flatpickr geeft comma-separated string terug → splits op ','
    const selectedDates = (dateInput.value || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(disp => {
        // "d-m-Y" -> ISO zonder timezone-trucs
        const [dd, mm, yyyy] = disp.split('-').map(x => x.trim());
        return `${yyyy}-${mm}-${dd}`;
      });

    if (selectedDates.length === 0) {
      toast('Kies minstens één dag', 'warning');
      return;
    }

    const sh = ud.shifts[selectedShift];
    if (!sh) {
      toast('Shift niet gevonden', 'danger');
      return;
    }

    // wegschrijven
    for (const iso of selectedDates) {
      const [yStr, mStr] = iso.split('-');
      const y = Number(yStr);
      const m = Number(mStr) - 1;

      ud.monthData ||= {};
      ud.monthData[y] ||= {};
      ud.monthData[y][m] ||= { targetHours: 0, targetMinutes: 0, rows: {} };

      // project auto
      let project = sh.project || '';
      const sp = autoProjectForShift(selectedShift);
      if (sp) {
        ensureProjectExists(sp);
        project = sp;
      }

      const minutes = minutesBetween(sh.start, sh.end, sh.break);

      ud.monthData[y][m].rows[iso] = {
        project,
        shift: selectedShift,
        start: sh.start,
        end: sh.end,
        break: sh.break,
        omschrijving: '',
        minutes
      };
    }

    await saveUserData();

    // UI refresh
    const curY = Number(yearSelectMain.value);
    const curM = Number(monthSelectMain.value);
    await renderMonth(curY, curM);
    updateInputTotals();
    renderHistory();

    // kalender-highlights (veilig, zonder await)
    if (window.multiDayPicker) {
      highlightPlannedDays(window.multiDayPicker, getPlannedDates());
    }

    // ✅ eerst toast tonen...
    toast('Shiften toegevoegd', 'success');

    // ...dán modal sluiten (met fallback als getInstance null is)
    const modalEl = document.getElementById('multiDayModal');
    (bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl)).hide();

  } catch (err) {
    console.error(err);
    toast('Er ging iets mis bij opslaan', 'danger');
  }
});
// 🧩 Functie om direct 1 dag op de kalender te updaten
function updateCalendarDay(date, shiftName) {
  // Zoek het cel-element dat overeenkomt met deze datum
  const cell = document.querySelector(`[data-date="${date}"]`);
  if (!cell) return;

  // Shift-informatie ophalen (kleur + label)
  const ud = getCurrentUserData();
  const shiftColor = ud.shiftColors?.[shiftName] || "#6c757d"; // grijs fallback

  // Update visuele weergave
  cell.classList.add("has-shift");
  cell.style.backgroundColor = shiftColor;
  cell.style.color = "#fff";
  cell.dataset.shift = shiftName;
  cell.innerHTML = `
    <div class="shift-label">${shiftName}</div>
    <div class="shift-date">${new Date(date).getDate()}</div>
  `;
}
// User: Indienen
document.getElementById('submitMonthBtn')?.addEventListener('click', async () => {
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const status = getMonthStatus(y,m);
  if (status === 'approved') return toast('Maand is al goedgekeurd', 'info');
  if (status === 'submitted') return toast('Maand is al ingediend', 'info');

  await setMonthStatus(y, m, 'submitted');
  toast('Maand ingediend ter goedkeuring', 'success');

  // ✉️ Mail naar admins + bevestiging naar user
  const ud = getCurrentUserData();
  const who = ud.name || ud.email || currentUserId;
  const subject = `[Planner] Ingediend — ${who} — ${monthsFull[m]} ${y}`;
  const bodyAdmin = `${who} heeft zojuist ${monthsFull[m]} ${y} ingediend.\n\nOpen Admin > Goedkeuring maand om te beoordelen.`;
  await broadcastToAdmins(subject, bodyAdmin, 'status');

  const bodyUser = `Je hebt ${monthsFull[m]} ${y} ingediend ter goedkeuring.\nJe ontvangt een bericht zodra dit is beoordeeld.`;
  await sendSystemMail(
  getActiveUserId(),
  `Planner ingediend — ${monthsFull[m]} ${y}`,
  `Je planner voor ${monthsFull[m]} ${y} werd ingediend.`,
  'status',
  `plan:${currentUserId}:${y}-${m}`
);
});

// Admin jaarveld default
document.getElementById('adminMultiYear')?.addEventListener('focus', e => {
  if (!e.target.value) e.target.value = new Date().getFullYear();
});
// Admin jaarveld default
document.getElementById('adminApproveYear')?.addEventListener('focus', e => {
  if (!e.target.value) e.target.value = new Date().getFullYear();
});

// ===================================================
// ✅ NIEUW: Centrale Logica voor Goedkeuring
// (Deze plak je BOVEN de 'adminApproveBtn' listener)
// ===================================================

async function approveMonthLogic(userToApproveId, y, m, comment) {
  // 1. Haal de ECHTE admin info op
  const adminId = auth.currentUser.uid;
  const adminName = auth.currentUser.displayName || "Admin";
  const adminRole = dataStore.users[adminId]?.role || 'admin';

  // 2. Status update
  const prev = dataStore.viewUserId;
  dataStore.viewUserId = userToApproveId; // Tijdelijk wisselen
  await setMonthStatus(y, m, 'approved');
  dataStore.viewUserId = prev; // Terugzetten

  // 3. ✉️ Mail naar user
  const subject = `[Planner] Goedgekeurd — ${monthsFull[m]} ${y}`;
  const body = `Je planner voor ${monthsFull[m]} ${y} werd goedgekeurd.${comment ? `\n\nReden:\n${comment}` : ''}`;
  const threadId = `plan:${userToApproveId}:${y}-${m}`;

  await addDoc(collection(db, "users", userToApproveId, "mailbox"), {
    threadId, system: true, kind: "status",
    from: { uid: adminId, name: adminName, role: adminRole },
    to: { uid: userToApproveId, type: "user" },
    subject, body, read: false,
    timestamp: serverTimestamp()
  });

  // 4. ✉️ Kopie in admin's "Verzonden" map
  await addDoc(collection(db, "users", adminId, "mailbox"), {
    threadId, system: false, kind: "status",
    from: { uid: adminId, name: adminName, role: adminRole },
    to: { uid: userToApproveId, type: "user" },
    subject, body, read: true,
    timestamp: serverTimestamp()
  });
}

async function rejectMonthLogic(userToRejectId, y, m, comment) {
  // 1. Haal de ECHTE admin info op
  const adminId = auth.currentUser.uid;
  const adminName = auth.currentUser.displayName || "Admin";
  const adminRole = dataStore.users[adminId]?.role || 'admin';

  // 2. Status update
  const prev = dataStore.viewUserId;
  dataStore.viewUserId = userToRejectId; // Tijdelijk wisselen
  await setMonthStatus(y, m, 'rejected');
  dataStore.viewUserId = prev; // Terugzetten

  // 3. ✉️ Mail naar user
  const subject = `[Planner] Afgekeurd — ${monthsFull[m]} ${y}`;
  const body = `Je planner voor ${monthsFull[m]} ${y} werd afgekeurd.${comment ? `\n\nReden:\n${comment}` : ''}`;
  const threadId = `plan:${userToRejectId}:${y}-${m}`;

  await addDoc(collection(db, "users", userToRejectId, "mailbox"), {
    threadId, system: true, kind: "status",
    from: { uid: adminId, name: adminName, role: adminRole },
    to: { uid: userToRejectId, type: "user" },
    subject, body, read: false,
    timestamp: serverTimestamp()
  });

  // 4. ✉️ Kopie in admin's "Verzonden" map
  await addDoc(collection(db, "users", adminId, "mailbox"), {
    threadId, system: false, kind: "status",
    from: { uid: adminId, name: adminName, role: adminRole },
    to: { uid: userToRejectId, type: "user" },
    subject, body, read: true,
    timestamp: serverTimestamp()
  });
}

async function reopenMonthLogic(uid, y, m) {
  const prev = dataStore.viewUserId;
  dataStore.viewUserId = uid;
  await setMonthStatus(y, m, 'draft');
  dataStore.viewUserId = prev;
}
// ✅ NIEUW: Render het 12-maanden overzicht
async function renderApprovalOverview(uid, year) {
  if (!approvalYearlyOverview) return;
  approvalYearlyOverview.innerHTML = ''; // Leegmaken

  // We moeten tijdelijk de 'view' wisselen om getMonthStatus te laten werken
  const prev = dataStore.viewUserId;
  dataStore.viewUserId = uid;

  // Zorg dat we de data van de user hebben
  if (!dataStore.users[uid]) {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      dataStore.users[uid] = snap.data();
    } else {
      approvalYearlyOverview.innerHTML = '<div class="col-12"><div class="alert alert-danger">Kon gebruiker niet laden.</div></div>';
      dataStore.viewUserId = prev;
      return;
    }
  }

  for (let m = 0; m < 12; m++) {
    const status = getMonthStatus(year, m);
    const monthName = monthsFull[m];
    
    let statusText = 'Concept';
    let statusClass = 'badge-draft'; // Gebruik de CSS classes die je al hebt
    if (status === 'submitted') { statusText = 'Ingediend'; statusClass = 'badge-submitted'; }
    if (status === 'approved') { statusText = 'Goedgekeurd'; statusClass = 'badge-approved'; }
    if (status === 'rejected') { statusText = 'Afgekeurd'; statusClass = 'badge-rejected'; }

    // Bepaal welke knoppen actief zijn
    const canApprove = (status === 'submitted' || status === 'rejected');
    const canReject = (status === 'submitted' || status === 'approved');
    const canReopen = (status === 'approved' || status === 'rejected');

    const card = document.createElement('div');
    card.className = 'col-md-4 col-lg-3';
    card.innerHTML = `
      <div class="card shadow-sm h-100">
        <div class="card-body d-flex flex-column">
          <div class="d-flex justify-content-between align-items-start">
            <h6 class="card-title">${monthName} ${year}</h6>
            <span class="badge badge-status ${statusClass}">${statusText}</span>
          </div>
          <div id="approval-card-${uid}-${m}" class="mt-auto pt-3 d-flex flex-column gap-2">
            <button class="btn btn-success btn-sm" 
              data-action="approve" data-uid="${uid}" data-y="${year}" data-m="${m}" 
              ${canApprove ? '' : 'disabled'}>
              Goedkeuren
            </button>
            <button class="btn btn-danger btn-sm" 
              data-action="reject" data-uid="${uid}" data-y="${year}" data-m="${m}" 
              ${canReject ? '' : 'disabled'}>
              Afkeuren
            </button>
            <button class="btn btn-outline-secondary btn-sm" 
              data-action="reopen" data-uid="${uid}" data-y="${year}" data-m="${m}" 
              ${canReopen ? '' : 'disabled'}>
              Heropenen (Draft)
            </button>
          </div>
        </div>
      </div>
    `;
    approvalYearlyOverview.appendChild(card);
  }

  // Zet de view terug
  dataStore.viewUserId = prev;
}
// ✅ NIEUW: Gedelegeerde listener voor de knoppen in het jaaroverzicht
approvalYearlyOverview?.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const uid = btn.dataset.uid;
  const y = Number(btn.dataset.y);
  const m = Number(btn.dataset.m);
  const year = Number(approvalYearSelect.value);

  if (!uid) return;

  // Laat de knoppen even "laden"
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';

  try {
    if (action === 'approve') {
      const comment = prompt('Commentaar voor de gebruiker (optioneel):', '');
      await approveMonthLogic(uid, y, m, comment);
      toast(`Goedgekeurd: ${monthsFull[m]} ${y}`, 'success');
    } 
    else if (action === 'reject') {
      const comment = prompt('Reden voor afkeuring (optioneel):', '');
      await rejectMonthLogic(uid, y, m, comment);
      toast(`Afgekeurd: ${monthsFull[m]} ${y}`, 'warning');
    }
    else if (action === 'reopen') {
      await reopenMonthLogic(uid, y, m);
      toast(`Heropend: ${monthsFull[m]} ${y}`, 'info');
    }

    // Herlaad het overzicht
    await renderApprovalOverview(uid, year);

  } catch (err) {
    console.error(`Fout bij actie ${action}:`, err);
    toast('Er ging iets mis', 'danger');
    // Herlaad ook bij fout, zodat de knop niet blijft spinnen
    await renderApprovalOverview(uid, year);
  }
});
// Admin: Keur goed
document.getElementById('adminApproveBtn')?.addEventListener('click', async () => {
  const userToApproveId = adminUserSelect?.value;
  if (!userToApproveId) return toast('Geen gebruiker gekozen', 'warning');
  
  const y = Number(document.getElementById('adminApproveYear').value || new Date().getFullYear());
  const m = Number(document.getElementById('adminApproveMonth').value || 0);
  const comment = prompt('Commentaar voor de gebruiker (optioneel):', '');

  await approveMonthLogic(userToApproveId, y, m, comment);
  
  toast(`Goedgekeurd: ${monthsFull[m]} ${y}`, 'success');

  // UI update (als de admin naar zichzelf kijkt)
  if (getActiveUserId() === userToApproveId && y===Number(yearSelectMain.value) && m===Number(monthSelectMain.value)) {
    renderMonth(y, m);
  }
});

// Admin: Keur af
document.getElementById('adminRejectBtn')?.addEventListener('click', async () => {
  const userToRejectId = adminUserSelect?.value;
  if (!userToRejectId) return toast('Geen gebruiker gekozen', 'warning');
  
  const y = Number(document.getElementById('adminApproveYear').value || new Date().getFullYear());
  const m = Number(document.getElementById('adminApproveMonth').value || 0);
  const comment = prompt('Reden voor afkeuring (optioneel):', ''); // Vraag om reden

  await rejectMonthLogic(userToRejectId, y, m, comment);

  toast(`Afgekeurd: ${monthsFull[m]} ${y}`, 'warning');
  
  // UI update
  if (getActiveUserId() === userToRejectId && y===Number(yearSelectMain.value) && m===Number(monthSelectMain.value)) {
    renderMonth(y, m);
  }
});

// Admin: Heropenen (ontgrendelen)
document.getElementById('adminReopenBtn')?.addEventListener('click', async () => {
  const uid = adminUserSelect?.value; // Gebruik de geselecteerde gebruiker
  if (!uid) return toast('Geen gebruiker gekozen', 'warning');
  
  const y = Number(document.getElementById('adminApproveYear').value || new Date().getFullYear());
  const m = Number(document.getElementById('adminApproveMonth').value || 0);

  await reopenMonthLogic(uid, y, m);

  toast(`Heropend: ${monthsFull[m]} ${y}`, 'info');

  // UI update
  if (getActiveUserId() === uid &&
      y === Number(yearSelectMain.value) &&
      m === Number(monthSelectMain.value)) {
    renderMonth(y, m);
  }
});
function renderAdminMonthlyMulti(){
  const yInput   = document.getElementById('adminMultiYear');
  const mSelect  = document.getElementById('adminMultiMonth');
  const allowBox = document.getElementById('adminMultiAllow');
  if (!yInput || !mSelect || !allowBox) return;

  const uid = adminUserSelect?.value || getActiveUserId();
  if (!uid){
    allowBox.checked = false;
    allowBox.disabled = true;
    return;
  }

  const prev = dataStore.viewUserId;
  dataStore.viewUserId = uid;
  const ud = getCurrentUserData();
  ensureUserMonthlyMap(ud);

  if (!yInput.value)   yInput.value = new Date().getFullYear();
  if (!mSelect.value)  mSelect.value = String(new Date().getMonth());

  const y = Number(yInput.value);
  const m = Number(mSelect.value);
  allowBox.disabled = false;
  allowBox.checked  = userAllowsMultiMonth(ud, y, m);

  yInput.onchange = () => renderAdminMonthlyMulti();
  mSelect.onchange = () => renderAdminMonthlyMulti();
  allowBox.onchange = async () => {
    const key = `${yInput.value}-${String(Number(mSelect.value)+1).padStart(2,'0')}`;
    if (allowBox.checked) ud.settings.multiByMonth[key] = true;
    else delete ud.settings.multiByMonth[key];
    await saveUserData();

    // herteken als het de zichtbare maand is
    if (getActiveUserId() === uid &&
        Number(yearSelectMain.value) === Number(yInput.value) &&
        Number(monthSelectMain.value) === Number(mSelect.value)) {
      renderMonth(Number(yInput.value), Number(mSelect.value));
    }
    toast(`Extra lijnen: ${allowBox.checked ? 'toegestaan' : 'uitgezet'} voor ${key}`, 'success');
  };

  dataStore.viewUserId = prev;
}
// aanroepen bij wisselen admin user
adminUserSelect?.addEventListener('change', renderAdminMonthlyMulti);
function renderProjectSummary() 
{
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const ud = getCurrentUserData();
  const md = ud.monthData?.[y]?.[m];
  const wrap = document.getElementById('projectSummary');
  if (!wrap) return;

  if (!md || !md.rows || !Object.keys(md.rows).length) {
    wrap.innerHTML = '<div class="alert alert-light border small mb-0">Geen data in deze maand.</div>';
    return;
  }

  const filterProject = projectFilterSelect.value || '';
  const perProject = {};
  for (const r of Object.values(md.rows)) {
    if (!r) continue;
    const p = (r.project || '—');
    if (filterProject && p !== filterProject) continue;
    perProject[p] = (perProject[p] || 0) + (r.minutes || 0);
  }

  const cards = Object.entries(perProject)
    .sort((a,b)=> b[1]-a[1])
    .map(([name, minutes]) => {
      const h = Math.floor(minutes/60), min = minutes%60;
      return `
        <div class="project-mini">
          <div class="title">${name}</div>
          <div class="meta">Totaal in maand</div>
          <div class="value">${h}u ${min}m</div>
        </div>`;
    });

  wrap.innerHTML = cards.length
    ? cards.join('')
    : '<div class="alert alert-light border small mb-0">Geen projecten voor huidig filter.</div>';
}
function minutesToHM(min){ return `${Math.floor(min/60)}u ${min%60}m`; }
// Helpers
function isSchoolLeaveEnabledFor(uid) {
  const prev = dataStore.viewUserId; dataStore.viewUserId = uid;
  const ud = getCurrentUserData();
  dataStore.viewUserId = prev;
  return ud?.settings?.schoolLeaveEnabled !== false; // default true
}
async function applySchoolLeaveVisibility() {
  const ud = getCurrentUserData();
  const enabled = ud?.settings?.schoolLeaveEnabled ?? true;

  // 🔹 Andere secties met class .school-leave-section
  document.querySelectorAll('.school-leave-section').forEach(el => {
    if (enabled) {
      el.classList.remove('fade-out');
      el.classList.add('fade-in');
      el.style.display = '';
    } else {
      el.classList.remove('fade-in');
      el.classList.add('fade-out');
      setTimeout(() => (el.style.display = 'none'), 300);
    }
  });

  // 🔹 Historiektabel Schoolverlof-kolom
  setTimeout(() => {
    const table = document.getElementById('historyTable');
    if (!table) return;

    const headers = Array.from(table.querySelectorAll('th'));
    const index = headers.findIndex(th =>
      th.textContent.trim().toLowerCase().includes('schoolverlof')
    );

    if (index >= 0) {
      table.querySelectorAll('tr').forEach(tr => {
        const cell = tr.children[index];
        if (!cell) return;
        if (enabled) {
          cell.classList.remove('fade-out', 'hidden-col');
          cell.classList.add('fade-in');
        } else {
          cell.classList.remove('fade-in');
          cell.classList.add('fade-out');
          setTimeout(() => cell.classList.add('hidden-col'), 300);
        }
      });
    }
  }, 200); // wacht even tot renderHistory() klaar is

  // 🔹 Andere UI vernieuwingen
  renderMonth(Number(yearSelectMain.value), Number(monthSelectMain.value));
  updateLeaveBadges();
  renderHistory();
}
// Admin: bij user-select en bij laden
document.getElementById('adminUserSelect')?.addEventListener('change', hydrateSchoolLeaveToggle);
document.querySelector('a[href="#tab-admin"]')?.addEventListener('shown.bs.tab', hydrateSchoolLeaveToggle);

function hydrateSchoolLeaveToggle() {
  const btn = document.getElementById('saveSettingsBtn');
  const badge = document.getElementById('schoolLeaveStatusBadge');
  if (!btn || !badge) return;

  // ⬇️ Helper om UI aan te passen
  function updateButtonUI(uid) {
    const state = isSchoolLeaveEnabledFor(uid);
    if (state) {
      btn.textContent = 'Schoolverlof uitschakelen';
      btn.classList.remove('btn-success');
      btn.classList.add('btn-outline-secondary');

      badge.textContent = 'Actief';
      badge.classList.remove('bg-danger');
      badge.classList.add('bg-success');
    } else {
      btn.textContent = 'Schoolverlof inschakelen';
      btn.classList.remove('btn-outline-secondary');
      btn.classList.add('btn-success');

      badge.textContent = 'Uitgeschakeld';
      badge.classList.remove('bg-success');
      badge.classList.add('bg-danger');
    }
  }

  // 🔁 Bij selectie van gebruiker (in adminpaneel)
  adminUserSelect?.addEventListener('change', () => {
    const uid = adminUserSelect.value || getActiveUserId();
    if (uid) updateButtonUI(uid);
  });

  // 🖱 Klikgedrag voor inschakelen / uitschakelen
  btn.onclick = async () => {
    const uid = adminUserSelect?.value || getActiveUserId();
    if (!uid) return;

    const prev = dataStore.viewUserId;
    dataStore.viewUserId = uid;

    const ud = getCurrentUserData();
    ud.settings ||= {};
    const newState = !ud.settings.schoolLeaveEnabled;
    ud.settings.schoolLeaveEnabled = newState;

    await saveUserData();
    dataStore.viewUserId = prev;

    applySchoolLeaveVisibility();
    renderMonth(Number(yearSelectMain.value), Number(monthSelectMain.value));
    updateLeaveBadges();
    renderHistory();

    updateButtonUI(uid);
    toast(`Schoolverlof ${newState ? 'ingeschakeld' : 'uitgeschakeld'}`, 'success');
  };

  // 🚀 Initialiseren bij laden
  const startUid = adminUserSelect?.value || getActiveUserId();
  if (startUid) updateButtonUI(startUid);
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
let mailUIBound = false;

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

  const me = dataStore.users[uid]; // Gebruik de ingelogde user ID
  const iAmAdmin = (me?.role || 'user') === 'admin';

  if (iAmAdmin) {
    // ADMIN: Luistert naar TWEE bronnen
    
    // Bron 1: De 'admin_mail' collectie (voor de Inbox)
    const inboxColRef = collection(db, 'admin_mail');
    const qyInbox = query(inboxColRef, orderBy('timestamp','desc'), limit(200));
    mailboxUnsubInbox = onSnapshot(qyInbox, (snap) => {
      // ⬇️ HIER IS DE FIX: _source tag toegevoegd
      mailboxCacheInbox = snap.docs.map(d => ({ _id:d.id, ...d.data(), _tsIso: normTs(d.data().timestamp), _source: 'admin_mail' }));
      mergeAndRenderMail(); 
    });

    // Bron 2: Hun EIGEN mailbox (voor Verzonden items en replies)
    const sentColRef = collection(db, 'users', uid, 'mailbox');
    const qySent = query(sentColRef, orderBy('timestamp','desc'), limit(200));
    mailboxUnsubSent = onSnapshot(qySent, (snap) => {
      // ⬇️ HIER IS DE FIX: _source tag toegevoegd
      mailboxCacheSent = snap.docs.map(d => ({ _id:d.id, ...d.data(), _tsIso: normTs(d.data().timestamp), _source: 'user_mailbox' }));
      mergeAndRenderMail(); 
    });

  } else {
    // GEWONE USER: Luistert naar ÉÉN bron (hun eigen mailbox)
    const userColRef = collection(db, 'users', uid, 'mailbox');
    const qyUser = query(userColRef, orderBy('timestamp','desc'), limit(200));
    mailboxUnsubInbox = onSnapshot(qyUser, (snap) => {
      // ⬇️ HIER IS DE FIX: _source tag toegevoegd
      mailboxCacheInbox = snap.docs.map(d => ({ _id:d.id, ...d.data(), _tsIso: normTs(d.data().timestamp), _source: 'user_mailbox' }));
      mailboxCacheSent = []; 
      mergeAndRenderMail(); 
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

  // --- HET FOUTE GEDEELTE IS VERVANGEN ---
  // In plaats van te 'fan-out' naar alle admins (wat mislukt)...
  
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
    system: false, // 👈 HIER IS DE FIX: DIT STAAT NU GOED
    kind: kind,
    from:{ uid: meUid, name: meName, role:'user' },
    to:{ type:'admin-group' }, // We sturen dit naar de 'admin-group'
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

  await updateDoc(docRef, { read: !!val }); // 👈 Gebruik het juiste pad
  
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
  const uid = currentUserId; // 👈 FIX: Altijd de ingelogde user gebruiken
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
  if (mailUIBound) return;
  mailUIBound = true;

// Folder switch
mailFolderNav?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-folder]');
    if (!btn) return;
    mailFolder = btn.dataset.folder; // 'inbox' or 'sent'
  
    const inboxBtn = document.getElementById('mailTabInbox');
    const sentBtn = document.getElementById('mailTabSent');
  
    // 1. FIX: Update de knop-stijlen correct
    if (mailFolder === 'sent') {
      inboxBtn.classList.remove('active', 'btn-outline-primary');
      inboxBtn.classList.add('btn-outline-secondary');
      
      sentBtn.classList.add('active', 'btn-outline-primary');
      sentBtn.classList.remove('btn-outline-secondary');
    } else { // 'inbox'
      inboxBtn.classList.add('active', 'btn-outline-primary');
      inboxBtn.classList.remove('btn-outline-secondary');
      
      sentBtn.classList.remove('active', 'btn-outline-primary');
      sentBtn.classList.add('btn-outline-secondary');
    }
  
    // 2. FIX: Update de titel
    const titleEl = document.getElementById('mailListTitle');
    if (titleEl) {
      titleEl.textContent = (mailFolder === 'sent') ? 'Verzonden' : 'Inbox';
    }
  
    // 3. Herlaad de lijst en maak details leeg
    renderMailList();
    mailDetail.innerHTML = '<div class="text-muted small">Selecteer een bericht…</div>';
  });

  // Compose
  mailComposeBtn?.addEventListener('click', () => {
    mailComposeCard.classList.toggle('d-none');
    if (!mailComposeCard.classList.contains('d-none')) {
      prepareComposeOptions();
      mailSubjectInput.value = '';
      mailBodyInput.value    = '';
      composeThreadId = null;
    }
  });
  mailCancelBtn?.addEventListener('click', () => {
    mailComposeCard.classList.add('d-none');
    composeThreadId = null;
  });
  mailSendBtn?.addEventListener('click', async () => {
    const toVal   = mailToSelect.value;
    const subject = (mailSubjectInput.value || '').trim();
    const body    = (mailBodyInput.value || '').trim();
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
      mailComposeCard.classList.add('d-none');
      composeThreadId = null;
    } catch (e) {
      console.error(e);
      toast('Versturen mislukt', 'danger');
    }
  });

  // Refresh
  mailRefreshBtn?.addEventListener('click', () => {
    const uid = getActiveUserId();
    if (uid) listenMailbox(uid);
  });
// 🆕 Alles verwijderen (in de huidige map)
mailDeleteAllBtn?.addEventListener('click', async () => {
    const uid = currentUserId; // 
    if (!uid) return;

    // 1. Bepaal welke map actief is
    const folderName = (mailFolder === 'sent') ? 'verzonden items' : 'inbox';

    // 2. Haal de berichten op die *zichtbaar* zijn in die map
    //    Deze helper bestaat al en respecteert de 'mailFolder' state
    const messagesToDelete = filteredMessages(); 

    if (messagesToDelete.length === 0) {
      return toast(`Er zijn geen berichten in je ${folderName}.`, 'info');
    }

    // 3. Vraag bevestiging (BELANGRIJK!)
    if (!confirm(`Weet je zeker dat je alle ${messagesToDelete.length} berichten in je ${folderName} permanent wilt verwijderen?`)) {
      return;
    }

    // 4. Bouw de lijst van te verwijderen documenten
    try {
      // ⬇️ HIER IS DE FIX ⬇️
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
      toast(`Alle ${messagesToDelete.length} berichten zijn verwijderd.`, 'success');
      
      // Maak het detailpaneel leeg
      mailDetail.innerHTML = '<div class="text-muted small">Selecteer een bericht…</div>';
      delete mailDetail.dataset.openId;

    } catch (err) {
      console.error("Fout bij alles verwijderen:", err);
      toast('Er ging iets mis bij het verwijderen.', 'danger');
    }
  });
// 🆕 Markeer alles als gelezen
  mailMarkAllReadBtn?.addEventListener('click', async () => {
    const uid = currentUserId; // 👈 FIX: Altijd de ingelogde user gebruiken
    if (!uid) return;
    if (!confirm('Alle berichten in de inbox als gelezen markeren?')) return;

    // We updaten alleen de items die we lokaal zien (uit de cache)
    const unreadInbox = mailboxCache.filter(m =>
      (m.from?.uid !== uid || m.system) && // Definitie van 'inbox'
      m.read === false
    );

    if (unreadInbox.length === 0) {
      return toast('Geen ongelezen berichten', 'info');
    }

    try {
      // ⬇️ HIER IS DE FIX ⬇️
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
      toast(`Alle ${unreadInbox.length} berichten als gelezen gemarkeerd`, 'success');

    } catch (err) {
      console.error("Fout bij alles gelezen:", err);
      toast('Er ging iets mis.', 'danger');
    }
  });
  // Lijst actions (delegation, één listener)
  mailListBody?.addEventListener('click', async (e) => {
    const aOpen = e.target.closest('a.js-open');
    const bTog  = e.target.closest('button.js-toggle');
    const bDel  = e.target.closest('button.js-del');
    if (aOpen) {
      e.preventDefault();
      const msg = filteredMessages().find(x => x._id === aOpen.dataset.id)
               || mailboxCache.find(x => x._id === aOpen.dataset.id);
      if (msg) openMail(msg);
      return;
    }
    if (bTog) {
      const id = bTog.dataset.id;
      const msg = mailboxCache.find(x => x._id === id);
      await markMailRead(id, !(msg?.read));
      return;
    }
    if (bDel) {
      const id = bDel.dataset.id;
      if (!confirm('Dit bericht verwijderen?')) return;
      await deleteMail(id);
      toast('Bericht verwijderd', 'success');
      return;
    }
  });

  // Detail actions (delegation)
  mailDetail?.addEventListener('click', (e) => {
    const markUn = e.target.closest('.js-mark-unread');
    const delBtn = e.target.closest('.js-del');
    const reply  = e.target.closest('.js-reply');

    if (markUn) {
      const id = markUn.dataset.id;
      markMailRead(id, false);
      toast('Gemarkeerd als ongelezen', 'success');
      return;
    }
    if (delBtn) {
      const id = delBtn.dataset.id;
      if (!confirm('Dit bericht verwijderen?')) return;
      deleteMail(id).then(()=> toast('Bericht verwijderd', 'success'));
      return;
    }
    if (reply) {
      const id = reply.dataset.id;
      const msg = mailboxCache.find(x => x._id === id);
      if (!msg) return;
      mailComposeCard.classList.remove('d-none');
      prepareComposeToCounterparty(msg);
      window.scrollTo({ top: mailComposeCard.offsetTop - 80, behavior: 'smooth' });
      return;
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

    // De Wachtwoord Reset Knop-logica is nu verwijderd.
