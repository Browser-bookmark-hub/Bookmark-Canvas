// Apply theme early to avoid flash (no inline script for CSP)
(function () {
  try {
    // Keep consistent with main UI theme.js:
    // - localStorage.themePreference: 'system' | 'light' | 'dark'
    // - only set data-theme='dark' when dark, otherwise remove the attribute.
    // Legacy override keys are cleared to avoid "not linked" confusion.
    try {
      localStorage.removeItem('historyViewerHasCustomTheme');
      localStorage.removeItem('historyViewerCustomTheme');
    } catch (_) {}

    const pref = localStorage.getItem('themePreference');
    const prefersDark = window.matchMedia
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = (pref === 'dark' || pref === 'light')
      ? pref
      : (prefersDark ? 'dark' : 'light');

    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  } catch (_) {}
})();
