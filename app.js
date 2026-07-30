// ==========================================
// 1. IMPORTS & FIREBASE CONFIGURATIE
// ==========================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { getMessaging, getToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, getDocs, addDoc, deleteDoc, collection, query, orderBy, limit, onSnapshot, where, startAfter, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, uploadBytesResumable } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js';

const firebaseConfig = {
    apiKey: "AIzaSyB8uHwRXCe1iV7z6T80YPxEbeB64qdMpNY",
    authDomain: "shift-planner-dc7ad.firebaseapp.com",
    projectId: "shift-planner-dc7ad",
    storageBucket: "shift-planner-dc7ad.firebasestorage.app",
    messagingSenderId: "719441527396",
    appId: "1:719441527396:web:de87d6f950fe23702a5571",
    measurementId: "G-7Q630776V6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const messaging = getMessaging(app);

// ==========================================
// 2. STATE & GLOBALE VARIABELEN
// ==========================================
let currentUserId = null;
let mailUIBound = false;
let notificationInterval = null;
let editingProjectIndex = null;
let isPaintMode = false;
let selectedPaintShiftKey = null;

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

// ==========================================
// 3. DOM ELEMENTEN
// ==========================================
const sidebar = document.getElementById('sidebar');
const main = document.getElementById('main');
const logoutBtn = document.getElementById('logoutBtn');
const currentUserName = document.getElementById('currentUserName');
const adminTabBtn = document.getElementById('adminTabBtn');

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

// ==========================================
// 4. HELPERS & ALGEMENE FUNCTIES
// ==========================================
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

function autoProjectForShift(shiftName) {
    return SPECIAL_PROJECT_MAP[shiftName] || null;
}

const daysFull = ["Zondag","Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag"];
const monthsFull = ["Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"];
const LEAVE_SHIFT_NAMES = ['Verlof'];              
const SCHOOL_LEAVE_SHIFT_NAMES = ['Schoolverlof']; 

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

function ensureUserMonthlyMap(ud){
    ud.settings ||= {};
    ud.settings.multiByMonth ||= {}; 
    return ud.settings.multiByMonth;
}

function userAllowsMultiMonth(ud, year, month){ 
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
    return Object.keys(monthData.rows)
        .filter(k => k === dateKey || k.startsWith(dateKey + '_'))
        .sort(); 
}

function nextLineIndex(md, baseKey) {
    const keys = listDayKeys(md, baseKey);
    let n = 2;
    while (keys.includes(`${baseKey}#${n}`)) n++;
    return n;
}

function fmt(mins){ return `${Math.floor(mins/60)}u ${mins%60}min`; }

// ==========================================
// 5. NOTIFICATIES (FIREBASE CLOUD MESSAGING)
// ==========================================
async function enableNotifications(uid) {
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log('Notificatie toestemming gegeven.');
            const swRegistration = await navigator.serviceWorker.register('./firebase-messaging-sw.js', { scope: './' });
            const token = await getToken(messaging, {
                vapidKey: 'BAQfmfk_rwoMDHbDeTU6gdRZBjxWmikZWf_prrddhvW8Pf2hOrLc8QmkMbltWCqxbKfRs3S8ZCB3NOjrGgj2h64', 
                serviceWorkerRegistration: swRegistration       
            });
            if (token) {
                console.log('Mijn Token:', token);
                const userRef = doc(db, 'users', uid);
                await updateDoc(userRef, { fcmToken: token });
                console.log('Token opgeslagen in database!');
            } else {
                console.log('Geen token ontvangen.');
            }
        } else {
            console.log('Notificatie toestemming geweigerd.');
        }
    } catch (err) {
        console.error('Fout bij notificaties:', err);
    }
}

onMessage(messaging, (payload) => {
    console.log('Bericht ontvangen in voorgrond: ', payload);
    alert(`${payload.notification.title}: ${payload.notification.body}`);
});

// ==========================================
// 6. DASHBOARD & HOME FUNCTIES
// ==========================================
function loadHomeNotifications() {
    try {
        if (!currentUserId) return;
        const listEl = document.getElementById('homeNotifList');
        if (!listEl) return;

        const notifications = dataStore.notifications.slice(0, 5);
        listEl.innerHTML = '';
        if (notifications.length === 0) {
            listEl.innerHTML = '<li class="text-muted small">Geen meldingen.</li>';
            return;
        }
        
        notifications.forEach(n => {
            const when = n.timestamp ? new Date(n.timestamp).toLocaleString('nl-BE') : '';
            listEl.insertAdjacentHTML('beforeend', `<li class="small mb-1">${n.text}<br><span class="text-muted">${when}</span></li>`);
        });
    } catch(e){ console.error(e); }
}

function renderHome() {
    const ud = getCurrentUserData();
    const name = ud.name || ud.email || '-';
    const y = Number(yearSelectMain.value);
    const m = Number(monthSelectMain.value);
    const md = ud.monthData?.[y]?.[m] || { rows:{}, targetHours:0, targetMinutes:0 };

    const userEl = document.getElementById('homeUserName');
    if (userEl) userEl.textContent = name;
    const monthNameEl = document.getElementById('homeMonthName');
    if (monthNameEl) monthNameEl.textContent = `${monthsFull[m]} ${y}`;

    const planned = Object.values(md.rows || {}).reduce((s, r) => {
        if (r.status && r.status !== 'approved') return s; 
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

    const st = document.getElementById('homeMonthStatus');
    if (st) {
        const status = getMonthStatus(y, m);
        st.textContent = status==='draft' ? 'Concept' : status==='submitted' ? 'Ingediend' : status==='approved' ? 'Goedgekeurd' : 'Afgekeurd';
        st.className = 'badge';
        st.classList.add(status==='approved' ? 'bg-success' : status==='submitted' ? 'bg-primary' : status==='rejected' ? 'bg-danger' : 'bg-secondary-subtle','text-dark');
    }

    const leaveAllow = getLeaveAllowanceMinutes();
    const leaveTaken = sumTakenMinutesFor(y, LEAVE_SHIFT_NAMES);
    const leaveRemain = leaveAllow - leaveTaken;
    const leaveEl = document.getElementById('homeLeave');
    if (leaveEl) {
        leaveEl.textContent = !leaveAllow ? 'Verlof: niet ingesteld' : (leaveRemain >= 0 ? `Verlof: ${fmt(leaveRemain)} over` : `Verlof: -${fmt(Math.abs(leaveRemain))} overschreden`);
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
            schEl.textContent = schRemain >= 0 ? `Schoolverlof: ${fmt(schRemain)} over — ${label}` : `Schoolverlof: -${fmt(Math.abs(schRemain))} overschreden — ${label}`;
            schEl.className = `badge ${schRemain < 0 ? 'bg-danger' : (schRemain === 0 ? 'bg-warning text-dark' : 'bg-success')}`;
        }
    }

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
    loadHomeNotifications();
    initAnnouncements();
}

document.getElementById('homeBtnQuickInput')?.addEventListener('click', () => new bootstrap.Modal(document.getElementById('quickModal')).show());
document.getElementById('homeBtnNewShift')?.addEventListener('click', () => new bootstrap.Modal(document.getElementById('shiftModal')).show());
document.getElementById('homeBtnGoInvoer')?.addEventListener('click', () => {
    const a = document.querySelector('a[href="#tab-invoer"]');
    if (a) new bootstrap.Tab(a).show();
});

// ==========================================
// 7. MAANDSTATUS & ALGEMENE INITS
// ==========================================
function getMonthStatus(y, m){
    const ud = getCurrentUserData();
    return ud.monthData?.[y]?.[m]?.status || 'draft';
}

async function setMonthStatus(y, m, status){
    const ud = getCurrentUserData();
    ud.monthData ||= {}; ud.monthData[y] ||= {};
    ud.monthData[y][m] ||= { targetHours:0, targetMinutes:0, rows:{} };
    ud.monthData[y][m].status = status;
    await saveUserData();
    updateMonthStatusBadge();
}

function updateMonthStatusBadge(){
    const y = Number(yearSelectMain.value), m = Number(monthSelectMain.value), status = getMonthStatus(y,m);
    const badge = document.getElementById('monthStatusBadge'), submitBtn = document.getElementById('submitMonthBtn');
    
    if (!badge) return;
    badge.className = 'badge badge-status';
    if (status==='draft'){ badge.classList.add('badge-draft'); badge.textContent='Concept'; }
    if (status==='submitted'){ badge.classList.add('badge-submitted'); badge.textContent='Ingediend'; }
    if (status==='approved'){ badge.classList.add('badge-approved'); badge.textContent='Goedgekeurd'; }
    if (status==='rejected'){ badge.classList.add('badge-rejected'); badge.textContent='Afgekeurd'; }

    const loggedInUser = dataStore.users[currentUserId];
    const iAmAdmin = loggedInUser && loggedInUser.role === 'admin';
    const hide = (status === 'submitted' || status === 'approved') && !iAmAdmin;

    if (submitBtn){
        submitBtn.classList.toggle('d-none', hide);
        submitBtn.disabled = hide; 
    }
    const mBtn = document.getElementById('multiDayShiftBtn');
    if (mBtn){
        mBtn.classList.toggle('d-none', hide);
        mBtn.disabled = hide;
    }
}

function initSelectors(){
    const yearSelect = document.getElementById('yearSelectMain');
    const monthSelect = document.getElementById('monthSelectMain');
    if (!yearSelect || !monthSelect) return;

    const yNow = new Date().getFullYear();
    yearSelect.innerHTML = '';
    for (let y = yNow - 2; y <= yNow + 3; y++) {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y;
        if (y === yNow) opt.selected = true;
        yearSelect.appendChild(opt);
    }
    const mNow = new Date().getMonth();
    monthSelect.value = String(mNow);
}

// ==========================================
// 8. DATA LADEN & AUTHENTICATIE
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (notificationInterval) clearInterval(notificationInterval);
    const savedColor = localStorage.getItem('accentColor');
    if (savedColor) applyAccentColor(savedColor);

    if (!user) {
        window.location.replace('index.html');
        return; 
    }

    document.body.classList.add('auth-checked');
    requestNotificationPermission();
    currentUserId = user.uid;

    const nameEl = document.getElementById('currentUserName');
    if (nameEl) nameEl.textContent = user.displayName || user.email;

    const topPhotoEl = document.getElementById('topbarProfilePhoto');
    if (topPhotoEl && user.photoURL) {
        topPhotoEl.src = user.photoURL;
    } else if (topPhotoEl) {
        topPhotoEl.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgZmlsbD0iY3VycmVudENvbG9yIiBjbGFzcz0iYmkgYmktcGVyc29uLWZpbGwiIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZD0iTTMgMTQgczEtMiAyLTIgMiAyIDIgMiAyLTItMi0yem01LTAiLz48cGF0aCBkPSJNODguNUM4IDcuNjcgNy4zMyA3IDYuNSA3UzUgNy42NyA1IDguNSA1LjY3IDEwIDYuNSAxMFM4IDkuMzMgOCA4LjV6bS0yIDBjMCAxLjExLS44OSAyLTIgMnMtMi0uODktMi0yIC44OS0yIDItMiAyIC44OSAyIDJ6bS0yLTNjLTMuMTQ2IDAtNS41IDIuNTM2LTUuNSA1LjVWMTloMTJ2LTIuNWMwLTIuOTY0LTIuMzU0LTUuNS01LjUtNS41eiIvPjwvc3ZnPg==';
    }

    await ensureUserDoc(user);
    await loadAllUsers();

    const ud = getCurrentUserData();
    if (ud?.settings?.accentColor) applyAccentColor(ud.settings.accentColor);

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
    enableNotifications(user.uid);

    listenToNotifications(user.uid); 
    await autoCheckNotifications(); 

    notificationInterval = setInterval(async () => {
        await autoCheckNotifications();
    }, 86400000);

    bindMailboxUIOnce();
    listenMailbox(user.uid);

    try {
        if (ud?.settings?.defaultTab) {
            const tabLink = document.querySelector(`a[href="${ud.settings.defaultTab}"]`);
            if (tabLink) bootstrap.Tab.getOrCreateInstance(tabLink).show();
        }
    } catch (e) {
        console.warn("Kon standaard tab niet laden:", e);
    }
});

