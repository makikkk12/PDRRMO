# PDRRMO Staff Daily Monitoring

## Deploying to Netlify
The site deploys automatically from GitHub. In VS Code: open **Source Control**
(Ctrl+Shift+G), type a short message describing the change, click **Commit**,
then **Sync Changes**. Netlify publishes the new version within about a minute.

`netlify.toml` tells Netlify there is no build step: it publishes this folder as-is.
`index.html` must stay at the top level, next to `sw.js`.

## How updates reach users
- The open app checks Netlify for changed files every 2 minutes, and whenever
  the window comes back to the front or the internet reconnects.
- When something changed, the app reloads itself automatically — but only when
  nobody is editing an entry, filling in a form, or typing. Otherwise a
  "New version ready — Update now" bar appears and it updates as soon as they finish.
- You don't need to change any version number. Just edit and redeploy.

## If you ADD a new file
Add its path to the `APP_FILES` (or `STATIC_FILES`) list at the top of `sw.js`,
otherwise it won't be available offline.

## Folder layout
- `index.html` – page markup
- `css/styles.css` – all styles
- `js/config.js` – Supabase URL/key, update-check interval
- `js/constants.js` – columns, divisions, app state
- `js/utils.js` – helpers, search helpers, modals
- `js/offline-store.js` – saved copy of the data (IndexedDB) for offline use
- `js/db.js` – Supabase loading, realtime, offline/online handling
- `js/whereabouts.js` – entries, new entry, edit, personnel picker
- `js/personnel.js` – personnel tab + search
- `js/history.js` – history tab + search
- `js/pdf.js` – PDF download
- `js/pwa.js` – install button + live updates
- `js/main.js` – startup
- `sw.js` – service worker (offline + update checks)
- `manifest.webmanifest`, `icons/` – makes it installable
- `vendor/` – Supabase, html2canvas, jsPDF stored locally so they work offline
- `_headers` – Netlify cache settings for the service worker
