// ===== SUPABASE CONFIG =====
let sbClient = null;


function saveConfig() {}

async function initSupabase() {
  try {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { error } = await sbClient.from('personnel').select('id').limit(1);
    if (error && error.code !== 'PGRST116') throw error;
    setDbStatus(true);
    await loadAllData();
    setupRealtime();
  } catch (e) {
    console.error(e);
    setDbStatus(false);
    showToast('Database connection failed: ' + e.message, 'X');
  } finally {
    document.getElementById('loading-screen').style.display = 'none';
  }
}

function setDbStatus(ok) {
  const dot = document.getElementById('db-dot');
  const txt = document.getElementById('db-status-text');
  dot.className = 'db-dot ' + (ok ? 'connected' : 'error');
  txt.textContent = ok ? 'Connected' : 'Disconnected';
}

// ===== STATE =====
let state = {
  personnel: [],
  entries: [],
  history: [],
};

const COLUMNS = [
  { key: 'office',   label: 'OFFICE',            icon: '🏢' },
  { key: 'capitol',  label: 'CAPITOL',            icon: '🏛️' },
  { key: 'travel',   label: 'OFFICIAL BUSINESS',  icon: '🚗' },
  { key: 'sl',       label: 'LEAVE',              icon: '📋' },
  { key: 'vl',       label: 'OFF DUTY',           icon: '🌙' },
];
const NOTES_COL = { key: 'others', label: 'OTHERS / NOTES', icon: '📌' };

let currentPickerCallback = null;
let editingEntrySnapshot = null;
let modalPhotoData = null;
let editingPersonnelId = null;

// ===== LOAD DATA FROM SUPABASE =====
async function loadAllData(silent = false) {
  try {
    const [pRes, eRes, hRes] = await Promise.all([
      sbClient.from('personnel').select('*').order('created_at', { ascending: true }),
      sbClient.from('entries').select('*').order('date', { ascending: false }),
      sbClient.from('history').select('*').order('created_at', { ascending: false }).limit(100),
    ]);
    if (pRes.error) throw pRes.error;
    if (eRes.error) throw eRes.error;
    if (hRes.error) throw hRes.error;

    state.personnel = pRes.data || [];
    // Preserve editMode for any entry currently being edited
    const prevEditModes = {};
    state.entries.forEach(e => { if (e.editMode) prevEditModes[e.id] = true; });

    state.entries = (eRes.data || []).map(e => ({
      ...e,
      columns: {
        office: [], capitol: [], travel: [], sl: [], vl: [],
        ...e.columns,
        // Normalize others: always a string
        others: typeof e.columns?.others === 'string' ? e.columns.others : '',
        // Normalize travelNotes: always an object
        travelNotes: (e.columns?.travelNotes && typeof e.columns.travelNotes === 'object') ? e.columns.travelNotes : {},
        leaveNotes:  (e.columns?.leaveNotes  && typeof e.columns.leaveNotes  === 'object') ? e.columns.leaveNotes  : {},
        // Normalize per-division notes
        notes_admin: e.columns?.notes_admin || '',
        notes_research: e.columns?.notes_research || '',
        notes_operations: e.columns?.notes_operations || '',
      },
      editMode: prevEditModes[e.id] || false,
    }));
    state.history = hRes.data || [];

    renderEntries();
    renderHistory();
    if (!silent) console.log('Data loaded.');
  } catch(e) {
    console.error(e);
    if (!silent) showToast('Failed to load data: ' + e.message, '❌');
  }
}

// ===== REALTIME AUTO-REFRESH =====
function setupRealtime() {
  sbClient
    .channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, () => loadAllData(true))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'personnel' }, () => loadAllData(true))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'history' }, () => loadAllData(true))
    .subscribe();
}

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

function showToast(msg, icon = '✅') {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${icon}</span> ${msg}`;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
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
}

// ===== MODALS =====
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ===== NEW ENTRY =====
function openNewEntryModal() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('new-entry-date').value = today;
  renderNewEntryColumns();
  openModal('modal-new-entry');
}

function renderNewEntryColumns() {
  const container = document.getElementById('new-entry-columns');
  container.innerHTML = '';

  // Build disabled map across all divisions/cols
  function getAssignedMap() {
    const map = {};
    DIVISIONS.forEach(div => {
      COLUMNS.forEach(col => {
        document.querySelectorAll(`#ne-${div.key}-${col.key} .ne-picker-item.selected`).forEach(el => {
          map[el.dataset.pid] = col.label;
        });
      });
    });
    return map;
  }

  function refreshAllDisabled() {
    const assignedMap = getAssignedMap();
    DIVISIONS.forEach(div => {
      COLUMNS.forEach(col => {
        document.querySelectorAll(`#ne-${div.key}-${col.key} .ne-picker-item`).forEach(el => {
          const pid = el.dataset.pid;
          const isSelected = el.classList.contains('selected');
          if (!isSelected && assignedMap[pid]) {
            el.classList.add('disabled-assigned');
            el.title = `Already in ${assignedMap[pid]}`;
          } else {
            el.classList.remove('disabled-assigned');
            el.title = '';
          }
        });
      });
    });
    renderAllNewEntryTravelNotes();
  }

  function renderAllNewEntryTravelNotes() {
    DIVISIONS.forEach(div => {
      const section = document.getElementById(`ne-travel-${div.key}`);
      const rowsDiv = document.getElementById(`ne-travel-rows-${div.key}`);
      if (!section || !rowsDiv) return;
      const selected = Array.from(document.querySelectorAll(`#ne-${div.key}-travel .ne-picker-item.selected`));
      if (selected.length === 0) { section.style.display = 'none'; return; }
      section.style.display = 'block';
      const existing = {};
      rowsDiv.querySelectorAll('.ne-travel-note-input').forEach(inp => { existing[inp.dataset.pid] = inp.value; });
      rowsDiv.innerHTML = '';
      selected.forEach(el => {
        const pid = el.dataset.pid;
        const p = state.personnel.find(x => x.id === pid);
        if (!p) return;
        const row = document.createElement('div');
        row.className = 'ne-travel-note-person';
        row.innerHTML = `
          <div class="ne-travel-note-person-name">${p.name}</div>
          <input class="ne-travel-note-input" type="text" data-pid="${pid}" placeholder="Enter destination…" value="${existing[pid] || ''}">
        `;
        rowsDiv.appendChild(row);
      });
    });
  }

  DIVISIONS.forEach(div => {
    const divPersonnel = state.personnel.filter(p => matchDivision(p.division) === div.label);

    const block = document.createElement('div');
    block.className = 'ne-div-block';

    const header = document.createElement('div');
    header.className = 'ne-div-header';
    header.innerHTML = `<span>${div.icon}</span> ${div.label}`;
    block.appendChild(header);

    const body = document.createElement('div');
    body.className = 'ne-div-body';

    if (divPersonnel.length === 0) {
      body.innerHTML = `<div style="font-size:12px;color:var(--gray-400);font-style:italic;padding:4px 0;">No personnel assigned to this division yet.</div>`;
      block.appendChild(body);
      container.appendChild(block);
      return;
    }

    COLUMNS.forEach(col => {
      const colRow = document.createElement('div');
      colRow.className = 'ne-div-col-row';

      const label = document.createElement('div');
      label.className = 'ne-col-label';
      label.innerHTML = `${col.icon} ${col.label}`;
      colRow.appendChild(label);

      const grid = document.createElement('div');
      grid.className = 'ne-picker-grid';
      grid.id = `ne-${div.key}-${col.key}`;

      divPersonnel.forEach(p => {
        const item = document.createElement('div');
        item.className = 'ne-picker-item';
        item.dataset.pid = p.id;
        const photoHTML = p.photo
          ? `<div class="ne-picker-photo"><img src="${p.photo}" alt="${p.name}"></div>`
          : `<div class="ne-picker-photo">${initials(p.name)}</div>`;
        item.innerHTML = `${photoHTML}<div class="ne-picker-name">${p.name}</div><span class="ne-check">✔</span>`;
        item.onclick = () => {
          item.classList.toggle('selected');
          refreshAllDisabled();
        };
        grid.appendChild(item);
      });

      colRow.appendChild(grid);

      // Travel notes row for this division
      if (col.key === 'travel') {
        const travelSec = document.createElement('div');
        travelSec.className = 'ne-travel-note-row';
        travelSec.id = `ne-travel-${div.key}`;
        travelSec.style.display = 'none';
        travelSec.innerHTML = `<div class="ne-travel-note-row-title">✈️ Travel Destination per Person</div><div id="ne-travel-rows-${div.key}"></div>`;
        colRow.appendChild(travelSec);
      }

      body.appendChild(colRow);
    });

    // Division notes field
    const divNotesRow = document.createElement('div');
    divNotesRow.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px dashed var(--gray-200);';
    divNotesRow.innerHTML = `
      <div class="ne-col-label" style="margin-bottom:4px;">📌 NOTES</div>
      <textarea class="form-input" id="ne-notes-${div.key}" rows="2"
        placeholder="Notes for ${div.label}…"
        style="resize:vertical;font-family:'Nunito',sans-serif;font-size:12px;min-height:44px;"></textarea>
    `;
    body.appendChild(divNotesRow);

    block.appendChild(body);
    container.appendChild(block);
  });
}

