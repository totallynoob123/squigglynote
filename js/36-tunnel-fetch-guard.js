/* Keep tunnel requests on their FastAPI endpoint even if an older handler passes the bare tunnel URL. */
(() => {
  const endpointNames = new Set(['chat', 'tts', 'transcribe', 'rewrite']);
  window.resolveApiTunnel = (entered, requestedEndpoint) => {
    const endpoint = String(requestedEndpoint || '').replace(/^\/+|\/+$/g, '');
    if (!endpointNames.has(endpoint)) throw new Error('Unknown API endpoint');
    const url = new URL(entered);
    const trailingEndpoint = /\/(?:chat|tts|transcribe|rewrite)\/?$/;
    const basePath = url.pathname.replace(trailingEndpoint, '').replace(/\/+$/, '');
    url.pathname = (basePath || '') + '/' + endpoint;
    return url.toString();
  };

  if (window.__squigglyTunnelFetchGuard) return;
  window.__squigglyTunnelFetchGuard = true;
  const nativeFetch = window.fetch.bind(window);
  const inferEndpoint = body => {
    if (body instanceof FormData) return 'transcribe';
    if (typeof body !== 'string') return '';
    try {
      const payload = JSON.parse(body);
      if (Object.prototype.hasOwnProperty.call(payload, 'voice')) return 'tts';
      if (
        Object.prototype.hasOwnProperty.call(payload, 'message') ||
        Object.prototype.hasOwnProperty.call(payload, 'messages') ||
        Object.prototype.hasOwnProperty.call(payload, 'history') ||
        Object.prototype.hasOwnProperty.call(payload, 'notes')
      )
        return 'chat';
      if (Object.prototype.hasOwnProperty.call(payload, 'text')) return 'rewrite';
    } catch (_) {
      /* The normal fetch call will report invalid request bodies. */
    }
    return '';
  };
  window.fetch = (input, init = {}) => {
    const tunnel = document.querySelector('#apiTunnel')?.value.trim();
    const method = (init.method || 'GET').toUpperCase();
    if (!tunnel || method !== 'POST' || typeof input !== 'string') return nativeFetch(input, init);
    try {
      const target = new URL(input, location.href);
      const configuredTunnel = new URL(tunnel, location.href);
      if (target.origin === configuredTunnel.origin && target.pathname === '/') {
        const endpoint = inferEndpoint(init.body);
        if (endpoint) return nativeFetch(window.resolveApiTunnel(tunnel, endpoint), init);
      }
    } catch (_) {
      /* Leave malformed URLs to fetch's normal error handling. */
    }
    return nativeFetch(input, init);
  };
})();
