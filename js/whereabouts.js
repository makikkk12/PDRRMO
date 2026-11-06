// ===== NEW ENTRY =====
function openNewEntryModal() {
  if (!requireOnline()) return;
  document.getElementById('new-entry-date').value = todayISO();
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
  if (!requireOnline()) return;

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
      if (col.key === 'office') body.style.gridTemplateColumns = '1fr 1fr 1fr';
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
  if (!requireOnline()) return;
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
  maybeApplyPendingUpdate();
}

async function saveEdit(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  if (!requireOnline()) return;
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
    maybeApplyPendingUpdate();
  } catch(e) {
    showToast('Error saving: ' + e.message, '❌');
  }
}

async function removeEntry(id) {
  document.querySelectorAll('.entry-dropdown').forEach(d => d.classList.remove('open'));
  if (!requireOnline()) return;
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
