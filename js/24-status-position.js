(() => {
  const editorWrap = document.querySelector('.editor-wrap');
  const toolbar = editorWrap?.querySelector('.toolbar');
  const status = document.querySelector('#status');
  if (!editorWrap || !toolbar || !status) return;
  status.style.margin = '0 0 14px';
  toolbar.insertAdjacentElement('afterend', status);
})();
