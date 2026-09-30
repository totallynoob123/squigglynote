(() => {
  const JETSON_BASE_URL = 'https://absolve-marigold-procedure.ngrok-free.dev';
  const getOpenAIKey = () => sessionStorage.getItem('squiggly-openai-key-session')?.trim();
  const openAIChat = async (system, user) => {
    const key = getOpenAIKey();
    if (!key) throw new Error('Jetson failed and no OpenAI backup key is entered.');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) throw new Error('OpenAI backup returned HTTP ' + response.status);
    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content;
    if (!answer) throw new Error('OpenAI backup did not return text.');
    return answer;
  };
  const dialog = document.querySelector('#rewriteDialog');
  const textBox = document.querySelector('#rewriteText');
  const rewriteStatus = document.querySelector('#rewriteStatus');
  const rewriteButton = document.querySelector('#sendRewrite');
  rewriteButton.onclick = async () => {
    const text = textBox.value.trim();
    if (!text) {
      rewriteStatus.textContent = 'Enter text to rewrite.';
      return;
    }
    rewriteButton.disabled = true;
    rewriteStatus.textContent = 'Rewriting...';
    try {
      let result;
      try {
        const concisePrompt =
          'Rewrite the note below to be concise while preserving its meaning. Return only the revised text.\n\nNote:\n' +
          text;
        const response = await fetch(JETSON_BASE_URL + '/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: concisePrompt, notes: text }),
        });
        if (!response.ok) throw new Error('Jetson returned HTTP ' + response.status);
        const data = await response.json();
        result = data.response;
        if (!result) throw new Error('Jetson response did not contain response.');
      } catch (jetsonError) {
        window.apiTrace?.('Branch: Jetson /chat concise request failed → OpenAI backup', jetsonError.message || '');
        rewriteStatus.textContent = 'Jetson unavailable — using OpenAI backup...';
        result = await openAIChat(
          'Rewrite the user text to be concise while preserving its meaning. Return only the revised text.',
          text,
        );
      }
      textBox.value = result;
      document.querySelector('#editor').textContent = result;
      edit();
      rewriteStatus.textContent = 'Done!';
    } catch (error) {
      console.error('Rewrite request failed:', error);
      rewriteStatus.textContent = 'Error: ' + error.message;
    } finally {
      rewriteButton.disabled = false;
    }
  };
  const chatInput = document.querySelector('#notesChatInput');
  const chatSend = document.querySelector('#notesChatSend');
  const chatMessages = document.querySelector('#notesChatMessages');
  const addMessage = (text, user = false) => {
    const item = document.createElement('div');
    item.style.cssText =
      'padding:9px 10px;border-radius:8px;font-size:.86rem;line-height:1.45;white-space:pre-wrap;' +
      (user ? 'background:var(--ink);color:var(--paper);margin-left:28px' : 'background:var(--soft);margin-right:28px');
    item.textContent = text;
    chatMessages.append(item);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return item;
  };
  const askWithFallback = async () => {
    const message = chatInput.value.trim();
    if (!message) return;
    const notes = document.querySelector('#editor').innerText;
    chatInput.value = '';
    addMessage(message, true);
    const reply = addMessage('Thinking...');
    try {
      let answer;
      try {
        const response = await fetch(JETSON_BASE_URL + '/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, notes }),
        });
        if (!response.ok) throw new Error('Jetson returned HTTP ' + response.status);
        const data = await response.json();
        answer = data.response;
        if (!answer) throw new Error('Jetson response did not contain response.');
      } catch (jetsonError) {
        window.apiTrace?.('Branch: Jetson chat failed → OpenAI backup', jetsonError.message || '');
        reply.textContent = 'Jetson unavailable — using OpenAI backup...';
        answer = await openAIChat(
          'You are SquigglyBot, a helpful general assistant. The following active note is optional context; use it when useful, but answer the user normally.\n\nActive note:\n' +
            notes,
          message,
        );
      }
      reply.textContent = answer;
    } catch (error) {
      console.error('Chat request failed:', error);
      reply.textContent = 'Error: ' + error.message;
    }
  };
  chatSend.onclick = askWithFallback;
  chatInput.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      askWithFallback();
    }
  };
})();
