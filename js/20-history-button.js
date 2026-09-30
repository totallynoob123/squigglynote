(() => {
  const button = document.querySelector('#openVersionHistory');
  const panel = document.querySelector('.timeline');
  if (!button || !panel) return;
  button.style.cssText = 'width:100%;margin:2px 0 12px;padding:8px 10px;font-size:.74rem';
  panel.querySelector('h2')?.after(button);
})();
