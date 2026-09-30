(() => {
  const TUNNEL_BASE = window.SQUIGGLY_API;
  const dialog = document.querySelector('#apiTestDialog');
  const routes = document.querySelector('#apiRoutes');
  if (!dialog || !routes) return;
  window.jetsonTestConnected = true;
  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;align-items:center;gap:7px;margin:12px 0';
  controls.innerHTML =
    '<span id="jetsonConnectionState" class="eyebrow" style="margin-right:auto;color:#397047">Jetson test mode: Connected</span><button class="btn" id="disconnectJetsonTest" style="padding:5px 8px;font-size:.72rem">Disconnect</button><button class="btn" id="connectJetsonTest" style="padding:5px 8px;font-size:.72rem" hidden>Connect</button>';
  routes.after(controls);
  const state = document.querySelector('#jetsonConnectionState');
  const connect = document.querySelector('#connectJetsonTest');
  const disconnect = document.querySelector('#disconnectJetsonTest');
  const sync = () => {
    const connected = window.jetsonTestConnected;
    state.textContent = 'Jetson test mode: ' + (connected ? 'Connected' : 'Disconnected (simulated)');
    state.style.color = connected ? '#397047' : '#a33';
    connect.hidden = connected;
    disconnect.hidden = !connected;
  };
  connect.onclick = () => {
    window.jetsonTestConnected = true;
    window.apiTrace?.('Test control: Jetson connection enabled');
    sync();
  };
  disconnect.onclick = () => {
    window.jetsonTestConnected = false;
    window.apiTrace?.('Test control: Jetson connection disabled — requests will use fallback');
    sync();
  };
  const currentFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.startsWith(TUNNEL_BASE) && !window.jetsonTestConnected) {
      const error = new Error('Jetson tunnel intentionally disconnected for fallback testing.');
      window.apiTrace?.('Branch: Jetson request blocked by test disconnect → fallback', error.message);
      throw error;
    }
    return currentFetch(input, init);
  };
  sync();
})();

(() => {
  const dialog = document.querySelector('#apiTestDialog');
  const exit = document.querySelector('#closeApiTest');
  if (!dialog || !exit) return;
  exit.textContent = 'Exit';
  exit.setAttribute('aria-label', 'Exit API test panel');
  exit.onclick = () => dialog.close();
})();

(() => {
  const routes = document.querySelector('#apiRoutes');
  if (routes) routes.remove();
  const controls = document.querySelector('#jetsonConnectionState')?.parentElement;
  if (controls) controls.style.margin = '4px 0 10px';
})();