document.querySelector('a[href="#tab-mail"]')?.addEventListener('shown.bs.tab', () => {
    bindMailboxUIOnce();
    if (currentUserId) listenMailbox(currentUserId); 
});

logoutBtn?.addEventListener('click', async ()=>{
    await signOut(auth);
    window.location.href = 'index.html'; 
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
    if (dataStore.viewUserId) return dataStore.viewUserId;
    const oldSelect = document.getElementById('adminUserSelect');
    if (oldSelect && oldSelect.value) return oldSelect.value;
    return currentUserId;
}

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

// ==========================================
// 9. TOPBAR ADMIN CONTROLS
// ==========================================
async function revealAdminIfNeeded(){
    const id = getActiveUserId();
    if(!id) return;

    const meSnap = await getDoc(doc(db,'users', id));
    if (!meSnap.exists()) return;
    const role = meSnap.data().role;
    
    if(role === 'admin'){ 
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
        
        initTopbarAdminSwitcher();
    }
}

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
                <button id="topbarSchoolBtn" class="btn btn-sm btn-outline-secondary d-flex align-items-center justify-content-center" style="width: 32px; height: 31px;" title="Schoolverlof Aan/Uit">
                    <span class="material-icons-outlined" style="font-size:18px">school</span>
                </button>
                <button id="topbarDeleteBtn" class="btn btn-sm btn-outline-danger d-flex align-items-center justify-content-center" style="width: 32px; height: 31px;" title="Gebruiker verwijderen">
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
        const users = Object.entries(dataStore.users).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
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

    const updateControlState = (uid) => {
        const adminLabel = document.getElementById('adminSettingsName');
        if (adminLabel) {
            const uName = uid ? (dataStore.users[uid]?.name || uid) : "Mijzelf";
            adminLabel.textContent = uName;
            adminLabel.className = uid ? "text-primary fw-bold" : "text-muted";
        }
        if (typeof hydrateAdminLeaveInputsFor === 'function') {
            hydrateAdminLeaveInputsFor(uid || currentUserId);
        }
        if (!uid) {
            controls.classList.add('d-none');
            return;
        }
        const u = dataStore.users[uid];
        if (!u) return;
        controls.classList.remove('d-none');
        roleSelect.value = u.role || 'user';
        const schoolEnabled = u.settings?.schoolLeaveEnabled !== false;
        schoolBtn.className = schoolEnabled ? 'btn btn-sm btn-success text-white d-flex align-items-center justify-content-center' : 'btn btn-sm btn-outline-secondary d-flex align-items-center justify-content-center';
    };

    updateControlState(select.value);

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

    roleSelect.onchange = async () => {
        const uid = select.value;
        if (!uid) return;
        try {
            await updateDoc(doc(db, 'users', uid), { role: roleSelect.value });
            dataStore.users[uid].role = roleSelect.value;
            toast(`Rol aangepast`, 'success');
        } catch (err) { console.error(err); toast('Fout bij rol', 'danger'); }
    };

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

    deleteBtn.onclick = async () => {
        const uid = select.value;
        if (!uid) return;
        if (!confirm('Weet je zeker dat je deze gebruiker wilt verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
        try {
            await deleteDoc(doc(db, 'users', uid));
            delete dataStore.users[uid]; 
            select.value = "";
            dataStore.viewUserId = null;
            updateControlState(null);
            await renderUserDataAsAdmin(currentUserId);
            refreshUserList();
            toast('Gebruiker verwijderd', 'success');
        } catch (err) {
            console.error(err);
            toast('Verwijderen mislukt', 'danger');
        }
    };
}
// ==========================================
// 10. PROJECT BEHEER
// ==========================================
function renderProjects() {
  const ud = getCurrentUserData();
  const projectTableBody = document.getElementById('projectTableBody');
  const newShiftProjectSelect = document.getElementById('newShiftProjectSelect');
  const projectFilterSelect = document.getElementById('projectFilterSelect');

  const loggedInUser = dataStore.users[currentUserId];
  const iAmAdmin = loggedInUser && loggedInUser.role === 'admin';

  const btnNew = document.querySelector('#tab-projects button[data-bs-target="#projectModal"]');
  if (btnNew) {
    if (iAmAdmin) {
        btnNew.classList.remove('d-none');
    } else {
        btnNew.classList.add('d-none');
    }
  }

  if (!projectTableBody) return;

  const list = (ud.projects || []).slice().sort((a, b) => {
    const as = a.start ? new Date(a.start) : new Date('01-01-1900');
    const bs = b.start ? new Date(b.start) : new Date('01-01-1900');
    if (as.getTime() !== bs.getTime()) return as - bs;
    const ae = a.end ? new Date(a.end) : new Date('31-12-9999');
    const be = b.end ? new Date(b.end) : new Date('31-12-9999');
    return ae - be;
  });

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
            <div><strong class="text-dark">${p.name}</strong></div>
        </div>
      </td>
      <td><span class="badge bg-light text-dark border">${toDisplayDate(p.start)}</span></td>
      <td><span class="badge bg-light text-dark border">${toDisplayDate(p.end)}</span></td>
      <td class="text-end">${actionsHtml}</td>`;
    
    projectTableBody.appendChild(tr);

    if (newShiftProjectSelect) {
      const o1 = document.createElement('option'); o1.value = p.name; o1.textContent = p.name; newShiftProjectSelect.appendChild(o1);
    }
    if (projectFilterSelect) {
      const o2 = document.createElement('option'); o2.value = p.name; o2.textContent = p.name; projectFilterSelect.appendChild(o2);
    }
  });

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
            document.querySelector('#projectModal .modal-title').textContent = "Project Bewerken";
            new bootstrap.Modal(document.getElementById('projectModal')).show();
          } 
          else if (action === 'extend') {
            const v = prompt('Nieuwe einddatum (DD-MM-YYYY):', toDisplayDate(p.end) || '');
            if (!v) return;
            p.end = fromDisplayDate(v);
            await saveUserData();
            renderProjects();
            renderProjectFilterForMonth(); 
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
}

document.getElementById('saveProjectBtn')?.addEventListener('click', async () => {
  const loggedInUser = dataStore.users[currentUserId];
  if (!loggedInUser || loggedInUser.role !== 'admin') {
      return toast('Alleen beheerders mogen projecten aanpassen.', 'danger');
  }
  
  const nameInput = document.getElementById('modalProjectName');
  const startInput = document.getElementById('modalProjectStart');
  const endInput = document.getElementById('modalProjectEnd');
  
  const name = nameInput.value.trim();
  if (!name) return toast('Vul een projectnaam in', 'warning');

  const ud = getCurrentUserData();
  ud.projects = ud.projects || [];

  if (editingProjectIndex !== null) {
    const existing = ud.projects[editingProjectIndex];
    existing.name = name;
    existing.start = startInput.value || null;
    existing.end = endInput.value || null;
    toast('Project gewijzigd', 'success');
  } else {
    ud.projects.push({
      name: name,
      start: startInput.value || null,
      end: endInput.value || null,
      allowMulti: false
    });
    toast('Project toegevoegd', 'success');
    
    const qs = await getDocs(collection(db, 'users'));
    for (const u of qs.docs) {
      if (u.id !== currentUserId) {
        if (typeof notifyProjectChange === 'function') await notifyProjectChange(u.id, 'added', name);
      }
    }
  }

  await saveUserData();
  const modalEl = document.getElementById('projectModal');
  if (modalEl) {
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
  }

  renderProjects();
  renderProjectFilterForMonth();
});

document.getElementById('projectModal')?.addEventListener('hidden.bs.modal', () => {
  const nameInput = document.getElementById('modalProjectName');
  const startInput = document.getElementById('modalProjectStart');
  const endInput = document.getElementById('modalProjectEnd');
  const multiInput = document.getElementById('modalProjectMulti');

  if(nameInput) nameInput.value = '';
  if(startInput) startInput.value = '';
  if(endInput) endInput.value = '';
  if(multiInput) multiInput.checked = false;

  editingProjectIndex = null;

  const title = document.querySelector('#projectModal .modal-title');
  if(title) title.textContent = "Nieuw Project";
});

// ==========================================
// 11. SHIFTS BEHEER & SORTEREN
// ==========================================
function renderShifts() {
  const ud = getCurrentUserData();
  const shifts = ud.shifts || {};
  
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
    tr.dataset.key = name; 
    
    const projectBadge = sh.project 
        ? `<span class="badge bg-light text-dark border">${sh.project}</span>` 
        : '<span class="text-muted small">-</span>';

    const periodText = (sh.startDate || sh.endDate) 
        ? `<small>${toDisplayDate(sh.startDate) || '...'} <span class="text-muted">t/m</span> ${toDisplayDate(sh.endDate) || '...'}</small>` 
        : '<span class="text-muted small">-</span>';

    const iconOptions = `
      <option value="light_mode" ${sh.icon === 'light_mode' ? 'selected' : ''}>☀️</option>
      <option value="wb_twilight" ${sh.icon === 'wb_twilight' ? 'selected' : ''}>🌅</option>
      <option value="bedtime" ${sh.icon === 'bedtime' ? 'selected' : ''}>🌙</option>
      <option value="schedule" ${sh.icon === 'schedule' ? 'selected' : ''}>🕒</option>
      <option value="school" ${sh.icon === 'school' ? 'selected' : ''}>🎓</option>
      <option value="medical_services" ${sh.icon === 'medical_services' ? 'selected' : ''}>🏥</option>
      <option value="flight" ${sh.icon === 'flight' ? 'selected' : ''}>✈️</option>
      <option value="bench" ${sh.icon === 'bench' ? 'selected' : ''}>🪑</option>
      <option value="feestdag" ${sh.icon === 'feestdag' ? 'selected' : ''}>🎉</option>
      <option value="teammeeting" ${sh.icon === 'teammeeting' ? 'selected' : ''}>👥</option>
      <option value="niet_ingepland" ${sh.icon === 'niet_ingepland' ? 'selected' : ''}>❌</option>
      <option value="vrij_weekend" ${sh.icon === 'vrij_weekend' ? 'selected' : ''}>😎</option>
    `;

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
      <td class="text-center">
        <select class="form-select form-select-sm shift-icon-select" data-key="${name}" style="width: 70px; margin: auto;">
          ${iconOptions}
        </select>
      </td>
      <td class="text-center">
        <div class="form-check form-switch d-flex justify-content-center">
          <input class="form-check-input shift-fav-toggle" type="checkbox" data-key="${name}" ${sh.isFavorite ? 'checked' : ''}>
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

    tr.querySelector('.shift-icon-select').onchange = async (e) => {
        const key = e.target.dataset.key;
        ud.shifts[key].icon = e.target.value;
        await saveUserData(); 
        
        const y = Number(document.getElementById('yearSelectMain')?.value);
        const m = Number(document.getElementById('monthSelectMain')?.value);
        if (y && !isNaN(m)) renderCalendarGrid(y, m);
    };

    tr.querySelector('.shift-fav-toggle').onchange = async (e) => {
        const key = e.target.dataset.key;
        ud.shifts[key].isFavorite = e.target.checked;
        await saveUserData(); 
        
        const y = Number(document.getElementById('yearSelectMain')?.value);
        const m = Number(document.getElementById('monthSelectMain')?.value);
        if (y && !isNaN(m)) renderCalendarGrid(y, m);
    };

    shiftTableBody.appendChild(tr);
  });

  initShiftSortable();
}

function initShiftSortable() {
  const el = document.getElementById('shiftTableBody');
  if (!el || el.dataset.sortableInitialized) return;
  
  if (typeof Sortable === 'undefined') return console.warn('SortableJS niet geladen');

  Sortable.create(el, {
    handle: '.handle', 
    animation: 150,
    ghostClass: 'bg-light',
    onEnd: async function () {
      const ud = getCurrentUserData();
      const newOrder = [];
      el.querySelectorAll('tr').forEach(row => {
          if (row.dataset.key) newOrder.push(row.dataset.key);
      });
      
      ud.shiftOrder = newOrder;
      
      const id = getActiveUserId();
      if(id) {
          await updateDoc(doc(db,'users',id), { shiftOrder: newOrder });
          toast('Nieuwe volgorde opgeslagen', 'success');
      }
    }
  });
  
  el.dataset.sortableInitialized = 'true';
}

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

      if (oldKey && oldKey !== uniqueKey) {
          delete ud.shifts[oldKey];
          const idx = ud.shiftOrder.indexOf(oldKey);
          if (idx !== -1) ud.shiftOrder[idx] = uniqueKey;
      }

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

filterShiftYear?.addEventListener('change', ()=> renderShifts());

function populateFilterShiftYears() {
  const ud = getCurrentUserData();
  const years = new Set();

  Object.values(ud.shifts || {}).forEach(sh => {
    if (sh.startDate) years.add(new Date(sh.startDate).getFullYear());
    if (sh.endDate) years.add(new Date(sh.endDate).getFullYear());
  });

  const sortedYears = [...years].sort((a, b) => a - b);
  const filterShiftYear = document.getElementById('filterShiftYear');
  
  if (filterShiftYear) {
      filterShiftYear.innerHTML = '<option value="">Alle jaren</option>';
      sortedYears.forEach(y => {
        const o = document.createElement('option');
        o.value = y;
        o.textContent = y;
        filterShiftYear.appendChild(o);
      });

      const currentYear = new Date().getFullYear();
      if (sortedYears.includes(currentYear)) {
        filterShiftYear.value = currentYear;
      }
      
      renderShifts();
  }
}
// ==========================================
// 12. INVOER (MAAND WEERGAVE)
// ==========================================
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
  
  await renderMonth(y,m); 
  updateInputTotals(); 
  renderHome(); 
  if(typeof renderHistory === 'function') renderHistory(); 
  if(typeof renderVersionControls === 'function') renderVersionControls();
}

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

  if(monthTargetHours) monthTargetHours.value = md.targetHours || 0;
  if(monthTargetMinutes) monthTargetMinutes.value = md.targetMinutes || 0;

  const statusNow = getMonthStatus(year, month);
  const loggedInUser = dataStore.users[currentUserId];
  const iAmAdmin = loggedInUser && loggedInUser.role === 'admin';
  const locked = !iAmAdmin && (statusNow==='approved' || statusNow==='submitted');

  const showActions = !locked && ( 
    userAllowsMultiMonth(ud, year, month) || 
    (ud.projects||[]).some(p => p.allowMulti) 
  );

  const th = document.getElementById('thActions');
  if (th) th.classList.toggle('d-none', !showActions);

  const daysInMonth = new Date(year, month+1, 0).getDate();
  for(let d=1; d<=daysInMonth; d++){
    const baseKey = dateKey(year, month, d);
    
    if (md.rows[baseKey]) {
      autoAssignProjectIfNeeded(md.rows[baseKey]);
    }

    let allKeys = listDayKeys(md, baseKey);
    if (allKeys.length === 0) {
        allKeys = [baseKey];
    }

    const visibleKeys = allKeys.filter(k => {
      const r = md.rows[k];
      if (!selectedProject) return true;
      return (r.project || '') === selectedProject;
    });

    const renderKeys = visibleKeys.length ? visibleKeys : (selectedProject ? [] : allKeys);

    for (let idx = 0; idx < renderKeys.length; idx++) {
      const rowKey = renderKeys[idx];
      let r = md.rows[rowKey];
      if (!r) {
          r = { project:'', shift:'', start:'', end:'', break:0, omschrijving:'', minutes:0 };
          autoAssignProjectIfNeeded(r);
      }

      const dayName = daysFull[new Date(year, month, d).getDay()];
      const allowByMonth   = userAllowsMultiMonth(ud, year, month);
      const allowByProject = r.project ? canAddMultiForProject(r.project) : false;
      const allowThisRow   = allowByMonth || allowByProject;

      const tr = document.createElement('tr');

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
      
      let statusIconHtml = '<span class="shift-status-icon d-none"></span>'; 
      if (r.status === 'pending') {
        statusIconHtml = '<span class="material-icons-outlined shift-status-icon status-pending" title="In aanvraag">hourglass_top</span>';
      } else if (r.status === 'approved') {
        statusIconHtml = '<span class="material-icons-outlined shift-status-icon status-approved" title="Goedgekeurd">check_circle</span>';
      } else if (r.status === 'rejected') {
        statusIconHtml = '<span class="material-icons-outlined shift-status-icon status-rejected" title="Afgekeurd">cancel</span>';
      }
      const isPendingOrRejected = r.status && r.status !== 'approved';
      const durationText = isPendingOrRejected ? '0u 0min' : `${Math.floor(r.minutes/60)}u ${r.minutes%60}min`;

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
            <span class="material-icons-outlined attachment-icon ${r.attachmentURL ? 'has-attachment' : ''}" title="Bijlage beheren" data-key="${rowKey}" data-bs-toggle="modal" data-bs-target="#attachmentModal">
                ${r.attachmentURL ? 'attach_file' : 'attachment'}
            </span>
        </td>
        <td class="dur text-mono">${durationText}</td>`; 
      tbody.appendChild(tr);

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
        if(typeof renderHistory === 'function') renderHistory();

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
        const isPendingOrRejected = r.status && r.status !== 'approved';
        tr.querySelector('.dur').textContent = isPendingOrRejected ? '0u 0min' : `${Math.floor(r.minutes/60)}u ${r.minutes%60}min`;
        updateInputTotals(); debouncedSave(); 
        if(typeof renderHistory === 'function') renderHistory();
      });
      
      tr.querySelector('.endInput').addEventListener('change', e=>{
        r.end = e.target.value; recalcRowMinutes(r);
        saveCell(year, month, rowKey, r, tr);
        const isPendingOrRejected = r.status && r.status !== 'approved';
        tr.querySelector('.dur').textContent = isPendingOrRejected ? '0u 0min' : `${Math.floor(r.minutes/60)}u ${r.minutes%60}min`;
        updateInputTotals(); debouncedSave(); 
        if(typeof renderHistory === 'function') renderHistory();
      });
      
      tr.querySelector('.breakInput').addEventListener('change', e=>{
        r.break = Number(e.target.value)||0; recalcRowMinutes(r);
        saveCell(year, month, rowKey, r, tr);
        const isPendingOrRejected = r.status && r.status !== 'approved';
        tr.querySelector('.dur').textContent = isPendingOrRejected ? '0u 0min' : `${Math.floor(r.minutes/60)}u ${r.minutes%60}min`;
        updateInputTotals(); debouncedSave(); 
        if(typeof renderHistory === 'function') renderHistory();
      });
      
      tr.querySelector('.omschrijvingInput').addEventListener('change', e=>{
        r.omschrijving = e.target.value; saveCell(year, month, rowKey, r, tr); debouncedSave(); 
        if(typeof renderHistory === 'function') renderHistory();
      });

      const addBtn = tr.querySelector('.addLineBtn');
      if (addBtn) {
        addBtn.addEventListener('click', async (e) => {
          e.preventDefault(); 
          const idxNew = nextLineIndex(md, baseKey);
          const newKey = `${baseKey}#${idxNew}`;
          md.rows[newKey] = { project: r.project, shift:'', start:'', end:'', break:0, omschrijving:'', minutes:0 };
          await saveUserData();
          renderMonth(year, month);
          updateInputTotals(); 
          if(typeof renderHistory === 'function') renderHistory();
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
          updateInputTotals(); 
          if(typeof renderHistory === 'function') renderHistory();
        });
      }
    } 
  }

  await saveUserData();
  renderCalendarGrid(year, month);
  if(typeof updateRemainingHours === 'function') updateRemainingHours();
  updateInputTotals();
  if(typeof renderProjectSummary === 'function') renderProjectSummary(); 
  if(typeof updateLeaveBadges === 'function') updateLeaveBadges(); 
  renderHome();

  const lockedNow = (!iAmAdmin && (getMonthStatus(year, month)==='approved' || getMonthStatus(year, month)==='submitted'));
  tbody.querySelectorAll('select, input').forEach(el => { el.disabled = lockedNow; });

  if (monthTargetHours) monthTargetHours.disabled = lockedNow;
  if (monthTargetMinutes) monthTargetMinutes.disabled = lockedNow;
  if (projectFilterSelect) projectFilterSelect.disabled = lockedNow;

  const excludeToggle = document.getElementById('excludeHistoryToggle');
  if (excludeToggle) {
    excludeToggle.checked = md.excludeFromHistory === true;
    excludeToggle.disabled = lockedNow; 
  }

  updateMonthStatusBadge();
}