async function createEntry() {
  const dateVal = document.getElementById('new-entry-date').value;
  if (!dateVal) { showToast('Please select a date.', '⚠️'); return; }

  const columns = { office: [], capitol: [], travel: [], sl: [], vl: [] };

  // Gather from division-based grids
  DIVISIONS.forEach(div => {
    COLUMNS.forEach(col => {
      const grid = document.getElementById(`ne-${div.key}-${col.key}`);
      if (!grid) return;
      grid.querySelectorAll('.ne-picker-item.selected').forEach(el => {
        if (!columns[col.key].includes(el.dataset.pid))
          columns[col.key].push(el.dataset.pid);
      });
    });
  });

  // Travel notes per person
  const travelNotes = {};
  DIVISIONS.forEach(div => {
    const rowsDiv = document.getElementById(`ne-travel-rows-${div.key}`);
    if (!rowsDiv) return;
    rowsDiv.querySelectorAll('.ne-travel-note-input').forEach(inp => {
      if (inp.value.trim()) travelNotes[inp.dataset.pid] = inp.value.trim();
    });
  });
  columns.travelNotes = travelNotes;
  // Gather per-division notes
  DIVISIONS.forEach(div => {
    const ta = document.getElementById(`ne-notes-${div.key}`);
    if (ta && ta.value.trim()) columns[`notes_${div.key}`] = ta.value.trim();
  });

  const entry = { date: dateVal, columns };

  try {
    const { data, error } = await sbClient.from('entries').insert([entry]).select().single();
    if (error) throw error;
    const newEntry = { ...data, editMode: false };
    state.entries.unshift(newEntry);
    closeModal('modal-new-entry');
    renderEntries();
    addHistory('New entry created', fmtDate(dateVal), '📅', data.id);
    showToast('Entry created for ' + fmtDate(dateVal));
  } catch(e) {
    showToast('Error creating entry: ' + e.message, '❌');
  }
}

