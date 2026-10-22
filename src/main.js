import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, collection, addDoc, getDocs, getDoc, query, orderBy, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ======= Firebase Config =======
console.log("Nyckel-test:", import.meta.env.VITE_FIREBASE_API_KEY);
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: "team-management-dbd94.firebaseapp.com",
    projectId: "team-management-dbd94",
    storageBucket: "team-management-dbd94.firebasestorage.app",
    messagingSenderId: "188366286791",
    appId: "1:188366286791:web:57544d4c0d51aa4138f3e2",
    measurementId: "G-E9VLQL10C3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ======= Inställningar =======
const availableRoles = ['ScrumMaster', 'PO', 'Frontendutvecklare', 'Backendutvecklare', 'Apputvecklare', 'Krav', 'Test', 'UX'];
const roleColors = {
    'ScrumMaster': '#8a0303', 'PO': '#701a75', 'Frontendutvecklare': '#1e3a8a',
    'Backendutvecklare': '#3b82f6', 'Apputvecklare': '#bfdbfe', 'Krav': '#b8860b',
    'Test': '#3cb44b', 'UX': '#ff69b4'
};
const palette = ["#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
let paletteIndex = 0;

let usedTeams = new Set();
let activeRoleFilters = new Set();
let activeTeamFilters = new Set();
let unsubscribeLive = null;
let currentEditingMemberId = null;
let currentUid = null;
let boardReady = false;
let legacyMigration = null;

const LEGACY_BOARD_EMAIL = 'webb@app.syd';

function boardRef(uid = currentUid) {
    return doc(db, 'users', uid, 'boards', 'live');
}

function snapshotsRef(uid = currentUid) {
    return collection(db, 'users', uid, 'snapshots');
}

function stopLiveSync() {
    if (unsubscribeLive) {
        unsubscribeLive();
        unsubscribeLive = null;
    }
    boardReady = false;
}

function clearBoardView() {
    const container = document.getElementById('teams');
    if (container) container.innerHTML = '';
    usedTeams.clear();
    activeRoleFilters.clear();
    activeTeamFilters.clear();
    currentEditingMemberId = null;
    updateTeamSelect();
    updateLegend();
}

// ======= Start =======
window.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, (user) => {
        document.getElementById('loginOverlay').style.display = user ? 'none' : 'flex';
        document.getElementById('appContainer').style.display = user ? 'block' : 'none';
        document.getElementById('snapshotsOverlay').style.display = 'none';
        document.getElementById('editMemberOverlay').style.display = 'none';
        document.getElementById('loginError').style.display = 'none';
        document.getElementById('currentUserLabel').textContent = user?.email || '';
        if (!user) setLoginMode('signin');

        stopLiveSync();
        clearBoardView();
        currentUid = user ? user.uid : null;
        if (user) startLiveSync(user.uid, user.email);
    });
    renderRoleCheckboxes('roleCheckboxContainer');
    setupEventListeners();
});

let loginMode = 'signin';

function setLoginMode(mode) {
    loginMode = mode;
    const creating = mode === 'signup';
    document.getElementById('loginTitle').textContent = creating ? 'Skapa konto' : 'Logga in';
    document.getElementById('loginSubtitle').textContent = creating
        ? 'Kontot får en egen tom tavla.'
        : 'Varje konto har en egen tavla.';
    const confirmPassword = document.getElementById('loginPasswordConfirm');
    confirmPassword.style.display = creating ? 'block' : 'none';
    if (!creating) confirmPassword.value = '';
    document.getElementById('loginPassword').autocomplete = creating ? 'new-password' : 'current-password';
    document.getElementById('loginBtn').textContent = creating ? 'Skapa konto' : 'Logga in';
    document.getElementById('loginModeBtn').textContent = creating ? 'Har du redan ett konto? Logga in' : 'Skapa konto';
    document.getElementById('loginError').style.display = 'none';
}

function showLoginError(message) {
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
}