async function populateShiftSelectForRow(tr, rowKey){
  const base = rowKey.split('#')[0];                   
  const [yStr, mStr, dStr] = base.split('-');
  const year = Number(yStr), month = Number(mStr)-1;

  const ud = getCurrentUserData();
  const md = ud.monthData?.[year]?.[month];
  const r = md?.rows?.[rowKey] || { shift: '' };

  const projSel = tr.querySelector('.projectSelect');
  const sel = tr.querySelector('.shiftSelect');
  
  if (!sel) return; 

  sel.innerHTML = '<option value=""></option>';

  const all = ud.shifts || {};
  const order = ud.shiftOrder || Object.keys(all);
  const entries = order.map(n=> [n, all[n]]).filter(([,sh])=> !!sh);

  for(const [name, sh] of entries){
    if(!isDateWithin(base, sh.startDate || null, sh.endDate || null)) continue;
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = sh.realName || name;
    if(r.shift === name) opt.selected = true;
    sel.appendChild(opt);
  }
  
  sel.addEventListener('change', async ()=>{
    const chosen = sel.value; 
    const all = ud.shifts || {};
    
    if (!chosen) {
      r.shift = ''; r.project = ''; projSel.value = '';
      delete r.status; 
      saveCell(year, month, rowKey, r, tr); 
      debouncedSave(); 
      updateInputTotals(); 
      if(typeof renderHistory === 'function') renderHistory();
      return;
    }

    r.shift = chosen; 
    debouncedSave();

    const isLeaveType = ['Verlof', 'Schoolverlof', 'Ziekte', 'Feestdag'].includes(chosen); 
    const shObj = all[chosen];
    const realName = shObj ? (shObj.realName || chosen) : chosen;
    const isRealLeaveType = ['Verlof', 'Schoolverlof', 'Ziekte', 'Feestdag'].includes(realName);

    if (isRealLeaveType) {
      const loggedInUser = dataStore.users[currentUserId];
      const iAmAdmin = loggedInUser && loggedInUser.role === 'admin';
      if (iAmAdmin) {
        r.status = 'approved';
      } else {
        r.status = 'pending';
        try {
          if(typeof notifyAdminOfPendingLeave === 'function') {
              await notifyAdminOfPendingLeave(getActiveUserId(), year, month, rowKey, r);
          }
        } catch(e) {
          console.warn("Kon admin niet live notificeren over verlof", e);
        }
      }
    } else {
      delete r.status;
    }

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
      if (shObj && shObj.project) {
        const p = (ud.projects||[]).find(px => px.name===shObj.project);
        if (p && isDateWithin(base, p.start||null, p.end||null)) {
          r.project = p.name;
        }
      }
    }

    projSel.innerHTML = '<option value="">--</option>';
    (getCurrentUserData().projects || []).forEach(p=>{
      if(isDateWithin(base, p.start || null, p.end || null)){
        const o = document.createElement('option');
        o.value = p.name; o.textContent = p.name; projSel.appendChild(o);
      }
    });
    setTimeout(()=> { projSel.value = r.project || ''; }, 50);

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
    if(typeof renderHistory === 'function') renderHistory();

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
    ud.projects.push({ name, start: "2000-01-01", end: "2099-12-31" });
    saveUserData();
    renderProjects(); 
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

  const total = Object.values(md.rows || {}).reduce((s, r) => {
    if (r.status === 'rejected') return s; 
    return s + (Number(r.minutes) || 0);
  }, 0);

  const target = (md.targetHours||0)*60 + (md.targetMinutes||0);
  
  if(typeof updateRemainingHours === 'function') updateRemainingHours();
  if (typeof updateLeaveBadges === 'function') updateLeaveBadges(); 
  if (typeof renderProjectSummary === 'function') renderProjectSummary();
}

monthTargetHours?.addEventListener('input', async ()=>{
  const y = Number(yearSelectMain.value), m = Number(monthSelectMain.value);
  const ud = getCurrentUserData();
  ud.monthData[y][m].targetHours = Number(monthTargetHours.value)||0;
  debouncedSave(); updateInputTotals(); 
  if(typeof renderHistory === 'function') renderHistory();
});

monthTargetMinutes?.addEventListener('input', async ()=>{
  const y = Number(yearSelectMain.value), m = Number(monthSelectMain.value);
  const ud = getCurrentUserData();
  ud.monthData[y][m].targetMinutes = Number(monthTargetMinutes.value)||0;
  debouncedSave(); updateInputTotals(); 
  if(typeof renderHistory === 'function') renderHistory();
});

document.getElementById('excludeHistoryToggle')?.addEventListener('change', async (e) => {
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);
  const ud = getCurrentUserData();
  ud.monthData[y] = ud.monthData[y] || {};
  ud.monthData[y][m] = ud.monthData[y][m] || { targetHours:0, targetMinutes:0, rows:{} };
  ud.monthData[y][m].excludeFromHistory = e.target.checked;
  debouncedSave();
  if(typeof renderHistory === 'function') renderHistory(); 
  toast(e.target.checked ? 'Maand telt niet meer mee in historiek' : 'Maand telt weer mee in historiek', 'info');
});

