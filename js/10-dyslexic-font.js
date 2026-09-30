(() => {
  const originalApplyPrefs = applyPrefs;
  applyPrefs = () => {
    originalApplyPrefs();
    document.body.classList.toggle('dyslexic', prefs.dyslexic === 'on');
  };
  prefs.dyslexic = prefs.dyslexic || 'off';
  applyPrefs();
  const row = document.createElement('div');
  row.className = 'settings-row';
  row.innerHTML =
    '<span>Dyslexic font</span><div class="choices"><button data-dyslexic="off">Off</button><button data-dyslexic="on">On</button></div>';
  document.querySelector('.dialog-actions').before(row);
  const buttons = row.querySelectorAll('[data-dyslexic]');
  const sync = () =>
    buttons.forEach(button => button.classList.toggle('active', button.dataset.dyslexic === prefs.dyslexic));
  buttons.forEach(
    button =>
      (button.onclick = () => {
        prefs.dyslexic = button.dataset.dyslexic;
        applyPrefs();
        sync();
      }),
  );
  document.querySelector('#homeSettings').addEventListener('click', () => setTimeout(sync, 0));
  document.querySelector('#workspaceSettings').addEventListener('click', () => setTimeout(sync, 0));
  sync();
})();
