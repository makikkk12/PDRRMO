// ===== HISTORY =====

// Each person assigned in an entry, with where they were and any note
function entryAssignments(entry) {
  const out = [];
  COLUMNS.forEach(col => {
    (entry.columns[col.key] || []).forEach(pid => {
      const p = state.personnel.find(x => x.id === pid);
      if (!p) return;
      const note = col.key === 'travel' ? (entry.columns.travelNotes || {})[pid]
                 : col.key === 'sl'     ? (entry.columns.leaveNotes  || {})[pid]
                 : '';
      out.push({ person: p, col, note: note || '' });
    });
  });
  return out;
}

// All the text a history item can be found by
function entrySearchText(entry) {
  const d = new Date(entry.date + 'T00:00:00');
  const dateWords = [
    entry.date,
    fmtDate(entry.date),
    d.toLocaleDateString('en-US', { weekday: 'long' }),
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }),
  ];
  const people = entryAssignments(entry).map(a => `${a.person.name} ${a.col.label} ${a.note}`);
  const notes = DIVISIONS.map(div => entry.columns[`notes_${div.key}`] || '');
  return [...dateWords, ...people, ...notes, entry.columns.others || ''].join(' ');
}

function renderHistory() {
  const list = document.getElementById('history-list');
  const countEl = document.getElementById('history-search-count');
  const query = (document.getElementById('history-search')?.value || '').trim();

  // Show one item per unique entry (no download/edit duplicates), newest first
  const allSorted = [...state.entries].sort((a, b) => (b.date > a.date ? 1 : -1));
  const sortedEntries = query ? allSorted.filter(e => matchesQuery(entrySearchText(e), query)) : allSorted;

  if (countEl) {
    countEl.textContent = query ? `Showing ${sortedEntries.length} of ${allSorted.length} entries` : '';
  }

  if (allSorted.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📜</div><p>No history yet. Start adding entries!</p></div>`;
    return;
  }

  if (sortedEntries.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>No entries match “${escapeHtml(query)}”.</p></div>`;
    return;
  }

  list.innerHTML = '';

  sortedEntries.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'history-item';

    // Count total assigned personnel
    const allAssigned = [];
    COLUMNS.forEach(col => {
      (entry.columns[col.key] || []).forEach(pid => {
        if (!allAssigned.includes(pid)) allAssigned.push(pid);
      });
    });

    // Personnel photo previews (up to 5)
    const shown = allAssigned.slice(0, 5);
    let personnelPreview = shown.map(pid => {
      const p = state.personnel.find(x => x.id === pid);
      if (!p) return '';
      return p.photo
        ? `<img src="${p.photo}" title="${p.name}" style="width:24px;height:24px;border-radius:4px;object-fit:cover;border:1.5px solid var(--yellow);">`
        : `<div title="${p.name}" style="width:24px;height:24px;border-radius:4px;background:var(--blue-pale);border:1.5px solid var(--yellow);display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:var(--blue-dark);">${initials(p.name)}</div>`;
    }).join('');
    if (allAssigned.length > 5) {
      personnelPreview += `<div style="width:24px;height:24px;border-radius:4px;background:var(--gray-200);display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:var(--gray-600);">+${allAssigned.length - 5}</div>`;
    }

    const staffCount = allAssigned.length;

    // When searching, show which staff matched and where they were
    let matchHTML = '';
    if (query) {
      const hits = entryAssignments(entry)
        .filter(a => matchesQuery(`${a.person.name} ${a.col.label} ${a.note}`, query))
        .slice(0, 6);
      if (hits.length) {
        matchHTML = `<div class="history-matches">${hits.map(a =>
          `<span class="history-match-chip">${a.col.icon} ${escapeHtml(a.person.name)} · ${a.col.label}${a.note ? ` (${escapeHtml(a.note)})` : ''}</span>`
        ).join('')}</div>`;
      }
    }

    div.innerHTML = `
      <div class="history-icon">📍</div>
      <div class="history-content">
        <div class="history-action">${fmtDate(entry.date)}</div>
        <div class="history-detail">${staffCount} staff assigned</div>
        ${personnelPreview ? `<div style="display:flex;gap:3px;margin-top:5px;flex-wrap:wrap;">${personnelPreview}</div>` : ''}
        ${matchHTML}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
        <div class="history-item-arrow">›</div>
      </div>
    `;
    div.onclick = () => openHistoryWhereabouts(entry.id);
    list.appendChild(div);
  });
}

function openHistoryWhereabouts(entryId) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;
  document.getElementById('history-wb-modal-date').textContent = fmtDate(entry.date);
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
      if (col.key === 'office') colBody.style.gridTemplateColumns = '1fr 1fr 1fr';

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