// ===== ENTRIES RENDER =====
function renderEntries() {
  const container = document.getElementById('entries-container');
  const empty = document.getElementById('wb-empty');

  if (state.entries.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  container.innerHTML = '';
  state.entries.forEach(entry => container.appendChild(buildEntryCard(entry)));
}

function buildEntryCard(entry) {
  const card = document.createElement('div');
  card.className = 'entry-card' + (entry.editMode ? ' edit-mode' : '');
  card.id = 'entry-' + entry.id;

  const d = fmtDate(entry.date);
  const parts = d.split(' ');
  const dateFmt = parts.length >= 3
    ? `${parts[0]} <span>${parts[1]}</span> ${parts[2]}`
    : d;

  // Build entry header
  card.innerHTML = `
    <div class="entry-header">
      <div class="entry-date">${dateFmt}</div>
      <div style="position:relative">
        <button class="entry-menu-btn" onclick="toggleEntryMenu('${entry.id}', event)">⋮</button>
        <div class="entry-dropdown" id="dropdown-${entry.id}">
          <div class="entry-dropdown-item" onclick="editEntry('${entry.id}')">✏️ Edit</div>
          <div class="entry-dropdown-item" onclick="downloadEntryPDF('${entry.id}')">⬇️ Download PDF</div>
          <div class="entry-dropdown-item danger" onclick="removeEntry('${entry.id}')">🗑 Remove</div>
        </div>
      </div>
    </div>
    <div class="edit-mode-banner">
      ✏️ Editing mode — make your changes below &nbsp;|&nbsp; <span style="opacity:0.75;font-weight:600;">Press Enter to save</span>
      <button class="edit-cancel-btn" onclick="cancelEdit('${entry.id}')">Cancel</button>
      <button class="edit-save-btn" onclick="saveEdit('${entry.id}')">Save Changes</button>
    </div>
    <div class="entry-table-wrap" id="wb-table-${entry.id}"></div>
  `;

  // Build the per-division whereabouts tables
  const tableWrap = card.querySelector(`#wb-table-${entry.id}`);
  DIVISIONS.forEach(div => {
    const divPersonnel = state.personnel.filter(p => matchDivision(p.division) === div.label);

    const block = document.createElement('div');
    block.className = 'div-wb-block';

    // Division label row
    const labelRow = document.createElement('div');
    labelRow.className = 'div-wb-label';
    labelRow.innerHTML = `<span>${div.icon}</span> ${div.label}`;
    block.appendChild(labelRow);

    // Column headers + bodies
    const table = document.createElement('div');
    table.className = 'div-wb-table';

    COLUMNS.forEach(col => {
      const colEl = document.createElement('div');
      colEl.className = 'div-wb-col';

      const header = document.createElement('div');
      header.className = 'div-wb-col-header';
      header.innerHTML = `${col.icon} ${col.label}`;
      colEl.appendChild(header);

      const body = document.createElement('div');
      body.className = 'div-wb-col-body';
      body.id = `col-${entry.id}-${div.key}-${col.key}`;

      // Only show personnel from this division who are in this column
      const colIds = entry.columns[col.key] || [];
      const divIds = divPersonnel.map(p => p.id);
      const showIds = colIds.filter(id => divIds.includes(id));
      const travelNotes = entry.columns.travelNotes || {};

      if (showIds.length === 0 && !entry.editMode) {
        const empty = document.createElement('div');
        empty.className = 'div-wb-empty-col';
        empty.style.gridColumn = '1 / -1';
        empty.textContent = '—';
        body.appendChild(empty);
      }

      showIds.forEach(pid => {
        const p = state.personnel.find(x => x.id === pid);
        if (!p) return;
        const card2 = document.createElement('div');
        card2.className = 'wb-person-card';
        const photoHTML = p.photo
          ? `<div class="wb-person-photo"><img src="${p.photo}" alt="${p.name}"></div>`
          : `<div class="wb-person-photo">${initials(p.name)}</div>`;

        let travelNoteHTML = '';
        if (col.key === 'travel' || col.key === 'sl') {
          const notesStore = col.key === 'travel' ? travelNotes : (entry.columns.leaveNotes || {});
          const placeholder = col.key === 'travel' ? 'Destination…' : 'Leave type (e.g. Sick, Vacation…)';
          const noteIcon = col.key === 'travel' ? '🚗' : '📋';
          if (entry.editMode) {
            const noteVal = (notesStore[pid] || '').replace(/"/g, '&quot;');
            travelNoteHTML = `<input class="wb-travel-note-edit" type="text" data-entry="${entry.id}" data-pid="${pid}" data-col="${col.key}" placeholder="${placeholder}" value="${noteVal}" oninput="updateColNote('${entry.id}','${col.key}','${pid}',this.value)">`;
          } else {
            const note = notesStore[pid];
            if (note) travelNoteHTML = `<div class="wb-travel-note" title="${note}">${noteIcon} ${note}</div>`;
          }
        }

        card2.innerHTML = `
          ${photoHTML}
          <div class="wb-person-name">${p.name}</div>
          ${travelNoteHTML}
          <button class="wb-remove-btn" onclick="removePersonFromColumn('${entry.id}','${col.key}','${pid}')">✕</button>
        `;
        body.appendChild(card2);
      });

      // Add person button (edit mode only)
      if (entry.editMode) {
        const addBtn = document.createElement('button');
        addBtn.className = 'wb-add-btn';
        addBtn.title = `Add ${div.label} personnel to ${col.label}`;
        addBtn.textContent = '+';
        addBtn.onclick = () => openPickerForColumnDivision(entry.id, col.key, div.key);
        addBtn.style.gridColumn = '1 / -1';
        body.appendChild(addBtn);
      }

      colEl.appendChild(body);
      table.appendChild(colEl);
    });

    // Notes column for this division
    const notesColEl = document.createElement('div');
    notesColEl.className = 'div-wb-col';
    const notesHeader = document.createElement('div');
    notesHeader.className = 'div-wb-col-header';
    notesHeader.innerHTML = `📌 NOTES`;
    notesColEl.appendChild(notesHeader);
    const notesBody = document.createElement('div');
    notesBody.className = 'div-wb-col-body';
    notesBody.style.display = 'block';
    notesBody.style.padding = '8px';
    const divNotesKey = `notes_${div.key}`;
    const divNotesVal = entry.columns[divNotesKey] || '';
    if (entry.editMode) {
      const ta = document.createElement('textarea');
      ta.className = 'wb-notes-textarea';
      ta.id = `divnotes-${entry.id}-${div.key}`;
      ta.placeholder = 'Division notes…';
      ta.style.minHeight = '60px';
      ta.value = divNotesVal;
      notesBody.appendChild(ta);
    } else {
      notesBody.innerHTML = divNotesVal
        ? `<div class="wb-notes-text" style="font-size:10px;">${divNotesVal}</div>`
        : `<div class="div-wb-empty-col">—</div>`;
    }
    notesColEl.appendChild(notesBody);
    table.appendChild(notesColEl);

    block.appendChild(table);
    tableWrap.appendChild(block);
  });

  return card;
}

function updateTravelNote(entryId, pid, value) { updateColNote(entryId, 'travel', pid, value); }
function updateColNote(entryId, colKey, pid, value) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  const storeKey = colKey === 'sl' ? 'leaveNotes' : 'travelNotes';
  if (!entry.columns[storeKey]) entry.columns[storeKey] = {};
  entry.columns[storeKey][pid] = value;
}

// ===== DROPDOWN =====
function toggleEntryMenu(id, e) {
  e.stopPropagation();
  const dd = document.getElementById('dropdown-' + id);
  const isOpen = dd.classList.contains('open');
  document.querySelectorAll('.entry-dropdown').forEach(d => d.classList.remove('open'));
  if (!isOpen) dd.classList.add('open');
}
document.addEventListener('click', () => {
  document.querySelectorAll('.entry-dropdown').forEach(d => d.classList.remove('open'));
});

// ===== EDIT ENTRY =====
function editEntry(id) {
  document.querySelectorAll('.entry-dropdown').forEach(d => d.classList.remove('open'));
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  editingEntrySnapshot = JSON.parse(JSON.stringify(entry.columns));
  entry.editMode = true;
  renderEntries();
}

// ── Enter key → Save ──
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  // Don't trigger if a modal is open
  if (document.querySelector('.modal-overlay.open')) return;
  // Don't trigger if the user is typing in a textarea (let them newline freely)
  if (e.target.tagName === 'TEXTAREA') return;
  // Find the entry currently in edit mode
  const editingEntry = state.entries.find(en => en.editMode);
  if (!editingEntry) return;
  e.preventDefault();
  saveEdit(editingEntry.id);
});