function authErrorMessage(error, creating) {
    switch (error?.code) {
        case 'auth/email-already-in-use':
            return 'Det finns redan ett konto med den e-postadressen.';
        case 'auth/invalid-email':
            return 'Ogiltig e-postadress.';
        case 'auth/weak-password':
            return 'Lösenordet måste vara minst 6 tecken.';
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
            return 'Fel e-post eller lösenord.';
        case 'auth/too-many-requests':
            return 'För många försök. Vänta en stund och prova igen.';
        default:
            return creating ? 'Kunde inte skapa kontot.' : 'Fel inloggning.';
    }
}

function submitLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    document.getElementById('loginError').style.display = 'none';
    if (!email || !password) {
        showLoginError('Fyll i e-post och lösenord.');
        return;
    }

    if (loginMode === 'signup') {
        const confirmPassword = document.getElementById('loginPasswordConfirm').value;
        if (password !== confirmPassword) {
            showLoginError('Lösenorden matchar inte.');
            return;
        }
        createUserWithEmailAndPassword(auth, email, password)
            .catch((error) => showLoginError(authErrorMessage(error, true)));
        return;
    }

    signInWithEmailAndPassword(auth, email, password)
        .catch((error) => showLoginError(authErrorMessage(error, false)));
}

function setupEventListeners() {
    document.getElementById('loginBtn').onclick = submitLogin;
    document.getElementById('loginModeBtn').onclick = () => setLoginMode(loginMode === 'signin' ? 'signup' : 'signin');
    ['loginEmail', 'loginPassword', 'loginPasswordConfirm'].forEach((id) => {
        document.getElementById(id).addEventListener('keydown', (event) => {
            if (event.key === 'Enter') submitLogin();
        });
    });
    document.getElementById('logoutBtn').onclick = () => signOut(auth);
    document.getElementById('snapshotBtn').onclick = loadSnaps;
    document.getElementById('closeSnapshotsBtn').onclick = () => document.getElementById('snapshotsOverlay').style.display = 'none';
    document.getElementById('saveSnapshotBtn').onclick = saveSnap;
    document.getElementById('exportCsvBtn').onclick = exportCSV;
    document.getElementById('importCsvBtn').onclick = () => document.getElementById('csvFileInput').click();
    document.getElementById('csvFileInput').onchange = importCSV;
    document.getElementById('addBtn').onclick = handleAddMember;
    document.getElementById('sortTeamsBtn').onclick = sortTeams;
    document.getElementById('clearRoleFilter').onclick = () => { activeRoleFilters.clear(); applyFilters(); updateLegend(); };
    document.getElementById('clearTeamFilter').onclick = () => { activeTeamFilters.clear(); applyFilters(); updateLegend(); };
    document.getElementById('editCancelBtn').onclick = () => document.getElementById('editMemberOverlay').style.display = 'none';
    document.getElementById('editSaveBtn').onclick = handleEditSave;
}

// ======= Säker Logik för Roller & Färger =======
function canonicalRole(r) {
    if (!r) return 'Okänd';
    const l = r.toString().toLowerCase().trim();
    if (l === 'scrummaster' || l === 'scm') return 'ScrumMaster';
    if (l === 'po') return 'PO';
    // Returnera med stor begynnelsebokstav
    return r.charAt(0).toUpperCase() + r.slice(1);
}

function getColor(role) {
    const cRole = canonicalRole(role);
    if (roleColors[cRole]) return roleColors[cRole];
    // Om rollen inte finns i fasta färger, ge den en färg från paletten
    roleColors[cRole] = palette[paletteIndex++ % palette.length];
    return roleColors[cRole];
}

function getMemberBackground(roles) {
    if (!roles || (Array.isArray(roles) && roles.length === 0)) return '#ccc';
    
    // Hantera om roles råkar vara en sträng (gammalt format)
    const rolesArray = Array.isArray(roles) ? roles : [roles];
    
    if (rolesArray.length === 1) return getColor(rolesArray[0]);
    
    const step = 100 / rolesArray.length;
    const stops = rolesArray.map((role, i) => {
        const color = getColor(role);
        return `${color} ${i * step}%, ${color} ${(i + 1) * step}%`;
    });
    return `linear-gradient(90deg, ${stops.join(', ')})`;
}

