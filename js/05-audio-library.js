(() => {
  let activePane = 'notes',
    recordings = [],
    noteAnchor = null,
    audioAnchor = null;
  const noteSelection = new Set(),
    audioSelection = new Set();
  const db = new Promise((resolve, reject) => {
    const request = indexedDB.open('squiggly-recordings-' + OWNER, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('recordings', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const dbRequest = async (mode, value) =>
    new Promise(async (resolve, reject) => {
      const database = await db,
        transaction = database.transaction('recordings', 'readwrite');
      const request =
        mode === 'all'
          ? transaction.objectStore('recordings').getAll()
          : transaction.objectStore('recordings')[mode](value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const refreshRecordings = async () => {
    recordings = await dbRequest('all');
    recordings.sort((a, b) => b.created - a.created);
  };
  const sidebarHead = document.querySelector('.sidebar-head');
  const paneSwitch = document.createElement('div');
  paneSwitch.className = 'choices';
  paneSwitch.innerHTML =
    '<button class="pane-tab active" data-pane="notes">Notes</button><button class="pane-tab" data-pane="audio">Audio</button>';
  sidebarHead.prepend(paneSwitch);
  const setPane = pane => {
    activePane = pane;
    render();
  };
  paneSwitch.querySelectorAll('button').forEach(button => (button.onclick = () => setPane(button.dataset.pane)));
  const applyRange = (items, selection, id, event, anchorRef) => {
    const index = items.findIndex(item => item.id === id);
    if (event.shiftKey && anchorRef.value !== null) {
      const start = Math.min(index, anchorRef.value),
        end = Math.max(index, anchorRef.value);
      for (let i = start; i <= end; i++) selection.add(items[i].id);
    } else if (event.ctrlKey || event.metaKey) {
      selection.has(id) ? selection.delete(id) : selection.add(id);
      anchorRef.value = index;
    } else {
      selection.clear();
      selection.add(id);
      anchorRef.value = index;
    }
  };
  const selectionCount = () => (activePane === 'notes' ? noteSelection.size : audioSelection.size);
  const updateActions = () => {
    const count = selectionCount(),
      exportButton = document.querySelector('#exportNote'),
      deleteButton = document.querySelector('#deleteNote');
    document.querySelector('#newNote').hidden = activePane !== 'notes';
    exportButton.textContent = count ? 'Export (' + count + ')' : 'Export';
    deleteButton.textContent = count ? 'Delete (' + count + ')' : 'Delete';
    document.querySelector('#noteLabel').textContent =
      activePane === 'audio' ? 'Audio recordings' : active().title || 'Untitled note';
  };
  render = () => {
    const tabs = document.querySelector('#tabs');
    tabs.replaceChildren();
    paneSwitch
      .querySelectorAll('button')
      .forEach(button => button.classList.toggle('active', button.dataset.pane === activePane));
    if (activePane === 'notes') {
      state.notes.forEach((note, index) => {
        const row = document.createElement('button');
        row.className = 'tab' + (note.id === state.activeId ? ' active' : '');
        row.style.background = noteSelection.has(note.id) ? 'var(--soft)' : '';
        row.style.boxShadow = noteSelection.has(note.id) ? 'inset 3px 0 var(--ink)' : '';
        row.textContent = note.title || 'Untitled note';
        row.onclick = event => {
          applyRange(state.notes, noteSelection, note.id, event, {
            get value() {
              return noteAnchor;
            },
            set value(v) {
              noteAnchor = v;
            },
          });
          state.activeId = note.id;
          save();
          render();
        };
        tabs.append(row);
      });
      const note = active();
      document.querySelector('#title').value = note.title;
      document.querySelector('#editor').textContent = note.body;
      document.querySelector('#timeline').innerHTML =
        '<li>Created ' +
        new Date(note.created).toLocaleString() +
        '</li>' +
        note.events
          .slice(0, 5)
          .map(event => '<li>' + event.kind + ' ' + new Date(event.time).toLocaleString() + '</li>')
          .join('');
    } else {
      recordings.forEach((recording, index) => {
        const row = document.createElement('button');
        row.className = 'tab';
        row.style.background = audioSelection.has(recording.id) ? 'var(--soft)' : '';
        row.style.boxShadow = audioSelection.has(recording.id) ? 'inset 3px 0 var(--ink)' : '';
        row.textContent = recording.name + ' · ' + new Date(recording.created).toLocaleString();
        row.onclick = event => {
          applyRange(recordings, audioSelection, recording.id, event, {
            get value() {
              return audioAnchor;
            },
            set value(v) {
              audioAnchor = v;
            },
          });
          render();
        };
        tabs.append(row);
      });
      if (!recordings.length)
        tabs.innerHTML = '<p style="color:var(--muted);font-size:.8rem;padding:10px">No recordings yet.</p>';
      document.querySelector('#title').value = 'Audio recordings';
      document.querySelector('#editor').textContent =
        'Select recordings with Ctrl/Cmd-click or Shift-click, then export, delete, or transcribe them.';
      document.querySelector('#timeline').innerHTML = '<li>WAV recordings are stored only in this browser.</li>';
    }
    renderIdentity();
    updateActions();
  };
  const download = (blob, name) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  document.querySelector('#exportNote').onclick = () => {
    if (activePane === 'notes') {
      const notes = noteSelection.size ? state.notes.filter(note => noteSelection.has(note.id)) : [active()];
      openConfirm(
        'Export notes?',
        'Download ' + notes.length + ' text file' + (notes.length === 1 ? '' : 's') + '?',
        () =>
          notes.forEach(note =>
            download(
              new Blob([note.title + '\n\n' + toPlainText(note.body)], { type: 'text/plain' }),
              (note.title || 'note').replace(/[\\/:*?"<>|]/g, '-') + '.txt',
            ),
          ),
      );
    } else {
      const files = recordings.filter(recording => audioSelection.has(recording.id));
      if (!files.length) {
        showFeedback(
          'Select recordings first',
          'No audio files are selected.',
          'Use Ctrl/Cmd-click for individual recordings or Shift-click for a range.',
        );
        return;
      }
      openConfirm(
        'Export recordings?',
        'Download ' + files.length + ' WAV file' + (files.length === 1 ? '' : 's') + '?',
        () =>
          files.forEach(file => download(file.blob, file.fileName || file.name.replace(/[\\/:*?"<>|]/g, '-') + '.wav')),
      );
    }
  };
  document.querySelector('#deleteNote').onclick = () => {
    if (activePane === 'notes') {
      const notes = noteSelection.size ? state.notes.filter(note => noteSelection.has(note.id)) : [active()];
      openConfirm(
        'Delete notes?',
        'Delete ' + notes.length + ' note' + (notes.length === 1 ? '' : 's') + '? This cannot be undone.',
        () => {
          const ids = new Set(notes.map(note => note.id));
          state.notes = state.notes.filter(note => !ids.has(note.id));
          if (!state.notes.length) state.notes.push(blank());
          if (!state.notes.some(note => note.id === state.activeId)) state.activeId = state.notes[0].id;
          noteSelection.clear();
          save();
          render();
        },
      );
    } else {
      const files = recordings.filter(recording => audioSelection.has(recording.id));
      if (!files.length) {
        showFeedback(
          'Select recordings first',
          'No audio files are selected.',
          'Use Ctrl/Cmd-click or Shift-click to select recordings.',
        );
        return;
      }
      openConfirm(
        'Delete recordings?',
        'Delete ' + files.length + ' WAV file' + (files.length === 1 ? '' : 's') + '? This cannot be undone.',
        async () => {
          await Promise.all(files.map(file => dbRequest('delete', file.id)));
          audioSelection.clear();
          await refreshRecordings();
          render();
        },
      );
    }
  };
  const floatToWav = (chunks, sampleRate) => {
    const size = chunks.reduce((total, chunk) => total + chunk.length, 0),
      buffer = new ArrayBuffer(44 + size * 2),
      view = new DataView(buffer);
    const write = (offset, value) =>
      value.split('').forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    write(0, 'RIFF');
    view.setUint32(4, 36 + size * 2, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, size * 2, true);
    let offset = 44;
    chunks.forEach(chunk =>
      chunk.forEach(sample => {
        view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
        offset += 2;
      }),
    );
    return new Blob([buffer], { type: 'audio/wav' });
  };
  let recordingStream,
    audioContext,
    processor,
    audioChunks = [];
  const mic = document.querySelector('#transcribe');
  mic.onclick = async () => {
    const status = document.querySelector('#status');
    if (processor) {
      processor.disconnect();
      audioContext.close();
      recordingStream.getTracks().forEach(track => track.stop());
      const blob = floatToWav(audioChunks, audioContext.sampleRate);
      await dbRequest('put', {
        id: crypto.randomUUID(),
        name: 'Recording ' + new Date().toLocaleTimeString(),
        created: Date.now(),
        blob,
      });
      processor = null;
      mic.innerHTML = window.microphoneGlyph;
      status.textContent = 'WAV recording saved to Audio.';
      status.className = 'status good';
      await refreshRecordings();
      return;
    }
    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new AudioContext();
      audioChunks = [];
      const source = audioContext.createMediaStreamSource(recordingStream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = event => audioChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      const silent = audioContext.createGain();
      silent.gain.value = 0;
      source.connect(processor);
      processor.connect(silent);
      silent.connect(audioContext.destination);
      mic.innerHTML = '&#9632;';
      status.textContent = 'Recording WAV… click again to save.';
      status.className = 'status';
    } catch {
      showFeedback(
        'Microphone unavailable',
        'A WAV recording could not be started.',
        'Allow microphone access in your browser settings, then try again.',
      );
    }
  };
  const transcribeSelected = async () => {
    const files = recordings.filter(recording => audioSelection.has(recording.id));
    if (!files.length) {
      showFeedback(
        'Select recordings first',
        'No audio files are selected.',
        'Open Audio, then use Ctrl/Cmd-click or Shift-click to select WAV files.',
      );
      return;
    }
    if (!document.querySelector('#apiTunnel').value.trim()) {
      showFeedback(
        'Add a transcription endpoint',
        'Audio transcription needs your ngrok rewrite URL.',
        'Paste the /rewrite URL into API tunnel; the app will use its /transcribe route.',
      );
      return;
    }
    const status = document.querySelector('#status');
    status.textContent = 'Transcribing ' + files.length + ' recording' + (files.length === 1 ? '' : 's') + '…';
    status.className = 'status';
    try {
      const texts = [];
      for (const file of files) {
        const form = new FormData();
        form.append('file', file.blob, file.fileName || file.name + '.wav');
        const response = await window.transcribeWithFallback(form);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json(),
          text = data.text || data.transcript || data.result;
        if (!text) throw new Error('No transcript returned');
        texts.push(text);
      }
      activePane = 'notes';
      const editor = document.querySelector('#editor');
      editor.innerText += (editor.innerText ? '\n\n' : '') + texts.join('\n\n');
      edit();
      status.textContent = 'Transcript added to the active note.';
      status.className = 'status good';
      render();
    } catch (error) {
      showFeedback(
        'Transcription failed',
        error.message || 'The selected WAV files could not be transcribed.',
        'Check the /transcribe endpoint in your API tunnel and try again.',
      );
    }
  };
  const transcribeAction = document.createElement('button');
  transcribeAction.className = 'btn';
  transcribeAction.textContent = 'Transcribe audio';
  transcribeAction.onclick = transcribeSelected;
  document.querySelector('.notes-actions').append(transcribeAction);
  refreshRecordings().then(() => render());
})();

(() => {
  const rightPanel = document.querySelector('.timeline');
  rightPanel.style.cssText += ';display:flex;flex-direction:column;gap:10px';
  rightPanel.querySelector('h2').textContent = 'Edit history';
  rightPanel.querySelector('#timeline').style.cssText =
    'margin:0;max-height:180px;overflow:auto;border:1px solid var(--line);border-radius:9px;padding:0 10px';
  rightPanel.querySelectorAll(':scope > div').forEach(section => {
    section.style.cssText =
      'margin:0;padding:12px;border:1px solid var(--line);border-radius:9px;background:var(--soft)';
  });
})();

(() => {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<dialog class="dialog" id="audioRenameDialog"><div class="eyebrow">Audio library</div><h2 style="margin-top:8px">Rename recording</h2><input id="audioRenameInput" type="text" maxlength="80" required style="width:100%;margin-top:12px;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--ink);padding:10px;outline:0"><div class="dialog-actions"><button class="btn" id="audioRenameCancel">Cancel</button><button class="btn primary" id="audioRenameSave">Save name</button></div></dialog>',
  );
  const dialog = document.querySelector('#audioRenameDialog'),
    input = document.querySelector('#audioRenameInput'),
    tabs = document.querySelector('#tabs');
  let target = null,
    timer;
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open('squiggly-recordings-' + OWNER, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const getFiles = () =>
    new Promise(async (resolve, reject) => {
      const db = await database,
        request = db.transaction('recordings').objectStore('recordings').getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.created - a.created));
      request.onerror = () => reject(request.error);
    });
  const putFile = file =>
    new Promise(async (resolve, reject) => {
      const db = await database,
        request = db.transaction('recordings', 'readwrite').objectStore('recordings').put(file);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  const isAudioPane = () => document.querySelector('.pane-tab.active')?.dataset.pane === 'audio';
  const enhanceAudio = async () => {
    if (!isAudioPane()) return;
    const files = await getFiles();
    if (!isAudioPane()) return;
    const buttons = Array.from(tabs.querySelectorAll(':scope > .tab:not([data-audio-ready])'));
    buttons.forEach((button, index) => {
      const file = files[index];
      if (!file) return;
      button.dataset.audioReady = 'true';
      button.dataset.audioId = file.id;
      button.textContent = file.name;
      const row = document.createElement('div');
      row.className = 'audio-library-row';
      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:.72rem;color:var(--muted)';
      meta.textContent = new Date(file.created).toLocaleString() + ' · WAV recording';
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = URL.createObjectURL(file.blob);
      audio.onclick = event => event.stopPropagation();
      audio.onplay = event => event.stopPropagation();
      const rename = document.createElement('button');
      rename.className = 'btn';
      rename.textContent = 'Rename';
      rename.style.cssText = 'justify-self:start;padding:6px 9px';
      rename.onclick = event => {
        event.stopPropagation();
        target = file;
        input.value = file.name;
        if (!dialog.open) dialog.showModal();
        input.focus();
        input.select();
      };
      button.replaceWith(row);
      row.append(button, meta, audio, rename);
    });
    tabs.querySelectorAll('audio').forEach(audio => {
      audio.onclick = event => event.stopPropagation();
    });
  };
  document.querySelector('#audioRenameCancel').onclick = () => dialog.close();
  document.querySelector('#audioRenameSave').onclick = async () => {
    const name = input.value.trim();
    if (!name) {
      input.reportValidity();
      return;
    }
    target.name = name;
    await putFile(target);
    const button = tabs.querySelector('[data-audio-id="' + target.id + '"]');
    if (button) button.textContent = name;
    dialog.close();
  };
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhanceAudio, 0);
  }).observe(tabs, { childList: true, subtree: false });
  document
    .querySelectorAll('.pane-tab')
    .forEach(button => button.addEventListener('click', () => setTimeout(enhanceAudio, 0)));
  enhanceAudio();
})();

(() => {
  const header = document.querySelector('.sidebar-head');
  const switcher = header.querySelector('.choices');
  const title = header.querySelector('h2');
  const actions = header.querySelector('.notes-actions');
  header.style.cssText = 'display:grid;grid-template-columns:1fr;gap:10px;align-items:stretch';
  title.hidden = true;
  switcher.style.cssText = 'display:flex;gap:6px;width:100%';
  switcher.querySelectorAll('button').forEach(button => (button.style.cssText = 'flex:1;min-height:38px'));
  actions.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:7px;width:100%';
  Array.from(actions.querySelectorAll('button')).forEach(button => {
    button.style.cssText += ';width:100%;min-height:38px;justify-content:center';
    if (button.id === 'newNote' || button.textContent.includes('Transcribe')) button.style.gridColumn = '1 / -1';
  });
})();

(() => {
  const paneButtons = document.querySelectorAll('.pane-tab');
  const syncPaneColors = () =>
    paneButtons.forEach(button => {
      button.style.borderRadius = '8px';
      button.style.borderColor = 'var(--line)';
      button.style.background = button.classList.contains('active') ? 'var(--ink)' : 'var(--soft)';
      button.style.color = button.classList.contains('active') ? 'var(--paper)' : 'var(--ink)';
    });
  syncPaneColors();
  paneButtons.forEach(button => button.addEventListener('click', () => setTimeout(syncPaneColors, 0)));
  const newButton = document.querySelector('#newNote');
  newButton.style.borderRadius = '8px';
  newButton.style.boxShadow = 'none';
})();

(() => {
  const tabs = document.querySelector('#tabs');
  const syncPane = () => {
    const audioOpen = document.querySelector('.pane-tab.active')?.dataset.pane === 'audio';
    document.body.classList.toggle('notes-pane', !audioOpen);
    document.body.classList.toggle('audio-pane', audioOpen);
    if (!audioOpen) tabs.querySelectorAll('.audio-library-row').forEach(row => row.remove());
    const transcribe = Array.from(document.querySelectorAll('.notes-actions button')).find(button =>
      button.textContent.includes('Transcribe'),
    );
    if (transcribe) transcribe.hidden = !audioOpen;
  };
  document
    .querySelectorAll('.pane-tab')
    .forEach(button => button.addEventListener('click', () => setTimeout(syncPane, 0)));
  new MutationObserver(syncPane).observe(tabs, { childList: true });
  syncPane();
})();
