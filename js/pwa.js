// ===== INSTALLABLE APP + LIVE UPDATES =====

// ---------- Install button ----------
let deferredInstallPrompt = null;

function isRunningInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!isRunningInstalled()) document.getElementById('install-btn').hidden = false;
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  document.getElementById('install-btn').hidden = true;
  showToast('App installed! You can open it from your desktop or home screen.', '📲', 4000);
});

async function installApp() {
  if (!deferredInstallPrompt) {
    showToast('Use your browser menu → "Install app" or "Add to Home Screen".', 'ℹ️', 4000);
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('install-btn').hidden = true;
}

// ---------- Live updates ----------
let updatePending = false;
let updateApplying = false;
let updateRetryTimer = null;

// Only reload when it won't interrupt someone's work
function isSafeToReload() {
  if (document.querySelector('.modal-overlay.open')) return false;          // a form/popup is open
  if (state.entries.some(e => e.editMode)) return false;                    // editing an entry
  if (document.getElementById('pdf-print-area').childElementCount) return false; // making a PDF
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return false; // typing
  return true;
}

function reloadToNewVersion() {
  if (updateApplying) return;
  updateApplying = true;
  try { sessionStorage.setItem('pdrrmo-just-updated', '1'); } catch (_) {}
  showToast('Updating to the latest version…', '🔄', 5000);
  setTimeout(() => location.reload(), 900);
}

function maybeApplyPendingUpdate() {
  if (!updatePending || updateApplying) return;
  if (isSafeToReload()) {
    document.getElementById('update-banner').hidden = true;
    reloadToNewVersion();
  } else {
    // Let the user finish; show a banner and try again in a few seconds
    document.getElementById('update-banner').hidden = false;
    clearTimeout(updateRetryTimer);
    updateRetryTimer = setTimeout(maybeApplyPendingUpdate, 5000);
  }
}

function applyUpdate() {
  if (state.entries.some(e => e.editMode) &&
      !confirm('You have unsaved changes in an entry. Update now and lose them?')) return;
  reloadToNewVersion();
}

let swRegistration = null;

function checkForAppUpdate(force = false) {
  if (!swRegistration || !navigator.onLine) return;
  swRegistration.update().catch(() => {});           // picks up changes to sw.js itself
  const sw = navigator.serviceWorker.controller;
  if (sw) sw.postMessage({ type: 'CHECK_FOR_UPDATES', force });  // picks up changes to app files
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'UPDATE_READY') {
      updatePending = true;
      maybeApplyPendingUpdate();
    }
  });

  // A new service worker took over (sw.js itself was changed)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install — nothing to refresh
    updatePending = true;
    maybeApplyPendingUpdate();
  });

  try {
    swRegistration = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  } catch (e) {
    console.warn('Service worker registration failed:', e);
    return;
  }

  // Check regularly, and whenever the app comes back to the front or online
  setInterval(() => checkForAppUpdate(), UPDATE_CHECK_INTERVAL);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForAppUpdate();
  });
  window.addEventListener('focus', () => checkForAppUpdate());
  window.addEventListener('online', () => checkForAppUpdate(true));

  try {
    if (sessionStorage.getItem('pdrrmo-just-updated')) {
      sessionStorage.removeItem('pdrrmo-just-updated');
      setTimeout(() => showToast('App updated to the latest version.', '✨', 3500), 600);
    }
  } catch (_) {}
}
