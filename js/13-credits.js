(() => {
  const landing = document.querySelector('#landing');
  const shell = landing?.querySelector('.shell');
  if (!shell || document.querySelector('#siteCredits')) return;
  const credits = document.createElement('footer');
  credits.id = 'siteCredits';
  credits.textContent = 'Credits: Ethan, Atreya, Robert, Joshua, Ryan';
  credits.style.cssText =
    'padding:42px 0 18px;text-align:center;color:var(--muted);font-size:.78rem;letter-spacing:.02em';
  shell.append(credits);
})();