projectFilterSelect?.addEventListener('change', ()=> { 
  renderMonth(Number(yearSelectMain.value), Number(monthSelectMain.value)); 
  updateInputTotals(); 
  if(typeof renderProjectSummary === 'function') renderProjectSummary(); 
});

yearSelectMain?.addEventListener('change', async ()=> {
  renderProjectFilterForMonth();
  await generateMonth();
  if(typeof updateLeaveBadges === 'function') updateLeaveBadges();
  if(typeof renderProjectSummary === 'function') renderProjectSummary();
});

monthSelectMain?.addEventListener('change', async ()=> { 
  renderProjectFilterForMonth(); 
  generateMonth(); 
});


// ==========================================
// 13. KALENDER GRID & DAG EDITOR
// ==========================================
function renderCalendarGrid(year, month) {
  const grid = document.getElementById('monthlyCalendarGrid');
  if (!grid) return;
  grid.innerHTML = '';

  let schoolVacation = null;
  if(typeof getSchoolHolidayInfo === 'function') {
      schoolVacation = getSchoolHolidayInfo(year, month);
  }

  const holidayLabel = document.getElementById('schoolHolidayLabel');
  if (holidayLabel) {
      if (schoolVacation) {
          let text = '';
          if (schoolVacation.fullMonth) {
              text = schoolVacation.name;
          } else {
              const options = { month: 'short', day: 'numeric' };
              const s = schoolVacation.start.toLocaleDateString('nl-NL', options);
              const e = schoolVacation.end.toLocaleDateString('nl-NL', options);
              text = `${schoolVacation.name}: ${s} t/m ${e}`;
          }
          holidayLabel.innerHTML = `
            <div class="school-holiday-tag">
               <span class="material-icons-outlined" style="font-size:16px">${schoolVacation.icon}</span> ${text}
            </div>
          `;
      } else {
          holidayLabel.innerHTML = '';
      }
  }

  const ud = getCurrentUserData();
  const md = ud.monthData?.[year]?.[month] || { rows: {} };
  const allShifts = ud.shifts || {};
  const order = ud.shiftOrder || Object.keys(allShifts);
  const favorites = order
    .filter(key => allShifts[key] && allShifts[key].isFavorite)
    .map(key => ({ key, ...allShifts[key] }));

  ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].forEach(d => 
    grid.insertAdjacentHTML('beforeend', `<div class="calendar-header">${d}</div>`)
  );

  const firstDay = new Date(year, month, 1).getDay();
  const offset = (firstDay === 0) ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < offset; i++) {
      grid.insertAdjacentHTML('beforeend', '<div class="calendar-day disabled"></div>');
  }

  const todayDate = new Date();
  const isCurrentMonth = (todayDate.getFullYear() === Number(year) && todayDate.getMonth() === Number(month));
  const currentDayNum = todayDate.getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const baseKey = dateKey(year, month, d);
    const dateObj = new Date(year, month, d);
    const dayOfWeek = dateObj.getDay(); 
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    const isToday = (isCurrentMonth && d === currentDayNum);

    let isHolidayDay = false;
    if (schoolVacation && !isWeekend) {
        if (schoolVacation.fullMonth) {
            isHolidayDay = true;
        } else if (schoolVacation.start && schoolVacation.end) {
            const checkDate = new Date(dateObj).setHours(0,0,0,0);
            const checkStart = new Date(schoolVacation.start).setHours(0,0,0,0);
            const checkEnd = new Date(schoolVacation.end).setHours(0,0,0,0);
            if (checkDate >= checkStart && checkDate <= checkEnd) {
                isHolidayDay = true;
            }
        }
    }

    let dayHoliday = null;
    if(typeof getBelgianHoliday === 'function') dayHoliday = getBelgianHoliday(dateObj);
    
    let holidayHtml = '';
    if (dayHoliday) {
      holidayHtml = `<div class="holiday-badge"><span style="font-size: 1.3em;">${dayHoliday.emoji}</span> ${dayHoliday.name}</div>`;
    }

    const quickIconsHtml = favorites.map(sh => {
      if (!isDateWithin(baseKey, sh.startDate, sh.endDate)) return '';
      const ICON_MAP = {
        'light_mode': '☀️', 'wb_twilight': '🌅', 'bedtime': '🌙', 'schedule': '🕒',
        'star': '⭐', 'school': '🎓', 'medical_services': '🏥', 'flight': '✈️',
        'bench': '🪑', 'feestdag': '🎉', 'teammeeting': '👥', 'niet_ingepland': '❌',
        'vrij_weekend': '😎'
      };
      const emoji = ICON_MAP[sh.icon] || '⭐';
      const hoverText = sh.realName || sh.key;
      return `<span class="quick-icon-btn" data-shift="${sh.key}" title="${hoverText}">${emoji}</span>`;
    }).join('');

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
      
      const hoverTekst = `Van ${r.start || '00:00'} tot ${r.end || '00:00'} (Pauze: ${r.break || 0} min)`;

      shiftsHtml += `
        <div class="cal-shift-item d-flex justify-content-between align-items-center" 
             title="${hoverTekst}"
             style="background:${sh.color || '#eee'}; border-left:3px solid rgba(0,0,0,0.2); padding-right:4px; cursor: help;">
          <span style="overflow:hidden; text-overflow:ellipsis;">${sh.realName || r.shift}</span>
          <span style="font-size:1em; font-weight:bold; margin-left:6px; white-space:nowrap; color:#000;">
            ${durationText}
          </span>
        </div>`;
    });

    const realCount = dayKeys.filter(k => md.rows[k].shift).length;
    if (realCount > 3) shiftsHtml += `<div style="font-size:9px; text-align:center; color:#999;">+${realCount - 3}</div>`;

    const dayEl = document.createElement('div');
    let classes = `calendar-day ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''} d-flex flex-column`;
    if (isHolidayDay) classes += ' school-holiday-bg';
    
    dayEl.className = classes;
    if (typeof isPaintMode !== 'undefined' && isPaintMode) dayEl.style.cursor = 'cell'; 

    dayEl.innerHTML = `
      <div class="d-flex justify-content-between align-items-start p-1">
        <span class="day-number">${d}</span>
        <div class="quick-icons-wrapper">${quickIconsHtml}</div>
      </div>
      <div class="d-flex flex-column gap-1 px-1" style="overflow:hidden;">
        ${shiftsHtml}
      </div>
      ${holidayHtml} 
    `;

    dayEl.onclick = () => {
        if (typeof isPaintMode !== 'undefined' && isPaintMode && typeof applyPaintShift === 'function') {
            applyPaintShift(baseKey);
        } else {
            openDayEditor(baseKey);
        }
    };

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

