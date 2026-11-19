/* The ladybug mouse pointer.

   - The ladybug replaces the mouse arrow. Its head turns toward wherever the mouse is heading.
   - Its legs scurry (the walk frames) while the mouse is moving, and it rests when still.
   - Holding a click squishes it: frames 1-2 play once, then frames 3-4 loop until you let go.
     Releasing plays the last frame, then it goes back to walking or resting.
   - Over the video player the page can't see the mouse at all (the player is a separate page
     inside this one), so there the ladybug steps aside and you get the normal arrow.
   - It only runs on devices with a real mouse, and not for people who ask their
     system to reduce motion; those visitors keep their normal pointer.

   Art lives in /ladybug/ (walk-0..7.png, click-0..4.png), all 64x64 and facing up.
   Everything it needs to look right is set in this file, so it doesn't depend on style.css.
   The `sound` functions below are empty on purpose: that's where the scurrying and
   squishing sounds will plug in later. */

(function () {
  'use strict';

  var sound = {
    scurryStart: function () {},   // the mouse started moving
    scurryStop: function () {},    // the mouse came to rest
    squish: function () {},        // a click went down
    release: function () {}        // a click was let go
  };

  var WALK_FRAMES = 8;
  var CLICK_FRAMES = 5;
  var SIZE = 64;               // pixels, matches the art
  var STEP_PX = 9;             // mouse travel per walk frame (at most one frame per screen refresh)
  var HEADING_PX = 12;         // mouse travel needed before the head re-aims (ignores hand jitter)
  var TURN_MS = 70;            // head turning speed: smaller = snappier
  var STILL_MS = 110;          // no movement for this long = at rest
  var LEAD_IN_MS = 55;         // time each of click frames 1 and 2 is shown
  var LOOP_MS = 90;            // time each of click frames 3 and 4 is shown
  var RELEASE_MS = 170;        // time the last click frame is shown
  var VIDEO_MARGIN = 14;       // step aside this close to a video player, since it can't be tracked inside

  var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || calm) return;

  var root = document.documentElement;

  // Hide the normal arrow only while the ladybug is out (and never over the video player).
  var css = document.createElement('style');
  css.textContent = '.ladybug-on, .ladybug-on * { cursor: none !important; }';
  document.head.appendChild(css);

  // One <img> per frame, stacked; showing a frame is just toggling visibility, so nothing flickers.
  var bug = document.createElement('div');
  bug.id = 'ladybug';
  bug.setAttribute('aria-hidden', 'true');
  bug.style.cssText = 'position:fixed;left:0;top:0;width:' + SIZE + 'px;height:' + SIZE + 'px;' +
    'pointer-events:none;z-index:2147483647;opacity:0;transition:opacity .12s;will-change:transform;';
  var frames = { walk: [], click: [] };
  function addFrames(kind, count) {
    for (var i = 0; i < count; i++) {
      var img = new Image(SIZE, SIZE);
      img.alt = '';
      img.draggable = false;
      img.style.cssText = 'position:absolute;left:0;top:0;width:' + SIZE + 'px;height:' + SIZE + 'px;' +
        'image-rendering:pixelated;user-select:none;-webkit-user-drag:none;visibility:hidden;';
      img.src = '/ladybug/' + kind + '-' + i + '.png';
      bug.appendChild(img);
      frames[kind].push(img);
    }
  }
  addFrames('walk', WALK_FRAMES);
  addFrames('click', CLICK_FRAMES);

  var shown = null;
  function show(kind, i) {
    var next = frames[kind][i];
    if (next === shown) return;
    if (shown) shown.style.visibility = 'hidden';
    next.style.visibility = 'visible';
    shown = next;
  }
  show('walk', 0);

  // ---- state ----
  var x = 0, y = 0;                 // pointer position
  var seen = false;                 // has the pointer been seen yet?
  var anchorX = 0, anchorY = 0;     // where the heading was last measured from
  var heading = 0, target = 0;      // degrees, 0 = facing up
  var phase = 0;                    // walk-cycle position, in frames
  var travelled = 0;                // mouse travel since the last screen refresh
  var lastMove = 0, moving = false;
  var pressed = false, pressAt = 0, releaseAt = 0, releaseWanted = false;
  var shown_ = false;               // is the ladybug currently out?
  var lastTick = 0;

  function place() {
    bug.style.transform = 'translate3d(' + (x - SIZE / 2) + 'px,' + (y - SIZE / 2) + 'px,0) rotate(' + heading + 'deg)';
  }

  function setOut(on) {
    if (on === shown_) return;
    shown_ = on;
    bug.style.opacity = on ? '1' : '0';
    root.classList.toggle('ladybug-on', on);
  }

  // Is the pointer inside, or about to be inside, a video player?
  function nearVideo(px, py, vx, vy) {
    var list = document.getElementsByTagName('iframe');
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      var m = VIDEO_MARGIN;
      if (px > r.left - m && px < r.right + m && py > r.top - m && py < r.bottom + m) return true;
      // a fast flick can jump over the margin, so also look a little ahead
      var ax = px + vx * 4, ay = py + vy * 4;
      if (ax > r.left && ax < r.right && ay > r.top && ay < r.bottom) return true;
    }
    return false;
  }

  function onMove(e) {
    var now = performance.now();
    if (!seen) {
      seen = true;
      x = anchorX = e.clientX;
      y = anchorY = e.clientY;
      document.body.appendChild(bug);
      lastTick = now;
    }
    var dx = e.clientX - x, dy = e.clientY - y;
    x = e.clientX; y = e.clientY;

    if (pressed && e.buttons === 0) onUp();   // the button was let go somewhere we couldn't see

    if (nearVideo(x, y, dx, dy)) { setOut(false); return; }
    setOut(true);

    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0) {
      if (!moving) sound.scurryStart();
      moving = true;
      lastMove = now;
      travelled += d;
    }
    var ax = x - anchorX, ay = y - anchorY;
    if (ax * ax + ay * ay >= HEADING_PX * HEADING_PX) {
      target = Math.atan2(ax, -ay) * 180 / Math.PI;
      anchorX = x; anchorY = y;
    }
    place();   // follow the mouse right away, not on the next animation frame
  }

  function onDown(e) {
    if (e.button !== 0) return;
    onMove(e);
    if (!shown_) return;
    pressed = true;
    releaseWanted = false;
    releaseAt = 0;
    pressAt = performance.now();
    sound.squish();
  }

  function onUp() {
    if (!pressed) return;
    releaseWanted = true;   // the frame loop plays the release once the lead-in has finished
  }

  // ---- animation loop ----
  function tick(now) {
    var dt = Math.min(now - lastTick, 100);
    lastTick = now;
    if (seen) {
      // turn the head the short way round, at the same speed whatever the screen refresh rate
      var diff = ((target - heading + 540) % 360) - 180;
      heading = Math.abs(diff) < 0.3 ? target : heading + diff * (1 - Math.exp(-dt / TURN_MS));
      place();

      // legs: at most one frame per refresh, so quick movement never skips round the cycle
      if (travelled > 0) {
        phase += Math.min(travelled / STEP_PX, 1);
        travelled = 0;
      }
      if (moving && now - lastMove > STILL_MS) {
        moving = false;
        phase = 0;
        sound.scurryStop();
      }

      if (pressed) {
        var t = now - pressAt;
        var leadIn = LEAD_IN_MS * 2;
        if (releaseWanted && t >= leadIn) {
          pressed = false;
          releaseWanted = false;
          releaseAt = now;
          sound.release();
          show('click', 4);
        } else if (t < LEAD_IN_MS) {
          show('click', 0);
        } else if (t < leadIn) {
          show('click', 1);
        } else {
          show('click', 2 + (Math.floor((t - leadIn) / LOOP_MS) % 2));
        }
      } else if (releaseAt && now - releaseAt < RELEASE_MS) {
        show('click', 4);
      } else {
        releaseAt = 0;
        show('walk', moving ? Math.floor(phase) % WALK_FRAMES : 0);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- wiring ----
  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('blur', function () { onUp(); setOut(false); });   // e.g. clicked into the video player
  root.addEventListener('mouseleave', function () { setOut(false); });
})();
