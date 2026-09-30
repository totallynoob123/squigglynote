(() => {
  const homeActions = document.querySelector('.hero-actions');
  if (!homeActions) return;
  const open = document.createElement('button');
  open.className = 'btn';
  open.id = 'openTodoList';
  open.textContent = 'To-do list';
  homeActions.insertBefore(open, homeActions.querySelector('#identity'));

  document.body.insertAdjacentHTML(
    'beforeend',
    '<dialog class="dialog" id="todoDialog"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><div class="eyebrow">Squiggly tasks</div><h2 style="margin:6px 0 0">To-do list</h2></div><button class="btn" id="closeTodoList">Done</button></div><p>Build a checklist, turn text or a WAV recording into task bullets, and ask SquigglyBot for suggestions.</p><div style="display:flex;gap:7px"><input id="todoNewItem" placeholder="Add a task…" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--ink);padding:9px;outline:0"><button class="btn primary" id="addTodoItem">Add</button></div><div id="todoItems"></div><div style="display:grid;gap:8px;padding-top:12px;border-top:1px solid var(--line)"><label class="eyebrow" for="todoSource">Turn text into tasks</label><textarea id="todoSource" placeholder="Paste a draft, plan, or transcript…" style="width:100%;min-height:90px;resize:vertical;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--ink);padding:9px;outline:0"></textarea><div class="actions" style="justify-content:flex-start"><button class="btn primary" id="todoConcise">Make bullet tasks</button><label class="btn" for="todoAudio">Transcribe WAV to tasks</label><input id="todoAudio" type="file" accept=".wav,audio/wav" hidden></div><div class="status" id="todoStatus"></div></div><div style="display:grid;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--line)"><label class="eyebrow" for="todoBotInput">Ask SquigglyBot for suggestions</label><div style="display:flex;gap:7px"><input id="todoBotInput" placeholder="How should I prioritize these?" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--ink);padding:9px;outline:0"><button class="btn" id="todoBotSend">Ask</button></div><div id="todoBotReply" style="display:none;padding:10px;border-radius:8px;background:var(--soft);font-size:.86rem;line-height:1.45;white-space:pre-wrap"></div></div></dialog>',
  );

  const dialog = document.querySelector('#todoDialog');
  const items = document.querySelector('#todoItems');
  const input = document.querySelector('#todoNewItem');
  const source = document.querySelector('#todoSource');
  const status = document.querySelector('#todoStatus');
  const key = 'squiggly-todos-v1-' + (typeof OWNER === 'undefined' ? 'guest' : OWNER);
  let tasks = JSON.parse(localStorage.getItem(key) || '[]');
  const save = () => localStorage.setItem(key, JSON.stringify(tasks));
  const render = () => {
    items.replaceChildren(
      ...tasks.map((task, index) => {
        const row = document.createElement('div');
        row.className = 'todo-item' + (task.done ? ' done' : '');
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = task.done;
        check.onchange = () => {
          task.done = check.checked;
          save();
          render();
        };
        const text = document.createElement('input');
        text.type = 'text';
        text.value = task.text;
        text.oninput = () => {
          task.text = text.value;
          save();
        };
        const remove = document.createElement('button');
        remove.className = 'btn';
        remove.textContent = 'Remove';
        remove.onclick = () => {
          tasks.splice(index, 1);
          save();
          render();
        };
        row.append(check, text, remove);
        return row;
      }),
    );
  };
  const addTasks = text => {
    const lines = String(text)
      .split(/\r?\n/)
      .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter(Boolean);
    tasks.push(...lines.map(text => ({ text, done: false })));
    save();
    render();
  };
  const requestTasks = async text => {
    const response = await fetch(window.SQUIGGLY_API + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:
          'Turn this into a concise to-do list. Return only one actionable task per line, each beginning with a hyphen.\n\nText:\n' +
          text,
        notes: text,
      }),
    });
    if (!response.ok) throw new Error('Jetson returned HTTP ' + response.status);
    const data = await response.json();
    if (!data.response) throw new Error('Jetson did not return task suggestions.');
    return data.response;
  };
  document.querySelector('#openTodoList').onclick = () => {
    render();
    dialog.showModal();
  };
  document.querySelector('#closeTodoList').onclick = () => dialog.close();
  document.querySelector('#addTodoItem').onclick = () => {
    if (input.value.trim()) {
      addTasks(input.value);
      input.value = '';
    }
  };
  input.onkeydown = event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.querySelector('#addTodoItem').click();
    }
  };
  document.querySelector('#todoConcise').onclick = async () => {
    if (!source.value.trim()) {
      status.textContent = 'Add text first.';
      status.className = 'status error';
      return;
    }
    status.textContent = 'Making task bullets…';
    status.className = 'status';
    try {
      addTasks(await requestTasks(source.value));
      status.textContent = 'Task bullets added.';
      status.className = 'status good';
    } catch (error) {
      console.error('To-do concise failed:', error);
      status.textContent = 'Error: ' + error.message;
      status.className = 'status error';
    }
  };
  document.querySelector('#todoAudio').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!/\.wav$/i.test(file.name)) {
      status.textContent = 'Choose a .wav file.';
      status.className = 'status error';
      return;
    }
    status.textContent = 'Transcribing and making task bullets…';
    status.className = 'status';
    try {
      const form = new FormData();
      form.append('audio', file);
      const response = await fetch(window.SQUIGGLY_API + '/transcribe', {
        method: 'POST',
        body: form,
      });
      if (!response.ok) throw new Error('Jetson returned HTTP ' + response.status);
      const data = await response.json();
      const transcript = data.text || data.content || data.transcript;
      if (!transcript) throw new Error('Jetson did not return a transcript.');
      source.value = transcript;
      addTasks(await requestTasks(transcript));
      status.textContent = 'Transcript turned into task bullets.';
      status.className = 'status good';
    } catch (error) {
      console.error('To-do transcription failed:', error);
      status.textContent = 'Error: ' + error.message;
      status.className = 'status error';
    }
    event.target.value = '';
  };
  document.querySelector('#todoBotSend').onclick = async () => {
    const question = document.querySelector('#todoBotInput').value.trim();
    const reply = document.querySelector('#todoBotReply');
    if (!question) return;
    reply.style.display = 'block';
    reply.textContent = 'Thinking…';
    try {
      const list = tasks.map((task, index) => (task.done ? '[done] ' : '') + (index + 1) + '. ' + task.text).join('\n');
      const response = await fetch(window.SQUIGGLY_API + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:
            'Give helpful suggestions only. Do not edit, rewrite, add, remove, or claim to have changed this to-do list.\n\nTo-do list:\n' +
            list +
            '\n\nUser question: ' +
            question,
          notes: list,
        }),
      });
      if (!response.ok) throw new Error('Jetson returned HTTP ' + response.status);
      const data = await response.json();
      if (!data.response) throw new Error('Jetson did not return a suggestion.');
      reply.textContent = data.response;
    } catch (error) {
      console.error('To-do SquigglyBot failed:', error);
      reply.textContent = 'Error: ' + error.message;
    }
  };
})();

(() => {
  const dialog = document.querySelector('#todoDialog');
  const status = document.querySelector('#todoStatus');
  if (!dialog || !status) return;
  status.style.margin = '12px 0 0';
  dialog.querySelector('p')?.insertAdjacentElement('afterend', status);
})();
