(() => {
  // Replace MY_NGROK_URL with the public hostname shown by ngrok.
  const API_BASE_URL = window.SQUIGGLY_API;
  const API_URL = API_BASE_URL + '/rewrite';

  document.body.insertAdjacentHTML(
    'beforeend',
    '<dialog class="dialog" id="rewriteDialog"><div class="eyebrow">Jetson AI</div><h2 style="margin-top:8px">Rewrite text</h2><p>Review or edit the text, then send it to your rewrite API.</p><textarea id="rewriteText" rows="9" style="width:100%;resize:vertical;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);padding:10px;line-height:1.55;outline:0"></textarea><p id="rewriteStatus" role="status" style="min-height:20px;margin:10px 0 0"></p><div class="dialog-actions"><button class="btn" id="cancelRewrite">Cancel</button><button class="btn primary" id="sendRewrite">Rewrite</button></div></dialog>',
  );
  const dialog = document.querySelector('#rewriteDialog');
  const text = document.querySelector('#rewriteText');
  const status = document.querySelector('#rewriteStatus');
  const button = document.querySelector('#sendRewrite');

  const showStatus = (message, error = false) => {
    status.textContent = message;
    status.style.color = error ? '#a33' : 'var(--muted)';
  };
  document.querySelector('#concise').onclick = () => {
    text.value = document.querySelector('#editor').innerText;
    showStatus('');
    dialog.showModal();
    text.focus();
  };
  document.querySelector('#cancelRewrite').onclick = () => dialog.close();
  button.onclick = async () => {
    const value = text.value.trim();
    if (!value) return showStatus('Enter text to rewrite.', true);
    button.disabled = true;
    showStatus('Rewriting...');
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value }),
      });
      if (!response.ok) throw new Error('Request failed with HTTP ' + response.status);
      const data = await response.json();
      const rewritten = data.content ?? data.text ?? data.rewritten_text ?? data.rewrite ?? data.result ?? data.output;
      if (typeof rewritten !== 'string' || !rewritten.trim())
        throw new Error('The API response did not contain rewritten text.');
      text.value = rewritten;
      document.querySelector('#editor').textContent = rewritten;
      edit();
      showStatus('Done');
    } catch (error) {
      console.error('Rewrite API error:', error);
      showStatus(error.message || 'Unable to reach the rewrite API.', true);
    } finally {
      button.disabled = false;
    }
  };
})();

