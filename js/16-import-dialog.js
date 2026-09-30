(() => {
  document.querySelectorAll('.notes-actions button').forEach(button => {
    if (/^Import (notes|audio)$/i.test(button.textContent)) button.hidden = true;
  });
  const actions = document.querySelector('.notes-actions');
  const importButton = document.createElement('button');
  importButton.className = 'btn';
  importButton.textContent = 'Import';
  actions.append(importButton);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<dialog class="dialog" id="importDialog"><div class="eyebrow">Import</div><h2 style="margin-top:8px">Add files</h2><p>Notes accept .txt or .md. Audio accepts .wav only.</p><div class="dialog-actions" style="justify-content:flex-start"><button class="btn primary" id="importNotesChoice">Import notes</button><button class="btn" id="importAudioChoice">Import WAV audio</button></div><div class="dialog-actions"><button class="btn" id="closeImportDialog">Cancel</button></div></dialog>',
  );
  const dialog = document.querySelector('#importDialog');
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
  importButton.onclick = () => dialog.showModal();
  document.querySelector('#closeImportDialog').onclick = () => dialog.close();
  document.querySelector('#importNotesChoice').onclick = () => {
    dialog.close();
    notePicker.click();
  };
  document.querySelector('#importAudioChoice').onclick = () => {
    dialog.close();
    audioPicker.click();
  };
  notePicker.onchange = async () => {
    const files = Array.from(notePicker.files);
    if (!files.length) return;
    try {
      const notes = await Promise.all(
        files.map(async file => ({
          id: crypto.randomUUID(),
          title: file.name.replace(/\.[^.]+$/, '') || 'Imported note',
          body: await file.text(),
          created: Date.now(),
          edited: Date.now(),
          events: [{ kind: 'Imported', time: Date.now() }],
        })),
      );
      state.notes.push(...notes);
      state.activeId = notes[0].id;
      save('Imported ' + notes.length + ' note' + (notes.length === 1 ? '' : 's'));
      render();
    } catch (error) {
      console.error('Note import error:', error);
      showFeedback('Could not import notes', 'The selected text file could not be read.', 'Try a .txt or .md file.');
    } finally {
      notePicker.value = '';
    }
  };
  audioPicker.onchange = () => {
    const files = Array.from(audioPicker.files);
    if (!files.length) return;
    if (files.some(file => !/\.wav$/i.test(file.name))) {
      showFeedback(
        'WAV files only',
        'Audio import accepts .wav files only.',
        'Choose one or more WAV files and try again.',
      );
      audioPicker.value = '';
      return;
    }
    const request = indexedDB.open('squiggly-recordings-' + OWNER, 1);
    request.onerror = () =>
      showFeedback(
        'Could not import audio',
        'The audio library could not be opened in this browser.',
        'Try again after reloading the page.',
      );
    request.onsuccess = () => {
      try {
        const transaction = request.result.transaction('recordings', 'readwrite');
        files.forEach(file =>
          transaction.objectStore('recordings').put({
            id: crypto.randomUUID(),
            name: file.name.replace(/\.[^.]+$/, '') || 'Imported audio',
            fileName: file.name,
            created: Date.now(),
            blob: file,
          }),
        );
        transaction.oncomplete = () => {
          window.refreshAudioLibrary?.();
          showFeedback(
            'Audio imported',
            files.length + ' WAV file' + (files.length === 1 ? ' was' : 's were') + ' added to Audio.',
            'Open the Audio tab to select or play the recordings.',
          );
        };
        transaction.onerror = () =>
          showFeedback(
            'Could not import audio',
            'The WAV file could not be stored.',
            'Make sure the file is a valid WAV audio file.',
          );
      } catch (error) {
        console.error('Audio import error:', error);
        showFeedback('Could not import audio', 'The audio library was not ready.', 'Reload the page and try again.');
      }
    };
    audioPicker.value = '';
  };
})();

(() => {
  const removeOldImportButtons = () => {
    document.querySelectorAll('.notes-actions button').forEach(button => {
      if (/^Import (notes|audio)$/i.test(button.textContent)) button.remove();
    });
  };
  removeOldImportButtons();
  new MutationObserver(removeOldImportButtons).observe(document.querySelector('.notes-actions'), { childList: true });
})();
