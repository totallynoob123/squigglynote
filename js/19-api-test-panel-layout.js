(() => {
  const dialog = document.querySelector('#apiTestDialog');
  const title = dialog?.querySelector('h2');
  const log = document.querySelector('#apiRequestLog');
  if (!dialog || !title || !log) return;
  dialog.style.cssText +=
    ';position:fixed;min-width:360px;min-height:300px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);resize:both;overflow:hidden';
  title.style.cssText += ';cursor:grab;user-select:none';
  log.style.cssText +=
    ';height:220px;max-height:none;overflow:auto;overscroll-behavior:contain;white-space:pre-wrap;overflow-wrap:anywhere';
  let drag = null;
  title.addEventListener('pointerdown', event => {
    const box = dialog.getBoundingClientRect();
    drag = { x: event.clientX - box.left, y: event.clientY - box.top };
    dialog.style.margin = '0';
    dialog.style.left = box.left + 'px';
    dialog.style.top = box.top + 'px';
    title.setPointerCapture(event.pointerId);
    title.style.cursor = 'grabbing';
  });
  title.addEventListener('pointermove', event => {
    if (!drag) return;
    const left = Math.max(8, Math.min(window.innerWidth - dialog.offsetWidth - 8, event.clientX - drag.x));
    const top = Math.max(8, Math.min(window.innerHeight - dialog.offsetHeight - 8, event.clientY - drag.y));
    dialog.style.left = left + 'px';
    dialog.style.top = top + 'px';
  });
  const stop = event => {
    drag = null;
    title.style.cursor = 'grab';
    if (title.hasPointerCapture(event.pointerId)) title.releasePointerCapture(event.pointerId);
  };
  title.addEventListener('pointerup', stop);
  title.addEventListener('pointercancel', stop);
})();

(() => {
  const routes = document.querySelector('#apiRoutes');
  const log = document.querySelector('#apiRequestLog');
  if (routes) {
    routes.innerHTML =
      '<div>Primary · Rewrite&nbsp;&nbsp;&nbsp; POST ' + window.SQUIGGLY_API + '/rewrite</div>' +
      '<div>Primary · Chat&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; POST ' + window.SQUIGGLY_API + '/chat</div>' +
      '<div>Primary · Transcribe POST ' + window.SQUIGGLY_API + '/transcribe</div>' +
      '<div style="margin-top:6px;color:var(--muted)">Fallback · Concise/chat&nbsp; POST https://api.openai.com/v1/chat/completions (only after Jetson fails)</div>' +
      '<div style="color:var(--muted)">Fallback · Audio&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; POST https://api.deepgram.com/v1/listen (only after Jetson fails)</div>';
  }
  if (log)
    log.style.cssText +=
      ';display:block;height:165px;min-height:165px;overflow-y:scroll!important;overflow-x:auto!important;touch-action:pan-y;white-space:pre-wrap;overflow-wrap:anywhere';
})();
