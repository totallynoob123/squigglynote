(() => {
  const OPENROUTER_KEY = 'squiggly-openrouter-key-v1';
  const PROVIDER_KEY = 'squiggly-ai-provider-v1';
  const CHAT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
  const getMode = () =>
    localStorage.getItem(PROVIDER_KEY) || (localStorage.getItem(OPENROUTER_KEY) ? 'openrouter' : 'tunnel');
  const setMode = value => localStorage.setItem(PROVIDER_KEY, value);
  const openSetup = () => {
    const dialog = document.querySelector('#openrouterDialog');
    if (dialog && !dialog.open) dialog.showModal();
  };
  const endpointFor = action => {
    const value = document.querySelector('#apiTunnel')?.value.trim();
    if (!value) return '';
    return window.resolveApiTunnel(value, action);
  };
  const aiPrefs = () => ({
    temperature: 0.7,
    maxTokens: 1024,
    reasoning: 1,
    ...JSON.parse(localStorage.getItem('squiggly-openrouter-preferences-v1') || '{}'),
  });
  const openRouter = async body => {
    const key = localStorage.getItem(OPENROUTER_KEY);
    if (!key) throw new Error('No OpenRouter key is saved.');
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
        'HTTP-Referer': location.origin,
        'X-Title': 'Squiggly Note',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('OpenRouter returned HTTP ' + response.status + '.');
    return response.json();
  };
  const options = () => {
    const p = aiPrefs();
    return {
      temperature: Number(p.temperature),
      max_tokens: Number(p.maxTokens),
      reasoning: { effort: ['low', 'medium', 'high'][Number(p.reasoning) || 0] },
    };
  };

  const settings = document.querySelector('#settingsDialog');
  const aiSettings = document.querySelector('#aiSettings');
  if (settings && aiSettings && !document.querySelector('#providerSetting')) {
    const section = document.createElement('div');
    section.className = 'ai-setting';
    section.id = 'providerSetting';
    section.innerHTML =
      '<label>AI provider <output id="providerValue"></output></label><small>OpenRouter powers the free models. The API tunnel uses your configured local service.</small><div class="provider-toggle"><span>Use OpenRouter</span><input type="checkbox" id="providerToggle" aria-label="Use OpenRouter API"></div>';
    aiSettings.prepend(section);
    const toggle = section.querySelector('#providerToggle'),
      value = section.querySelector('#providerValue');
    const refresh = () => {
      const openrouter = getMode() === 'openrouter';
      toggle.checked = openrouter;
      value.value = openrouter ? 'OpenRouter' : 'API tunnel';
    };
    toggle.onchange = () => {
      setMode(toggle.checked ? 'openrouter' : 'tunnel');
      refresh();
    };
    refresh();
  }

  const messages = document.querySelector('#notesChatMessages');
  const input = document.querySelector('#notesChatInput');
  const send = document.querySelector('#notesChatSend');
  const message = (text, role) => {
    const item = document.createElement('div');
    item.style.cssText =
      'padding:9px 10px;border-radius:8px;font-size:.86rem;line-height:1.45;white-space:pre-wrap;' +
      (role === 'user'
        ? 'background:var(--ink);color:var(--paper);margin-left:28px'
        : 'background:var(--soft);margin-right:28px');
    item.textContent = text;
    messages.append(item);
    messages.scrollTop = messages.scrollHeight;
    return item;
  };
  if (messages && input && send) {
    send.onclick = async () => {
      const question = input.value.trim();
      if (!question) return;
      const preferOpenRouter = getMode() === 'openrouter';
      const useOpenRouter = preferOpenRouter && !!localStorage.getItem(OPENROUTER_KEY);
      const tunnel = endpointFor('chat');
      if (!useOpenRouter && !tunnel) {
        if (preferOpenRouter) openSetup();
        else message('Add an API tunnel URL in the workspace, or switch to OpenRouter in Settings.', 'assistant');
        return;
      }
      message(question, 'user');
      input.value = '';
      send.disabled = true;
      const waiting = message('Thinking…', 'assistant');
      try {
        const note = window.active?.() || {};
        if (useOpenRouter) {
          const data = await openRouter({
            model: CHAT_MODEL,
            messages: [
              {
                role: 'system',
                content:
                  'You are SquigglyBot, a concise and helpful writing companion. Answer using the active note as context when relevant.',
              },
              {
                role: 'user',
                content:
                  'Active note title: ' +
                  (note.title || 'Untitled') +
                  '\n\nActive note:\n' +
                  (note.body || '') +
                  '\n\nQuestion: ' +
                  question,
              },
            ],
            ...options(),
          });
          waiting.textContent = data.choices?.[0]?.message?.content || 'I could not generate a response.';
        } else {
          const response = await fetch(tunnel, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: question,
              notes: [{ title: note.title || 'Untitled', body: note.body || '' }],
            }),
          });
          if (!response.ok) throw new Error('The API tunnel returned HTTP ' + response.status + '.');
          const data = await response.json();
          waiting.textContent =
            data.response || data.text || data.choices?.[0]?.message?.content || 'I could not generate a response.';
        }
      } catch (error) {
        waiting.textContent = error.message;
      } finally {
        send.disabled = false;
        messages.scrollTop = messages.scrollHeight;
      }
    };
    input.onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send.click();
      }
    };
  }

  // Read aloud always uses the Squiggly server's Kokoro voices, whichever AI provider is
  // chosen: OpenRouter has no free speech model. If the server can't be reached, the
  // browser's built-in voice reads the note instead, so the button always does something.
  const speakInBrowser = (text, voice) =>
    new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window)) return reject(new Error('This browser cannot read aloud.'));
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = voice.startsWith('b') ? 'en-GB' : 'en-US';
      utterance.onend = resolve;
      utterance.onerror = event => reject(new Error('Browser speech failed: ' + event.error));
      speechSynthesis.speak(utterance);
    });
  document.querySelector('#closeTts')?.addEventListener('click', () => window.speechSynthesis?.cancel());

  const tts = document.querySelector('#generateTts');
  if (tts)
    tts.onclick = async () => {
      const text = document.querySelector('#editor').innerText.trim();
      const status = document.querySelector('#ttsStatus');
      const player = document.querySelector('#ttsPlayer');
      const voice = document.querySelector('#ttsVoice')?.value || '';
      if (!text) {
        status.textContent = 'Write something in the note first.';
        status.className = 'status error';
        return;
      }
      tts.disabled = true;
      status.textContent = 'Generating speech…';
      status.className = 'status';
      try {
        let blob;
        try {
          const response = await fetch(endpointFor('tts') || window.SQUIGGLY_API + '/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice }),
          });
          if (!response.ok) throw new Error('The Squiggly server returned HTTP ' + response.status + '.');
          blob = await response.blob();
        } catch (serverError) {
          console.warn('Server speech failed; using the browser voice.', serverError);
          player.style.display = 'none';
          status.textContent = 'The Squiggly server is unavailable, so your browser is reading the note aloud…';
          await speakInBrowser(text, voice);
          status.textContent = "Finished (read with your browser's voice; the server was unavailable).";
          status.className = 'status good';
          return;
        }
        if (player.src.startsWith('blob:')) URL.revokeObjectURL(player.src);
        player.src = URL.createObjectURL(blob);
        player.style.display = 'block';
        await player.play();
        status.textContent = 'Finished.';
        status.className = 'status good';
      } catch (error) {
        status.textContent = error.message;
        status.className = 'status error';
      } finally {
        tts.disabled = false;
      }
    };
})();