async function applyShiftDirectly(dateKey, shiftKey) {
  const [y, mStr] = dateKey.split('-');
  const m = Number(mStr) - 1;
  const ud = getCurrentUserData();
  const sh = ud.shifts[shiftKey];
  
  if (!sh) return;
  ud.monthData = ud.monthData || {};
  ud.monthData[y] = ud.monthData[y] || {};
  ud.monthData[y][m] = ud.monthData[y][m] || { targetHours:0, targetMinutes:0, rows:{} };
  const md = ud.monthData[y][m];

  let targetKey = dateKey;
  if (md.rows[dateKey]) {
    targetKey = `${dateKey}_${Date.now()}`; 
  }
  const mins = minutesBetween(sh.start, sh.end, sh.break);

  md.rows[targetKey] = {
    project: sh.project || '',
    shift: shiftKey,
    start: sh.start,
    end: sh.end,
    break: sh.break,
    description: '',
    minutes: mins
  };

  renderCalendarGrid(y, m);
  updateInputTotals();
  await saveUserData();
  toast(`${sh.realName || shiftKey} toegevoegd`, 'success');
}

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
  let dayKeys = listDayKeys(md, dateKey).filter(k => md.rows[k].shift);
  
  if (dayKeys.length === 0) {
    listContainer.innerHTML = '<span class="text-muted small fst-italic">Nog geen shiften.</span>';
  } else {
    dayKeys.forEach(k => {
      const r = md.rows[k];
      const sh = ud.shifts[r.shift] || { color: '#ccc', realName: r.shift };
      
      const rowDiv = document.createElement('div');
      rowDiv.className = 'p-2 border rounded bg-light mb-2'; 
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
                <input type="time" class="form-control form-control-sm" value="${r.start || '00:00'}" onchange="updateShiftTime('${k}', 'start', this.value)">
            </div>
            <div style="flex:1;">
                <label class="form-label mb-0" style="font-size:0.75rem; color:#666;">Einde</label>
                <input type="time" class="form-control form-control-sm" value="${r.end || '00:00'}" onchange="updateShiftTime('${k}', 'end', this.value)">
            </div>
            <div style="width: 60px;">
                <label class="form-label mb-0" style="font-size:0.75rem; color:#666;">Pauze</label>
                <input type="number" class="form-control form-control-sm" value="${r.break || 0}" onchange="updateShiftTime('${k}', 'break', this.value)">
            </div>
        </div>
      `;
      listContainer.appendChild(rowDiv);
    });
  }

  const firstKey = dayKeys[0];
  const noteField = document.getElementById('dayEditorNote');
  if (noteField) noteField.value = firstKey ? (md.rows[firstKey].description || '') : '';

  const modalEl = document.getElementById('dayEditorModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

window.removeShiftFromDay = async (uniqueKey) => {
  if (!uniqueKey) return;
  const [yStr, mStr] = uniqueKey.split('-');
  const y = Number(yStr); 
  const m = Number(mStr) - 1;
  const ud = getCurrentUserData();
  
  if (ud.monthData?.[y]?.[m]?.rows?.[uniqueKey]) {
    delete ud.monthData[y][m].rows[uniqueKey];
    
    const id = getActiveUserId();
    if (id) {
       const ref = doc(db, 'users', id);
       await updateDoc(ref, {
           [`monthData.${y}.${m}.rows`]: ud.monthData[y][m].rows
       });
    }

    renderCalendarGrid(y, m);
    updateInputTotals();
    
    const popup = document.getElementById('dayEditorModal');
    if (popup && popup.classList.contains('show')) {
        openDayEditor(currentEditingDateKey);
    }
    
    toast('Shift verwijderd', 'success');
  }
};

const saveDayEditorBtn = document.getElementById('btnSaveDayEditor');
if (saveDayEditorBtn) {
  const newBtn = saveDayEditorBtn.cloneNode(true);
  saveDayEditorBtn.parentNode.replaceChild(newBtn, saveDayEditorBtn);

  newBtn.addEventListener('click', async () => {
    const dateKey = currentEditingDateKey; 
    if (!dateKey) return;

    const [yStr, mStr] = dateKey.split('-');
    const y = Number(yStr); 
    const m = Number(mStr) - 1;
    
    const ud = getCurrentUserData();
    if (!ud.monthData) ud.monthData = {};
    if (!ud.monthData[y]) ud.monthData[y] = {};
    if (!ud.monthData[y][m]) ud.monthData[y][m] = { rows: {} };

    const md = ud.monthData[y][m];
    const note = document.getElementById('dayEditorNote')?.value || '';
    const dayKeys = listDayKeys(md, dateKey);
    
    dayKeys.forEach(k => {
        const r = md.rows[k];
        if (!r.shift || r.shift.trim() === '') {
            delete md.rows[k]; 
        } else {
            r.description = note;
        }
    });

    const id = getActiveUserId();
    if (id) {
        const ref = doc(db, 'users', id);
        await updateDoc(ref, {
            [`monthData.${y}.${m}.rows`]: md.rows
        });
    }
    
    renderCalendarGrid(y, m);
    updateInputTotals();
    if(typeof renderHistory === 'function') renderHistory();
    
    const modalEl = document.getElementById('dayEditorModal');
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.hide();

    toast('Opgeslagen', 'success');
  });
}

window.updateShiftTime = async (rowKey, field, value) => {
  const [yStr, mStr] = currentEditingDateKey.split('-');
  const y = Number(yStr); 
  const m = Number(mStr) - 1;
  
  const ud = getCurrentUserData();
  const md = ud.monthData?.[y]?.[m];
  
  if (!md || !md.rows[rowKey]) return;

  const r = md.rows[rowKey];
  
  if (field === 'break') {
      r.break = Number(value) || 0;
  } else {
      r[field] = value;
  }

  if (typeof minutesBetween === 'function') {
      r.minutes = minutesBetween(r.start, r.end, r.break);
  } else {
      const [sh, sm] = (r.start||'00:00').split(':').map(Number);
      const [eh, em] = (r.end||'00:00').split(':').map(Number);
      let mins = (eh*60+em) - (sh*60+sm) - (Number(r.break)||0);
      if (mins < 0) mins += 1440; 
      r.minutes = mins;
  }

  await saveUserData();
  
  renderCalendarGrid(y, m);
  updateInputTotals();
  if(typeof renderHistory === 'function') renderHistory();
};

// ==========================================
// 14. SNELLE INVOER (QUICK INPUT)
// ==========================================
quickDate?.addEventListener('change', populateQuickShifts);
function populateQuickShifts(){
    const ud = getCurrentUserData();
    if(!quickShift) return;
    quickShift.innerHTML = '<option value="">-- Kies shift --</option>';
    const all = ud.shifts || {};
    const order = ud.shiftOrder || Object.keys(all);
    const dateStr = quickDate?.value; 
    if(!dateStr) return;
    
    const withPeriod = [], without = [];
    order.forEach(n=> { 
        const sh = all[n]; 
        if(!sh) return; 
        if(sh.startDate || sh.endDate) withPeriod.push([n,sh]); 
        else without.push([n,sh]); 
    });
    
    [...withPeriod, ...without].forEach(([n,sh])=>{
        if(!isDateWithin(dateStr, sh.startDate||null, sh.endDate||null)) return;
        const o = document.createElement('option'); o.value=n; o.textContent=n; quickShift.appendChild(o);
    });
}

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

    let key = date;
    if (ud.monthData[y][m].rows[key]) {
      key = `${date}_${Date.now()}`;
    }

    const sh = ud.shifts[shift]; 
    if (!sh) {
        console.error("Shift niet gevonden:", shift);
        return toast("Fout: Shift data niet gevonden", "danger");
    }

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
    if(typeof renderHistory === 'function') renderHistory();
    if(typeof updateRemainingHours === 'function') updateRemainingHours();

    bootstrap.Modal.getInstance(document.getElementById('quickModal')).hide();
    
    const editor = document.getElementById('dayEditorModal');
    if (editor && editor.classList.contains('show')) openDayEditor(date);

    toast('Extra shift toegevoegd', 'success');
  });
}
// ==========================================
// 15. HISTORIEK
// ==========================================
function renderHistory() {
  const viewUid = dataStore.viewUserId || dataStore.currentUser;
  if (!viewUid) return;

  const ud = dataStore.users[viewUid] || { name: '-', monthData: {} };
  const year = Number(yearSelectMain.value) || new Date().getFullYear();

  const historiekJaar = document.getElementById('historiekJaar');
  const currentUserHistoriek = document.getElementById('currentUserHistoriek');
  if (historiekJaar) historiekJaar.textContent = year;
  if (currentUserHistoriek) currentUserHistoriek.textContent = ud.name || ud.email || '—';

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

  const schoolEnabled = !!(ud?.settings?.schoolLeaveEnabled ?? true);
  const visibleCols = cols.filter(c => c.key !== 'school' || schoolEnabled);

  const table = document.getElementById('historyTable');
  if (!table) return;

  const theadHtml = `<thead class="table-light"><tr>${visibleCols.map(c => `<th>${c.title}</th>`).join('')}</tr></thead>`;
  let bodyHtml = '<tbody>';
  let totals = { target:0, planned:0, diff:0, leave:0, sick:0, school:0, holiday:0, bench:0 };

  for (let m = 0; m < 12; m++) {
    const md = ud.monthData?.[year]?.[m] || { targetHours:0, targetMinutes:0, rows:{} };
    const isExcluded = md.excludeFromHistory === true; 
    const target = (md.targetHours||0)*60 + (md.targetMinutes||0);
    const rows = md.rows || {};
    
    const planned = Object.values(rows).reduce((s, r) => {
      if (r.status && r.status !== 'approved') return s; 
      return s + (r.minutes || 0);
    }, 0);

    let leave = 0, sick = 0, school = 0, holiday = 0, bench = 0;
    
    Object.values(rows).forEach(r => {
      if (r.status === 'rejected') return;
      const sID = (r.shift || '').trim();
      if (!sID) return;

      const shiftDef = ud.shifts?.[sID];
      const realName = shiftDef ? (shiftDef.realName || sID) : sID;

      if (realName === 'Verlof') leave += Number(r.minutes)||0;
      if (realName === 'Ziekte') sick += Number(r.minutes)||0;
      if (realName === 'Schoolverlof' || realName === 'School') school += Number(r.minutes)||0;
      if (realName === 'Feestdag') holiday += Number(r.minutes)||0;
      if (realName === 'Bench') bench += Number(r.minutes)||0;
    });
    
    const diff = planned - target;

    if (!isExcluded) {
      totals.target += target; totals.planned += planned; totals.diff += diff;
      totals.leave += leave; totals.sick += sick; totals.school += school;
      totals.holiday += holiday; totals.bench += bench;
    }

    const rowMap = {
      monthLabel: isExcluded ? `${monthsFull[m]} <span class="badge bg-secondary ms-1" style="font-size:0.65rem;">Uitgesloten</span>` : monthsFull[m],
      target: isExcluded ? '-' : `${Math.floor(target/60)}u ${target%60}min`,
      planned: isExcluded ? '-' : `${Math.floor(planned/60)}u ${planned%60}min`,
      diff: isExcluded ? '-' : `${diff > 0 ? '+' : (diff < 0 ? '-' : '')}${Math.floor(Math.abs(diff)/60)}u ${Math.abs(diff)%60}min`,
      leave: isExcluded ? '-' : `${Math.floor(leave/60)}u ${leave%60}min`,
      sick: isExcluded ? '-' : `${Math.floor(sick/60)}u ${sick%60}min`,
      bench: isExcluded ? '-' : `${Math.floor(bench/60)}u ${bench%60}min`,
      school: isExcluded ? '-' : `${Math.floor(school/60)}u ${school%60}min`,
      holiday: isExcluded ? '-' : `${Math.floor(holiday/60)}u ${holiday%60}min`
    };
    
    const rowCells = visibleCols.map(c => {
      if (c.key === 'monthLabel') return `<td>${rowMap[c.key]}</td>`;
      if (c.key === 'diff') {
        let colorClass = '';
        if (!isExcluded) {
            if (diff > 0) colorClass = 'text-success'; 
            else if (diff < 0) colorClass = 'text-danger'; 
        }
        return `<td class="fw-medium ${colorClass}">${rowMap[c.key]}</td>`;
      }
      return `<td>${rowMap[c.key] || ''}</td>`;
    }).join('');
    
    bodyHtml += `<tr class="${isExcluded ? 'opacity-50' : ''}">${rowCells}</tr>`;
  }
  bodyHtml += '</tbody>';

  const footerMap = {
    target: `${Math.floor(totals.target/60)}u ${totals.target%60}min`,
    planned: `${Math.floor(totals.planned/60)}u ${totals.planned%60}min`,
    diff: `${totals.diff > 0 ? '+' : (totals.diff < 0 ? '-' : '')}${Math.floor(Math.abs(totals.diff)/60)}u ${Math.abs(totals.diff)%60}min`,
    leave: `${Math.floor(totals.leave/60)}u ${totals.leave%60}min`,
    sick: `${Math.floor(totals.sick/60)}u ${totals.sick%60}min`,
    bench: `${Math.floor(totals.bench/60)}u ${totals.bench%60}min`,
    school: `${Math.floor(totals.school/60)}u ${totals.school%60}min`,
    holiday: `${Math.floor(totals.holiday/60)}u ${totals.holiday%60}min`
  };
  
  const tfootCells = visibleCols.map(c => {
    if (c.key === 'monthLabel') return `<th>Totaal</th>`;
    if (c.key === 'diff') {
      let colorClass = '';
      if (totals.diff > 0) colorClass = 'text-success';
      else if (totals.diff < 0) colorClass = 'text-danger';
      return `<th class="${colorClass}">${footerMap[c.key]}</th>`;
    }
    return `<th>${footerMap[c.key] || ''}</th>`;
  }).join('');

  table.innerHTML = `${theadHtml}${bodyHtml}<tfoot class="table-light"><tr>${tfootCells}</tr></tfoot>`;
  const newTbody = table.querySelector('tbody');
  if (newTbody) newTbody.id = 'historyBody';
}

document.querySelector('a[href="#tab-historiek"]')?.addEventListener('shown.bs.tab', () => {
  renderHistory();
});

// ==========================================
// 16. VERLOF SALDI & BEREKENINGEN
// ==========================================
function getLeaveAllowanceMinutes() {
  const ud = getCurrentUserData();
  return Number(ud?.settings?.leaveAllowanceMinutes) || 0;
}

function getSchoolLeaveAllowanceMinutes(y, m) {
  const ud = getCurrentUserData();
  const label = getAcademicYearBounds(y, m).label; 
  const map = ud?.settings?.schoolLeaveByYear || {};
  return Number(map[label]) || 0;
}

function sumTakenMinutesFor(year, shiftNames) {
  const ud = getCurrentUserData();
  let total = 0;
  const months = ud.monthData?.[year] || {};

  Object.values(months).forEach(md => {
    if (md.status === 'rejected') return;
    Object.values(md?.rows || {}).forEach(r => {
      const sID = (r?.shift || '').trim(); 
      if (!sID) return;
      const shiftDef = ud.shifts?.[sID];
      const realName = shiftDef ? (shiftDef.realName || sID) : sID;

      if (shiftNames.includes(realName) || shiftNames.includes(sID)) {
        if (!r.status || r.status !== 'rejected') {
          total += Number(r.minutes) || 0;
        }
      }
    });
  });
  return total;
}

function sumTakenMinutesForRange(startISO, endISO, shiftNames) {
  const ud = getCurrentUserData();
  let total = 0;
  for (const months of Object.values(ud.monthData || {})) {
    for (const md of Object.values(months || {})) {
      if (md.status === 'rejected') continue;
      for (const [key, r] of Object.entries(md?.rows || {})) {
        const sID = (r?.shift || '').trim();
        if (!sID) continue;
        const shiftDef = ud.shifts?.[sID];
        const realName = shiftDef ? (shiftDef.realName || sID) : sID;

        if (shiftNames.includes(realName) || shiftNames.includes(sID)) {
          if (isDateWithin(key, startISO, endISO)) {
            if (!r.status || r.status !== 'rejected') {
              total += Number(r.minutes) || 0;
            }
          }
        }
      }
    }
  }
  return total;
}

function getAcademicYearBounds(y, m) {
  const startYear = (m >= 8) ? y : y - 1;   
  const endYear   = startYear + 1;
  const startISO  = `${startYear}-09-01`;
  const endISO    = `${endYear}-08-31`;
  return { startISO, endISO, label: `${startYear}-${endYear}` };
}

function buildSchoolYearOptions(selectEl) {
  if (!selectEl) return;
  const now = new Date();
  const yNow = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1; 
  selectEl.innerHTML = '';
  for (let y = yNow - 3; y <= yNow + 3; y++) {
    const opt = document.createElement('option');
    opt.value = `${y}-${y+1}`;
    opt.textContent = `${y}-${y+1}`;
    selectEl.appendChild(opt);
  }
}

function updateLeaveBadges() {
  const badgeLeave  = document.getElementById('leaveBalanceBadge');
  const badgeSchool = document.getElementById('schoolLeaveBalanceBadge');
  const y = Number(yearSelectMain.value);
  const m = Number(monthSelectMain.value);

  if (badgeLeave) {
    const allowance = getLeaveAllowanceMinutes(); 
    if (!allowance) {
      badgeLeave.textContent = 'Verlof saldo: — (stel in)';
      badgeLeave.className = 'badge bg-secondary-subtle text-dark ms-2';
    } else {
      const taken = sumTakenMinutesFor(y, LEAVE_SHIFT_NAMES);
      const remaining = allowance - taken;
      const over = remaining < 0;
      badgeLeave.textContent = over ? `Verlof saldo: -${fmt(Math.abs(remaining))} (overschreden)` : `Verlof saldo: ${fmt(remaining)} over`;
      badgeLeave.className = `badge ms-2 ${over ? 'bg-danger' : (remaining === 0 ? 'bg-warning text-dark' : 'bg-success')}`;
    }
  }

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
      badgeSchool.textContent = over ? `Schoolverlof saldo: -${fmt(Math.abs(remaining))} (overschreden) — ${label}` : `Schoolverlof saldo: ${fmt(remaining)} over — ${label}`;
      badgeSchool.className = `badge ms-2 ${over ? 'bg-danger' : (remaining === 0 ? 'bg-warning text-dark' : 'bg-success')}`;
    }
  }
}

function hydrateAdminLeaveInputsFor(uid) {
  const prev = dataStore.viewUserId;
  dataStore.viewUserId = uid;
  const ud = getCurrentUserData();

  const i1 = document.getElementById('adminLeaveHours');
  if (i1) i1.value = Math.floor((ud?.settings?.leaveAllowanceMinutes || 0) / 60) || '';

  const yearSel = document.getElementById('adminSchoolYearSelect');
  const schoolHoursInput = document.getElementById('adminSchoolLeaveHours');
  if (yearSel && schoolHoursInput) {
    if (!yearSel.options.length) buildSchoolYearOptions(yearSel);
    const label = yearSel.value; 
    const map = ud?.settings?.schoolLeaveByYear || {};
    const mins = Number(map[label] || 0);
    schoolHoursInput.value = mins ? Math.floor(mins / 60) : '';
  }
  dataStore.viewUserId = prev;
}

// ==========================================
// 17. PROJECT SAMENVATTING (WIDGET)
// ==========================================
function renderProjectSummary() {
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
    if (r.status && r.status !== 'approved') continue; 
    
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

// ==========================================
// 18. CONVERTER TAB
// ==========================================
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

convHours?.addEventListener('input', updateDecimal);
convMinutes?.addEventListener('input', updateDecimal);
decimalInput?.addEventListener('input', updateHM);

// ==========================================
// 19. ADMIN: GEBRUIKERS BEHEER & DASHBOARD
// ==========================================
async function renderAdminUserSelect() {
  const adminSelect = document.getElementById('adminUserSelect');
  const approvalSelect = document.getElementById('approvalUserSelect');
  if (!adminSelect && !approvalSelect) return;

  if (adminSelect) adminSelect.innerHTML = '<option value="">Laden...</option>';
  if (approvalSelect) approvalSelect.innerHTML = '<option value="">Kies gebruiker...</option>';

  let usersList = [];
  if (Object.keys(dataStore.users).length > 0) {
     usersList = Object.values(dataStore.users);
  } else {
     const qs = await getDocs(collection(db, 'users'));
     qs.forEach(d => usersList.push({id: d.id, ...d.data()}));
  }

  usersList.forEach(u => {
    const txt = `${u.name || u.email || u.id} (${u.role || 'user'})`;
    const uid = u.id || u.uid; 
    if (adminSelect) {
      const opt = document.createElement('option');
      opt.value = uid; opt.textContent = txt;
      adminSelect.appendChild(opt);
    }
    if (approvalSelect) {
      const opt = document.createElement('option');
      opt.value = uid; opt.textContent = txt;
      approvalSelect.appendChild(opt);
    }
  });

  const activeName = dataStore.users[currentUserId]?.name || '-';
  const lblAdmin = document.getElementById('activeUserLabel');
  if (lblAdmin) lblAdmin.textContent = activeName;
  const lblApprove = document.getElementById('approvalActiveUserLabel');
  if (lblApprove) lblApprove.textContent = activeName;
}

async function renderAdminDashboard() {
  const adminHomeTab = document.getElementById('tab-admin-home');
  if (!adminHomeTab) return; 

  await loadAllUsers();

  const elPending = document.getElementById('adminPendingList');
  const elBehind = document.getElementById('adminBehindList');
  const elStatPending = document.getElementById('statPendingMonths');
  const elStatSick = document.getElementById('statSickHours');
  const elStatLeave = document.getElementById('statLeaveHours');

  if (!elPending) return; 
  elPending.innerHTML = '<tr><td colspan="3">Laden...</td></tr>';
  elBehind.innerHTML = '<tr><td colspan="2">Laden...</td></tr>';
  
  let pendingCount = 0, sickMinutes = 0, leaveMinutes = 0;
  let pendingHtml = '', behindHtml = '';

  const now = new Date();
  const currentY = now.getFullYear();
  const currentM = now.getMonth(); 
  const prevDate = new Date(now.setDate(0)); 
  const prevY = prevDate.getFullYear();
  const prevM = prevDate.getMonth(); 
  
  for (const [uid, user] of Object.entries(dataStore.users)) {
    if (user.role === 'admin') continue; 
    const userName = user.name || user.email || uid;

    for (const [y, months] of Object.entries(user.monthData || {})) {
      for (const [m, data] of Object.entries(months || {})) {
        if (data.status === 'submitted') {
          pendingCount++;
          pendingHtml += `
            <tr>
              <td>${userName}</td>
              <td>${monthsFull[m]} ${y}</td>
              <td><a href="#tab-goedkeuring" data-uid="${uid}" class="btn btn-sm btn-primary js-goto-approval">Beoordelen</a></td>
            </tr>`;
        }
      }
    }

    const prevMonthStatus = user.monthData?.[prevY]?.[prevM]?.status || 'draft';
    if (prevMonthStatus === 'draft' || prevMonthStatus === 'rejected') {
      behindHtml += `
        <tr>
          <td>${userName}</td>
          <td><span class="badge ${prevMonthStatus === 'rejected' ? 'badge-rejected' : 'badge-draft'}">${prevMonthStatus}</span></td>
        </tr>`;
    }

    const monthData = user.monthData?.[currentY]?.[currentM]?.rows || {};
    for (const row of Object.values(monthData)) {
      if (row.status === 'approved' || !row.status) { 
        if (row.shift === 'Ziekte') sickMinutes += Number(row.minutes) || 0;
        if (row.shift === 'Verlof') leaveMinutes += Number(row.minutes) || 0;
      }
    }
  }

  if(elStatPending) elStatPending.textContent = pendingCount;
  if(elStatSick) elStatSick.textContent = fmt(sickMinutes);
  if(elStatLeave) elStatLeave.textContent = fmt(leaveMinutes);

  elPending.innerHTML = pendingHtml || '<tr><td colspan="3" class="text-muted">Geen maanden ter goedkeuring.</td></tr>';
  elBehind.innerHTML = behindHtml || '<tr><td colspan="2" class="text-muted">Iedereen is bij.</td></tr>';
}

document.querySelector('a[href="#tab-admin-home"]')?.addEventListener('shown.bs.tab', renderAdminDashboard);

// ==========================================
// 20. ADMIN: GOEDKEURINGEN & VERLOF
// ==========================================
async function approveMonthLogic(userToApproveId, y, m, comment) {
  const adminId = auth.currentUser.uid;
  const adminName = auth.currentUser.displayName || "Admin";
  const adminRole = dataStore.users[adminId]?.role || 'admin';

  const prev = dataStore.viewUserId;
  dataStore.viewUserId = userToApproveId; 
  await setMonthStatus(y, m, 'approved');
  dataStore.viewUserId = prev; 

  const subject = `[Planner] Goedgekeurd — ${monthsFull[m]} ${y}`;
  const body = `Je planner voor ${monthsFull[m]} ${y} werd goedgekeurd.${comment ? `\n\nReden:\n${comment}` : ''}`;
  const threadId = `plan:${userToApproveId}:${y}-${m}`;

  await addDoc(collection(db, "users", userToApproveId, "mailbox"), {
    threadId, system: true, kind: "status",
    from: { uid: adminId, name: adminName, role: adminRole },
    to: { uid: userToApproveId, type: "user" },
    subject, body, read: false, timestamp: serverTimestamp()
  });

  await addDoc(collection(db, "users", adminId, "mailbox"), {
    threadId, system: false, kind: "status",
    from: { uid: adminId, name: adminName, role: adminRole },
    to: { uid: userToApproveId, type: "user" },
    subject, body, read: true, timestamp: serverTimestamp()
  });
}

async function rejectMonthLogic(userToRejectId, y, m, comment) {
  const adminId = auth.currentUser.uid;
  const adminName = auth.currentUser.displayName || "Admin";
  const adminRole = dataStore.users[adminId]?.role || 'admin';

  const prev = dataStore.viewUserId;
  dataStore.viewUserId = userToRejectId; 
  await setMonthStatus(y, m, 'rejected');
  dataStore.viewUserId = prev; 

  const subject = `[Planner] Afgekeurd — ${monthsFull[m]} ${y}`;
  const body = `Je planner voor ${monthsFull[m]} ${y} werd afgekeurd.${comment ? `\n\nReden:\n${comment}` : ''}`;
  const threadId = `plan:${userToRejectId}:${y}-${m}`;

  await addDoc(collection(db, "users", userToRejectId, "mailbox"), {
    threadId, system: true, kind: "status",
    from: { uid: adminId, name: adminName, role: adminRole },
    to: { uid: userToRejectId, type: "user" },
    subject, body, read: false, timestamp: serverTimestamp()
  });

  await addDoc(collection(db, "users", adminId, "mailbox"), {
    threadId, system: false, kind: "status",
    from: { uid: adminId, name: adminName, role: adminRole },
    to: { uid: userToRejectId, type: "user" },
    subject, body, read: true, timestamp: serverTimestamp()
  });
}

async function reopenMonthLogic(uid, y, m) {
  const prev = dataStore.viewUserId;
  dataStore.viewUserId = uid;
  await setMonthStatus(y, m, 'draft');
  dataStore.viewUserId = prev;
}

async function renderApprovalOverview(uid, year) {
  if (!approvalYearlyOverview) return;
  approvalYearlyOverview.innerHTML = ''; 

  const prev = dataStore.viewUserId;
  dataStore.viewUserId = uid;

  if (!dataStore.users[uid]) {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) dataStore.users[uid] = snap.data();
    else {
      approvalYearlyOverview.innerHTML = '<div class="col-12"><div class="alert alert-danger">Kon gebruiker niet laden.</div></div>';
      dataStore.viewUserId = prev;
      return;
    }
  }

  for (let m = 0; m < 12; m++) {
    const status = getMonthStatus(year, m);
    const monthName = monthsFull[m];
    
    let statusText = 'Concept', statusClass = 'badge-draft'; 
    if (status === 'submitted') { statusText = 'Ingediend'; statusClass = 'badge-submitted'; }
    if (status === 'approved') { statusText = 'Goedgekeurd'; statusClass = 'badge-approved'; }
    if (status === 'rejected') { statusText = 'Afgekeurd'; statusClass = 'badge-rejected'; }

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
            <button class="btn btn-success btn-sm" data-action="approve" data-uid="${uid}" data-y="${year}" data-m="${m}" ${canApprove ? '' : 'disabled'}>Goedkeuren</button>
            <button class="btn btn-danger btn-sm" data-action="reject" data-uid="${uid}" data-y="${year}" data-m="${m}" ${canReject ? '' : 'disabled'}>Afkeuren</button>
            <button class="btn btn-outline-secondary btn-sm" data-action="reopen" data-uid="${uid}" data-y="${year}" data-m="${m}" ${canReopen ? '' : 'disabled'}>Heropenen (Draft)</button>
          </div>
        </div>
      </div>
    `;
    approvalYearlyOverview.appendChild(card);
  }
  dataStore.viewUserId = prev;
}

approvalUserSelect?.addEventListener('change', async () => {
  const uid = approvalUserSelect.value;
  const year = Number(approvalYearSelect.value);

  if (!uid) {
    approvalYearlyOverview.innerHTML = '<div class="col-12"><div class="alert alert-info">Selecteer een gebruiker om het jaaroverzicht te zien.</div></div>';
    approvalActiveUserLabel.textContent = '-';
    return;
  }
  if (!dataStore.users[uid]) {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) dataStore.users[uid] = snap.data();
  }
  const u = dataStore.users[uid] || { name: 'Onbekend' };
  approvalActiveUserLabel.textContent = u.name || u.email || uid;
  renderApprovalOverview(uid, year);
});

