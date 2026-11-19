/* The flower.

   One flower sits at a random spot on each page (a new spot every time the page loads).
   When it scrolls into view it spawns once (a seed lands, sprouts and grows), then dances in a loop.
   It sits behind the text and ignores the mouse, so it never gets in the way.
   People who ask their system to reduce motion just get the grown flower, standing still.

   Art lives in /flower/ (spawn-0..18.png, dance-0..15.png), all 64x64 with the soil at the bottom. */

(function () {
  'use strict';

  var SPAWN_FRAMES = 19;
  var DANCE_FRAMES = 16;
  var SCALE = 1;               // size of the flower, 1 = the 64px art as drawn
  var SIZE = 64 * SCALE;
  var FRAME_MS = 1000 / 12;    // 12 frames per second

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

  // ---- a random spot, kept as a fraction of the page so it stays put when the window resizes ----
  var fx = Math.random(), fy = Math.random();
  function position() {
    var de = document.documentElement;
    var w = de.clientWidth;
    var h = Math.max(de.scrollHeight, window.innerHeight);
    box.style.left = Math.round(fx * Math.max(w - SIZE, 0)) + 'px';
    box.style.top = Math.round(fy * Math.max(h - SIZE, 0)) + 'px';
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

  var ready = false, inView = false, started = false, t0 = 0;
  function maybeStart() {
    if (started || !ready || loaded < total || !inView) return;
    started = true;
    box.style.visibility = 'visible';
    if (calm) { show(dance, 0); return; }
    t0 = performance.now();
    requestAnimationFrame(tick);
  }

  function tick(now) {
    var n = Math.floor((now - t0) / FRAME_MS);
    if (n < SPAWN_FRAMES) show(spawn, n);                       // once
    else show(dance, (n - SPAWN_FRAMES) % DANCE_FRAMES);        // then forever
    requestAnimationFrame(tick);
  }

  function begin() {
    document.body.appendChild(box);
    position();
    ready = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries, obs) {
        if (entries[0].isIntersecting) { inView = true; obs.disconnect(); maybeStart(); }
      }, { threshold: 0.5 }).observe(box);
    } else {
      inView = true; maybeStart();
    }
    window.addEventListener('resize', position);
    window.addEventListener('load', position);
  }

  if (document.body) begin(); else document.addEventListener('DOMContentLoaded', begin);
})();
