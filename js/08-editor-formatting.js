(() => {
  const oldWelcome = 'A quieter place for your ideas. Create a note or make a long draft concise.';
  const current = active();
  if (current && current.body === oldWelcome) {
    current.body = '';
    if (current.title === 'Welcome') current.title = 'Untitled note';
    save();
    render();
  }
})();

(() => {
  const editor = document.querySelector('#editor');
  const toolbar = document.querySelector('.toolbar');
  toolbar.style.justifyContent = 'flex-start';
  const formatBar = document.createElement('div');
  formatBar.setAttribute('aria-label', 'Text formatting');
  formatBar.style.cssText = 'display:flex;align-items:center;gap:4px;flex-wrap:wrap';
  const actionBar = toolbar.querySelector('.actions');
  const makeButton = (label, command, value, title) => {
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = label;
    button.title = title;
    button.style.cssText = 'min-width:31px;padding:6px 8px;font-weight:' + (label === 'B' ? '800' : 'inherit');
    button.onmousedown = event => event.preventDefault();
    button.onclick = () => {
      editor.focus();
      document.execCommand(command, false, value);
      edit();
    };
    return button;
  };
  formatBar.append(
    makeButton('B', 'bold', null, 'Bold'),
    makeButton('I', 'italic', null, 'Italic'),
    makeButton('U', 'underline', null, 'Underline'),
    makeButton('H', 'formatBlock', 'h2', 'Heading'),
    makeButton('•', 'insertUnorderedList', null, 'Bulleted list'),
    makeButton('1.', 'insertOrderedList', null, 'Numbered list'),
    makeButton('❝', 'formatBlock', 'blockquote', 'Quote'),
    makeButton('↶', 'undo', null, 'Undo'),
    makeButton('↷', 'redo', null, 'Redo'),
  );
  const color = document.createElement('input');
  color.type = 'color';
  color.value = '#111111';
  color.title = 'Text color';
  color.style.cssText =
    'width:32px;height:31px;padding:2px;border:1px solid var(--line);border-radius:7px;background:transparent';
  color.oninput = () => {
    editor.focus();
    document.execCommand('foreColor', false, color.value);
    edit();
  };
  formatBar.append(color);
  toolbar.insertBefore(formatBar, actionBar);
})();

(() => {
  const title = document.querySelector('#title');
  const toolbar = document.querySelector('.toolbar');
  const editorWrap = document.querySelector('.editor-wrap');
  title.insertAdjacentElement('afterend', toolbar);
  toolbar.querySelector('label').hidden = true;
  toolbar.style.cssText =
    'display:flex;align-items:center;gap:9px;margin:12px 0 0;padding:8px 9px;border:1px solid var(--line);border-radius:9px;background:var(--soft);box-shadow:inset 0 1px #fff8';
  toolbar.querySelector('[aria-label="Text formatting"]').style.flex = '1';
  toolbar.querySelector('.actions').style.cssText = 'display:flex;align-items:center;gap:7px;margin-left:auto';
  editorWrap.style.paddingTop = '22px';
})();

(() => {
  const editor = document.querySelector('#editor');
  const formatBar = document.querySelector('[aria-label="Text formatting"]');
  const buttons = Array.from(formatBar.querySelectorAll('button'));
  const commandFor = {
    Bold: 'bold',
    Italic: 'italic',
    Underline: 'underline',
    'Bulleted list': 'insertUnorderedList',
    'Numbered list': 'insertOrderedList',
  };
  const setSelected = (button, selected) => {
    button.style.background = selected ? 'var(--ink)' : 'var(--paper)';
    button.style.color = selected ? 'var(--paper)' : 'var(--ink)';
    button.style.borderColor = selected ? 'var(--ink)' : 'var(--line)';
    button.setAttribute('aria-pressed', String(selected));
  };
  const inTag = tag => {
    const node = window.getSelection().anchorNode;
    const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    return Boolean(element?.closest(tag));
  };
  const update = () => {
    const selection = window.getSelection();
    const inEditor = selection?.anchorNode && editor.contains(selection.anchorNode);
    buttons.forEach(button => {
      if (!inEditor) return setSelected(button, false);
      const title = button.title;
      let selected = commandFor[title] ? document.queryCommandState(commandFor[title]) : false;
      if (title === 'Heading') selected = inTag('h2');
      if (title === 'Quote') selected = inTag('blockquote');
      setSelected(button, selected);
    });
  };
  document.addEventListener('selectionchange', update);
  buttons.forEach(button => button.addEventListener('click', () => setTimeout(update, 0)));
  editor.addEventListener('keyup', update);
  editor.addEventListener('mouseup', update);
})();

(() => {
  let repaired = false;
  state.notes.forEach(note => {
    const probe = document.createElement('textarea');
    probe.innerHTML = note.body;
    const decoded = probe.value;
    if (decoded !== note.body && /<\/?(b|strong|i|em|u|h2|ul|ol|li|blockquote|font|span)\b/i.test(decoded)) {
      note.body = decoded;
      repaired = true;
    }
  });
  if (repaired) {
    save('Formatting restored');
    render();
  }
})();

(() => {
  const editor = document.querySelector('#editor');
  const formatBar = document.querySelector('[aria-label="Text formatting"]');
  const size = document.createElement('select');
  size.title = 'Font size';
  size.setAttribute('aria-label', 'Font size');
  size.style.cssText =
    'height:31px;border:1px solid var(--line);border-radius:7px;background:var(--paper);color:var(--ink);padding:0 5px;font-size:.8rem';
  size.innerHTML =
    '<option value="" selected>Size</option><option value="2">Small</option><option value="3">Normal</option><option value="4">Large</option><option value="5">XL</option>';
  size.onchange = () => {
    if (!size.value) return;
    editor.focus();
    document.execCommand('fontSize', false, size.value);
    edit();
    size.value = '';
  };
  formatBar.insertBefore(size, formatBar.lastElementChild);
})();

(() => {
  const hasFormat = value => /<\/?(b|strong|i|em|u|h2|ul|ol|li|blockquote|font|span)\b/i.test(value);
  let repaired = false;
  state.notes.forEach(note => {
    let value = note.body;
    for (let step = 0; step < 3; step++) {
      const probe = document.createElement('textarea');
      probe.innerHTML = value;
      const decoded = probe.value;
      if (decoded === value || !hasFormat(decoded)) break;
      value = decoded;
    }
    if (value !== note.body && hasFormat(value)) {
      note.body = value;
      repaired = true;
    }
  });
  const restoreFormat = () => {
    const note = active();
    if (note) document.querySelector('#editor').innerHTML = note.body;
  };
  const previousRender = render;
  render = () => {
    previousRender();
    restoreFormat();
  };
  restoreFormat();
  if (repaired) save('Formatting restored');
})();

function toPlainText(html) {
  const container = document.createElement('div');
  container.innerHTML = String(html)
    .replace(/<br\s*\/?>(?=.)/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|li|blockquote)>/gi, '\n');
  return container.textContent.replace(/\n{3,}/g, '\n\n').trim();
}
