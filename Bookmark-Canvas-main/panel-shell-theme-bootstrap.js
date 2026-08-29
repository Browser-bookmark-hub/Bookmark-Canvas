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
      : (pref === 'system' ? (prefersDark ? 'dark' : 'light') : 'dark');

    root.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');

    // Help UA choose correct default form/control palette during first paint.
    root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';

    if (pref === 'system' && window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const applySystemTheme = (event) => {
        const currentPref = localStorage.getItem('themePreference');
        if (currentPref !== 'system') return;
        const nextTheme = event.matches ? 'dark' : 'light';
        root.setAttribute('data-theme', nextTheme);
        root.style.colorScheme = nextTheme;
      };
      if (media.addEventListener) media.addEventListener('change', applySystemTheme);
      else if (media.addListener) media.addListener(applySystemTheme);
    }
  } catch (_) { }
})();