// ======= Firebase Sync =======
function isStarterBoard(data) {
    const teams = data?.teams || [];
    const members = data?.members || [];
    if (members.length > 0) return false;
    const starter = ['Team 1', 'Oplacerade'];
    return teams.length === starter.length && teams.every((team, index) => team === starter[index]);
}

function migrateLegacyBoard(uid) {
    if (!legacyMigration) {
        legacyMigration = copyLegacyBoard(uid).catch((error) => {
            legacyMigration = null;
            console.error('Kunde inte flytta den gamla tavlan', error);
            return false;
        });
    }
    return legacyMigration;
}

async function copyLegacyBoard(uid) {
    const metaRef = doc(db, 'users', uid, 'meta', 'legacy');
    if ((await getDoc(metaRef)).exists()) return false;

    const legacy = await getDoc(doc(db, 'boards', 'live'));
    const hasContent = legacy.exists() && !isStarterBoard(legacy.data());
    if (hasContent) await setDoc(boardRef(uid), legacy.data());

    const existingSnaps = await getDocs(snapshotsRef(uid));
    if (existingSnaps.empty) {
        const legacySnaps = await getDocs(collection(db, 'snapshots'));
        for (const snap of legacySnaps.docs) {
            await addDoc(snapshotsRef(uid), snap.data());
        }
    }

    await setDoc(metaRef, { migratedAt: serverTimestamp() });
    return hasContent;
}

function startLiveSync(uid, email) {
    unsubscribeLive = onSnapshot(boardRef(uid), async (snap) => {
        if (currentUid !== uid) return;
        if (snap.metadata.hasPendingWrites) return;

        const data = snap.exists() ? snap.data() : null;
        const ownsLegacyBoard = (email || '').toLowerCase() === LEGACY_BOARD_EMAIL;
        if (ownsLegacyBoard && (!data || isStarterBoard(data))) {
            const migrated = await migrateLegacyBoard(uid);
            if (currentUid !== uid) return;
            if (migrated) return;
        }

        if (snap.exists()) {
            render(data);
            boardReady = true;
        } else {
            setDoc(boardRef(uid), { teams: ["Team 1", "Oplacerade"], members: [] });
        }
    });
}

function triggerSave() {
    if (!currentUid || !boardReady) return;
    const teams = Array.from(document.querySelectorAll('.team')).map(t => t.dataset.name);
    const members = Array.from(document.querySelectorAll('.member')).map(m => {
        let roles;
        try {
            roles = JSON.parse(m.dataset.roles);
        } catch(e) {
            roles = [m.dataset.roles || 'Okänd'];
        }
        return {
            id: m.id, 
            name: m.dataset.name, 
            roles: roles, 
            type: m.dataset.type, 
            team: m.closest('.team').dataset.name
        };
    });
    setDoc(boardRef(), { teams, members });
}

// ======= Rendering =======
function render(data) {
    const container = document.getElementById('teams');
    container.innerHTML = '';
    usedTeams.clear();

    // 1. Skapa Team
    (data.teams || []).forEach(t => createTeamUI(t));
    
    // 2. Skapa Medlemmar (Hanterar både 'roles' och gamla 'role')
    (data.members || []).forEach(m => {
        const memberRoles = m.roles || (m.role ? [m.role] : ['Okänd']);
        addMemberUI(m.name, memberRoles, m.type, m.team, m.id);
    });

    updateTeamSelect();
    applyFilters();
    updateLegend();
}

function renderRoleCheckboxes(containerId, selectedRoles = []) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = availableRoles.map(role => `
        <label class="checkbox-item">
            <input type="checkbox" value="${role}" ${selectedRoles.includes(role) ? 'checked' : ''}> ${role}
        </label>
    `).join('');
}

