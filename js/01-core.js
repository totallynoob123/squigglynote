const KEY = 'squiggly-workspace-v4',
  PREF = 'squiggly-preferences-v2',
  ACCOUNT = 'squiggly-account-v1';
const $ = s => document.querySelector(s);
const blank = () => ({
  id: crypto.randomUUID(),
  title: 'Untitled note',
  body: '',
  created: Date.now(),
  edited: Date.now(),
  events: [],
});
const initial = () => blank();
const OWNER = ((JSON.parse(localStorage.getItem(ACCOUNT) || 'null') || {}).email || 'guest').toLowerCase();
let state = JSON.parse(
  localStorage.getItem(KEY + '-' + OWNER) || (OWNER === 'guest' ? localStorage.getItem(KEY) : 'null') || 'null',
) || { notes: [initial()], activeId: null };
if (!state.activeId) state.activeId = state.notes[0].id;
let prefs = JSON.parse(
  localStorage.getItem(PREF) || '{"theme":"light","background":"warm","font":"serif","size":"regular"}',
);
let pending = null;
const active = () => state.notes.find(n => n.id === state.activeId);
function save(message = 'Saved') {
  localStorage.setItem(KEY + '-' + OWNER, JSON.stringify(state));
  $('#saveState').textContent = message;
}
function applyPrefs() {
  document.body.classList.toggle('dark', prefs.theme === 'dark');
  document.body.classList.toggle('clean', prefs.background === 'clean');
  document.body.classList.toggle('sans', prefs.font === 'sans');
  document.body.classList.toggle('large', prefs.size === 'large');
  localStorage.setItem(PREF, JSON.stringify(prefs));
}
function account() {
  return JSON.parse(localStorage.getItem(ACCOUNT) || 'null');
}
function renderIdentity() {
  const a = account();
  $('#identity').textContent = a ? 'Signed in as ' + a.email : 'Your personal workspace';
  $('#workspaceIdentity').textContent = a ? 'Signed in as ' + a.email : 'Your workspace';
  $('#account').textContent = a ? 'Account' : 'Sign in';
  $('#account').hidden = !!a;
}
function render() {
  const n = active();
  $('#tabs').replaceChildren(
    ...state.notes.map(note => {
      const b = document.createElement('button');
      b.className = 'tab' + (note.id === n.id ? ' active' : '');
      b.textContent = note.title || 'Untitled note';
      b.onclick = () => {
        state.activeId = note.id;
        save();
        render();
      };
      return b;
    }),
  );
  $('#title').value = n.title;
  $('#editor').innerHTML = n.body;
  $('#noteLabel').textContent = n.title || 'Untitled note';
  $('#timeline').innerHTML =
    '<li>Created ' +
    new Date(n.created).toLocaleString() +
    '</li>' +
    n.events
      .slice(0, 5)
      .map(e => '<li>' + e.kind + ' ' + new Date(e.time).toLocaleString() + '</li>')
      .join('');
  renderIdentity();
}
function edit() {
  const n = active();
  n.title = $('#title').value.trim() || 'Untitled note';
  n.body = $('#editor').innerHTML;
  n.edited = Date.now();
  n.events.unshift({ kind: 'Edited', time: n.edited });
  n.events = n.events.slice(0, 8);
  save('Saved');
  $('#noteLabel').textContent = n.title;
}
function showApp() {
  landing.hidden = true;
  app.classList.add('visible');
  render();
}
function showLanding() {
  app.classList.remove('visible');
  landing.hidden = false;
}
function openConfirm(title, copy, fn) {
  pending = fn;
  $('#confirmTitle').textContent = title;
  $('#confirmCopy').textContent = copy;
  $('#confirmDialog').showModal();
}
$('#openApp').onclick = showApp;
$('#startWriting').onclick = showApp;
$('#back').onclick = showLanding;
$('#newNote').onclick = () => {
  const n = blank();
  state.notes.push(n);
  state.activeId = n.id;
  save('New note');
  render();
};
$('#title').oninput = edit;
$('#editor').oninput = edit;
$('#deleteNote').onclick = () => {
  const n = active();
  openConfirm('Delete note?', 'Delete "' + (n.title || 'Untitled note') + '"? This cannot be undone.', () => {
    state.notes = state.notes.filter(x => x.id !== n.id);
    if (!state.notes.length) state.notes.push(blank());
    state.activeId = state.notes[0].id;
    save();
    render();
  });
};
$('#deleteWorkspace').onclick = () =>
  openConfirm('Delete workspace?', 'This removes every note. This cannot be undone.', () => {
    state = { notes: [initial()], activeId: null };
    state.activeId = state.notes[0].id;
    save();
    render();
    showLanding();
  });
$('#cancelConfirm').onclick = () => $('#confirmDialog').close();
$('#confirmAction').onclick = () => {
  if (pending) pending();
  pending = null;
  $('#confirmDialog').close();
};
$('#exportNote').onclick = () => {
  const n = active();
  openConfirm('Export note?', 'Download "' + (n.title || 'Untitled note') + '" as a text file?', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([n.title + '\n\n' + n.body], { type: 'text/plain' }));
    a.download = (n.title || 'note').replace(/[\\/:*?"<>|]/g, '-') + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });
};
$('#concise').onclick = async () => {
  const text = $('#editor').innerText.trim();
  if (!text) {
    $('#status').textContent = 'Write something first.';
    $('#status').className = 'status error';
    return;
  }
  const b = $('#concise');
  b.disabled = true;
  b.textContent = 'Working...';
  try {
    const r = await fetch(apiEndpoint('rewrite'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw Error();
    const d = await r.json(),
      v = d.text || d.concise || d.result;
    if (!v) throw Error();
    $('#editor').textContent = v;
    edit();
    $('#status').textContent = 'Concise version ready.';
    $('#status').className = 'status good';
  } catch {
    $('#status').textContent = 'Could not reach the concise service.';
    $('#status').className = 'status error';
  } finally {
    b.disabled = false;
    b.textContent = 'Make concise';
  }
};
function openSettings() {
  $('#settingsDialog').showModal();
  document
    .querySelectorAll('[data-key]')
    .forEach(b => b.classList.toggle('active', prefs[b.dataset.key] === b.dataset.value));
}
$('#homeSettings').onclick = openSettings;
$('#workspaceSettings').onclick = openSettings;
document.querySelectorAll('[data-key]').forEach(
  b =>
    (b.onclick = () => {
      prefs[b.dataset.key] = b.dataset.value;
      applyPrefs();
      openSettings();
    }),
);
$('#closeSettings').onclick = () => $('#settingsDialog').close();
$('#signIn').onclick = $('#account').onclick = () => {};
applyPrefs();
render();
