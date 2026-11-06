// ===== INIT =====
async function init() {
  // Small screens (phones): start with the sidebar collapsed
  if (window.innerWidth < 760) document.getElementById('sidebar').classList.add('collapsed');

  // Return to the same tab after an automatic update reload
  try {
    const lastView = sessionStorage.getItem('pdrrmo-view');
    if (lastView && document.getElementById('view-' + lastView)) {
      const nav = document.querySelector(`.nav-item[onclick*="'${lastView}'"]`);
      showView(lastView, nav);
    }
  } catch (_) {}

  document.getElementById('new-entry-date').value = todayISO();
  registerServiceWorker();
  await initSupabase();
}

init();
