(() => {
  const originalEdit = edit;
  const lastSnapshotAt = new Map();

  edit = () => {
    const note = active();
    const now = Date.now();
    const last = lastSnapshotAt.get(note.id) || 0;
    // One snapshot per typing burst keeps history useful without filling storage.
    if (now - last > 5000) {
      note.history = Array.isArray(note.history) ? note.history : [];
      const latest = note.history[0];
      if (!latest || latest.title !== note.title || latest.body !== note.body) {
        note.history.unshift({ title: note.title, body: note.body, time: now });
        note.history = note.history.slice(0, 20);
      }
      lastSnapshotAt.set(note.id, now);
    }
    originalEdit();
  };
  document.querySelector('#title').oninput = edit;
  document.querySelector('#editor').oninput = edit;

  const priorRender = render;
  render = () => {
    priorRender();
    const note = active();
    const timeline = document.querySelector('#timeline');
    if (!note || !timeline || !document.querySelector('#editor').isContentEditable) return;
    const history = Array.isArray(note.history) ? note.history : [];
    timeline.replaceChildren();
    const created = document.createElement('li');
    created.textContent = 'Created ' + new Date(note.created).toLocaleString();
    timeline.append(created);
    if (!history.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Your saved edit versions will appear here.';
      timeline.append(empty);
      return;
    }
    history.slice(0, 10).forEach((version, index) => {
      const item = document.createElement('li');
      item.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px';
      const label = document.createElement('span');
      label.textContent = 'Version ' + (index + 1) + ' · ' + new Date(version.time).toLocaleString();
      const restore = document.createElement('button');
      restore.className = 'btn';
      restore.textContent = 'Restore';
      restore.style.cssText = 'padding:4px 7px;font-size:.7rem';
      restore.onclick = () => {
        const current = active();
        current.history = Array.isArray(current.history) ? current.history : [];
        current.history.unshift({ title: current.title, body: current.body, time: Date.now() });
        current.history = current.history.slice(0, 20);
        current.title = version.title;
        current.body = version.body;
        current.edited = Date.now();
        current.events = Array.isArray(current.events) ? current.events : [];
        current.events.unshift({ kind: 'Restored a previous version', time: current.edited });
        save('Previous version restored');
        render();
      };
      item.append(label, restore);
      timeline.append(item);
    });
  };
  render();
})();

(() => {
  let pendingSnapshot;
  let previewVersion = null;
  const editor = document.querySelector('#editor');
  const title = document.querySelector('#title');
  const timeline = document.querySelector('#timeline');

  document.body.insertAdjacentHTML(
    'beforeend',
    '<dialog class="dialog" id="historyPreview" style="width:min(760px,calc(100% - 28px))"><div class="eyebrow">Edit history</div><h2 id="historyPreviewTitle" style="margin:8px 0"></h2><p id="historyPreviewTime"></p><div id="historyPreviewBody" style="min-height:180px;max-height:48vh;overflow:auto;border:1px solid var(--line);border-radius:9px;padding:14px;line-height:1.7"></div><div class="dialog-actions"><button class="btn" id="closeHistoryPreview">Cancel</button><button class="btn primary" id="restoreHistoryPreview">Restore this version</button></div></dialog>',
  );
  const dialog = document.querySelector('#historyPreview');

  const versions = note => (Array.isArray(note.history) ? note.history : (note.history = []));
  const addVersion = note => {
    const list = versions(note);
    const candidate = { title: note.title, body: note.body, time: Date.now() };
    const latest = list[0];
    if (!latest || latest.title !== candidate.title || latest.body !== candidate.body) {
      list.unshift(candidate);
      note.history = list.slice(0, 20);
      save('Version saved');
    }
  };

  const refreshHistory = () => {
    const note = active();
    if (!note || !timeline || !editor.isContentEditable) return;
    timeline.replaceChildren();
    const heading = document.createElement('li');
    heading.textContent = 'Edit history';
    heading.style.cssText = 'font-weight:700;color:var(--ink)';
    timeline.append(heading);
    const list = versions(note);
    if (!list.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Start editing to save versions.';
      timeline.append(empty);
      return;
    }
    list.slice(0, 10).forEach((version, index) => {
      const item = document.createElement('li');
      const view = document.createElement('button');
      view.className = 'btn';
      view.textContent = 'Version ' + (index + 1) + ' · ' + new Date(version.time).toLocaleString();
      view.style.cssText = 'width:100%;text-align:left;padding:7px 8px;font-size:.72rem';
      view.onclick = () => {
        previewVersion = version;
        document.querySelector('#historyPreviewTitle').textContent = version.title || 'Untitled note';
        document.querySelector('#historyPreviewTime').textContent = 'Saved ' + new Date(version.time).toLocaleString();
        document.querySelector('#historyPreviewBody').innerHTML =
          version.body || '<span style="color:var(--muted)">This version is empty.</span>';
        dialog.showModal();
      };
      item.append(view);
      timeline.append(item);
    });
  };

  const queueSnapshot = () => {
    clearTimeout(pendingSnapshot);
    pendingSnapshot = setTimeout(() => {
      addVersion(active());
      refreshHistory();
    }, 4000);
  };
  editor.addEventListener('input', queueSnapshot);
  title.addEventListener('input', queueSnapshot);

  document.querySelector('#closeHistoryPreview').onclick = () => dialog.close();
  document.querySelector('#restoreHistoryPreview').onclick = () => {
    if (!previewVersion) return;
    const note = active();
    addVersion(note);
    note.title = previewVersion.title;
    note.body = previewVersion.body;
    note.edited = Date.now();
    note.events = Array.isArray(note.events) ? note.events : [];
    note.events.unshift({ kind: 'Restored a previous version', time: note.edited });
    save('Previous version restored');
    dialog.close();
    render();
  };

  const priorRender = render;
  render = () => {
    priorRender();
    refreshHistory();
  };
  refreshHistory();
})();

