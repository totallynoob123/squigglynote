(() => {
  const header = document.querySelector('.workspace-head');
  const duplicateTitle = document.querySelector('#noteLabel');
  duplicateTitle.hidden = true;
  header.style.position = 'relative';
  const toggle = document.createElement('button');
  toggle.className = 'btn';
  toggle.id = 'notesChatToggle';
  toggle.textContent = 'Ask SquigglyBot';
  toggle.setAttribute('aria-expanded', 'false');
  const saveState = document.querySelector('#saveState');
  header.insertBefore(toggle, saveState);
  const panel = document.createElement('section');
  panel.id = 'notesChatPanel';
  panel.hidden = true;
  panel.style.cssText =
    'position:absolute;z-index:10;right:18px;top:calc(100% + 8px);width:min(390px,calc(100vw - 56px));padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--paper);box-shadow:0 16px 45px #0003';
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><strong>Ask your notes</strong><span class="eyebrow">AI</span></div><div id="notesChatMessages" style="display:grid;gap:8px;max-height:220px;overflow:auto;margin:12px 0"><p style="margin:0;color:var(--muted);font-size:.86rem;line-height:1.45">Ask about or edit the active note.</p></div><div style="display:flex;gap:7px"><input id="notesChatInput" placeholder="Ask a question…" style="min-width:0;flex:1;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--ink);padding:9px;outline:0"><button class="btn primary" id="notesChatSend">Send</button></div>';
  header.append(panel);
  const messages = panel.querySelector('#notesChatMessages');
  const input = panel.querySelector('#notesChatInput');
  const addMessage = (text, role) => {
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
  const chatEndpoint = () => {
    const tunnel = document.querySelector('#apiTunnel').value.trim();
    if (!tunnel) return '';
    return window.resolveApiTunnel(tunnel, 'chat');
  };
  const ask = async () => {
    const question = input.value.trim();
    if (!question) return;
    const apiKey = sessionStorage.getItem('squiggly-openai-key-session');
    const endpoint = apiKey ? 'https://api.openai.com/v1/chat/completions' : chatEndpoint();
    if (!endpoint) {
      showFeedback(
        'Connect an AI service',
        'The chatbot needs an OpenAI API key or an API tunnel.',
        'Add an OpenAI key or an ngrok /rewrite URL in the right sidebar. The chat route uses /chat.',
      );
      return;
    }
    addMessage(question, 'user');
    input.value = '';
    const waiting = addMessage('Thinking…', 'assistant');
    const notes = [{ title: active().title, body: active().body }];
    const context = JSON.stringify(notes).slice(0, 30000);
    try {
      const response = await fetch(
        endpoint,
        apiKey
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
              body: JSON.stringify({
                model: 'gpt-5-mini',
                messages: [
                  {
                    role: 'system',
                    content:
                      'Answer any question the user gives you. If they ask a question about something that is in the notes then site the notes in your answer. Notes: ' +
                      context,
                  },
                  { role: 'user', content: question },
                ],
              }),
            }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: question, notes, activeNote: active() }),
            },
      );
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      const answer = data.answer || data.text || data.result || data.choices?.[0]?.message?.content;
      if (!answer) throw new Error('No answer returned');
      waiting.textContent = answer;
    } catch (error) {
      waiting.textContent = 'I could not answer that right now.';
      showFeedback(
        'Chatbot request failed',
        error.message || 'The AI service did not return an answer.',
        apiKey
          ? 'Check the temporary OpenAI key and browser access, or use your ngrok chat endpoint.'
          : 'Check that your tunnel exposes a /chat endpoint that accepts note context.',
      );
    }
  };
  toggle.onclick = () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) input.focus();
  };
  panel.querySelector('#notesChatSend').onclick = ask;
  input.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      ask();
    }
  };
})();

(() => {
  const panel = document.querySelector('#notesChatPanel');
  const handle = panel.firstElementChild;
  handle.style.cursor = 'grab';
  handle.title = 'Drag to move';
  let drag = null;
  handle.addEventListener('pointerdown', event => {
    const bounds = panel.getBoundingClientRect();
    drag = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    panel.style.position = 'fixed';
    panel.style.left = bounds.left + 'px';
    panel.style.top = bounds.top + 'px';
    panel.style.right = 'auto';
    handle.setPointerCapture(event.pointerId);
    handle.style.cursor = 'grabbing';
  });
  handle.addEventListener('pointermove', event => {
    if (!drag) return;
    const left = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, event.clientX - drag.x));
    const top = Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, event.clientY - drag.y));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  });
  const stopDrag = event => {
    drag = null;
    handle.style.cursor = 'grab';
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener('pointerup', stopDrag);
  handle.addEventListener('pointercancel', stopDrag);
})();

