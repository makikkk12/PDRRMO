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
      PDRRMO Staff Daily Monitoring
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
    wrapper.style.cssText = 'margin-bottom:7px;border:1.5px solid #4A4A4A;border-radius:6px;overflow:hidden;';

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
      const isOffice = col.key === 'office';
      body.style.cssText = `padding:5px 4px;display:grid;grid-template-columns:${isOffice ? '1fr 1fr 1fr' : '1fr 1fr'};gap:4px;align-items:start;justify-items:center;min-height:60px;`;

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

        const photoSize = isOffice ? '34px' : '40px';
        const fontSize  = isOffice ? '11px' : '12px';
        const nameWidth = isOffice ? '44px' : '54px';
        const nameFSize = isOffice ? '6.5px' : '7px';

        if (p.photo) {
          const img = document.createElement('img');
          img.src = p.photo;
          img.style.cssText = `width:${photoSize};height:${photoSize};border-radius:5px;object-fit:cover;border:2px solid #6B6B6B;display:block;margin:0 auto 2px;`;
          img.crossOrigin = 'anonymous';
          pWrap.appendChild(img);
        } else {
          const initDiv = document.createElement('div');
          initDiv.style.cssText = `width:${photoSize};height:${photoSize};border-radius:5px;background:#FFF4EE;border:2px solid #6B6B6B;display:flex;align-items:center;justify-content:center;font-size:${fontSize};font-weight:700;color:#6B6B6B;margin:0 auto 2px;`;
          initDiv.textContent = initials(p.name);
          pWrap.appendChild(initDiv);
        }

        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = `font-size:${nameFSize};font-weight:700;color:#3A3A3A;text-transform:uppercase;max-width:${nameWidth};word-break:break-word;line-height:1.3;`;
        nameDiv.textContent = p.name;
        pWrap.appendChild(nameDiv);

        // Note tag (travel or leave)
        const noteVal = col.key === 'sl' ? leaveNotes[pid] : (col.key === 'travel' ? travelNotes[pid] : null);
        if (noteVal) {
          const tn = document.createElement('div');
          const noteIcon = col.key === 'sl' ? '📋' : '🚗';
          tn.style.cssText = 'font-size:6px;color:#6B6B6B;background:#FFF4EE;border:1px solid #BBBBBB;border-radius:3px;padding:1px 3px;margin-top:2px;max-width:54px;word-break:break-word;';
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
    notesBody.style.cssText = 'padding:5px 6px;min-height:60px;font-size:9px;color:#3A3A3A;white-space:pre-wrap;word-break:break-word;line-height:1.5;';
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
