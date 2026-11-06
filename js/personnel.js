// ===== PERSONNEL =====
function personnelSearchText(p) {
  return [p.name, p.role, p.division, matchDivision(p.division)].join(' ');
}

function buildPersonnelCard(p, showDivision = false) {
  const card = document.createElement('div');
  card.className = 'personnel-card';
  card.onclick = () => openEditPersonnelModal(p.id);
  const photoHTML = p.photo
    ? `<div class="personnel-card-photo"><img src="${p.photo}" alt="${escapeHtml(p.name)}"></div>`
    : `<div class="personnel-card-photo">${initials(p.name)}</div>`;
  card.innerHTML = `
    <button class="personnel-card-remove-btn" title="Remove personnel">✕</button>
    ${photoHTML}
    <div class="personnel-card-name">${escapeHtml(p.name)}</div>
    <div class="personnel-card-role">${escapeHtml(p.role || '')}</div>
    ${showDivision ? `<div style="font-size:10px;color:var(--gray-400);margin-top:2px;">${escapeHtml(p.division || 'No division set')}</div>` : ''}
  `;
  card.querySelector('.personnel-card-remove-btn').addEventListener('click', e => {
    e.stopPropagation();
    removePersonnel(p.id);
  });
  return card;
}

function renderPersonnelGrid() {
  const container = document.getElementById('personnel-divisions');
  const query = (document.getElementById('personnel-search')?.value || '').trim();
  const searching = query.length > 0;
  container.innerHTML = '';

  const visible = state.personnel.filter(p => matchesQuery(personnelSearchText(p), query));
  const matched = new Set();
  let shownCount = 0;

  DIVISIONS.forEach(div => {
    const allInDiv = state.personnel.filter(p => matchDivision(p.division) === div.label);
    allInDiv.forEach(p => matched.add(p.id));
    const divPersonnel = allInDiv.filter(p => visible.includes(p));

    // While searching, hide divisions with no matches
    if (searching && divPersonnel.length === 0) return;
    shownCount += divPersonnel.length;

    const section = document.createElement('div');
    section.className = 'division-section';

    const countLabel = searching
      ? `${divPersonnel.length} of ${allInDiv.length} personnel`
      : `${allInDiv.length} personnel`;

    const header = document.createElement('div');
    header.className = 'division-header';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">${div.icon}</span>
        <span class="division-title">${div.label}</span>
        <span class="division-count">${countLabel}</span>
      </div>
      <button class="btn-add-personnel-div" onclick="openAddPersonnelModal('${div.label}')">＋ Add Personnel</button>
    `;
    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'division-body';

    if (divPersonnel.length === 0) {
      body.innerHTML = `<div class="division-empty">No personnel in this division yet.</div>`;
    } else {
      const grid = document.createElement('div');
      grid.className = 'personnel-grid';
      divPersonnel.forEach(p => grid.appendChild(buildPersonnelCard(p)));
      body.appendChild(grid);
    }

    section.appendChild(body);
    container.appendChild(section);
  });

  // ===== UNASSIGNED / fallback section =====
  const unassigned = state.personnel.filter(p => !matched.has(p.id) && visible.includes(p));
  if (unassigned.length > 0) {
    shownCount += unassigned.length;
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
    unassigned.forEach(p => grid.appendChild(buildPersonnelCard(p, true)));
    body.appendChild(grid);
    section.appendChild(body);
    container.appendChild(section);
  }

  if (searching && shownCount === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>No personnel match “${escapeHtml(query)}”.</p>
      </div>`;
  }
}

async function removePersonnel(id) {
  const p = state.personnel.find(x => x.id === id);
  if (!p) return;
  if (!requireOnline()) return;
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
  if (!requireOnline()) return;
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
  if (!requireOnline()) return;

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