function cancelEdit(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  if (editingEntrySnapshot) entry.columns = editingEntrySnapshot;
  entry.editMode = false;
  editingEntrySnapshot = null;
  renderEntries();
  showToast('Edit cancelled.');
}

async function saveEdit(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  // Capture per-division notes
  DIVISIONS.forEach(div => {
    const ta = document.getElementById(`divnotes-${id}-${div.key}`);
    if (ta) entry.columns[`notes_${div.key}`] = ta.value.trim();
  });
  // Capture travel + leave notes from edit inputs
  const travelNotes = entry.columns.travelNotes || {};
  const leaveNotes  = entry.columns.leaveNotes  || {};
  document.querySelectorAll(`.wb-travel-note-edit[data-entry="${id}"]`).forEach(inp => {
    if (inp.dataset.col === 'sl') leaveNotes[inp.dataset.pid] = inp.value.trim();
    else travelNotes[inp.dataset.pid] = inp.value.trim();
  });
  entry.columns.travelNotes = travelNotes;
  entry.columns.leaveNotes  = leaveNotes;
  try {
    const { error } = await sbClient.from('entries').update({ columns: entry.columns }).eq('id', id);
    if (error) throw error;
    entry.editMode = false;
    editingEntrySnapshot = null;
    renderEntries();
    showToast('Entry saved!');
  } catch(e) {
    showToast('Error saving: ' + e.message, '❌');
  }
}

async function removeEntry(id) {
  document.querySelectorAll('.entry-dropdown').forEach(d => d.classList.remove('open'));
  if (!confirm('Remove this entry?')) return;
  try {
    // Delete history for this entry
    await sbClient.from('history').delete().eq('entry_id', id);
    const { error } = await sbClient.from('entries').delete().eq('id', id);
    if (error) throw error;
    state.entries = state.entries.filter(e => e.id !== id);
    state.history = state.history.filter(h => h.entry_id !== id);
    renderEntries();
    renderHistory();
    showToast('Entry removed.');
  } catch(e) {
    showToast('Error removing entry: ' + e.message, '❌');
  }
}

function removePersonFromColumn(entryId, colKey, pid) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  entry.columns[colKey] = (entry.columns[colKey] || []).filter(x => x !== pid);
  renderEntries();
}

// ===== PICKER =====
function openPickerForColumn(entryId, colKey) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  if (!entry.editMode) {
    editingEntrySnapshot = JSON.parse(JSON.stringify(entry.columns));
    entry.editMode = true;
    renderEntries();
  }

  const col = COLUMNS.find(c => c.key === colKey);
  document.getElementById('picker-title').textContent = `${col.icon} Assign to ${col.label}`;

  const assigned = entry.columns[colKey] || [];
  // Build a map of pid -> colLabel for all OTHER columns
  const assignedElsewhere = {};
  COLUMNS.forEach(c => {
    if (c.key === colKey) return;
    (entry.columns[c.key] || []).forEach(pid => {
      assignedElsewhere[pid] = c.label;
    });
  });

  const grid = document.getElementById('picker-grid');
  grid.innerHTML = '';

  state.personnel.forEach(p => {
    const isSelected = assigned.includes(p.id);
    const isElsewhere = !isSelected && assignedElsewhere[p.id];
    const div = document.createElement('div');
    div.className = 'picker-item' + (isSelected ? ' selected' : '') + (isElsewhere ? ' disabled-assigned' : '');
    div.dataset.pid = p.id;
    if (isElsewhere) div.dataset.assignedTo = assignedElsewhere[p.id];
    const photoHTML = p.photo
      ? `<div class="picker-photo"><img src="${p.photo}" alt="${p.name}"></div>`
      : `<div class="picker-photo">${initials(p.name)}</div>`;
    div.innerHTML = `${photoHTML}<div class="picker-name">${p.name}</div>`;
    if (!isElsewhere) {
      div.onclick = () => {
        div.classList.toggle('selected');
        if (colKey === 'travel' || colKey === 'sl') refreshPickerTravelNotes(entry);
      };
    }
    grid.appendChild(div);
  });

  // Travel notes section
  const travelSection = document.getElementById('picker-travel-notes');
  if (colKey === 'travel' || colKey === 'sl') {
    refreshPickerTravelNotes(entry);
  } else {
    travelSection.classList.remove('visible');
  }

  currentPickerCallback = (selectedIds, notes, isSL) => {
    entry.columns[colKey] = selectedIds;
    if ((colKey === 'travel' || colKey === 'sl') && notes) {
      const storeKey = colKey === 'sl' ? 'leaveNotes' : 'travelNotes';
      if (!entry.columns[storeKey]) entry.columns[storeKey] = {};
      Object.assign(entry.columns[storeKey], notes);
      Object.keys(entry.columns[storeKey]).forEach(pid => {
        if (!selectedIds.includes(pid)) delete entry.columns[storeKey][pid];
      });
    }
    renderEntries();
  };

  openModal('modal-picker');
}

