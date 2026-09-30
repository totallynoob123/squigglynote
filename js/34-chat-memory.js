(() => {
  const STORE = 'squiggly-chat-sessions-v1',
    OPENROUTER_KEY = 'squiggly-openrouter-key-v1',
    PROVIDER_KEY = 'squiggly-ai-provider-v1',
    MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
  const input = document.querySelector('#notesChatInput'),
    send = document.querySelector('#notesChatSend'),
    view = document.querySelector('#notesChatMessages');
  if (!input || !send || !view) return;
  const read = () => JSON.parse(localStorage.getItem(STORE) || 'null');
  const write = data => localStorage.setItem(STORE, JSON.stringify(data));
  const getChat = (data, id = data.activeId) => data?.items?.find(chat => chat.id === id);
  const bubble = entry => {
    const item = document.createElement('div');
    item.style.cssText =
      'padding:9px 10px;border-radius:8px;font-size:.86rem;line-height:1.45;white-space:pre-wrap;' +
      (entry.role === 'user'
        ? 'background:var(--ink);color:var(--paper);margin-left:28px'
        : 'background:var(--soft);margin-right:28px');
    item.textContent = entry.text;
    return item;
  };
  const render = () => {
    const data = read(),
      chat = getChat(data);
    if (!chat) return;
    view.replaceChildren(...chat.messages.map(bubble));
    view.scrollTop = view.scrollHeight;
  };
  const mode = () =>
    localStorage.getItem(PROVIDER_KEY) || (localStorage.getItem(OPENROUTER_KEY) ? 'openrouter' : 'tunnel');
  const endpoint = () => {
    const value = document.querySelector('#apiTunnel')?.value.trim();
    if (!value) return '';
    return window.resolveApiTunnel(value, 'chat');
  };
  const prefs = () => ({
    temperature: 0.7,
    maxTokens: 1024,
    reasoning: 1,
    ...JSON.parse(localStorage.getItem('squiggly-openrouter-preferences-v1') || '{}'),
  });
  send.onclick = async () => {
    const question = input.value.trim();
    if (!question) return;
    const data = read(),
      chat = getChat(data),
      chatId = chat?.id;
    if (!chat) return;
    if (chat.title === 'New chat') chat.title = question.slice(0, 26) + (question.length > 26 ? '…' : '');
    chat.messages.push({ role: 'user', text: question, time: Date.now() });
    const history = chat.messages.slice(-24).map(item => ({ role: item.role, text: item.text }));
    const transcript = history
      .map(item => (item.role === 'user' ? 'User' : 'SquigglyBot') + ': ' + item.text)
      .join('\n');
    chat.messages.push({ role: 'assistant', text: 'Thinking…', time: Date.now() });
    write(data);
    input.value = '';
    render();
    send.disabled = true;
    try {
      let answer;
      const noteTitle = document.querySelector('#title')?.value || 'Untitled',
        noteBody = document.querySelector('#editor')?.innerText || '';
      if (mode() === 'openrouter' && localStorage.getItem(OPENROUTER_KEY)) {
        const p = prefs();
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + localStorage.getItem(OPENROUTER_KEY),
            'HTTP-Referer': location.origin,
            'X-Title': 'Squiggly Note',
          },
          body: JSON.stringify({
            model: MODEL,
            temperature: Number(p.temperature),
            max_tokens: Number(p.maxTokens),
            reasoning: { effort: ['low', 'medium', 'high'][Number(p.reasoning) || 0] },
            messages: [
              {
                role: 'system',
                content:
                  'You are SquigglyBot, a concise and helpful writing companion. Use the conversation history and active note for context. Active note title: ' +
                  noteTitle +
                  '\n\nActive note:\n' +
                  noteBody,
              },
              ...history.map(item => ({ role: item.role, content: item.text })),
            ],
          }),
        });
        if (!response.ok) throw new Error('OpenRouter returned HTTP ' + response.status + '.');
        const result = await response.json();
        answer = result.choices?.[0]?.message?.content || 'I could not generate a response.';
      } else {
        const url = endpoint();
        if (!url) throw new Error('Add an API tunnel URL or choose OpenRouter in Settings.');
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message:
              'Use this conversation memory to answer the current question. Do not say you lack personal information when the user has already provided it in this conversation.\n\nConversation memory:\n' +
              transcript +
              '\n\nCurrent user question: ' +
              question,
            history,
            messages: history,
            notes: [{ title: noteTitle, body: noteBody }],
          }),
        });
        if (!response.ok) throw new Error('The API tunnel returned HTTP ' + response.status + '.');
        const result = await response.json();
        answer =
          result.response || result.text || result.choices?.[0]?.message?.content || 'I could not generate a response.';
      }
      const latest = read(),
        target = getChat(latest, chatId);
      if (target) {
        target.messages[target.messages.length - 1].text = answer;
        write(latest);
      }
      render();
    } catch (error) {
      const latest = read(),
        target = getChat(latest, chatId);
      if (target) {
        target.messages[target.messages.length - 1].text = error.message;
        write(latest);
      }
      render();
    } finally {
      send.disabled = false;
    }
  };
  input.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send.click();
    }
  };
})();
