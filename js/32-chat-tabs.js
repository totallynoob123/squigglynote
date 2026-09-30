(() => {
  const STORE = 'squiggly-chat-sessions-v1';
  const OPENROUTER_KEY = 'squiggly-openrouter-key-v1';
  const PROVIDER_KEY = 'squiggly-ai-provider-v1';
  const CHAT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
  const blankChat = () => ({ id: uid(), title: 'New chat', messages: [], created: Date.now() });
  let chats = JSON.parse(localStorage.getItem(STORE) || 'null') || { items: [blankChat()], activeId: null };
  if (!Array.isArray(chats.items) || !chats.items.length) chats.items = [blankChat()];
  if (!chats.activeId || !chats.items.some(chat => chat.id === chats.activeId)) chats.activeId = chats.items[0].id;
  const persist = () => localStorage.setItem(STORE, JSON.stringify(chats));
  const selected = () => chats.items.find(chat => chat.id === chats.activeId) || chats.items[0];
  const panel = document.querySelector('#notesChatPanel');
  const messages = document.querySelector('#notesChatMessages');
  const input = document.querySelector('#notesChatInput');
  const send = document.querySelector('#notesChatSend');
  if (!panel || !messages || !input || !send || document.querySelector('#chatTabsBar')) return;
  const tabs = document.createElement('div');
  tabs.id = 'chatTabsBar';
  tabs.setAttribute('aria-label', 'Chat conversations');
  const header = panel.firstElementChild;
  header?.insertAdjacentElement('afterend', tabs);
  const renderTabs = () => {
    tabs.replaceChildren();
    chats.items.forEach(chat => {
      const button = document.createElement('button');
      button.className = 'chat-session-tab' + (chat.id === chats.activeId ? ' active' : '');
      button.title = chat.title;
      button.textContent = chat.title;
      button.onclick = () => {
        chats.activeId = chat.id;
        persist();
        render();
      };
      tabs.append(button);
    });
    const add = document.createElement('button');
    add.className = 'btn chat-session-new';
    add.type = 'button';
    add.title = 'New chat';
    add.setAttribute('aria-label', 'New chat');
    add.textContent = '+';
    add.onclick = () => {
      const chat = blankChat();
      chats.items.push(chat);
      chats.activeId = chat.id;
      persist();
      render();
      input.focus();
    };
    tabs.append(add);
  };
  const renderMessages = () => {
    const chat = selected();
    messages.replaceChildren();
    if (!chat.messages.length) {
      const empty = document.createElement('p');
      empty.className = 'chat-empty';
      empty.textContent = 'Start a new conversation about your notes.';
      messages.append(empty);
    } else
      chat.messages.forEach(entry => {
        const item = document.createElement('div');
        item.style.cssText =
          'padding:9px 10px;border-radius:8px;font-size:.86rem;line-height:1.45;white-space:pre-wrap;' +
          (entry.role === 'user'
            ? 'background:var(--ink);color:var(--paper);margin-left:28px'
            : 'background:var(--soft);margin-right:28px');
        item.textContent = entry.text;
        messages.append(item);
      });
    messages.scrollTop = messages.scrollHeight;
  };
  const render = () => {
    renderTabs();
    renderMessages();
  };
  const append = (role, text) => {
    const chat = selected();
    chat.messages.push({ role, text, time: Date.now() });
    persist();
    renderMessages();
    return chat.messages.length - 1;
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
  const askOpenRouter = async question => {
    const p = prefs(),
      key = localStorage.getItem(OPENROUTER_KEY);
    const noteTitle = document.querySelector('#title')?.value || 'Untitled';
    const noteBody = document.querySelector('#editor')?.innerText || '';
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
        'HTTP-Referer': location.origin,
        'X-Title': 'Squiggly Note',
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        temperature: Number(p.temperature),
        max_tokens: Number(p.maxTokens),
        reasoning: { effort: ['low', 'medium', 'high'][Number(p.reasoning) || 0] },
        messages: [
          { role: 'system', content: 'You are SquigglyBot, a concise and helpful writing companion.' },
          {
            role: 'user',
            content: 'Active note title: ' + noteTitle + '\n\nActive note:\n' + noteBody + '\n\nQuestion: ' + question,
          },
        ],
      }),
    });
    if (!response.ok) throw new Error('OpenRouter returned HTTP ' + response.status + '.');
    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'I could not generate a response.';
  };
  send.onclick = async () => {
    const question = input.value.trim();
    if (!question) return;
    const chat = selected();
    if (chat.title === 'New chat') chat.title = question.slice(0, 26) + (question.length > 26 ? '…' : '');
    append('user', question);
    input.value = '';
    send.disabled = true;
    const responseIndex = append('assistant', 'Thinking…');
    try {
      let answer;
      if (mode() === 'openrouter' && localStorage.getItem(OPENROUTER_KEY)) answer = await askOpenRouter(question);
      else {
        const url = endpoint();
        if (!url) throw new Error('Add an API tunnel URL or choose OpenRouter in Settings.');
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: question,
            notes: [
              {
                title: document.querySelector('#title')?.value || 'Untitled',
                body: document.querySelector('#editor')?.innerText || '',
              },
            ],
          }),
        });
        if (!response.ok) throw new Error('The API tunnel returned HTTP ' + response.status + '.');
        const data = await response.json();
        answer =
          data.response || data.text || data.choices?.[0]?.message?.content || 'I could not generate a response.';
      }
      const activeChat = chats.items.find(item => item.id === chat.id);
      if (activeChat?.messages[responseIndex]) activeChat.messages[responseIndex].text = answer;
      persist();
      render();
    } catch (error) {
      const activeChat = chats.items.find(item => item.id === chat.id);
      if (activeChat?.messages[responseIndex]) activeChat.messages[responseIndex].text = error.message;
      persist();
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
  render();
})();
