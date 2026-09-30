(() => {
  const monitorUrl = 'https://atreyap31-cell.github.io/Squigglynote-tester/';
  const open = () => {
    let dialog = document.querySelector('#monitorDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'monitorDialog';
      dialog.innerHTML =
        '<div class="monitor-head"><strong>Squiggly Note Monitor</strong><button class="btn" type="button" id="closeMonitor">Close</button></div><iframe title="Squiggly Note Monitor" src="' +
        monitorUrl +
        '"></iframe>';
      document.body.append(dialog);
      dialog.querySelector('#closeMonitor').onclick = () => dialog.close();
    }
    dialog.showModal();
  };
  const add = container => {
    if (!container || container.querySelector('#monitorTab')) return;
    const button = document.createElement('button');
    button.id = 'monitorTab';
    button.className = 'btn';
    button.type = 'button';
    button.textContent = 'Monitor';
    button.title = 'Open Squiggly Note Monitor';
    button.onclick = open;
    container.append(button);
  };
  add(document.querySelector('.nav .actions'));
  add(document.querySelector('#app .topbar .actions'));
})();
