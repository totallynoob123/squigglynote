// Address of the Squiggly Note server (Ollama chat, Whisper transcription, Kokoro speech),
// reached through its ngrok tunnel. Change it here and everything else follows.
// For testing, ?api=http://127.0.0.1:8787 in the page URL overrides it for that visit.
window.SQUIGGLY_API = (
  new URLSearchParams(location.search).get('api') || 'https://football-wielder-skipping.ngrok-free.dev'
).replace(/\/+$/, '');

(() => {
  // Earlier default addresses. A browser that saved one of these into the "API tunnel"
  // field is moved onto the current server; addresses people typed themselves are kept.
  const LEGACY_DEFAULTS = ['https://absolve-marigold-procedure.ngrok-free.dev'];
  const TUNNEL_KEY = 'squiggly-api-tunnel-v1';
  try {
    const saved = localStorage.getItem(TUNNEL_KEY);
    if (saved && LEGACY_DEFAULTS.some(url => saved.startsWith(url)) && !saved.startsWith(window.SQUIGGLY_API)) {
      localStorage.removeItem(TUNNEL_KEY);
    }
  } catch {}

  // Free ngrok tunnels answer browser requests with a warning page unless this header is sent.
  const nativeFetch = window.fetch.bind(window);
  const isTunnel = url => url.startsWith(window.SQUIGGLY_API) || /^https:\/\/[^/]+\.ngrok(-free)?\.(app|dev|io)\//.test(url);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (!isTunnel(url)) return nativeFetch(input, init);
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('ngrok-skip-browser-warning', 'true');
    return nativeFetch(input, { ...init, headers });
  };
})();
