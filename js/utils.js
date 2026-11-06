// ===== UTILS =====
function uid() { return '_' + Math.random().toString(36).substr(2, 9); }

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
}

function initials(name) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

let toastTimer = null;
function showToast(msg, icon = '✅', ms = 2800) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${icon}</span> ${msg}`;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// Today's date in the device's local time zone (YYYY-MM-DD).
// (toISOString() uses UTC, which gave yesterday's date before 8 AM in PH time.)
function todayISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Blocks changes while offline (saved data is view-only until reconnected)
function requireOnline() {
  if (dbOnline && navigator.onLine) return true;
  showToast("You're offline — changes can't be saved until the connection is back.", '📴', 3800);
  return false;
}

// ===== SEARCH HELPERS =====
function normalizeText(str) {
  return String(str ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

// Every word typed must appear somewhere in the text (order doesn't matter)
function matchesQuery(haystack, query) {
  const words = normalizeText(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const text = normalizeText(haystack);
  return words.every(w => text.includes(w));
}

function clearSearch(inputId, rerender) {
  const input = document.getElementById(inputId);
  input.value = '';
  rerender();
  input.focus();
}

async function addHistory(action, detail, icon = '📝', entryId = null) {
  const rec = { action, detail, icon, entry_id: entryId, created_at: new Date().toISOString() };
  state.history.unshift(rec);
  renderHistory();
  if (sbClient) {
    const { error } = await sbClient.from('history').insert([rec]);
    if (error) console.error('History insert error:', error);
  }
}

// ===== SIDEBAR TOGGLE =====
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// ===== VIEWS =====
function showView(name, el) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  if (el) el.classList.add('active');
  if (name === 'personnel') renderPersonnelGrid();
  if (name === 'history') renderHistory();
  try { sessionStorage.setItem('pdrrmo-view', name); } catch (_) {}
}

// ===== MODALS =====
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (typeof maybeApplyPendingUpdate === 'function') maybeApplyPendingUpdate();
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});
