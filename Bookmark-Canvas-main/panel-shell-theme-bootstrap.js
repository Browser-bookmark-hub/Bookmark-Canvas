// Apply side panel shell theme early to avoid white flash before iframe paints.
(function () {
  try {
    const root = document.documentElement;
    if (!root) return;

    const pref = localStorage.getItem('themePreference');
    const prefersDark = window.matchMedia
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = (pref === 'dark' || pref === 'light')
      ? pref
      : (prefersDark ? 'dark' : 'light');

    root.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');

    // Help UA choose correct default form/control palette during first paint.
    root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  } catch (_) { }
})();
