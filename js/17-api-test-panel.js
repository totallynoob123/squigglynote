(() => {
  const TUNNEL_BASE_URL = window.SQUIGGLY_API;
  const requests = [];
  const header = document.querySelector('.workspace-head');
  const button = document.createElement('button');
  button.className = 'btn';
  button.id = 'apiTestButton';
  button.textContent = 'API test';
  button.style.cssText = 'margin-left:auto;padding:6px 8px;font-size:.72rem';
  header.insertBefore(button, document.querySelector('#saveState'));
  document.body.insertAdjacentHTML(
    'beforeend',
    '<dialog class="dialog" id="apiTestDialog" style="width:min(700px,calc(100% - 28px))"><div class="eyebrow">Jetson connection</div><h2 style="margin:8px 0">API test panel</h2><p>These are the exact routes used by the app.</p><div id="apiRoutes" style="display:grid;gap:7px;font:12px/1.45 ui-monospace,monospace;background:var(--soft);padding:12px;border-radius:9px"></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px"><strong style="font-size:.86rem">Live request log</strong><button class="btn" id="clearApiLog" style="padding:5px 8px;font-size:.72rem">Clear</button></div><div id="apiRequestLog" style="margin-top:8px;max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:9px;padding:8px;font:12px/1.45 ui-monospace,monospace"></div><div class="dialog-actions"><button class="btn" id="closeApiTest">Done</button></div></dialog>',
  );
  const dialog = document.querySelector('#apiTestDialog');
  const routes = document.querySelector('#apiRoutes');
  const log = document.querySelector('#apiRequestLog');
  routes.innerHTML =
    '<div>Rewrite&nbsp;&nbsp;&nbsp; POST ' +
    TUNNEL_BASE_URL +
    '/rewrite</div><div>Chat&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; POST ' +
    TUNNEL_BASE_URL +
    '/chat</div><div>Transcribe POST ' +
    TUNNEL_BASE_URL +
    '/transcribe</div>';
  const renderLog = () => {
    log.replaceChildren();
    if (!requests.length) {
      log.textContent = 'No tunnel requests yet. Use Make concise, Chat, or Transcribe selected.';
      return;
    }
    requests
      .slice()
      .reverse()
      .forEach(entry => {
        const line = document.createElement('div');
        line.style.cssText =
          'padding:6px 2px;border-bottom:1px solid var(--line);color:' +
          (entry.error ? '#a33' : entry.status >= 200 && entry.status < 300 ? '#397047' : 'var(--ink)');
        line.textContent =
          '[' +
          entry.time +
          '] ' +
          entry.label +
          '\n' +
          (entry.method ? entry.method + ' ' + entry.url + '\n' : '') +
          (entry.error ||
            (entry.status === null
              ? 'Started'
              : 'HTTP ' +
                entry.status +
                (entry.statusText ? ' ' + entry.statusText : '') +
                (entry.duration ? ' · ' + entry.duration + 'ms' : '') +
                (entry.contentType ? '\nContent-Type: ' + entry.contentType : '')));
        log.append(line);
      });
  };
  button.onclick = () => {
    renderLog();
    dialog.showModal();
  };
  document.querySelector('#closeApiTest').onclick = () => dialog.close();
  document.querySelector('#clearApiLog').onclick = () => {
    requests.length = 0;
    renderLog();
  };
  window.apiTrace = (label, error = '') => {
    requests.push({ time: new Date().toLocaleTimeString(), label, method: '', url: '', status: null, error });
    if (dialog.open) renderLog();
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = init.method || (typeof input === 'object' && input?.method) || 'GET';
    const service = url.startsWith(TUNNEL_BASE_URL)
      ? 'Jetson tunnel'
      : url.startsWith('https://api.deepgram.com/')
        ? 'Deepgram backup'
        : url.startsWith('https://api.openai.com/')
          ? 'OpenAI backup'
          : '';
    const entry = service
      ? {
          time: new Date().toLocaleTimeString(),
          label: service + ' request',
          method: method.toUpperCase(),
          url,
          status: null,
          error: '',
          started: performance.now(),
          duration: 0,
        }
      : null;
    if (entry) requests.push(entry);
    try {
      const response = await originalFetch(input, init);
      if (entry) {
        entry.status = response.status;
        entry.statusText = response.statusText;
        entry.contentType = response.headers.get('content-type') || '';
        entry.duration = Math.round(performance.now() - entry.started);
        if (dialog.open) renderLog();
      }
      return response;
    } catch (error) {
      if (entry) {
        entry.error = error.message || 'Network error';
        entry.duration = Math.round(performance.now() - entry.started);
        if (dialog.open) renderLog();
      }
      throw error;
    }
  };
})();

(() => {
  const button = document.querySelector('#apiTestButton');
  if (!button) return;
  button.style.cssText =
    'position:fixed;right:22px;bottom:22px;z-index:1000;padding:10px 13px;border-radius:999px;background:var(--paper);box-shadow:0 8px 24px #0003;touch-action:none';
  button.title = 'Drag to move · Click to open API test';
  let drag = null,
    moved = false;
  button.addEventListener('pointerdown', event => {
    const bounds = button.getBoundingClientRect();
    drag = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    moved = false;
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', event => {
    if (!drag) return;
    const left = Math.max(8, Math.min(window.innerWidth - button.offsetWidth - 8, event.clientX - drag.x));
    const top = Math.max(8, Math.min(window.innerHeight - button.offsetHeight - 8, event.clientY - drag.y));
    if (Math.abs(left - button.offsetLeft) > 3 || Math.abs(top - button.offsetTop) > 3) moved = true;
    button.style.left = left + 'px';
    button.style.top = top + 'px';
    button.style.right = 'auto';
    button.style.bottom = 'auto';
  });
  const stop = event => {
    if (!drag) return;
    drag = null;
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
  };
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener(
    'click',
    event => {
      if (!moved) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      moved = false;
    },
    true,
  );
})();
