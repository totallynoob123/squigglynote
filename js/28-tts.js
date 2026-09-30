(() => {
  const toolbarActions = document.querySelector('#app .toolbar .actions');
  if (!toolbarActions || document.querySelector('#openTts')) return;
  const button = document.createElement('button');
  button.className = 'btn gear';
  button.id = 'openTts';
  button.setAttribute('aria-label', 'Read note aloud');
  button.title = 'Read note aloud';
  button.innerHTML = '&#128266;';
  toolbarActions.insertBefore(button, toolbarActions.querySelector('#concise'));

  document.body.insertAdjacentHTML(
    'beforeend',
    '<dialog class="dialog" id="ttsDialog"><div class="eyebrow">Text to speech</div><h2 style="margin-top:8px">Read this note aloud</h2><p>Choose a Kokoro voice, then generate audio from the active note.</p><label class="eyebrow" for="ttsVoice">Voice</label><select id="ttsVoice" style="width:100%;margin-top:8px;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--ink);padding:9px;outline:0"><optgroup label="American Female"><option value="af_heart">Heart</option><option value="af_bella">Bella</option><option value="af_nicole">Nicole</option><option value="af_alloy">Alloy</option><option value="af_aoede">Aoede</option><option value="af_jessica">Jessica</option><option value="af_kore">Kore</option><option value="af_nova">Nova</option><option value="af_river">River</option><option value="af_sarah">Sarah</option><option value="af_sky">Sky</option></optgroup><optgroup label="American Male"><option value="am_adam">Adam</option><option value="am_michael">Michael</option><option value="am_echo">Echo</option><option value="am_eric">Eric</option><option value="am_fenrir">Fenrir</option><option value="am_liam">Liam</option><option value="am_onyx">Onyx</option><option value="am_puck">Puck</option></optgroup><optgroup label="British Female"><option value="bf_emma">Emma</option><option value="bf_alice">Alice</option><option value="bf_isabella">Isabella</option><option value="bf_lily">Lily</option></optgroup><optgroup label="British Male"><option value="bm_george">George</option><option value="bm_daniel">Daniel</option><option value="bm_fable">Fable</option><option value="bm_lewis">Lewis</option></optgroup></select><div class="status" id="ttsStatus"></div><audio id="ttsPlayer" controls style="width:100%;display:none;margin-top:8px"></audio><div class="dialog-actions"><button class="btn" id="closeTts">Close</button><button class="btn primary" id="generateTts">Generate speech</button></div></dialog>',
  );
  const dialog = document.querySelector('#ttsDialog');
  const player = document.querySelector('#ttsPlayer');
  const status = document.querySelector('#ttsStatus');
  let audioUrl = '';
  const endpoint = () => {
    const entered = document.querySelector('#apiTunnel')?.value.trim();
    if (entered) {
      return window.resolveApiTunnel(entered, 'tts');
    }
    return window.SQUIGGLY_API + '/tts';
  };
  button.onclick = () => {
    status.textContent = '';
    player.style.display = 'none';
    if (!dialog.open) dialog.showModal();
  };
  document.querySelector('#closeTts').onclick = () => {
    player.pause();
    dialog.close();
  };
  document.querySelector('#generateTts').onclick = async event => {
    const text = document.querySelector('#editor').innerText.trim();
    if (!text) {
      status.textContent = 'Write something in the note first.';
      status.className = 'status error';
      return;
    }
    event.currentTarget.disabled = true;
    status.textContent = 'Generating speech…';
    status.className = 'status';
    try {
      const response = await fetch(endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: document.querySelector('#ttsVoice').value }),
      });
      if (!response.ok) throw new Error('Jetson returned HTTP ' + response.status + ': ' + (await response.text()));
      const blob = await response.blob();
      const recording = {
        id: crypto.randomUUID(),
        name: 'Read aloud — ' + (document.querySelector('#title').value.trim() || 'Untitled note'),
        created: Date.now(),
        blob,
      };
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('squiggly-recordings-' + OWNER, 1);
        request.onsuccess = () => {
          const write = request.result.transaction('recordings', 'readwrite').objectStore('recordings').put(recording);
          write.onsuccess = () => resolve();
          write.onerror = () => reject(write.error);
        };
        request.onerror = () => reject(request.error);
      });
      window.dispatchEvent(new CustomEvent('squiggly-audio-saved', { detail: recording }));
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(blob);
      player.src = audioUrl;
      player.style.display = 'block';
      await player.play();
      status.textContent = 'Finished.';
      status.className = 'status good';
    } catch (error) {
      console.error('TTS failed:', error);
      status.textContent = 'Error: ' + error.message;
      status.className = 'status error';
    } finally {
      event.currentTarget.disabled = false;
    }
  };
})();

(() => {
  const tabs = document.querySelector('#tabs');
  const isAudioOpen = () => document.querySelector('.pane-tab.active')?.dataset.pane === 'audio';
  const addGeneratedRow = recording => {
    if (!tabs || !isAudioOpen() || tabs.textContent.includes(recording.name)) return;
    const row = document.createElement('div');
    row.className = 'audio-library-row';
    row.dataset.generatedAudioId = recording.id;
    const name = document.createElement('div');
    name.className = 'tab';
    name.textContent = recording.name;
    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:.72rem;color:var(--muted)';
    meta.textContent = new Date(recording.created).toLocaleString() + ' · Generated speech';
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = URL.createObjectURL(recording.blob);
    row.append(name, meta, audio);
    tabs.prepend(row);
  };
  window.addEventListener('squiggly-audio-saved', event => addGeneratedRow(event.detail));
  document.querySelector('.pane-tab[data-pane="audio"]')?.addEventListener('click', () => {
    const request = indexedDB.open('squiggly-recordings-' + OWNER, 1);
    request.onsuccess = () => {
      const get = request.result.transaction('recordings').objectStore('recordings').getAll();
      get.onsuccess = () =>
        setTimeout(() => get.result.filter(file => file.name?.startsWith('Read aloud —')).forEach(addGeneratedRow), 0);
    };
  });
})();
