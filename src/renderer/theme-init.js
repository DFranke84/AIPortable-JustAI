// Applies a saved theme before first paint, so switching to light mode in a
// past session doesn't flash the default dark theme for a moment on launch.
// Loaded as its own <script> in <head>, ahead of styles.css and renderer.js.
(function () {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch { /* localStorage unavailable — just falls back to the default theme */ }
})();
