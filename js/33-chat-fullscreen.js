(() => {
  const panel = document.querySelector('#notesChatPanel');
  if (!panel || document.querySelector('#panelFullscreen')) return;
  const button = document.createElement('button');
  button.className = 'btn';
  button.type = 'button';
  button.id = 'panelFullscreen';
  button.textContent = 'Fullscreen';
  button.title = 'Fit chat to screen';
  button.onclick = () => {
    const active = panel.classList.toggle('chat-panel-fullscreen');
    button.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
  };
  panel.firstElementChild?.append(button);
})();
