(() => {
  window.microphoneGlyph =
    '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3" width="8" height="12" rx="4"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"></path></svg>';
  const mic = document.querySelector('#transcribe');
  mic.innerHTML = window.microphoneGlyph;
  mic.style.lineHeight = '0';
})();