(() => {
  const head = document.querySelector('.workspace-head');
  const saved = document.querySelector('#saveState');
  if (!head || document.querySelector('#openVersionHistory')) return;
  const open = document.createElement('button');
  open.id = 'openVersionHistory';
  open.className = 'btn';
  open.textContent = 'Edit history';
  open.style.cssText = 'margin-left:auto;padding:6px 8px;font-size:.72rem';
  head.insertBefore(open, saved);

  document.body.insertAdjacentHTML(
    'beforeend',
    '<dialog class="dialog" id="versionHistoryDialog" style="width:min(820px,calc(100% - 28px))"><div class="eyebrow">Edit history</div><h2 style="margin:8px 0">Saved versions</h2><p>Choose a version to preview it before restoring.</p><div id="versionHistoryList" style="display:grid;gap:8px;max-height:52vh;overflow:auto"></div><div class="dialog-actions"><button class="btn" id="closeVersionHistory">Done</button></div></dialog>',
  );
  const dialog = document.querySelector('#versionHistoryDialog');
  const list = document.querySelector('#versionHistoryList');
  let timer;

  const snapshots = note => (Array.isArray(note.history) ? note.history : (note.history = []));
  const record = () => {
    const note = active();
    const versions = snapshots(note);
    const version = { title: note.title, body: note.body, time: Date.now() };
    const last = versions[0];
    if (!last || last.title !== version.title || last.body !== version.body) {
      versions.unshift(version);
      note.history = versions.slice(0, 20);
      save('Version saved');
    }
  };
  const renderDialog = () => {
    const versions = snapshots(active());
    list.replaceChildren();
    if (!versions.length) {
      list.innerHTML =
        '<div style="padding:18px;border:1px dashed var(--line);border-radius:9px;color:var(--muted)">No saved versions yet. Make an edit, then pause for a few seconds.</div>';
      return;
    }
    versions.forEach((version, index) => {
      const card = document.createElement('article');
      card.style.cssText =
        'padding:12px;border:1px solid var(--line);border-radius:9px;display:flex;align-items:center;justify-content:space-between;gap:12px';
      const details = document.createElement('div');
      details.style.minWidth = '0';
      const name = document.createElement('strong');
      name.textContent = version.title || 'Untitled note';
      const time = document.createElement('div');
      time.className = 'eyebrow';
      time.style.marginTop = '4px';
      time.textContent = 'Version ' + (index + 1) + ' · ' + new Date(version.time).toLocaleString();
      details.append(name, time);
      const preview = document.createElement('button');
      preview.className = 'btn';
      preview.textContent = 'Preview';
      preview.onclick = () => {
        document.querySelector('#historyPreviewTitle').textContent = version.title || 'Untitled note';
        document.querySelector('#historyPreviewTime').textContent = 'Saved ' + new Date(version.time).toLocaleString();
        document.querySelector('#historyPreviewBody').innerHTML =
          version.body || '<span style="color:var(--muted)">This version is empty.</span>';
        document.querySelector('#restoreHistoryPreview').onclick = () => {
          const note = active();
          record();
          note.title = version.title;
          note.body = version.body;
          note.edited = Date.now();
          save('Previous version restored');
          document.querySelector('#historyPreview').close();
          render();
          renderDialog();
        };
        document.querySelector('#historyPreview').showModal();
      };
      card.append(details, preview);
      list.append(card);
    });
  };
  open.onclick = () => {
    renderDialog();
    dialog.showModal();
  };
  document.querySelector('#closeVersionHistory').onclick = () => dialog.close();
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(record, 5000);
  };
  document.querySelector('#editor').addEventListener('input', schedule);
  document.querySelector('#title').addEventListener('input', schedule);
})();