function addMemberUI(name, roles, type, team, fid) {
    if (!usedTeams.has(team)) createTeamUI(team);
    
    const rolesArray = Array.isArray(roles) ? roles : [roles];
    const m = document.createElement('div');
    m.className = 'member'; 
    m.id = fid || 'm-' + Math.random().toString(36).substr(2, 9);
    m.draggable = true;
    m.dataset.name = name; 
    m.dataset.roles = JSON.stringify(rolesArray);
    m.dataset.type = type;
    
    m.style.background = getMemberBackground(rolesArray);
    if (type === 'konsult') m.classList.add('konsult');
    
    // Vit text om bakgrunden är mörk (förutom PO/Apputvecklare i vissa kombon)
    const isLightText = rolesArray.length === 1 && (rolesArray[0] === 'Apputvecklare');
    if (isLightText) m.classList.add('light-text');

    m.innerHTML = `<span>${name}</span><button class="icon-btn del-m">✖</button>`;
    
    // Dubbelklick för att redigera
    m.ondblclick = () => {
        currentEditingMemberId = m.id;
        document.getElementById('editName').value = name;
        document.getElementById('editType').value = type;
        renderRoleCheckboxes('editRoleContainer', rolesArray);
        document.getElementById('editMemberOverlay').style.display = 'flex';
    };

    m.querySelector('.del-m').onclick = (e) => { e.stopPropagation(); m.remove(); triggerSave(); };
    m.addEventListener('dragstart', e => e.dataTransfer.setData('text/member-id', m.id));
    
    const target = document.querySelector(`.team[data-name="${team}"] .member-list`);
    if (target) { target.appendChild(m); sortMembersInTeam(target.closest('.team')); }
}

function handleEditSave() {
    const m = document.getElementById(currentEditingMemberId);
    if (m) {
        const newRoles = Array.from(document.querySelectorAll('#editRoleContainer input:checked')).map(i => i.value);
        const newName = document.getElementById('editName').value;
        const newType = document.getElementById('editType').value;

        m.dataset.name = newName;
        m.dataset.roles = JSON.stringify(newRoles);
        m.dataset.type = newType;
        m.querySelector('span').innerText = newName;
        m.style.background = getMemberBackground(newRoles);
        m.classList.toggle('konsult', newType === 'konsult');
        
        document.getElementById('editMemberOverlay').style.display = 'none';
        triggerSave();
    }
}

function createTeamUI(name) {
    if (usedTeams.has(name)) return;
    usedTeams.add(name);
    const t = document.createElement('div');
    t.className = 'team'; t.dataset.name = name;
    t.innerHTML = `<div class="team-header"><h3>${name}</h3><button class="icon-btn del-t">✖</button></div><div class="member-list"></div>`;
    t.querySelector('.del-t').onclick = () => { 
        if(confirm(`Ta bort teamet ${name}?`)) {
            t.remove(); usedTeams.delete(name); triggerSave(); 
        }
    };
    t.addEventListener('dragover', e => e.preventDefault());
    t.addEventListener('drop', e => {
        const mid = e.dataTransfer.getData('text/member-id');
        if (mid) { t.querySelector('.member-list').appendChild(document.getElementById(mid)); sortMembersInTeam(t); triggerSave(); }
    });
    document.getElementById('teams').appendChild(t);
}

function handleAddMember() {
    const n = document.getElementById('manualName').value.trim();
    const selectedRoles = Array.from(document.querySelectorAll('#roleCheckboxContainer input:checked')).map(i => i.value);
    const t = document.getElementById('manualTeam').value;
    
    if (n && selectedRoles.length > 0 && t) { 
        addMemberUI(n, selectedRoles, document.getElementById('manualType').value, t); 
        triggerSave(); 
        document.getElementById('manualName').value = '';
        document.querySelectorAll('#roleCheckboxContainer input').forEach(i => i.checked = false);
    } else {
        alert("Fyll i namn och välj minst en roll.");
    }
}