approvalYearlyOverview?.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const uid = btn.dataset.uid;
  const y = Number(btn.dataset.y);
  const m = Number(btn.dataset.m);
  const year = Number(approvalYearSelect.value);
  if (!uid) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';

  try {
    if (action === 'approve') {
      const comment = prompt('Commentaar voor de gebruiker (optioneel):', '');
      await approveMonthLogic(uid, y, m, comment);
      toast(`Goedgekeurd: ${monthsFull[m]} ${y}`, 'success');
    } else if (action === 'reject') {
      const comment = prompt('Reden voor afkeuring (optioneel):', '');
      await rejectMonthLogic(uid, y, m, comment);
      toast(`Afgekeurd: ${monthsFull[m]} ${y}`, 'warning');
    } else if (action === 'reopen') {
      await reopenMonthLogic(uid, y, m);
      toast(`Heropend: ${monthsFull[m]} ${y}`, 'info');
    }
    await renderApprovalOverview(uid, year);
  } catch (err) {
    console.error(`Fout bij actie ${action}:`, err);
    toast('Er ging iets mis', 'danger');
    await renderApprovalOverview(uid, year);
  }
});

// Verlofbeheer Tabel (Admin)
async function loadAndRenderLeaveRequests() {
  if (!leaveRequestTableBody) return;
  leaveRequestTableBody.innerHTML = '<tr><td colspan="5">Laden...</td></tr>';

  const requests = [];
  for (const [uid, user] of Object.entries(dataStore.users)) {
    if (!user.monthData) continue;
    for (const [year, months] of Object.entries(user.monthData)) {
      for (const [month, monthData] of Object.entries(months)) {
        for (const [rowKey, row] of Object.entries(monthData.rows || {})) {
          if (row.status === 'pending') {
            requests.push({
              uid: uid, userName: user.name || user.email || uid,
              year: Number(year), month: Number(month), rowKey: rowKey,
              shift: row.shift, note: row.omschrijving || '-', data: row
            });
          }
        }
      }
    }
  }

  requests.sort((a, b) => b.rowKey.localeCompare(a.rowKey));

  if (requests.length === 0) {
    leaveRequestTableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Geen openstaande aanvragen gevonden.</td></tr>';
    return;
  }

  leaveRequestTableBody.innerHTML = requests.map(req => `
    <tr>
      <td>${req.userName}</td>
      <td><span class="badge ${req.shift === 'Ziekte' ? 'bg-warning text-dark' : 'bg-info'}">${req.shift}</span></td>
      <td>${req.rowKey.split('-').reverse().join('-')}</td>
      <td>${req.note}</td>
      <td class="text-center">
        ${req.data.attachmentURL ? `<a href="${req.data.attachmentURL}" target="_blank" class="btn btn-sm btn-outline-secondary" title="${req.data.attachmentName || 'Bekijk'}"><span class="material-icons-outlined" style="font-size:16px">attach_file</span></a>` : '<span>-</span>'}
      </td>
      <td class="text-end">
        <button class="btn btn-sm btn-success me-1" data-action="approve" data-uid="${req.uid}" data-year="${req.year}" data-month="${req.month}" data-key="${req.rowKey}">Goedkeuren</button>
        <button class="btn btn-sm btn-danger" data-action="reject" data-uid="${req.uid}" data-year="${req.year}" data-month="${req.month}" data-key="${req.rowKey}">Afkeuren</button>
      </td>
    </tr>
  `).join('');
}

