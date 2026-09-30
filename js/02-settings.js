openSettings = () => {
  const dialog = document.querySelector('#settingsDialog');
  if (!dialog.open) dialog.showModal();
  document
    .querySelectorAll('[data-key]')
    .forEach(button => button.classList.toggle('active', prefs[button.dataset.key] === button.dataset.value));
};
document.querySelector('#homeSettings').onclick = openSettings;
document.querySelector('#workspaceSettings').onclick = openSettings;

(() => {
  const fontButton = document.querySelector('[data-key="font"][data-value="sans"]');
  const largeButton = document.querySelector('[data-key="size"][data-value="large"]');
  fontButton.textContent = 'Sans-serif';
  largeButton.textContent = 'Large text';
  fontButton.onclick = () => {
    prefs.font = 'sans';
    applyPrefs();
    openSettings();
  };
  largeButton.onclick = () => {
    prefs.size = 'large';
    applyPrefs();
    openSettings();
  };
})();

(() => {
  const whiteBackground = document.querySelector('[data-key="background"][data-value="clean"]');
  whiteBackground.onclick = () => {
    prefs.background = 'clean';
    prefs.theme = 'light';
    applyPrefs();
    openSettings();
  };
})();

(() => {
  const darkTheme = document.querySelector('[data-key="theme"][data-value="dark"]');
  darkTheme.onclick = () => {
    prefs.theme = 'dark';
    prefs.background = 'warm';
    applyPrefs();
    openSettings();
  };
})();
