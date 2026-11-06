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

const DIVISIONS = [
  { key: 'admin', label: 'ADMIN AND TRAINING DIVISION', icon: '🗂️' },
  { key: 'research', label: 'RESEARCH AND PLANNING DIVISION', icon: '🔬' },
  { key: 'operations', label: 'OPERATIONS AND WARNING DIVISION', icon: '🚨' },
  { key: 'opd', label: 'OPD', icon: '🛡️' },
];

// Match a personnel's saved division string to one of the 3 divisions
// Uses keyword matching so old/variant spellings still work
function matchDivision(savedDivision) {
  const d = (savedDivision || '').toUpperCase().trim();
  if (!d) return null;
  if (d.includes('ADMIN') || d.includes('TRAINING')) return 'ADMIN AND TRAINING DIVISION';
  if (d.includes('RESEARCH') || d.includes('PLANNING')) return 'RESEARCH AND PLANNING DIVISION';
  if (d.includes('OPERAT') || d.includes('WARNING')) return 'OPERATIONS AND WARNING DIVISION';
  if (d.includes('OPD')) return 'OPD';
  // Exact match fallback
  for (const div of DIVISIONS) {
    if (d === div.label) return div.label;
  }
  return '__UNASSIGNED__';
}
