(() => {
  const selectedNotes = new Set();
  const getSelected = () => {
    const chosen = state.notes.filter(note => selectedNotes.has(note.id));
    return chosen.length ? chosen : [active()];
  };
  const updateSelectionLabels = () => {
    const count = selectedNotes.size;
    document.querySelector('#exportNote').textContent = count ? 'Export (' + count + ')' : 'Export';
    document.querySelector('#deleteNote').textContent = count ? 'Delete (' + count + ')' : 'Delete';
  };
  render = () => {
    const note = active();
    const tabs = document.querySelector('#tabs');
    tabs.replaceChildren(
      ...state.notes.map(item => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:5px';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedNotes.has(item.id);
        checkbox.setAttribute('aria-label', 'Select ' + (item.title || 'Untitled note'));
        checkbox.onchange = () => {
          if (checkbox.checked) selectedNotes.add(item.id);
          else selectedNotes.delete(item.id);
          updateSelectionLabels();
        };
        const button = document.createElement('button');
        button.className = 'tab' + (item.id === note.id ? ' active' : '');
        button.style.flex = '1';
        button.textContent = item.title || 'Untitled note';
        button.onclick = () => {
          state.activeId = item.id;
          save();
          render();
        };
        row.append(checkbox, button);
        return row;
      }),
    );
    document.querySelector('#title').value = note.title;
    document.querySelector('#editor').innerHTML = note.body;
    document.querySelector('#noteLabel').textContent = note.title || 'Untitled note';
    document.querySelector('#timeline').innerHTML =
      '<li>Created ' +
      new Date(note.created).toLocaleString() +
      '</li>' +
      note.events
        .slice(0, 5)
        .map(event => '<li>' + event.kind + ' ' + new Date(event.time).toLocaleString() + '</li>')
        .join('');
    renderIdentity();
    updateSelectionLabels();
  };
  document.querySelector('#exportNote').onclick = () => {
    const notes = getSelected();
    const description =
      notes.length === 1 ? '"' + (notes[0].title || 'Untitled note') + '"' : notes.length + ' selected notes';
    openConfirm(
      'Export ' + (notes.length === 1 ? 'note?' : 'notes?'),
      'Download ' + description + ' as text files?',
      () => {
        notes.forEach(note => {
          const link = document.createElement('a');
          link.href = URL.createObjectURL(
            new Blob([note.title + '\n\n' + toPlainText(note.body)], { type: 'text/plain' }),
          );
          link.download = (note.title || 'note').replace(/[\\/:*?"<>|]/g, '-') + '.txt';
          link.click();
          URL.revokeObjectURL(link.href);
        });
      },
    );
  };
  document.querySelector('#deleteNote').onclick = () => {
    const notes = getSelected();
    const description =
      notes.length === 1 ? '"' + (notes[0].title || 'Untitled note') + '"' : notes.length + ' selected notes';
    openConfirm(
      'Delete ' + (notes.length === 1 ? 'note?' : 'notes?'),
      'Delete ' + description + '? This cannot be undone.',
      () => {
        const ids = new Set(notes.map(note => note.id));
        state.notes = state.notes.filter(note => !ids.has(note.id));
        if (!state.notes.length) state.notes.push(blank());
        if (!state.notes.some(note => note.id === state.activeId)) state.activeId = state.notes[0].id;
        selectedNotes.clear();
        save();
        render();
      },
    );
  };
  render();
})();
