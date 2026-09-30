(() => {
  const endpoint = 'https://absolve-marigold-procedure.ngrok-free.dev/chat';
  const request = async (message, notes) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, notes }),
    });
    if (!response.ok) throw new Error('Jetson returned HTTP ' + response.status);
    const data = await response.json();
    if (!data.response) throw new Error('Jetson did not return a response.');
    return data.response;
  };
  const objectFrom = text => {
    try {
      return JSON.parse(text);
    } catch {}
    const match = String(text).match(/\{[\s\S]*\}/);
    if (match)
      try {
        return JSON.parse(match[0]);
      } catch {}
    return null;
  };
  const noteChangeFrom = raw => {
    const json = objectFrom(raw);
    if (json) return { answer: json.answer || '', replacement: json.replacement ?? json.replacment ?? null };
    const match = String(raw).match(/ANSWER:\s*([\s\S]*?)\s*REPLACEMENT:\s*([\s\S]*)$/i);
    if (!match) return { answer: String(raw), replacement: null };
    const replacement = match[2].trim();
    return { answer: match[1].trim(), replacement: /^NO_CHANGE$/i.test(replacement) ? null : replacement };
  };
  const taskChangeFrom = raw => {
    const json = objectFrom(raw);
    if (json) return { answer: json.answer || '', tasks: Array.isArray(json.tasks) ? json.tasks : null };
    const match = String(raw).match(/ANSWER:\s*([\s\S]*?)\s*TASKS:\s*([\s\S]*)$/i);
    if (!match) return { answer: String(raw), tasks: null };
    const taskText = match[2].trim();
    return {
      answer: match[1].trim(),
      tasks: /^NO_CHANGE$/i.test(taskText)
        ? null
        : taskText
            .split(/\r?\n/)
            .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
            .filter(Boolean),
    };
  };
  const preview = (title, before, after, apply) => {
    const wrap = document.createElement('div');
    wrap.className = 'change-preview';
    const header = document.createElement('header');
    header.textContent = title;
    wrap.append(header);
    const oldLines = String(before).split(/\r?\n/).filter(Boolean);
    const newLines = String(after).split(/\r?\n/).filter(Boolean);
    oldLines
      .filter(line => !newLines.includes(line))
      .forEach(line => {
        const row = document.createElement('div');
        row.className = 'change-line remove';
        row.textContent = '- ' + line;
        wrap.append(row);
      });
    newLines
      .filter(line => !oldLines.includes(line))
      .forEach(line => {
        const row = document.createElement('div');
        row.className = 'change-line add';
        row.textContent = '+ ' + line;
        wrap.append(row);
      });
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    actions.style.cssText = 'margin:0;padding:9px;background:var(--paper)';
    const reject = document.createElement('button');
    reject.className = 'btn';
    reject.textContent = 'Reject';
    const accept = document.createElement('button');
    accept.className = 'btn primary';
    accept.textContent = 'Apply changes';
    reject.onclick = () => wrap.remove();
    accept.onclick = () => {
      apply();
      wrap.remove();
    };
    actions.append(reject, accept);
    wrap.append(actions);
    return wrap;
  };

  const notesPanel = document.querySelector('#notesChatPanel');
  const notesSend = document.querySelector('#notesChatSend');
  const notesInput = document.querySelector('#notesChatInput');
  const notesMessages = document.querySelector('#notesChatMessages');
  if (notesPanel && notesSend && notesInput && notesMessages) {
    const allow = document.createElement('label');
    allow.className = 'bot-permission';
    allow.innerHTML = '<input type="checkbox"> Allow SquigglyBot to propose note changes';
    notesInput.parentElement.insertAdjacentElement('beforebegin', allow);
    const originalSend = notesSend.onclick;
    notesSend.onclick = async () => {
      if (!allow.querySelector('input').checked) return originalSend?.();
      const question = notesInput.value.trim();
      const editor = document.querySelector('#editor');
      if (!question || !editor) return;
      const before = editor.innerText;
      notesInput.value = '';
      const reply = document.createElement('div');
      reply.style.cssText =
        'padding:9px 10px;border-radius:8px;background:var(--soft);margin-right:28px;font-size:.86rem;white-space:pre-wrap';
      reply.textContent = 'Preparing a change preview…';
      notesMessages.append(reply);
      try {
        const raw = await request(
          'The user has given permission to propose an edit to their active note. Use exactly this format, with no code fence:\nANSWER: short explanation\nREPLACEMENT: complete replacement note text, or NO_CHANGE\nOnly provide a replacement when the request asks to change the note.\n\nCurrent note:\n' +
            before +
            '\n\nRequest: ' +
            question,
          before,
        );
        const result = noteChangeFrom(raw);
        reply.textContent = result.answer || raw;
        if (result?.replacement && result.replacement !== before) {
          const change = preview('Proposed note changes', before, result.replacement, () => {
            editor.innerText = result.replacement;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          });
          notesMessages.append(change);
        }
      } catch (error) {
        console.error('Note change proposal failed:', error);
        reply.textContent = 'Error: ' + error.message;
      }
      notesMessages.scrollTop = notesMessages.scrollHeight;
    };
    notesInput.onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        notesSend.click();
      }
    };
  }

  const todoSend = document.querySelector('#todoBotSend');
  const todoInput = document.querySelector('#todoBotInput');
  const todoReply = document.querySelector('#todoBotReply');
  const todoItems = document.querySelector('#todoItems');
  if (todoSend && todoInput && todoReply && todoItems) {
    const allow = document.createElement('label');
    allow.className = 'bot-permission';
    allow.innerHTML = '<input type="checkbox"> Allow SquigglyBot to propose task changes';
    todoInput.parentElement.insertAdjacentElement('beforebegin', allow);
    const originalSend = todoSend.onclick;
    todoSend.onclick = async () => {
      if (!allow.querySelector('input').checked) return originalSend?.();
      const question = todoInput.value.trim();
      if (!question) return;
      const before = [...todoItems.querySelectorAll('input[type="text"]')]
        .map(input => input.value.trim())
        .filter(Boolean);
      todoInput.value = '';
      todoReply.style.display = 'block';
      todoReply.textContent = 'Preparing a change preview…';
      try {
        const raw = await request(
          'The user has given permission to propose changes to this to-do list. Use exactly this format, with no code fence:\nANSWER: short explanation\nTASKS: one complete task per line beginning with a hyphen, or NO_CHANGE\nKeep tasks unchanged unless the user asks to change them.\n\nCurrent tasks:\n' +
            before.map(task => '- ' + task).join('\n') +
            '\n\nRequest: ' +
            question,
          before.join('\n'),
        );
        const result = taskChangeFrom(raw);
        todoReply.textContent = result.answer || raw;
        const after = Array.isArray(result.tasks)
          ? result.tasks.map(task => String(task).trim()).filter(Boolean)
          : null;
        if (after && after.join('\n') !== before.join('\n')) {
          const change = preview('Proposed task changes', before.join('\n'), after.join('\n'), () => {
            while (todoItems.querySelector('.todo-item .btn')) todoItems.querySelector('.todo-item .btn').click();
            const add = document.querySelector('#todoNewItem');
            const addButton = document.querySelector('#addTodoItem');
            after.forEach(task => {
              add.value = task;
              addButton.click();
            });
          });
          todoReply.parentElement.append(change);
        }
      } catch (error) {
        console.error('Task change proposal failed:', error);
        todoReply.textContent = 'Error: ' + error.message;
      }
    };
  }
})();
