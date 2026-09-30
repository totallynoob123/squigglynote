(() => {
  const panel = document.querySelector('#notesChatPanel');
  const chatToggle = document.querySelector('#notesChatToggle');
  const headerActions = document.querySelector('#app .topbar .actions');
  if (!panel || !chatToggle || !headerActions) return;

  const STORAGE_KEY = 'squigglybot-sidebar-geometry-v1';
  const GAP = 12;
  const SNAP_DISTANCE = 130;
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  let drag = null,
    snapTarget = null;

  const oldHandle = panel.firstElementChild;
  const handle = oldHandle.cloneNode(true);
  handle.classList.add('squigglybot-handle');
  const badge = handle.querySelector('.eyebrow');
  if (badge) {
    const close = document.createElement('button');
    close.className = 'btn';
    close.textContent = 'Close';
    close.style.cssText = 'padding:5px 8px;font-size:.72rem';
    close.onclick = event => {
      event.stopPropagation();
      closeChat();
    };
    badge.replaceWith(close);
  }
  oldHandle.replaceWith(handle);

  let preview = document.querySelector('#chatSnapPreview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'chatSnapPreview';
    document.body.append(preview);
  }

  const defaultGeometry = () => ({
    width: Math.min(390, window.innerWidth - GAP * 2),
    height: Math.min(560, window.innerHeight - GAP * 2),
    left: Math.max(GAP, window.innerWidth - Math.min(390, window.innerWidth - GAP * 2) - 22),
    top: Math.max(GAP, window.innerHeight - Math.min(560, window.innerHeight - GAP * 2) - 22),
  });
  const clamp = geometry => {
    const width = Math.max(300, Math.min(geometry.width || panel.offsetWidth || 390, window.innerWidth - GAP * 2));
    const height = Math.max(300, Math.min(geometry.height || panel.offsetHeight || 560, window.innerHeight - GAP * 2));
    return {
      width,
      height,
      left: Math.max(GAP, Math.min(geometry.left ?? window.innerWidth - width - GAP, window.innerWidth - width - GAP)),
      top: Math.max(GAP, Math.min(geometry.top ?? GAP, window.innerHeight - height - GAP)),
    };
  };
  const applyGeometry = geometry => {
    const next = clamp(geometry);
    panel.style.left = next.left + 'px';
    panel.style.top = next.top + 'px';
    panel.style.width = next.width + 'px';
    panel.style.height = next.height + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    return next;
  };
  const saveGeometry = () => {
    const box = panel.getBoundingClientRect();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ left: box.left, top: box.top, width: box.width, height: box.height }),
    );
  };
  const cornerRect = corner => {
    const box = panel.getBoundingClientRect();
    const width = Math.min(box.width, window.innerWidth - GAP * 2);
    const height = Math.min(box.height, window.innerHeight - GAP * 2);
    return {
      left: corner.includes('right') ? window.innerWidth - width - GAP : GAP,
      top: corner.includes('bottom') ? window.innerHeight - height - GAP : GAP,
      width,
      height,
    };
  };
  const nearestCorner = (left, top) => {
    const box = panel.getBoundingClientRect();
    const centerX = left + box.width / 2;
    const centerY = top + box.height / 2;
    const corners = [
      ['top-left', GAP, GAP],
      ['top-right', window.innerWidth - GAP, GAP],
      ['bottom-left', GAP, window.innerHeight - GAP],
      ['bottom-right', window.innerWidth - GAP, window.innerHeight - GAP],
    ];
    const [name, x, y] = corners.reduce(
      (best, corner) => {
        const distance = Math.hypot(centerX - corner[1], centerY - corner[2]);
        return distance < best[3] ? [...corner, distance] : best;
      },
      ['', 0, 0, Infinity],
    );
    return Math.min(Math.abs(centerX - x), Math.abs(centerY - y)) <= SNAP_DISTANCE ? name : '';
  };
  const showSnap = corner => {
    if (!corner) {
      snapTarget = null;
      preview.classList.remove('visible');
      return;
    }
    snapTarget = corner;
    const rect = cornerRect(corner);
    preview.style.left = rect.left + 'px';
    preview.style.top = rect.top + 'px';
    preview.style.width = rect.width + 'px';
    preview.style.height = rect.height + 'px';
    preview.classList.add('visible');
  };
  const openChat = () => {
    panel.hidden = false;
    panel.classList.add('squigglybot-sidebar');
    chatToggle.setAttribute('aria-expanded', 'true');
    applyGeometry(saved || defaultGeometry());
    document.querySelector('#notesChatInput')?.focus();
  };
  const closeChat = () => {
    panel.hidden = true;
    chatToggle.setAttribute('aria-expanded', 'false');
    showSnap('');
  };

  const chatButton = document.querySelector('#openChatFromNotes') || document.createElement('button');
  chatButton.className = 'btn';
  chatButton.id = 'openChatFromNotes';
  chatButton.textContent = 'Chat';
  if (!chatButton.isConnected) headerActions.insertBefore(chatButton, headerActions.querySelector('#back'));
  chatButton.onclick = openChat;
  chatToggle.textContent = 'Ask SquigglyBot';
  chatToggle.onclick = openChat;

  panel.classList.add('squigglybot-sidebar');
  panel.hidden = true;
  applyGeometry(saved || defaultGeometry());

  handle.addEventListener('pointerdown', event => {
    if (event.target.closest('button,input,textarea')) return;
    const box = panel.getBoundingClientRect();
    drag = { x: event.clientX - box.left, y: event.clientY - box.top };
    panel.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!drag) return;
    const box = panel.getBoundingClientRect();
    const left = Math.max(GAP, Math.min(window.innerWidth - box.width - GAP, event.clientX - drag.x));
    const top = Math.max(GAP, Math.min(window.innerHeight - box.height - GAP, event.clientY - drag.y));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    showSnap(nearestCorner(left, top));
  });
  const stopDrag = event => {
    if (!drag) return;
    drag = null;
    panel.classList.remove('dragging');
    if (snapTarget) applyGeometry(cornerRect(snapTarget));
    showSnap('');
    saveGeometry();
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener('pointerup', stopDrag);
  handle.addEventListener('pointercancel', stopDrag);
  new ResizeObserver(() => {
    if (!panel.hidden && !drag) saveGeometry();
  }).observe(panel);
  window.addEventListener('resize', () => {
    if (!panel.hidden) applyGeometry(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || defaultGeometry());
  });
})();