// Division-aware picker: only shows personnel from the given division
function openPickerForColumnDivision(entryId, colKey, divKey) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  if (!entry.editMode) {
    editingEntrySnapshot = JSON.parse(JSON.stringify(entry.columns));
    entry.editMode = true;
    renderEntries();
  }

  const div = DIVISIONS.find(d => d.key === divKey);
  const col = COLUMNS.find(c => c.key === colKey);
  document.getElementById('picker-title').textContent = `${div.icon} ${div.label} → ${col.icon} ${col.label}`;

  const divPersonnel = state.personnel.filter(p => matchDivision(p.division) === div.label);
  const assigned = entry.columns[colKey] || [];
  const assignedElsewhere = {};
  COLUMNS.forEach(c => {
    if (c.key === colKey) return;
    (entry.columns[c.key] || []).forEach(pid => { assignedElsewhere[pid] = c.label; });
  });

  const grid = document.getElementById('picker-grid');
  grid.innerHTML = '';

  if (divPersonnel.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--gray-400);font-size:13px;font-style:italic;">No personnel in this division yet.<br>Add them via the Personnel tab.</div>`;
  }

  divPersonnel.forEach(p => {
    const isSelected = assigned.includes(p.id);
    const isElsewhere = !isSelected && assignedElsewhere[p.id];
    const div2 = document.createElement('div');
    div2.className = 'picker-item' + (isSelected ? ' selected' : '') + (isElsewhere ? ' disabled-assigned' : '');
    div2.dataset.pid = p.id;
    if (isElsewhere) div2.dataset.assignedTo = assignedElsewhere[p.id];
    const photoHTML = p.photo
      ? `<div class="picker-photo"><img src="${p.photo}" alt="${p.name}"></div>`
      : `<div class="picker-photo">${initials(p.name)}</div>`;
    div2.innerHTML = `${photoHTML}<div class="picker-name">${p.name}</div>`;
    if (!isElsewhere) {
      div2.onclick = () => {
        div2.classList.toggle('selected');
        if (colKey === 'travel' || colKey === 'sl') refreshPickerTravelNotes(entry);
      };
    }
    grid.appendChild(div2);
  });

  const travelSection = document.getElementById('picker-travel-notes');
  if (colKey === 'travel' || colKey === 'sl') {
    refreshPickerTravelNotes(entry);
  } else {
    travelSection.classList.remove('visible');
  }

  currentPickerCallback = (selectedIds, notes, isSL) => {
    const otherDivIds = state.personnel
      .filter(p => matchDivision(p.division) !== div.label)
      .map(p => p.id);
    const kept = (entry.columns[colKey] || []).filter(id => otherDivIds.includes(id));
    entry.columns[colKey] = [...kept, ...selectedIds];
    if ((colKey === 'travel' || colKey === 'sl') && notes) {
      const storeKey = colKey === 'sl' ? 'leaveNotes' : 'travelNotes';
      if (!entry.columns[storeKey]) entry.columns[storeKey] = {};
      Object.assign(entry.columns[storeKey], notes);
      Object.keys(entry.columns[storeKey]).forEach(pid => {
        if (!entry.columns[colKey].includes(pid)) delete entry.columns[storeKey][pid];
      });
    }
    renderEntries();
  };

  openModal('modal-picker');
}

function refreshPickerTravelNotes(entry) {
  const travelSection = document.getElementById('picker-travel-notes');
  const rowsDiv = document.getElementById('picker-travel-notes-rows');
  const titleEl = document.getElementById('picker-travel-notes-title');
  const selected = Array.from(document.querySelectorAll('#picker-grid .picker-item.selected'));
  if (selected.length === 0) { travelSection.classList.remove('visible'); return; }
  travelSection.classList.add('visible');
  // Detect current col from picker title text
  const isSL = (document.getElementById('picker-title')?.textContent || '').includes('LEAVE');
  if (titleEl) titleEl.textContent = isSL ? '📋 Leave Type per Person' : '🚗 Official Business Destination';
  const savedNotes = (entry && (isSL ? entry.columns.leaveNotes : entry.columns.travelNotes)) || {};
  const existing = {};
  rowsDiv.querySelectorAll('.picker-travel-note-input').forEach(inp => { existing[inp.dataset.pid] = inp.value; });
  rowsDiv.innerHTML = '';
  const placeholder = isSL ? 'Leave type (e.g. Sick, Vacation…)' : 'Destination…';
  selected.forEach(el => {
    const pid = el.dataset.pid;
    const p = state.personnel.find(x => x.id === pid);
    if (!p) return;
    const row = document.createElement('div');
    row.className = 'picker-travel-note-row';
    const val = existing[pid] !== undefined ? existing[pid] : (savedNotes[pid] || '');
    row.innerHTML = `
      <div class="picker-travel-note-name">${p.name}</div>
      <input class="picker-travel-note-input" type="text" data-pid="${pid}" placeholder="${placeholder}" value="${val.replace(/"/g,'&quot;')}">
    `;
    rowsDiv.appendChild(row);
  });
}

function confirmPickerSelection() {
  const selected = Array.from(document.querySelectorAll('#picker-grid .picker-item.selected'))
    .map(el => el.dataset.pid);
  const isSL = (document.getElementById('picker-title')?.textContent || '').includes('LEAVE');
  const notes = {};
  document.querySelectorAll('#picker-travel-notes-rows .picker-travel-note-input').forEach(inp => {
    if (inp.value.trim()) notes[inp.dataset.pid] = inp.value.trim();
  });
  if (currentPickerCallback) currentPickerCallback(selected, notes, isSL);
  closeModal('modal-picker');
  showToast('Personnel assigned!');
}

// ===== PERSONNEL =====
const DIVISIONS = [
  { key: 'admin', label: 'ADMIN AND TRAINING DIVISION', icon: '🗂️' },
  { key: 'research', label: 'RESEARCH AND PLANNING DIVISION', icon: '🔬' },
  { key: 'operations', label: 'OPERATIONS AND WARNING DIVISION', icon: '🚨' },
];

// Match a personnel's saved division string to one of the 3 divisions
// Uses keyword matching so old/variant spellings still work
function matchDivision(savedDivision) {
  const d = (savedDivision || '').toUpperCase().trim();
  if (!d) return null;
  if (d.includes('ADMIN') || d.includes('TRAINING')) return 'ADMIN AND TRAINING DIVISION';
  if (d.includes('RESEARCH') || d.includes('PLANNING')) return 'RESEARCH AND PLANNING DIVISION';
  if (d.includes('OPERAT') || d.includes('WARNING')) return 'OPERATIONS AND WARNING DIVISION';
  // Exact match fallback
  for (const div of DIVISIONS) {
    if (d === div.label) return div.label;
  }
  return '__UNASSIGNED__';
}