document.querySelector('a[href="#tab-verlofbeheer"]')?.addEventListener('shown.bs.tab', async () => { 
  toast('Verlof-aanvragen laden...', 'info');
  await loadAllUsers(); 
  loadAndRenderLeaveRequests();
});

refreshLeaveRequestsBtn?.addEventListener('click', async () => { 
  toast('Verlof-aanvragen herladen...', 'info');
  await loadAllUsers(); 
  loadAndRenderLeaveRequests();
});

leaveRequestTableBody?.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action; 
  const newStatus = (action === 'approve') ? 'approved' : 'rejected';
  const { uid, year, month, key } = btn.dataset;

  if (!uid || !year || !month || !key) return toast('Kon aanvraag niet vinden', 'danger');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span>';

  try {
    const row = dataStore.users[uid]?.monthData?.[year]?.[month]?.rows?.[key];
    if (!row) throw new Error('Rij niet gevonden in dataStore');
    
    row.status = newStatus;
    const userRef = doc(db, 'users', uid);
    await setDoc(userRef, dataStore.users[uid], { merge: true });
    
    if (typeof notifyUserOfLeaveStatus === 'function') {
        await notifyUserOfLeaveStatus(uid, row, key, newStatus);
    }
    
    await loadAndRenderLeaveRequests();
    toast(`Aanvraag ${newStatus}`, 'success');

    if (getActiveUserId() === uid && Number(yearSelectMain.value) === Number(year) && Number(monthSelectMain.value) === Number(month)) {
      await renderMonth(Number(year), Number(month));
    }
  } catch (err) {
    console.error(`Fout bij ${action}:`, err);
    toast('Er ging iets mis', 'danger');
    await loadAndRenderLeaveRequests();
  }
});
