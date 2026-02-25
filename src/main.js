import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, collection, addDoc, getDocs, query, orderBy, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ======= Firebase Config =======
const firebaseConfig = {
    apiKey: "AIzaSyDFmHUwnl_tPRcUPS3bsOgYyo-mhBA1WbA",
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

// ======= Start =======
window.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, (user) => {
        document.getElementById('loginOverlay').style.display = user ? 'none' : 'flex';
        document.getElementById('appContainer').style.display = user ? 'block' : 'none';
        if (user) startLiveSync();
    });
    renderRoleCheckboxes('roleCheckboxContainer');
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('loginBtn').onclick = () => {
        signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value, document.getElementById('loginPassword').value)
            .catch(() => document.getElementById('loginError').style.display = 'block');
    };
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
function startLiveSync() {
    unsubscribeLive = onSnapshot(doc(db, 'boards', 'live'), (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        if (snap.exists()) render(snap.data());
        else setDoc(doc(db, 'boards', 'live'), { teams: ["Team 1", "Oplacerade"], members: [] });
    });
}

function triggerSave() {
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
    setDoc(doc(db, 'boards', 'live'), { teams, members });
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
            const mRoles = JSON.parse(m.dataset.roles);
            const rMatch = activeRoleFilters.size === 0 || mRoles.some(r => activeRoleFilters.has(canonicalRole(r)));
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
            <div class="legend-item" onclick="window.toggleRoleFilter('${r}')">
                <input type="checkbox" ${activeRoleFilters.has(r) ? 'checked' : ''} onclick="event.stopPropagation()">
                <div class="swatch" style="background:${getColor(r)}"></div>
                <span>${r} (${rolesCount[r]})</span>
            </div>`).join('');
    }

    const teamFiltersEl = document.getElementById('teamFilters');
    if (teamFiltersEl) {
        teamFiltersEl.innerHTML = Array.from(usedTeams).sort().map(t => `
            <div class="legend-item" onclick="window.toggleTeamFilter('${t}')">
                <input type="checkbox" ${activeTeamFilters.has(t) ? 'checked' : ''} onclick="event.stopPropagation()"><span>${t}</span>
            </div>`).join('');
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
    const name = document.getElementById('newSnapshotName').value;
    if(!name) return;
    const teams = Array.from(document.querySelectorAll('.team')).map(t => t.dataset.name);
    const members = Array.from(document.querySelectorAll('.member')).map(m => ({
        id: m.id, name: m.dataset.name, roles: JSON.parse(m.dataset.roles), type: m.dataset.type, team: m.closest('.team').dataset.name
    }));
    await addDoc(collection(db, "snapshots"), { name, boardData: { teams, members }, createdAt: serverTimestamp() });
    document.getElementById('newSnapshotName').value = ''; loadSnaps();
}

async function loadSnaps() {
    document.getElementById('snapshotsOverlay').style.display = 'flex';
    const list = document.getElementById('snapshotList');
    list.innerHTML = 'Laddar...';
    const snaps = await getDocs(query(collection(db, "snapshots"), orderBy("createdAt", "desc")));
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
    const snaps = await getDocs(collection(db, "snapshots"));
    const s = snaps.docs.find(d => d.id === id);
    if(s) { 
        if(confirm(`Vill du ladda "${s.data().name}"? Detta skriver över nuvarande vy.`)) {
            setDoc(doc(db, 'boards', 'live'), s.data().boardData); 
            document.getElementById('snapshotsOverlay').style.display = 'none'; 
        }
    }
};

window.delSnap = async (id) => { if(confirm("Radera denna snapshot?")) { await deleteDoc(doc(db, "snapshots", id)); loadSnaps(); } };

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
    const f = e.target.files[0];
    const r = new FileReader();
    r.onload = async (ev) => {
        const lines = ev.target.result.split(/\r?\n/).slice(1);
        const members = lines.filter(l => l.trim()).map(l => {
            const p = l.split(/[;,]/).map(s => s.trim().replace(/"/g, ''));
            const roles = p[1] ? p[1].split(',').map(role => role.trim()) : ['Okänd'];
            return { id: 'im-'+Math.random().toString(36).substr(2,5), name: p[0], roles, type: p[2]||'anställd', team: p[3]||'Oplacerade' };
        });
        const teams = [...new Set(members.map(m => m.team))];
        await addDoc(collection(db, "snapshots"), { name: 'Import: ' + f.name, boardData: { teams, members }, createdAt: serverTimestamp() });
        loadSnaps();
    };
    r.readAsText(f);
    e.target.value = '';
}
