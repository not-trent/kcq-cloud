(() => {
  const button = document.getElementById('themeToggle');
  const apply = (theme) => {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    button.textContent = dark ? 'Light' : 'Dark';
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
  };
  chrome.storage.local.get('theme').then(({ theme }) => apply(theme));
  button.addEventListener('click', async () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(theme);
    await chrome.storage.local.set({ theme });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.theme) apply(changes.theme.newValue);
  });
})();