(() => {
  const panel = document.querySelector('#notesChatPanel');
  const input = document.querySelector('#notesChatInput');
  const send = document.querySelector('#notesChatSend');
  const messages = document.querySelector('#notesChatMessages');
  let pendingEdit = null;
  const message = (text, user = false) => {
    const item = document.createElement('div');
    item.style.cssText =
      'padding:9px 10px;border-radius:8px;font-size:.86rem;line-height:1.45;white-space:pre-wrap;' +
      (user ? 'background:var(--ink);color:var(--paper);margin-left:28px' : 'background:var(--soft);margin-right:28px');
    item.textContent = text;
    messages.append(item);
    messages.scrollTop = messages.scrollHeight;
    return item;
  };
  const endpoint = () => {
    const tunnel = document.querySelector('#apiTunnel').value.trim();
    if (!tunnel) return '';
    return window.resolveApiTunnel(tunnel, 'chat');
  };
  const applyEdit = () => {
    if (!pendingEdit) return;
    window.previewChatEdit(pendingEdit, () => {
      const note = active();
      if (typeof pendingEdit.title === 'string' && pendingEdit.title.trim()) note.title = pendingEdit.title.trim();
      if (typeof pendingEdit.body === 'string') note.body = pendingEdit.body;
      note.edited = Date.now();
      note.events.unshift({ kind: 'Edited with Ask notes', time: note.edited });
      note.events = note.events.slice(0, 8);
      save('AI edit applied');
      document.querySelector('#title').value = note.title;
      document.querySelector('#editor').innerHTML = note.body;
      pendingEdit = null;
      render();
    });
  };
  const ask = async () => {
    const question = input.value.trim();
    if (!question) return;
    const apiKey = sessionStorage.getItem('squiggly-openai-key-session');
    const url = apiKey ? 'https://api.openai.com/v1/chat/completions' : endpoint();
    if (!url) {
      showFeedback(
        'Connect an AI service',
        'The chatbot needs an OpenAI API key or API tunnel.',
        'Add one in the right sidebar before asking or editing notes.',
      );
      return;
    }
    message(question, true);
    input.value = '';
    const waiting = message('Thinking…');
    const notes = [{ title: active().title, body: active().body }];
    const context = JSON.stringify(notes).slice(0, 30000);
    try {
      const response = await fetch(
        url,
        apiKey
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
              body: JSON.stringify({
                model: 'gpt-5-mini',
                messages: [
                  {
                    role: 'system',
                    content:
                      'You answer questions about notes and can propose edits to the active note. Return only valid JSON in this exact shape: {"answer":"short response", "update":null or {"title":"optional title", "body":"complete replacement body"}}. Only include update when the user explicitly asks to edit, rewrite, append, or change the active note. Note context: ' +
                      context,
                  },
                  { role: 'user', content: 'Active note: ' + JSON.stringify(active()) + '\nRequest: ' + question },
                ],
              }),
            }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: question, notes, activeNote: active(), allowEdit: true }),
            },
      );
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      let payload = data;
      const rawAnswer = data.choices?.[0]?.message?.content || data.answer || data.text || data.result;
      if (typeof rawAnswer === 'string') {
        try {
          payload = JSON.parse(rawAnswer.replace(/^\`\`\`json\s*|\`\`\`$/g, '').trim());
        } catch {
          payload = { answer: rawAnswer };
        }
      }
      waiting.textContent = payload.answer || 'Done.';
      const update = payload.update || data.update || data.note;
      if (update && (typeof update.body === 'string' || typeof update.title === 'string')) {
        pendingEdit = update;
        const apply = document.createElement('button');
        apply.className = 'btn primary';
        apply.textContent = 'Apply edit to active note';
        apply.style.marginTop = '8px';
        apply.onclick = applyEdit;
        waiting.append(document.createElement('br'), apply);
      }
    } catch (error) {
      waiting.textContent = 'I could not complete that request.';
      showFeedback(
        'Chatbot request failed',
        error.message || 'No response was returned.',
        'Check your OpenAI key or /chat tunnel route, then try again.',
      );
    }
  };
  send.onclick = ask;
  input.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      ask();
    }
  };
})();