function sortMembersInTeam(teamEl) {
    const list = teamEl.querySelector('.member-list');
    const order = ['ScrumMaster', 'PO', 'Frontendutvecklare', 'Backendutvecklare', 'Apputvecklare', 'Krav', 'Test', 'UX'];
    const members = Array.from(list.querySelectorAll('.member')).sort((a, b) => {
        const rolesA = JSON.parse(a.dataset.roles);
        const rolesB = JSON.parse(b.dataset.roles);
        const p = order.indexOf(canonicalRole(rolesA[0])) - order.indexOf(canonicalRole(rolesB[0]));
        return p !== 0 ? p : a.dataset.name.localeCompare(b.dataset.name);
    });
    members.forEach(m => list.appendChild(m));
}

function applyFilters() {
    document.querySelectorAll('.team').forEach(t => {
        const tMatch = activeTeamFilters.size === 0 || activeTeamFilters.has(t.dataset.name);
        let visibleInTeam = 0;
        
        t.querySelectorAll('.member').forEach(m => {
            let mRoles = [];
            try {
                // Vi lägger till ett skydd ifall dataset.roles är tomt eller trasigt [cite: 2026-02-03]
                mRoles = JSON.parse(m.dataset.roles || '[]');
            } catch(e) {
                console.warn("Kunde inte tolka roller för:", m.innerText, e); 
            }
            
            const rMatch = activeRoleFilters.size === 0 || mRoles.some(r => activeRoleFilters.has(canonicalRole(r)));
            
            // Här läggs klassen till som ska dölja elementet [cite: 2026-02-03]
            m.classList.toggle('hidden-by-filter', !(tMatch && rMatch));
            
            if (tMatch && rMatch) visibleInTeam++;
        });
        
        t.classList.toggle('hidden-team', !tMatch || (activeRoleFilters.size > 0 && visibleInTeam === 0));
    });
}

function updateLegend() {
    const rolesCount = {};
    document.querySelectorAll('.member').forEach(m => {
        try {
            JSON.parse(m.dataset.roles).forEach(r => {
                const cr = canonicalRole(r);
                rolesCount[cr] = (rolesCount[cr] || 0) + 1;
            });
        } catch(e) {}
    });
    
    const roleFiltersEl = document.getElementById('roleFilters');
    if (roleFiltersEl) {
        roleFiltersEl.innerHTML = Object.keys(rolesCount).map(r => `
            <label class="legend-item">
                <input type="checkbox" ${activeRoleFilters.has(r) ? 'checked' : ''} onchange="window.toggleRoleFilter('${r}')">
                <div class="swatch" style="background:${getColor(r)}"></div>
                <span>${r} (${rolesCount[r]})</span>
            </label>`).join('');
    }

    const teamFiltersEl = document.getElementById('teamFilters');
    if (teamFiltersEl) {
        teamFiltersEl.innerHTML = Array.from(usedTeams).sort().map(t => `
            <label class="legend-item">
                <input type="checkbox" ${activeTeamFilters.has(t) ? 'checked' : ''} onchange="window.toggleTeamFilter('${t}')">
                <span>${t}</span>
            </label>`).join('');
    }
    
    document.getElementById('legendTotal').innerText = `Totalt: ${document.querySelectorAll('.member').length} personer`;
}

window.toggleRoleFilter = (r) => { if(activeRoleFilters.has(r)) activeRoleFilters.delete(r); else activeRoleFilters.add(r); applyFilters(); updateLegend(); };
window.toggleTeamFilter = (t) => { if(activeTeamFilters.has(t)) activeTeamFilters.delete(t); else activeTeamFilters.add(t); applyFilters(); updateLegend(); };

function updateTeamSelect() {
    const s = document.getElementById('manualTeam');
    if (!s) return;
    const current = s.value;
    s.innerHTML = Array.from(usedTeams).sort().map(t => `<option value="${t}">${t}</option>`).join('') + '<option value="__new__">+ Nytt...</option>';
    if (current && usedTeams.has(current)) s.value = current;
}

function sortTeams() {
    const teams = Array.from(document.querySelectorAll('.team')).sort((a,b) => a.dataset.name.localeCompare(b.dataset.name));
    teams.forEach(t => document.getElementById('teams').appendChild(t));
    triggerSave();
}

