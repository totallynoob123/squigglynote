(() => {
  const KEY = 'squiggly-openrouter-key-v1';
  const PREF_KEY = 'squiggly-openrouter-preferences-v1';
  const CHAT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
  const TTS_MODEL = 'fish-audio/s2.1-pro-free:free';
  const defaults = { temperature: 0.7, maxTokens: 1024, reasoning: 1 };
  const readPrefs = () => ({ ...defaults, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') });
  let aiPrefs = readPrefs();
  const savePrefs = () => localStorage.setItem(PREF_KEY, JSON.stringify(aiPrefs));
  const keyInput = document.querySelector('#openaiKey');
  const keyLabel = document.querySelector('label[for="openaiKey"]');
  if (keyInput) {
    keyInput.type = 'password';
    keyInput.autocomplete = 'off';
    keyInput.placeholder = 'sk-or-v1-…';
    keyInput.value = localStorage.getItem(KEY) || '';
    keyInput.setAttribute('aria-label', 'OpenRouter API key');
    keyInput.oninput = () => localStorage.setItem(KEY, keyInput.value.trim());
  }
  if (keyLabel) keyLabel.textContent = 'OpenRouter API key';
  const keyHelp = keyInput?.parentElement?.querySelector('p');
  if (keyHelp)
    keyHelp.textContent = 'Saved privately in this browser. Used for SquigglyBot, concise writing, and speech.';

  document.body.insertAdjacentHTML(
    'beforeend',
    '<dialog class="dialog" id="openrouterDialog"><div class="eyebrow">Set up SquigglyBot</div><h2 style="margin-top:8px">Get your free OpenRouter key</h2><p>Visit <a class="onboarding-link" href="https://openrouter.ai/" target="_blank" rel="noopener">openrouter.ai</a>, claim a free API key, then paste it below. Your key is hidden and stays only in this browser.</p><label class="eyebrow" for="openrouterKeyInput">OpenRouter API key</label><div class="key-actions"><input id="openrouterKeyInput" type="password" autocomplete="off" placeholder="sk-or-v1-…"><button class="btn" type="button" id="toggleOpenrouterKey">Show</button></div><p class="onboarding-note">SquigglyBot uses nvidia/nemotron-3-ultra-550b-a55b:free. Read aloud uses the Kokoro voices on the Squiggly server.</p><div class="dialog-actions"><button class="btn" id="skipOpenrouter">Not now</button><button class="btn primary" id="saveOpenrouterKey">Save key</button></div></dialog>',
  );
  const setupDialog = document.querySelector('#openrouterDialog');
  const setupInput = document.querySelector('#openrouterKeyInput');
  const showSetup = () => {
    setupInput.value = localStorage.getItem(KEY) || '';
    if (!setupDialog.open) setupDialog.showModal();
  };
  document.querySelector('#toggleOpenrouterKey').onclick = () => {
    const visible = setupInput.type === 'text';
    setupInput.type = visible ? 'password' : 'text';
    document.querySelector('#toggleOpenrouterKey').textContent = visible ? 'Show' : 'Hide';
  };
  document.querySelector('#skipOpenrouter').onclick = () => setupDialog.close();
  document.querySelector('#saveOpenrouterKey').onclick = () => {
    const value = setupInput.value.trim();
    if (!value) {
      setupInput.focus();
      return;
    }
    localStorage.setItem(KEY, value);
    if (keyInput) keyInput.value = value;
    setupDialog.close();
  };
  if (!localStorage.getItem(KEY)) setTimeout(showSetup, 250);

  const callOpenRouter = async body => {
    const apiKey = localStorage.getItem(KEY);
    if (!apiKey) {
      showSetup();
      throw new Error('Add an OpenRouter API key to continue.');
    }
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
        'HTTP-Referer': location.origin,
        'X-Title': 'Squiggly Note',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('OpenRouter returned HTTP ' + response.status + '.');
    return response.json();
  };
  const reasoning = () => ['low', 'medium', 'high'][Math.max(0, Math.min(2, Number(aiPrefs.reasoning) || 0))];
  const requestOptions = () => ({
    temperature: Number(aiPrefs.temperature),
    max_tokens: Number(aiPrefs.maxTokens),
    reasoning: { effort: reasoning() },
  });

  const settings = document.querySelector('#settingsDialog');
  const actions = settings?.querySelector('.dialog-actions');
  if (settings && actions && !document.querySelector('#aiSettings')) {
    const section = document.createElement('section');
    section.id = 'aiSettings';
    section.innerHTML =
      '<div class="eyebrow" style="margin-top:8px">AI preferences</div><div class="ai-setting"><label for="aiTemperature">Creativity <output id="aiTemperatureValue"></output></label><small>Lower is steadier; higher is more imaginative.</small><input id="aiTemperature" type="range" min="0" max="1" step="0.05"></div><div class="ai-setting"><label for="aiMaxTokens">Response length <output id="aiMaxTokensValue"></output></label><small>Sets the maximum length of SquigglyBot responses.</small><input id="aiMaxTokens" type="range" min="128" max="4096" step="128"></div><div class="ai-setting"><label for="aiReasoning">Reasoning <output id="aiReasoningValue"></output></label><small>Higher levels ask SquigglyBot to spend more effort thinking.</small><input id="aiReasoning" type="range" min="0" max="2" step="1"></div>';
    actions.before(section);
    const temp = section.querySelector('#aiTemperature'),
      tokens = section.querySelector('#aiMaxTokens'),
      reason = section.querySelector('#aiReasoning');
    const refresh = () => {
      temp.value = aiPrefs.temperature;
      tokens.value = aiPrefs.maxTokens;
      reason.value = aiPrefs.reasoning;
      section.querySelector('#aiTemperatureValue').value = Math.round(aiPrefs.temperature * 100) + '%';
      section.querySelector('#aiMaxTokensValue').value = aiPrefs.maxTokens + ' tokens';
      section.querySelector('#aiReasoningValue').value = ['Light', 'Balanced', 'Deep'][aiPrefs.reasoning];
    };
    temp.oninput = () => {
      aiPrefs.temperature = Number(temp.value);
      savePrefs();
      refresh();
    };
    tokens.oninput = () => {
      aiPrefs.maxTokens = Number(tokens.value);
      savePrefs();
      refresh();
    };
    reason.oninput = () => {
      aiPrefs.reasoning = Number(reason.value);
      savePrefs();
      refresh();
    };
    refresh();
  }

  const concise = document.querySelector('#concise');
  const originalConcise = concise?.onclick;
  if (concise)
    concise.onclick = async () => {
      const text = document.querySelector('#editor').innerText.trim();
      if (!localStorage.getItem(KEY)) return originalConcise?.();
      if (!text) return;
      concise.disabled = true;
      concise.textContent = 'Working…';
      try {
        const data = await callOpenRouter({
          model: CHAT_MODEL,
          messages: [
            {
              role: 'system',
              content: 'Rewrite the user text to be concise while preserving meaning. Return only the revised text.',
            },
            { role: 'user', content: text },
          ],
          ...requestOptions(),
        });
        const revised = data.choices?.[0]?.message?.content;
        if (!revised) throw new Error('No revised text was returned.');
        document.querySelector('#editor').textContent = revised;
        window.edit?.();
        document.querySelector('#status').textContent = 'Concise version ready.';
        document.querySelector('#status').className = 'status good';
      } catch (error) {
        document.querySelector('#status').textContent = error.message;
        document.querySelector('#status').className = 'status error';
      } finally {
        concise.disabled = false;
        concise.textContent = 'Make concise';
      }
    };

  const chatInput = document.querySelector('#notesChatInput');
  const chatSend = document.querySelector('#notesChatSend');
  const messages = document.querySelector('#notesChatMessages');
  const appendMessage = (text, role) => {
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
  if (chatInput && chatSend && messages) {
    chatSend.onclick = async () => {
      const question = chatInput.value.trim();
      if (!question) return;
      if (!localStorage.getItem(KEY)) {
        showSetup();
        return;
      }
      appendMessage(question, 'user');
      chatInput.value = '';
      const waiting = appendMessage('Thinking…', 'assistant');
      chatSend.disabled = true;
      try {
        const note = window.active?.() || {};
        const data = await callOpenRouter({
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
          ...requestOptions(),
        });
        waiting.textContent = data.choices?.[0]?.message?.content || 'I could not generate a response.';
      } catch (error) {
        waiting.textContent = error.message;
      } finally {
        chatSend.disabled = false;
        messages.scrollTop = messages.scrollHeight;
      }
    };
    chatInput.onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        chatSend.click();
      }
    };
  }

  const generateTts = document.querySelector('#generateTts');
  if (generateTts)
    generateTts.onclick = async event => {
      const text = document.querySelector('#editor').innerText.trim();
      const status = document.querySelector('#ttsStatus');
      if (!text) {
        status.textContent = 'Write something in the note first.';
        status.className = 'status error';
        return;
      }
      if (!localStorage.getItem(KEY)) {
        showSetup();
        return;
      }
      event.currentTarget.disabled = true;
      status.textContent = 'Generating speech…';
      status.className = 'status';
      try {
        const data = await callOpenRouter({
          model: TTS_MODEL,
          messages: [{ role: 'user', content: text }],
          modalities: ['text', 'audio'],
          audio: { voice: document.querySelector('#ttsVoice')?.value || 'alloy', format: 'wav' },
          ...requestOptions(),
        });
        const audio = data.choices?.[0]?.message?.audio || data.audio;
        const encoded = audio?.data || audio?.base64;
        if (!encoded) throw new Error('The speech model did not return audio.');
        const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'audio/' + (audio.format || 'wav') });
        const player = document.querySelector('#ttsPlayer');
        player.src = URL.createObjectURL(blob);
        player.style.display = 'block';
        await player.play();
        status.textContent = 'Finished.';
        status.className = 'status good';
      } catch (error) {
        status.textContent = error.message;
        status.className = 'status error';
      } finally {
        event.currentTarget.disabled = false;
      }
    };
})();
