(() => {
  const actions = document.querySelector('.notes-actions');
  const importNotes = document.createElement('button');
  const importAudio = document.createElement('button');
  importNotes.className = importAudio.className = 'btn';
  importNotes.textContent = 'Import notes';
  importAudio.textContent = 'Import audio';
  importNotes.style.gridColumn = importAudio.style.gridColumn = '1 / -1';
  actions.append(importNotes, importAudio);
  const notePicker = document.createElement('input');
  notePicker.type = 'file';
  notePicker.accept = '.txt,.md,text/plain';
  notePicker.multiple = true;
  notePicker.hidden = true;
  const audioPicker = document.createElement('input');
  audioPicker.type = 'file';
  audioPicker.accept = '.wav,audio/wav';
  audioPicker.multiple = true;
  audioPicker.hidden = true;
  document.body.append(notePicker, audioPicker);
  const isAudioPane = () => document.querySelector('.pane-tab.active')?.dataset.pane === 'audio';
  const syncImportButtons = () => {
    importNotes.hidden = isAudioPane();
    importAudio.hidden = !isAudioPane();
  };
  document
    .querySelectorAll('.pane-tab')
    .forEach(button => button.addEventListener('click', () => setTimeout(syncImportButtons, 0)));
  syncImportButtons();
  importNotes.onclick = () => notePicker.click();
  importAudio.onclick = () => audioPicker.click();
  notePicker.onchange = async () => {
    const files = Array.from(notePicker.files);
    if (!files.length) return;
    const imported = await Promise.all(
      files.map(async file => ({
        id: crypto.randomUUID(),
        title: file.name.replace(/\.[^.]+$/, '') || 'Imported note',
        body: await file.text(),
        created: Date.now(),
        edited: Date.now(),
        events: [{ kind: 'Imported', time: Date.now() }],
      })),
    );
    state.notes.push(...imported);
    state.activeId = imported[0].id;
    save('Imported ' + imported.length + ' note' + (imported.length === 1 ? '' : 's'));
    render();
    notePicker.value = '';
  };
  const audioDb = new Promise((resolve, reject) => {
    const request = indexedDB.open('squiggly-recordings-' + OWNER, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  audioPicker.onchange = async () => {
    const files = Array.from(audioPicker.files);
    if (files.some(file => !file.name.toLowerCase().endsWith('.wav'))) {
      showFeedback(
        'WAV files only',
        'This transcription setup accepts WAV audio files only.',
        'Choose a file ending in .wav, then try the import again.',
      );
      audioPicker.value = '';
      return;
    }
    if (!files.length) return;
    const db = await audioDb;
    const transaction = db.transaction('recordings', 'readwrite');
    files.forEach(file =>
      transaction.objectStore('recordings').put({
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, '') || 'Imported audio',
        fileName: file.name,
        created: Date.now(),
        blob: file,
      }),
    );
    transaction.oncomplete = () => location.reload();
    transaction.onerror = () =>
      showFeedback(
        'Could not import audio',
        'One or more audio files could not be stored in this browser.',
        'Choose a valid .wav audio file and try again.',
      );
    audioPicker.value = '';
  };
})();