(() => {
  const TUNNEL_REWRITE_URL = window.SQUIGGLY_API + '/rewrite';
  const OPENAI_KEY_STORAGE = 'squiggly-openai-key-session';
  const tunnelInput = document.querySelector('#apiTunnel');
  if (!tunnelInput.value.trim()) {
    tunnelInput.value = TUNNEL_REWRITE_URL;
    tunnelInput.dispatchEvent(new Event('input'));
  }
  const apiKey = () => sessionStorage.getItem(OPENAI_KEY_STORAGE)?.trim();
  const openAIRewrite = async text => {
    const key = apiKey();
    if (!key) throw new Error('Tunnel request failed and no API-key backup is configured.');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        messages: [
          {
            role: 'system',
            content: 'Rewrite the user text to be concise while preserving its meaning. Return only the revised text.',
          },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!response.ok) throw new Error('API-key backup returned HTTP ' + response.status);
    const data = await response.json();
    const result = data.choices?.[0]?.message?.content;
    if (!result) throw new Error('API-key backup did not return text.');
    return result;
  };

  document.querySelector('#sendRewrite').onclick = async () => {
    const textBox = document.querySelector('#rewriteText');
    const status = document.querySelector('#rewriteStatus');
    const button = document.querySelector('#sendRewrite');
    const value = textBox.value.trim();
    if (!value) {
      status.textContent = 'Enter text to rewrite.';
      return;
    }
    button.disabled = true;
    status.textContent = 'Rewriting…';
    try {
      let rewritten;
      try {
        const response = await fetch(TUNNEL_REWRITE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: value }),
        });
        if (!response.ok) throw new Error('Tunnel returned HTTP ' + response.status);
        const data = await response.json();
        rewritten = data.content ?? data.text ?? data.rewritten_text ?? data.result;
        if (!rewritten) throw new Error('Tunnel response did not contain content.');
      } catch (tunnelError) {
        console.warn('Tunnel rewrite failed; trying API-key backup.', tunnelError);
        status.textContent = 'Tunnel unavailable — trying API-key backup…';
        rewritten = await openAIRewrite(value);
      }
      textBox.value = rewritten;
      document.querySelector('#editor').textContent = rewritten;
      edit();
      status.textContent = 'Done';
    } catch (error) {
      console.error('Rewrite failed:', error);
      status.textContent = 'Error: ' + error.message;
    } finally {
      button.disabled = false;
    }
  };

  const chatInput = document.querySelector('#notesChatInput');
  const chatSend = document.querySelector('#notesChatSend');
  const chatMessages = document.querySelector('#notesChatMessages');
  const addChatMessage = (text, user = false) => {
    const item = document.createElement('div');
    item.style.cssText =
      'padding:9px 10px;border-radius:8px;font-size:.86rem;line-height:1.45;white-space:pre-wrap;' +
      (user ? 'background:var(--ink);color:var(--paper);margin-left:28px' : 'background:var(--soft);margin-right:28px');
    item.textContent = text;
    chatMessages.append(item);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return item;
  };
  const askTunnelFirst = async () => {
    const question = chatInput.value.trim();
    if (!question) return;
    chatInput.value = '';
    addChatMessage(question, true);
    const waiting = addChatMessage('Thinking…');
    const note = active();
    const notes = [{ title: note.title, body: note.body }];
    try {
      let data;
      try {
        const prompt =
          'Use only this active note to answer the question. If the answer is not in the note, say so.\\n\\nActive note: ' +
          JSON.stringify(notes) +
          '\\n\\nQuestion: ' +
          question;
        const response = await fetch(TUNNEL_REWRITE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: prompt }),
        });
        if (!response.ok) throw new Error('Tunnel returned HTTP ' + response.status);
        data = await response.json();
      } catch (tunnelError) {
        console.warn('Tunnel chat failed; trying API-key backup.', tunnelError);
        const key = apiKey();
        if (!key) throw new Error('Tunnel request failed and no API-key backup is configured.');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({
            model: 'gpt-5-mini',
            messages: [
              { role: 'system', content: 'Answer the question using only this active note: ' + JSON.stringify(notes) },
              { role: 'user', content: question },
            ],
          }),
        });
        if (!response.ok) throw new Error('API-key backup returned HTTP ' + response.status);
        data = await response.json();
      }
      const answer = data.answer ?? data.content ?? data.text ?? data.result ?? data.choices?.[0]?.message?.content;
      if (!answer) throw new Error('No answer returned.');
      waiting.textContent = answer;
    } catch (error) {
      console.error('Chat failed:', error);
      waiting.textContent = 'Error: ' + error.message;
    }
  };
  chatSend.onclick = askTunnelFirst;
  chatInput.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      askTunnelFirst();
    }
  };
})();

window.transcribeWithFallback = async formData => {
  try {
    const response = await fetch(apiEndpoint('transcribe'), { method: 'POST', body: formData });
    if (!response.ok) throw new Error('Tunnel returned HTTP ' + response.status);
    return response;
  } catch (tunnelError) {
    console.warn('Tunnel transcription failed; trying API-key backup.', tunnelError);
    const status = document.querySelector('#status');
    if (status) {
      status.textContent = 'Tunnel unavailable — using API-key transcription…';
      status.className = 'status';
    }
    const apiKey = sessionStorage.getItem('squiggly-openai-key-session')?.trim();
    if (!apiKey) throw new Error('Tunnel transcription failed and no API-key backup is configured.');
    const backupForm = new FormData();
    for (const [name, value] of formData.entries()) backupForm.append(name, value);
    backupForm.append('model', 'whisper-1');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: backupForm,
    });
    if (!response.ok) {
      let detail = '';
      try {
        const error = await response.json();
        detail = error?.error?.message || error?.message || JSON.stringify(error);
      } catch {
        detail = await response.text().catch(() => '');
      }
      const requestId = response.headers.get('x-request-id');
      throw new Error(
        'API-key transcription backup returned HTTP ' +
          response.status +
          (detail ? ': ' + detail : '') +
          (requestId ? ' (request ' + requestId + ')' : ''),
      );
    }
    return response;
  }
};

