(() => {
  const actions = document.querySelector('#todoPage .topbar .actions');
  const settings = document.querySelector('#workspaceSettings');
  if (!actions || !settings || document.querySelector('#todoSettings')) return;
  const button = document.createElement('button');
  button.className = 'btn gear';
  button.id = 'todoSettings';
  button.setAttribute('aria-label', 'Settings');
  button.title = 'Settings';
  button.textContent = '⚙';
  button.onclick = () => settings.click();
  actions.append(button);
})();
