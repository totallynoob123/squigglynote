(() => {
  const panel = document.querySelector('#notesChatPanel');
  if (!panel) return;
  const heading = panel.querySelector('strong');
  const intro = panel.querySelector('#notesChatMessages p');
  const input = panel.querySelector('#notesChatInput');
  if (heading) heading.textContent = 'Ask SquigglyBot';
  if (intro) intro.textContent = 'Ask anything. Your active note is included as helpful context.';
  if (input) input.placeholder = 'Ask SquigglyBot…';
})();