(() => {
  // Jetson API contract: POST /rewrite => { content }, POST /transcribe with form field "audio".
  const JETSON_API_URL = window.SQUIGGLY_API;
  const DEEPGRAM_KEY_STORAGE = 'squiggly-deepgram-key-session';
  const status = document.querySelector('#status');
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.className = 'status' + (error ? ' error' : message === 'Done!' ? ' good' : '');
  };
  const readError = async response => {
    let detail = '';
    try {
      detail = (await response.json())?.detail || '';
    } catch {}
    return 'HTTP ' + response.status + (detail ? ': ' + detail : '');
  };
  const deepgramRow = document.createElement('div');
  deepgramRow.style.cssText = 'margin-top:18px;padding-top:14px;border-top:1px solid var(--line)';
  deepgramRow.innerHTML =
    '<label class="eyebrow" for="deepgramKey">Deepgram API key</label><input id="deepgramKey" type="password" autocomplete="off" placeholder="Session-only audio backup key" aria-label="Deepgram API key" style="width:100%;margin-top:8px;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--ink);padding:9px;font-size:.78rem;outline:0"><p style="margin:8px 0 0;font-size:.75rem;color:var(--muted);line-height:1.4">Used only if Jetson transcription fails. Cleared when this browser tab closes.</p>';
  document.querySelector('.timeline').append(deepgramRow);
  const deepgramKey = document.querySelector('#deepgramKey');
  deepgramKey.value = sessionStorage.getItem(DEEPGRAM_KEY_STORAGE) || '';
  deepgramKey.oninput = () => sessionStorage.setItem(DEEPGRAM_KEY_STORAGE, deepgramKey.value.trim());

  document.querySelector('#concise').onclick = async () => {
    const editor = document.querySelector('#editor');
    const text = editor.innerText.trim();
    if (!text) return setStatus('Write something first.', true);
    const button = document.querySelector('#concise');
    button.disabled = true;
    setStatus('Rewriting...');
    try {
      const response = await fetch(JETSON_API_URL + '/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = await response.json();
      if (!data.content) throw new Error('API response did not contain content.');
      editor.textContent = data.content;
      edit();
      setStatus('Done!');
    } catch (error) {
      console.error('Jetson rewrite error:', error);
      setStatus('Error: ' + error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  const audioInput = document.createElement('input');
  audioInput.type = 'file';
  audioInput.accept = '.wav,audio/wav';
  audioInput.hidden = true;
  document.body.append(audioInput);
  const transcribeButton = Array.from(document.querySelectorAll('.notes-actions button')).find(button =>
    /transcribe/i.test(button.textContent),
  );
  if (transcribeButton) {
    transcribeButton.textContent = 'Transcribe audio';
    transcribeButton.onclick = () => audioInput.click();
  }
  audioInput.onchange = async () => {
    const file = audioInput.files[0];
    if (!file) return;
    if (!/\.wav$/i.test(file.name)) {
      setStatus('Choose a WAV audio file.', true);
      return;
    }
    setStatus('Transcribing...');
    try {
      let transcript;
      try {
        const formData = new FormData();
        formData.append('audio', file, file.name);
        const response = await fetch(JETSON_API_URL + '/transcribe', { method: 'POST', body: formData });
        if (!response.ok) throw new Error(await readError(response));
        const data = await response.json();
        transcript = data.text || data.content || data.transcript;
      } catch (tunnelError) {
        console.warn('Jetson transcription failed; trying Deepgram backup.', tunnelError);
        window.apiTrace?.('Branch: Jetson transcription failed → Deepgram backup', tunnelError.message || '');
        const key = sessionStorage.getItem(DEEPGRAM_KEY_STORAGE)?.trim();
        if (!key) throw new Error('Jetson failed and no Deepgram backup key is entered.');
        setStatus('Jetson unavailable — using Deepgram backup...');
        const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true', {
          method: 'POST',
          headers: { Authorization: 'Token ' + key, 'Content-Type': file.type || 'audio/wav' },
          body: file,
        });
        if (!response.ok) throw new Error('Deepgram returned ' + (await readError(response)));
        const data = await response.json();
        transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
      }
      if (!transcript) throw new Error('API response did not contain a transcript.');
      const editor = document.querySelector('#editor');
      editor.innerText += (editor.innerText ? '\n\n' : '') + transcript;
      edit();
      setStatus('Done!');
    } catch (error) {
      console.error('Jetson transcription error:', error);
      setStatus('Error: ' + error.message, true);
    } finally {
      audioInput.value = '';
    }
  };

  const chatInput = document.querySelector('#notesChatInput');
  const chatSend = document.querySelector('#notesChatSend');
  const chatMessages = document.querySelector('#notesChatMessages');
  const addMessage = (value, user = false) => {
    const item = document.createElement('div');
    item.style.cssText =
      'padding:9px 10px;border-radius:8px;font-size:.86rem;line-height:1.45;white-space:pre-wrap;' +
      (user ? 'background:var(--ink);color:var(--paper);margin-left:28px' : 'background:var(--soft);margin-right:28px');
    item.textContent = value;
    chatMessages.append(item);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return item;
  };
  const askJetson = async () => {
    const question = chatInput.value.trim();
    if (!question) return;
    const notes = document.querySelector('#editor').innerText;
    chatInput.value = '';
    addMessage(question, true);
    const reply = addMessage('Thinking...');
    try {
      const response = await fetch(JETSON_API_URL + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, notes }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = await response.json();
      if (!data.response) throw new Error('API response did not contain response.');
      reply.textContent = data.response;
    } catch (error) {
      console.error('Jetson chatbot error:', error);
      reply.textContent = 'Error: ' + error.message;
    }
  };
  chatSend.onclick = askJetson;
  chatInput.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      askJetson();
    }
  };
})();

