// ===== DATABASE (Supabase) + OFFLINE FALLBACK =====
let sbClient = null;
let dbOnline = false;          // true only when the last Supabase call succeeded
let realtimeChannel = null;
let lastSyncedAt = null;       // ISO time of the last successful load

const SNAPSHOT_KEY = 'snapshot-v1';

function setDbStatus(mode) {
  // mode: 'connected' | 'offline' | 'error' | 'connecting'
  const dot = document.getElementById('db-dot');
  const txt = document.getElementById('db-status-text');
  const labels = {
    connected: 'Connected',
    offline: 'Offline · saved data',
    error: 'Disconnected',
    connecting: 'Connecting…',
  };
  dot.className = 'db-dot ' + (mode === 'connected' ? 'connected' : mode === 'offline' ? 'offline' : mode === 'error' ? 'error' : '');
  txt.textContent = labels[mode] || mode;
  dot.parentElement.title = lastSyncedAt
    ? 'Last synced: ' + new Date(lastSyncedAt).toLocaleString()
    : '';
  document.body.classList.toggle('is-offline', mode !== 'connected');
}

function normalizeEntry(e) {
  return {
    ...e,
    columns: {
      office: [], capitol: [], travel: [], sl: [], vl: [],
      ...e.columns,
      // Normalize others: always a string
      others: typeof e.columns?.others === 'string' ? e.columns.others : '',
      // Normalize travelNotes / leaveNotes: always an object
      travelNotes: (e.columns?.travelNotes && typeof e.columns.travelNotes === 'object') ? e.columns.travelNotes : {},
      leaveNotes:  (e.columns?.leaveNotes  && typeof e.columns.leaveNotes  === 'object') ? e.columns.leaveNotes  : {},
      // Normalize per-division notes
      notes_admin: e.columns?.notes_admin || '',
      notes_research: e.columns?.notes_research || '',
      notes_operations: e.columns?.notes_operations || '',
      notes_opd: e.columns?.notes_opd || '',
    },
    editMode: false,
  };
}

// Re-draw everything that shows data
function renderAll() {
  // Don't wipe out an entry someone is in the middle of editing
  if (!state.entries.some(e => e.editMode)) renderEntries();
  renderHistory();
  if (document.getElementById('view-personnel').classList.contains('active')) renderPersonnelGrid();
}

// Apply fresh rows from the server, keeping any entry currently being edited
function applyServerData(personnel, entries, history) {
  const editing = {};
  state.entries.forEach(e => { if (e.editMode) editing[e.id] = e; });

  state.personnel = personnel;
  state.entries = entries.map(e => editing[e.id] || normalizeEntry(e));
  state.history = history;
}

// ── Show the last saved copy right away (works with no internet) ──
async function loadSnapshot() {
  const snap = await OfflineStore.get(SNAPSHOT_KEY);
  if (!snap) return false;
  state.personnel = snap.personnel || [];
  state.entries = (snap.entries || []).map(normalizeEntry);
  state.history = snap.history || [];
  lastSyncedAt = snap.savedAt || null;
  renderAll();
  return true;
}

function saveSnapshot() {
  lastSyncedAt = new Date().toISOString();
  const clean = state.entries.map(({ editMode, ...rest }) => rest);
  OfflineStore.set(SNAPSHOT_KEY, {
    personnel: state.personnel,
    entries: clean,
    history: state.history,
    savedAt: lastSyncedAt,
  });
}

// ===== LOAD DATA FROM SUPABASE =====
const LOAD_TIMEOUT_MS = 15000; // give up and use saved data on very slow / no internet

