// Runs before first paint so the page never flashes the wrong theme.
(function () {
  var theme = null;
  try { theme = localStorage.getItem('eisenhower.theme'); } catch (e) { /* ignore */ }
  if (theme !== 'dark' && theme !== 'light') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
