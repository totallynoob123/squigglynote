(() => {
  const editor = document.querySelector('#editor');
  const closestFormat = selector => {
    const node = window.getSelection().anchorNode;
    const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    return element?.closest(selector);
  };
  const setupToggle = (title, tag) => {
    const button = Array.from(document.querySelectorAll('[aria-label="Text formatting"] button')).find(
      item => item.title === title,
    );
    if (!button) return;
    button.onclick = () => {
      editor.focus();
      document.execCommand('formatBlock', false, closestFormat(tag) ? 'p' : tag);
      edit();
      document.dispatchEvent(new Event('selectionchange'));
    };
  };
  setupToggle('Heading', 'h2');
  setupToggle('Quote', 'blockquote');
})();

(() => {
  const editor = document.querySelector('#editor');
  const bar = document.querySelector('[aria-label="Text formatting"]');
  const colors = [
    ['Black', '#111111'],
    ['Red', '#b42318'],
    ['Orange', '#b54708'],
    ['Green', '#16794c'],
    ['Blue', '#175cd3'],
    ['Purple', '#6941c6'],
  ];
  const palette = document.createElement('div');
  palette.setAttribute('aria-label', 'Preset text colors');
  palette.style.cssText = 'display:flex;gap:3px;padding-left:3px;border-left:1px solid var(--line)';
  colors.forEach(([name, value]) => {
    const swatch = document.createElement('button');
    swatch.className = 'btn';
    swatch.title = name;
    swatch.setAttribute('aria-label', name + ' text');
    swatch.style.cssText =
      'width:18px;min-width:18px;height:18px;padding:0;border-radius:50%;background:' +
      value +
      ';border:2px solid var(--paper);box-shadow:0 0 0 1px var(--line)';
    swatch.onmousedown = event => event.preventDefault();
    swatch.onclick = () => {
      editor.focus();
      document.execCommand('foreColor', false, value);
      edit();
    };
    palette.append(swatch);
  });
  bar.append(palette);
})();