async function fetchAllData() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LOAD_TIMEOUT_MS);
  let pRes, eRes, hRes;
  try {
    [pRes, eRes, hRes] = await Promise.all([
      sbClient.from('personnel').select('*').order('created_at', { ascending: true }).abortSignal(ac.signal),
      sbClient.from('entries').select('*').order('date', { ascending: false }).abortSignal(ac.signal),
      sbClient.from('history').select('*').order('created_at', { ascending: false }).limit(100).abortSignal(ac.signal),
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (ac.signal.aborted) throw new Error('The connection timed out');
  if (pRes.error) throw pRes.error;
  if (eRes.error) throw eRes.error;
  if (hRes.error) throw hRes.error;

  applyServerData(pRes.data || [], eRes.data || [], hRes.data || []);

  // Seed sample OPD personnel if none exist in OPD division
  const hasOPD = state.personnel.some(p => matchDivision(p.division) === 'OPD');
  if (!hasOPD) {
    const sampleOPD = { name: 'JUAN D. DELA CRUZ', role: 'OPD Officer', division: 'OPD', photo: null };
    const { data: newP, error: seedErr } = await sbClient.from('personnel').insert([sampleOPD]).select().single();
    if (!seedErr && newP) state.personnel.push(newP);
  }
}

async function loadAllData(silent = false) {
  try {
    await fetchAllData();
    dbOnline = true;
    saveSnapshot();
    setDbStatus('connected');
    renderAll();
    return true;
  } catch (e) {
    console.error(e);
    dbOnline = false;
    // If we have a saved copy on screen, say so instead of just "Disconnected"
    setDbStatus(lastSyncedAt ? 'offline' : 'error');
    if (!silent || lastSyncedAt) {
      if (lastSyncedAt) showToast("Can't reach the database — showing saved data.", '📴', 3500);
      else showToast('Could not reach the database: ' + e.message, '❌');
    }
    return false;
  }
}

// ===== CONNECT =====
async function initSupabase() {
  setDbStatus('connecting');
  try {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    console.error(e);
    setDbStatus('error');
    return;
  }

  const hadSnapshot = await loadSnapshot();
  // Data is on screen already if we had a saved copy — hide the loader early
  if (hadSnapshot) hideLoadingScreen();

  if (navigator.onLine) {
    const ok = await loadAllData(hadSnapshot);
    if (ok) setupRealtime();
  } else {
    setDbStatus('offline');
    if (hadSnapshot) showToast('You are offline — showing saved data.', '📴');
    else showToast('You are offline and no data has been saved on this device yet.', '📴');
  }
  hideLoadingScreen();
}

function hideLoadingScreen() {
  document.getElementById('loading-screen').style.display = 'none';
}

// ===== REALTIME AUTO-REFRESH =====
let realtimeTimer = null;
function scheduleRealtimeReload() {
  // Several rows can change at once — reload once, not once per row
  clearTimeout(realtimeTimer);
  realtimeTimer = setTimeout(() => loadAllData(true), 300);
}

function setupRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = sbClient
    .channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, scheduleRealtimeReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'personnel' }, scheduleRealtimeReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'history' }, scheduleRealtimeReload)
    .subscribe();
}

// ===== GOING OFFLINE / BACK ONLINE =====
window.addEventListener('offline', () => {
  dbOnline = false;
  setDbStatus('offline');
  showToast('Connection lost — showing saved data. Changes are paused.', '📴');
});

window.addEventListener('online', async () => {
  if (!sbClient) return;
  setDbStatus('connecting');
  const ok = await loadAllDataQuiet();
  if (ok) {
    setupRealtime();
    showToast('Back online — data refreshed.', '🟢');
  } else {
    setDbStatus(lastSyncedAt ? 'offline' : 'error');
  }
});

// Wi-Fi can be "connected" with no internet — keep retrying quietly in the background
setInterval(async () => {
  if (dbOnline || !sbClient || !navigator.onLine) return;
  const ok = await loadAllDataQuiet();
  if (ok) {
    setupRealtime();
    showToast('Reconnected — data refreshed.', '🟢');
  }
}, 60 * 1000);

async function loadAllDataQuiet() {
  try {
    await fetchAllData();
    dbOnline = true;
    saveSnapshot();
    setDbStatus('connected');
    renderAll();
    return true;
  } catch (_) {
    return false;
  }
}
