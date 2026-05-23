(function () {
  try {
    const root = document.documentElement;
    const frame = document.getElementById('canvasSidePanelFrame');
    if (!root || !frame) return;

    const reveal = () => {
      root.classList.add('frame-ready');
    };

    frame.addEventListener('load', reveal, { once: true });

    try {
      const doc = frame.contentDocument;
      if (doc && doc.readyState === 'complete') reveal();
    } catch (_) { }

    setTimeout(() => {
      if (!root.classList.contains('frame-ready')) reveal();
    }, 1600);
  } catch (_) { }
})();
