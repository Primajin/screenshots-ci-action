// Acme Demo Shop helper: prints the measured viewport into the header band,
// draws the 500px ruler, writes the footer marker and runs the page modes
// (?mode=late, ?mode=wait-until, ?mode=tall, ?mode=iframe). Text only, no dependencies.
(function () {
  'use strict';

  var LATE_DELAY_MS = 4000;
  var RULER_STEP = 500;
  var body = document.body;
  var mode =
    new URLSearchParams(location.search).get('mode') ||
    body.getAttribute('data-mode') ||
    'default';
  body.setAttribute('data-mode', mode);

  function $(selector) {
    return document.querySelector(selector);
  }

  function isMobile() {
    return (
      window.matchMedia('(pointer: coarse)').matches ||
      /Mobile|iPhone|iPad|Android/.test(navigator.userAgent)
    );
  }

  function measure() {
    var dpr = window.devicePixelRatio || 1;
    var scale = Number(dpr.toFixed(2));
    $('#probe-size').textContent =
      Math.round(window.innerWidth * dpr) +
      ' x ' +
      Math.round(window.innerHeight * dpr) +
      ' px @' +
      scale +
      'x | ' +
      (isMobile() ? 'mobile' : 'desktop');
    $('#probe-css').textContent =
      'viewport ' +
      window.innerWidth +
      ' x ' +
      window.innerHeight +
      ' css px, device scale factor ' +
      scale;
  }

  function marks() {
    var page = $('#page');
    var ruler = $('#ruler');
    ruler.textContent = '';
    for (var y = RULER_STEP; y + 16 < page.offsetHeight; y += RULER_STEP) {
      var tick = document.createElement('span');
      tick.style.top = y + 'px';
      tick.textContent = y;
      ruler.appendChild(tick);
    }

    var height = document.documentElement.scrollHeight;
    var dpr = window.devicePixelRatio || 1;
    $('#end-marker').textContent =
      '— end of page · document height ' +
      height +
      ' px' +
      (dpr === 1 ? '' : ' (' + Math.round(height * dpr) + ' px @' + Number(dpr.toFixed(2)) + 'x)') +
      ' —';
  }

  function refresh() {
    measure();
    marks();
  }

  function startLateMode() {
    var root = $('#late-root');
    setTimeout(function () {
      var spinner = $('#spinner');
      if (spinner) {
        spinner.remove();
      }

      root.innerHTML =
        '<div id="late-banner">late element appeared after ' +
        LATE_DELAY_MS +
        ' ms</div>' +
        '<div id="late">#late: a tall block that only exists once the wait is over.</div>';
      refresh();
    }, LATE_DELAY_MS);
  }

  function startTallMode() {
    var count = 40;
    var root = $('#tall-root');
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('on');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    for (var i = 0; i < count; i++) {
      var section = document.createElement('section');
      section.className = 'reveal';
      section.style.setProperty('--hue', String((i * 37) % 360));
      var label = document.createElement('div');
      label.className = 'label';
      section.appendChild(label);
      root.appendChild(section);
      observer.observe(section);
    }
    Array.prototype.forEach.call(root.children, function (section, index) {
      section.firstChild.textContent =
        'section ' + (index + 1) + ' / ' + count + ' \u00b7 y = ' + section.offsetTop + ' px';
    });
    refresh();
  }

  // ?mode=iframe: a sandboxed iframe of another site (http://127.0.0.1:8082/ by
  // default, ?iframe=<url> to change it) 1500px down the page, like a map embed
  function startIframeMode() {
    var frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', 'a page of another site');
    frame.src = new URLSearchParams(location.search).get('iframe') || 'http://127.0.0.1:8082/';
    $('#iframe-root').appendChild(frame);
    refresh();
  }

  function printTimings() {
    var panel = $('#timings');
    if (panel) {
      panel.hidden = false;
    }

    if (!panel) {
      return;
    }

    function fmt(value) {
      return value > 0 ? Math.round(value) + ' ms' : 'pending';
    }

    function render() {
      var nav = performance.getEntriesByType('navigation')[0];
      var resources = performance.getEntriesByType('resource');
      var lastResource = resources.reduce(function (max, entry) {
        return Math.max(max, entry.responseEnd);
      }, 0);
      panel.querySelector('pre').textContent =
        'DOMContentLoaded : ' +
        fmt(nav ? nav.domContentLoadedEventEnd : 0) +
        '\nload event       : ' +
        fmt(nav ? nav.loadEventEnd : 0) +
        '\nlast resource    : ' +
        fmt(lastResource) +
        '\nnetwork idle     : ' +
        (nav && nav.loadEventEnd > 0 ? '>= ' + Math.round(Math.max(nav.loadEventEnd, lastResource) + 500) + ' ms' : 'pending') +
        '\n(wait-until: load / domcontentloaded / networkidle decide which of these has passed at capture time)';
      marks();
    }

    render();
    window.addEventListener('load', function () {
      setTimeout(render, 0);
    });
    setTimeout(render, 700);
  }

  window.addEventListener('resize', refresh);
  window.addEventListener('load', refresh);
  refresh();

  if (mode === 'late') {
    startLateMode();
  } else if (mode === 'tall') {
    startTallMode();
  } else if (mode === 'wait-until') {
    printTimings();
  } else if (mode === 'iframe') {
    startIframeMode();
  }
})();
