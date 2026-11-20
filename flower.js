/* The flower.

   One flower sits at a random spot on each page (a new spot every time the page loads).
   The spot is always completely clear: never under any text, line, picture or video.
   When it scrolls into view it spawns once (a seed lands, sprouts and grows), then dances in a loop.
   It ignores the mouse, so it never gets in the way.
   If the window is too narrow or the page too full to leave a clear spot, there's no flower.
   People who ask their system to reduce motion just get the grown flower, standing still.

   Art lives in /flower/ (spawn-0..18.png, dance-0..15.png), all 64x64 with the soil at the bottom. */

(function () {
  'use strict';

  var SPAWN_FRAMES = 19;
  var DANCE_FRAMES = 16;
  var SCALE = 1;               // size of the flower, 1 = the 64px art as drawn
  var SIZE = 64 * SCALE;
  var FRAME_MS = 1000 / 12;    // 12 frames per second
  var CLEAR = 14;              // keep at least this far from anything on the page
  var EDGE = 8;                // and from the edge of the page

  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var box = document.createElement('div');
  box.id = 'flower';
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:absolute;left:0;top:0;width:' + SIZE + 'px;height:' + SIZE + 'px;' +
    'pointer-events:none;z-index:-1;visibility:hidden;';

  var spawn = [], dance = [], loaded = 0, total = SPAWN_FRAMES + DANCE_FRAMES;
  function add(kind, list, count) {
    for (var i = 0; i < count; i++) {
      var img = new Image();
      img.alt = '';
      img.draggable = false;
      img.style.cssText = 'position:absolute;left:0;top:0;width:' + SIZE + 'px;height:' + SIZE + 'px;' +
        'user-select:none;-webkit-user-drag:none;visibility:hidden;';
      img.onload = img.onerror = function () { loaded++; maybeStart(); };
      img.src = '/flower/' + kind + '-' + i + '.png';
      box.appendChild(img);
      list.push(img);
    }
  }
  add('spawn', spawn, SPAWN_FRAMES);
  add('dance', dance, DANCE_FRAMES);

  // ---- finding a clear spot ----
  // Everything on the page that the flower must stay away from, as rectangles in page coordinates:
  // every line of text (tight to the words), pictures, videos, and lines drawn by borders.
  function obstacles() {
    var out = [], sx = window.pageXOffset, sy = window.pageYOffset;
    function addRect(r) {
      if (r.width > 0 || r.height > 0) out.push({ l: r.left + sx, t: r.top + sy, r: r.right + sx, b: r.bottom + sy });
    }
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !/\S/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        var tag = n.parentNode && n.parentNode.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        if (n.parentNode.closest && n.parentNode.closest('[data-flower-ignore]')) return NodeFilter.FILTER_REJECT;   // fixed extras (the mute button and notice)
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var range = document.createRange(), node;
    while ((node = walker.nextNode())) {
      range.selectNodeContents(node);
      var rects = range.getClientRects();
      for (var i = 0; i < rects.length; i++) addRect(rects[i]);
    }
    var all = document.body.getElementsByTagName('*');
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      if (el === box || box.contains(el) || el.id === 'ladybug' || el.nodeName === 'CANVAS') continue;
      if (el.closest && el.closest('[data-flower-ignore]')) continue;
      var tn = el.nodeName;
      if (tn === 'IMG' || tn === 'IFRAME' || tn === 'VIDEO' || tn === 'SVG' || tn === 'svg') { addRect(el.getBoundingClientRect()); continue; }
      var cs = window.getComputedStyle(el);
      if (cs.display === 'none') continue;
      var r2 = el.getBoundingClientRect();
      if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') addRect({ left: r2.left, right: r2.right, top: r2.top, bottom: r2.top + parseFloat(cs.borderTopWidth), width: r2.width, height: 1 });
      if (parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== 'none') addRect({ left: r2.left, right: r2.right, top: r2.bottom - parseFloat(cs.borderBottomWidth), bottom: r2.bottom, width: r2.width, height: 1 });
    }
    return out;
  }

  function isClear(x, y, list) {
    var l = x - CLEAR, t = y - CLEAR, r = x + SIZE + CLEAR, b = y + SIZE + CLEAR;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (l < o.r && r > o.l && t < o.b && b > o.t) return false;
    }
    return true;
  }

  // The flower's top-left corner, in page coordinates, or null when there's no clear spot.
  var spotX = null, spotY = null;
  function chooseSpot(list) {
    var de = document.documentElement;
    var w = de.clientWidth, h = Math.max(de.scrollHeight, window.innerHeight);
    var minX = EDGE, maxX = w - SIZE - EDGE, minY = EDGE, maxY = h - SIZE - EDGE;
    if (maxX <= minX || maxY <= minY) return null;
    // random tries first, then an even sweep, so a clear spot is found whenever one exists
    for (var i = 0; i < 500; i++) {
      var x = Math.round(minX + Math.random() * (maxX - minX));
      var y = Math.round(minY + Math.random() * (maxY - minY));
      if (isClear(x, y, list)) return { x: x, y: y };
    }
    var found = [];
    for (var yy = minY; yy <= maxY; yy += 12) {
      for (var xx = minX; xx <= maxX; xx += 12) if (isClear(xx, yy, list)) found.push({ x: xx, y: yy });
    }
    return found.length ? found[Math.floor(Math.random() * found.length)] : null;
  }

  function place() {
    var list = obstacles();
    // keep the current spot if it's still clear (e.g. after a small resize); otherwise pick again
    if (spotX === null || !isClear(spotX, spotY, list)) {
      var s = chooseSpot(list);
      spotX = s ? s.x : null;
      spotY = s ? s.y : null;
    }
    if (spotX === null) {
      box.style.visibility = 'hidden';
      started = false;
      return;
    }
    box.style.left = spotX + 'px';
    box.style.top = spotY + 'px';
    maybeStart();
  }

  // ---- animation ----
  var shownImg = null;
  function show(list, i) {
    var next = list[i];
    if (next === shownImg) return;
    if (shownImg) shownImg.style.visibility = 'hidden';
    next.style.visibility = 'visible';
    shownImg = next;
  }

  var ready = false, inView = false, started = false, running = false, t0 = 0;
  function maybeStart() {
    if (started || !ready || loaded < total || !inView || spotX === null) return;
    started = true;
    box.style.visibility = 'visible';
    if (calm) { show(dance, 0); return; }
    if (!running) {
      running = true;
      t0 = performance.now();
      requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    var n = Math.floor((now - t0) / FRAME_MS);
    if (n < SPAWN_FRAMES) show(spawn, n);                       // once
    else show(dance, (n - SPAWN_FRAMES) % DANCE_FRAMES);        // then forever
    requestAnimationFrame(tick);
  }

  function begin() {
    document.body.appendChild(box);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) if (entries[i].isIntersecting) { inView = true; maybeStart(); }
      }, { threshold: 0.5 }).observe(box);
    } else {
      inView = true;
    }
    // choose the spot once the page has settled (fonts and pictures can move the text)
    function settled() {
      ready = true;
      place();
    }
    function afterLoad() {
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(settled); else settled();
    }
    if (document.readyState === 'complete') afterLoad(); else window.addEventListener('load', afterLoad);
    var timer = null;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { if (ready) place(); }, 200);
    });
  }

  if (document.body) begin(); else document.addEventListener('DOMContentLoaded', begin);
})();