(() => {
  const API_BASE = window.SQUIGGLY_API;
  const status = document.querySelector('#status');
  const report = (message, error = false) => {
    status.textContent = message;
    status.className = 'status' + (error ? ' error' : message === 'Done!' ? ' good' : '');
  };
  const errorText = async response => {
    let detail = '';
    try {
      detail = (await response.json())?.detail || '';
    } catch {}
    return 'HTTP ' + response.status + (detail ? ': ' + detail : '');
  };
  const addTranscript = transcript => {
    const safe = document.createElement('div');
    safe.textContent = transcript;
    const note = active();
    note.body = (note.body || '') + (note.body ? '<br><br>' : '') + safe.innerHTML;
    note.edited = Date.now();
    save('Transcript added');
    document.querySelector('[data-pane="notes"]')?.click();
  };
  const getSelectedAudio = async () => {
    const selectedRows = Array.from(document.querySelectorAll('#tabs .tab')).filter(row =>
      row.style.boxShadow.includes('inset'),
    );
    if (!selectedRows.length) return [];
    const names = selectedRows.map(row => row.textContent.split(' · ')[0]);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('squiggly-recordings-' + OWNER, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const store = request.result.transaction('recordings').objectStore('recordings');
        const all = store.getAll();
        all.onerror = () => reject(all.error);
        all.onsuccess = () => resolve(all.result.filter(file => names.includes(file.name)));
      };
    });
  };
  const transcribe = async file => {
    try {
      const form = new FormData();
      form.append('audio', file.blob, file.name + '.wav');
      const response = await fetch(API_BASE + '/transcribe', { method: 'POST', body: form });
      if (!response.ok) throw new Error(await errorText(response));
      const data = await response.json();
      return data.text || data.content || data.transcript;
    } catch (tunnelError) {
      console.warn('Jetson transcription failed; trying Deepgram backup.', tunnelError);
      window.apiTrace?.('Branch: Jetson transcription failed → Deepgram backup', tunnelError.message || '');
      const key = sessionStorage.getItem('squiggly-deepgram-key-session')?.trim();
      if (!key) throw tunnelError;
      report('Jetson unavailable — using Deepgram backup...');
      const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true', {
        method: 'POST',
        headers: { Authorization: 'Token ' + key, 'Content-Type': 'audio/wav' },
        body: file.blob,
      });
      if (!response.ok) throw new Error('Deepgram ' + (await errorText(response)));
      const data = await response.json();
      return data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    }
  };
  const transcribeButton = Array.from(document.querySelectorAll('.notes-actions button')).find(button =>
    /transcribe/i.test(button.textContent),
  );
  if (transcribeButton) {
    transcribeButton.textContent = 'Transcribe selected';
    transcribeButton.onclick = async () => {
      try {
        const files = await getSelectedAudio();
        if (!files.length) return report('Select one or more WAV recordings in Audio first.', true);
        report('Transcribing...');
        const transcripts = [];
        for (const file of files) {
          const transcript = await transcribe(file);
          if (!transcript) throw new Error('The transcription response did not contain text.');
          transcripts.push(transcript);
        }
        addTranscript(transcripts.join('\n\n'));
        report('Done!');
      } catch (error) {
        console.error('Audio transcription error:', error);
        report('Error: ' + error.message, true);
      }
    };
  }

  const dialog = document.querySelector('#rewriteDialog');
  const textBox = document.querySelector('#rewriteText');
  const rewriteStatus = document.querySelector('#rewriteStatus');
  const rewriteButton = document.querySelector('#sendRewrite');
  document.querySelector('#concise').onclick = () => {
    textBox.value = document.querySelector('#editor').innerText;
    rewriteStatus.textContent = '';
    dialog.showModal();
    textBox.focus();
  };
  rewriteButton.onclick = async () => {
    const text = textBox.value.trim();
    if (!text) {
      rewriteStatus.textContent = 'Enter text to rewrite.';
      return;
    }
    rewriteButton.disabled = true;
    rewriteStatus.textContent = 'Rewriting...';
    try {
      const response = await fetch(API_BASE + '/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const data = await response.json();
      if (!data.content) throw new Error('API response did not contain content.');
      textBox.value = data.content;
      document.querySelector('#editor').textContent = data.content;
      edit();
      rewriteStatus.textContent = 'Done!';
    } catch (error) {
      console.error('Jetson rewrite error:', error);
      rewriteStatus.textContent = 'Error: ' + error.message;
    } finally {
      rewriteButton.disabled = false;
    }
  };
})();