// ======= Snapshot & CSV =======
async function saveSnap() {
    const uid = currentUid;
    if (!uid || !boardReady) return;
    const name = document.getElementById('newSnapshotName').value;
    if(!name) return;
    const teams = Array.from(document.querySelectorAll('.team')).map(t => t.dataset.name);
    const members = Array.from(document.querySelectorAll('.member')).map(m => ({
        id: m.id, name: m.dataset.name, roles: JSON.parse(m.dataset.roles), type: m.dataset.type, team: m.closest('.team').dataset.name
    }));
    await addDoc(snapshotsRef(uid), { name, boardData: { teams, members }, createdAt: serverTimestamp() });
    if (currentUid !== uid) return;
    document.getElementById('newSnapshotName').value = '';
    loadSnaps();
}

async function loadSnaps() {
    const uid = currentUid;
    document.getElementById('snapshotsOverlay').style.display = 'flex';
    const list = document.getElementById('snapshotList');
    if (!uid) {
        list.innerHTML = 'Inga snapshots.';
        return;
    }
    list.innerHTML = 'Laddar...';
    const snaps = await getDocs(query(snapshotsRef(uid), orderBy("createdAt", "desc")));
    if (currentUid !== uid) return;
    list.innerHTML = snaps.empty ? 'Inga snapshots.' : '';
    snaps.forEach(d => {
        const s = d.data();
        const div = document.createElement('div');
        div.style = "display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid #eee; align-items:center;";
        div.innerHTML = `<span>${s.name}</span><div style="display:flex; gap:4px;"><button class="secondary" onclick="window.activateSnap('${d.id}')">Ladda</button><button class="icon-btn" onclick="window.delSnap('${d.id}')">✖</button></div>`;
        list.appendChild(div);
    });
}

window.activateSnap = async (id) => {
    const uid = currentUid;
    if (!uid) return;
    const snaps = await getDocs(snapshotsRef(uid));
    if (currentUid !== uid) return;
    const s = snaps.docs.find(d => d.id === id);
    if(s) { 
        if(confirm(`Vill du ladda "${s.data().name}"? Detta skriver över nuvarande vy.`)) {
            if (currentUid !== uid) return;
            setDoc(boardRef(uid), s.data().boardData); 
            document.getElementById('snapshotsOverlay').style.display = 'none'; 
        }
    }
};

window.delSnap = async (id) => {
    const uid = currentUid;
    if (!uid) return;
    if (confirm("Radera denna snapshot?")) {
        await deleteDoc(doc(db, "users", uid, "snapshots", id));
        if (currentUid === uid) loadSnaps();
    }
};

function exportCSV() {
    const members = Array.from(document.querySelectorAll('.member')).map(m => 
        `"${m.dataset.name}";"${JSON.parse(m.dataset.roles).join(', ')}";"${m.dataset.type}";"${m.closest('.team').dataset.name}"`
    );
    const csv = "Namn;Roll;Typ;Team\n" + members.join("\n");
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: 'text/csv' }));
    a.download = `teams-export.csv`; a.click();
}

function importCSV(e) {
    const uid = currentUid;
    const f = e.target.files[0];
    const r = new FileReader();
    r.onload = async (ev) => {
        if (!uid || currentUid !== uid) return;
        const lines = ev.target.result.split(/\r?\n/).slice(1);
        const members = lines.filter(l => l.trim()).map(l => {
            const p = l.split(/[;,]/).map(s => s.trim().replace(/"/g, ''));
            const roles = p[1] ? p[1].split(',').map(role => role.trim()) : ['Okänd'];
            return { id: 'im-'+Math.random().toString(36).substr(2,5), name: p[0], roles, type: p[2]||'anställd', team: p[3]||'Oplacerade' };
        });
        const teams = [...new Set(members.map(m => m.team))];
        await addDoc(snapshotsRef(uid), { name: 'Import: ' + f.name, boardData: { teams, members }, createdAt: serverTimestamp() });
        if (currentUid === uid) loadSnaps();
    };
    r.readAsText(f);
    e.target.value = '';
}