function renderPersonnelGrid() {
  const container = document.getElementById('personnel-divisions');
  container.innerHTML = '';

  // Track which personnel fall into a known division
  const matched = new Set();

  DIVISIONS.forEach(div => {
    const divPersonnel = state.personnel.filter(p => {
      const m = matchDivision(p.division);
      return m === div.label;
    });
    divPersonnel.forEach(p => matched.add(p.id));

    const section = document.createElement('div');
    section.className = 'division-section';

    // Header
    const header = document.createElement('div');
    header.className = 'division-header';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">${div.icon}</span>
        <span class="division-title">${div.label}</span>
        <span class="division-count">${divPersonnel.length} personnel</span>
      </div>
      <button class="btn-add-personnel-div" onclick="openAddPersonnelModal('${div.label}')">＋ Add Personnel</button>
    `;
    section.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'division-body';

    if (divPersonnel.length === 0) {
      body.innerHTML = `<div class="division-empty">No personnel in this division yet.</div>`;
    } else {
      const grid = document.createElement('div');
      grid.className = 'personnel-grid';
      divPersonnel.forEach(p => {
        const card = document.createElement('div');
        card.className = 'personnel-card';
        card.onclick = () => openEditPersonnelModal(p.id);
        const photoHTML = p.photo
          ? `<div class="personnel-card-photo"><img src="${p.photo}" alt="${p.name}"></div>`
          : `<div class="personnel-card-photo">${initials(p.name)}</div>`;
        card.innerHTML = `
          <button class="personnel-card-remove-btn" title="Remove personnel">✕</button>
          ${photoHTML}
          <div class="personnel-card-name">${p.name}</div>
          <div class="personnel-card-role">${p.role || ''}</div>
        `;
        card.querySelector('.personnel-card-remove-btn').addEventListener('click', e => {
          e.stopPropagation();
          removePersonnel(p.id);
        });
        grid.appendChild(card);
      });
      body.appendChild(grid);
    }

    section.appendChild(body);
    container.appendChild(section);
  }); // end DIVISIONS.forEach

  // ===== UNASSIGNED / fallback section =====
  const unassigned = state.personnel.filter(p => !matched.has(p.id));
  if (unassigned.length > 0) {
    const section = document.createElement('div');
    section.className = 'division-section';
    const header = document.createElement('div');
    header.className = 'division-header';
    header.style.background = 'linear-gradient(135deg, #909090 0%, #BBBBBB 100%)';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">📁</span>
        <span class="division-title" style="color:#fff;">UNASSIGNED / OTHER</span>
        <span class="division-count">${unassigned.length} personnel</span>
      </div>
    `;
    section.appendChild(header);
    const body = document.createElement('div');
    body.className = 'division-body';
    const grid = document.createElement('div');
    grid.className = 'personnel-grid';
    unassigned.forEach(p => {
      const card = document.createElement('div');
      card.className = 'personnel-card';
      card.onclick = () => openEditPersonnelModal(p.id);
      const photoHTML = p.photo
        ? `<div class="personnel-card-photo"><img src="${p.photo}" alt="${p.name}"></div>`
        : `<div class="personnel-card-photo">${initials(p.name)}</div>`;
      card.innerHTML = `
        <button class="personnel-card-remove-btn" title="Remove personnel">✕</button>
        ${photoHTML}
        <div class="personnel-card-name">${p.name}</div>
        <div class="personnel-card-role">${p.role || ''}</div>
        <div style="font-size:10px;color:var(--gray-400);margin-top:2px;">${p.division || 'No division set'}</div>
      `;
      card.querySelector('.personnel-card-remove-btn').addEventListener('click', e => {
        e.stopPropagation();
        removePersonnel(p.id);
      });
      grid.appendChild(card);
    });
    body.appendChild(grid);
    section.appendChild(body);
    container.appendChild(section);
  }
}

async function removePersonnel(id) {
  const p = state.personnel.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Remove ${p.name} from personnel?`)) return;
  try {
    const { error } = await sbClient.from('personnel').delete().eq('id', id);
    if (error) throw error;
    state.personnel = state.personnel.filter(x => x.id !== id);
    // Remove from all entry columns
    for (const entry of state.entries) {
      let changed = false;
      COLUMNS.forEach(col => {
        if ((entry.columns[col.key] || []).includes(id)) {
          entry.columns[col.key] = entry.columns[col.key].filter(pid => pid !== id);
          changed = true;
        }
      });
      if (changed) {
        await sbClient.from('entries').update({ columns: entry.columns }).eq('id', entry.id);
      }
    }
    renderPersonnelGrid();
    renderEntries();
    showToast(`${p.name} removed.`, '🗑');
  } catch(e) {
    showToast('Error removing personnel: ' + e.message, '❌');
  }
}

function openAddPersonnelModal(presetDivision = '') {
  editingPersonnelId = null;
  modalPhotoData = null;
  document.getElementById('personnel-modal-title').textContent = '➕ Add Personnel';
  document.getElementById('edit-personnel-id').value = '';
  document.getElementById('personnel-name').value = '';
  document.getElementById('personnel-role').value = '';
  document.getElementById('personnel-division').value = presetDivision;
  document.getElementById('modal-photo-preview').innerHTML = '👤';
  openModal('modal-personnel');
}

function openEditPersonnelModal(id) {
  const p = state.personnel.find(x => x.id === id);
  if (!p) return;
  editingPersonnelId = id;
  modalPhotoData = p.photo || null;
  document.getElementById('personnel-modal-title').textContent = '✏️ Edit Personnel';
  document.getElementById('edit-personnel-id').value = id;
  document.getElementById('personnel-name').value = p.name;
  document.getElementById('personnel-role').value = p.role || '';
  document.getElementById('personnel-division').value = p.division || '';
  const prev = document.getElementById('modal-photo-preview');
  prev.innerHTML = p.photo ? `<img src="${p.photo}" alt="">` : initials(p.name);
  openModal('modal-personnel');
}

async function savePersonnel() {
  const name = document.getElementById('personnel-name').value.trim().toUpperCase();
  const role = document.getElementById('personnel-role').value.trim();
  const division = document.getElementById('personnel-division').value.trim();
  if (!name) { showToast('Please enter a name.', '⚠️'); return; }

  try {
    if (editingPersonnelId) {
      const updates = { name, role, division, photo: modalPhotoData || null };
      const { error } = await sbClient.from('personnel').update(updates).eq('id', editingPersonnelId);
      if (error) throw error;
      const p = state.personnel.find(x => x.id === editingPersonnelId);
      if (p) Object.assign(p, updates);
      showToast('Personnel updated!');
    } else {
      const newP = { name, role, division, photo: modalPhotoData || null };
      const { data, error } = await sbClient.from('personnel').insert([newP]).select().single();
      if (error) throw error;
      state.personnel.push(data);
      showToast('Personnel added!');
    }
    closeModal('modal-personnel');
    renderPersonnelGrid();
    renderEntries();
  } catch(e) {
    showToast('Error saving personnel: ' + e.message, '❌');
  }
}

function triggerPhotoUpload() {
  document.getElementById('photo-file-input').click();
}

function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  // Resize to max 400px to keep storage small
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 400;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      modalPhotoData = canvas.toDataURL('image/jpeg', 0.8);
      document.getElementById('modal-photo-preview').innerHTML = `<img src="${modalPhotoData}" alt="photo">`;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function removePhoto() {
  modalPhotoData = null;
  document.getElementById('modal-photo-preview').innerHTML = '👤';
  document.getElementById('photo-file-input').value = '';
  showToast('Photo removed.', '🗑');
}

// ===== HISTORY =====
function renderHistory() {
  const list = document.getElementById('history-list');
  const entryHistory = state.history.filter(h => h.entry_id);

  if (entryHistory.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📜</div><p>No history yet. Start adding entries!</p></div>`;
    return;
  }
  list.innerHTML = '';
  entryHistory.forEach(h => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const t = new Date(h.created_at || h.time);
    const timeStr = t.toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });

    const entry = state.entries.find(e => e.id === h.entry_id);
    let personnelPreview = '';
    if (entry) {
      const allAssigned = [];
      COLUMNS.forEach(col => {
        (entry.columns[col.key] || []).forEach(pid => {
          if (!allAssigned.includes(pid)) allAssigned.push(pid);
        });
      });
      const shown = allAssigned.slice(0, 5);
      personnelPreview = shown.map(pid => {
        const p = state.personnel.find(x => x.id === pid);
        if (!p) return '';
        return p.photo
          ? `<img src="${p.photo}" title="${p.name}" style="width:24px;height:24px;border-radius:4px;object-fit:cover;border:1.5px solid var(--yellow);">`
          : `<div title="${p.name}" style="width:24px;height:24px;border-radius:4px;background:var(--blue-pale);border:1.5px solid var(--yellow);display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:var(--blue-dark);">${initials(p.name)}</div>`;
      }).join('');
      if (allAssigned.length > 5) {
        personnelPreview += `<div style="width:24px;height:24px;border-radius:4px;background:var(--gray-200);display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:var(--gray-600);">+${allAssigned.length - 5}</div>`;
      }
    }

    div.innerHTML = `
      <div class="history-icon">${h.icon}</div>
      <div class="history-content">
        <div class="history-action">${h.detail}</div>
        ${personnelPreview ? `<div style="display:flex;gap:3px;margin-top:5px;flex-wrap:wrap;">${personnelPreview}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
        <div class="history-time">${timeStr}</div>
        ${entry ? '<div class="history-item-arrow">›</div>' : ''}
      </div>
    `;
    if (entry) div.onclick = () => openHistoryWhereabouts(h.entry_id);
    list.appendChild(div);
  });
}

function openHistoryWhereabouts(entryId) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  document.getElementById('history-wb-modal-title').textContent = '📍 Whereabouts — ' + fmtDate(entry.date);
  const body = document.getElementById('history-wb-modal-body');
  body.innerHTML = '';

  const travelNotes = entry.columns.travelNotes || {};
  const leaveNotes  = entry.columns.leaveNotes  || {};

  DIVISIONS.forEach(div => {
    const divPersonnel = state.personnel.filter(p => matchDivision(p.division) === div.label);

    const block = document.createElement('div');
    block.className = 'div-wb-block';

    const labelRow = document.createElement('div');
    labelRow.className = 'div-wb-label';
    labelRow.innerHTML = `<span>${div.icon}</span> ${div.label}`;
    block.appendChild(labelRow);

    const table = document.createElement('div');
    table.className = 'div-wb-table';

    COLUMNS.forEach(col => {
      const colEl = document.createElement('div');
      colEl.className = 'div-wb-col';

      const header = document.createElement('div');
      header.className = 'div-wb-col-header';
      header.innerHTML = `${col.icon} ${col.label}`;
      colEl.appendChild(header);

      const colBody = document.createElement('div');
      colBody.className = 'div-wb-col-body';

      const colIds = (entry.columns[col.key] || []).filter(pid => divPersonnel.some(p => p.id === pid));

      if (colIds.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'div-wb-empty-col';
        empty.style.gridColumn = '1 / -1';
        empty.textContent = '—';
        colBody.appendChild(empty);
      }

      colIds.forEach(pid => {
        const p = state.personnel.find(x => x.id === pid);
        if (!p) return;
        const card = document.createElement('div');
        card.className = 'wb-person-card';
        const photoHTML = p.photo
          ? `<div class="wb-person-photo"><img src="${p.photo}" alt="${p.name}"></div>`
          : `<div class="wb-person-photo">${initials(p.name)}</div>`;
        const noteVal = col.key === 'sl' ? leaveNotes[pid] : col.key === 'travel' ? travelNotes[pid] : null;
        const noteIcon = col.key === 'sl' ? '📋' : '🚗';
        const noteHTML = noteVal ? `<div class="wb-travel-note">${noteIcon} ${noteVal}</div>` : '';
        card.innerHTML = `${photoHTML}<div class="wb-person-name">${p.name}</div>${noteHTML}`;
        colBody.appendChild(card);
      });

      colEl.appendChild(colBody);
      table.appendChild(colEl);
    });

    // Notes column
    const notesColEl = document.createElement('div');
    notesColEl.className = 'div-wb-col';
    const notesHeader = document.createElement('div');
    notesHeader.className = 'div-wb-col-header';
    notesHeader.innerHTML = '📌 NOTES';
    notesColEl.appendChild(notesHeader);
    const notesBody = document.createElement('div');
    notesBody.className = 'div-wb-col-body';
    notesBody.style.display = 'block';
    notesBody.style.padding = '8px';
    const divNotesVal = entry.columns[`notes_${div.key}`] || '';
    notesBody.innerHTML = divNotesVal
      ? `<div class="wb-notes-text" style="font-size:10px;">${divNotesVal}</div>`
      : `<div class="div-wb-empty-col">—</div>`;
    notesColEl.appendChild(notesBody);
    table.appendChild(notesColEl);

    block.appendChild(table);
    body.appendChild(block);
  });

  openModal('modal-history-wb');
}

// ===== PDF DOWNLOAD =====
async function downloadEntryPDF(id) {
  document.querySelectorAll('.entry-dropdown').forEach(d => d.classList.remove('open'));
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  showToast('Generating PDF…', '⏳');

  const printArea = document.getElementById('pdf-print-area');
  printArea.innerHTML = '';
  printArea.style.cssText = 'position:fixed;left:0;top:0;background:#fff;padding:14px 18px;width:1400px;font-family:Arial,sans-serif;';

  // ── Header ──
  const hdrWrap = document.createElement('div');
  hdrWrap.style.cssText = 'text-align:center;margin-bottom:14px;';
  hdrWrap.innerHTML = `
    <div style="font-size:15px;font-weight:900;color:#4A4A4A;letter-spacing:1px;text-transform:uppercase;">
      PDRRMO Staff Tracking
    </div>
    <div style="font-size:12px;color:#6B6B6B;font-weight:600;margin-top:3px;">
      Daily Staff Whereabouts &nbsp;|&nbsp; ${fmtDate(entry.date)}
    </div>
    <div style="height:2px;background:linear-gradient(90deg,#4A4A4A,#FF6B2B);border-radius:2px;margin-top:10px;"></div>
  `;
  printArea.appendChild(hdrWrap);

  // ── Helper: build one division table ──
  function buildDivisionTable(div) {
    const divPersonnel = state.personnel.filter(p => matchDivision(p.division) === div.label);
    const travelNotes  = entry.columns.travelNotes || {};
    const leaveNotes   = entry.columns.leaveNotes  || {};
    const divNotesVal  = entry.columns[`notes_${div.key}`] || '';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'margin-bottom:10px;border:1.5px solid #4A4A4A;border-radius:6px;overflow:hidden;';

    const bar = document.createElement('div');
    bar.style.cssText = 'background:#4A4A4A;padding:5px 12px;display:flex;align-items:center;gap:8px;';
    bar.innerHTML = `<span style="font-size:13px;">${div.icon}</span><span style="font-family:Arial,sans-serif;font-size:11px;font-weight:900;color:#FF6B2B;letter-spacing:1px;text-transform:uppercase;">${div.label}</span>`;
    wrapper.appendChild(bar);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr) 1.3fr;';

    COLUMNS.forEach(col => {
      const colDiv = document.createElement('div');
      colDiv.style.cssText = 'border-right:1.5px solid #EBEBEB;';

      const ch = document.createElement('div');
      ch.style.cssText = 'background:#FF6B2B;padding:5px 4px;text-align:center;font-weight:800;font-size:10px;color:#3A3A3A;border-bottom:1.5px solid #E85A1A;letter-spacing:0.4px;';
      ch.textContent = col.label;
      colDiv.appendChild(ch);

      const body = document.createElement('div');
      body.style.cssText = 'padding:6px 4px;display:grid;grid-template-columns:1fr 1fr;gap:5px;align-items:start;justify-items:center;min-height:70px;';

      const colIds = (entry.columns[col.key] || []).filter(pid => divPersonnel.some(p => p.id === pid));
      if (colIds.length === 0) {
        const dash = document.createElement('div');
        dash.style.cssText = 'font-size:9px;color:#BBBBBB;font-style:italic;padding-top:6px;grid-column:1/-1;';
        dash.textContent = '—';
        body.appendChild(dash);
      }

      colIds.forEach(pid => {
        const p = state.personnel.find(x => x.id === pid);
        if (!p) return;
        const pWrap = document.createElement('div');
        pWrap.style.cssText = 'text-align:center;';

        if (p.photo) {
          const img = document.createElement('img');
          img.src = p.photo;
          img.style.cssText = 'width:44px;height:44px;border-radius:5px;object-fit:cover;border:2px solid #6B6B6B;display:block;margin:0 auto 2px;';
          img.crossOrigin = 'anonymous';
          pWrap.appendChild(img);
        } else {
          const initDiv = document.createElement('div');
          initDiv.style.cssText = 'width:44px;height:44px;border-radius:5px;background:#FFF4EE;border:2px solid #6B6B6B;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#6B6B6B;margin:0 auto 2px;';
          initDiv.textContent = initials(p.name);
          pWrap.appendChild(initDiv);
        }

        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-size:7px;font-weight:700;color:#3A3A3A;text-transform:uppercase;max-width:58px;word-break:break-word;line-height:1.3;';
        nameDiv.textContent = p.name;
        pWrap.appendChild(nameDiv);

        // Note tag (travel or leave)
        const noteVal = col.key === 'sl' ? leaveNotes[pid] : (col.key === 'travel' ? travelNotes[pid] : null);
        if (noteVal) {
          const tn = document.createElement('div');
          const noteIcon = col.key === 'sl' ? '📋' : '🚗';
          tn.style.cssText = 'font-size:6.5px;color:#6B6B6B;background:#FFF4EE;border:1px solid #BBBBBB;border-radius:3px;padding:1px 3px;margin-top:2px;max-width:58px;word-break:break-word;';
          tn.textContent = noteIcon + ' ' + noteVal;
          pWrap.appendChild(tn);
        }

        body.appendChild(pWrap);
      });

      colDiv.appendChild(body);
      grid.appendChild(colDiv);
    });

    // Notes column
    const notesCol = document.createElement('div');
    notesCol.style.cssText = 'border-left:1.5px solid #EBEBEB;';
    const notesHdr = document.createElement('div');
    notesHdr.style.cssText = 'background:#FF6B2B;padding:5px 4px;text-align:center;font-weight:800;font-size:10px;color:#3A3A3A;border-bottom:1.5px solid #E85A1A;letter-spacing:0.4px;';
    notesHdr.textContent = 'NOTES';
    notesCol.appendChild(notesHdr);
    const notesBody = document.createElement('div');
    notesBody.style.cssText = 'padding:6px;min-height:70px;font-size:9px;color:#3A3A3A;white-space:pre-wrap;word-break:break-word;line-height:1.5;';
    notesBody.textContent = divNotesVal || '';
    notesCol.appendChild(notesBody);
    grid.appendChild(notesCol);

    wrapper.appendChild(grid);
    return wrapper;
  }

  // ── Render all 3 divisions ──
  DIVISIONS.forEach(div => printArea.appendChild(buildDivisionTable(div)));

  // ── Footer ──
  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:6px;text-align:right;font-size:8px;color:#BBBBBB;';
  footer.textContent = `Generated: ${new Date().toLocaleString()}`;
  printArea.appendChild(footer);

  // ── Render to PDF (landscape, tight margins) ──
  try {
    await new Promise(r => setTimeout(r, 400));
    const canvas = await html2canvas(printArea, { scale: 2, useCORS: true, backgroundColor: '#fff' });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const imgData = canvas.toDataURL('image/png');
    const pageW = pdf.internal.pageSize.getWidth();  // 297mm
    const pageH = pdf.internal.pageSize.getHeight(); // 210mm
    const margin = 4;
    const usableW = pageW - margin * 2;
    const usableH = pageH - margin * 2;
    const ratio = canvas.width / canvas.height;
    let w = usableW, h = w / ratio;
    if (h > usableH) { h = usableH; w = h * ratio; }
    pdf.addImage(imgData, 'PNG', (pageW - w) / 2, (pageH - h) / 2, w, h);
    pdf.save(`PDRRMO-Whereabouts-${entry.date}.pdf`);
    showToast('PDF downloaded!', '📄');
  } catch(err) {
    console.error(err);
    showToast('PDF generation failed: ' + err.message, '❌');
  }

  printArea.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff;padding:24px;width:1100px;';
  printArea.innerHTML = '';
}

// ===== INIT =====
async function init() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('new-entry-date').value = today;
  await initSupabase();
}

init();
