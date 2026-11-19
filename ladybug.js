/* The ladybug mouse pointer.

   - The ladybug replaces the mouse arrow. Its head turns toward wherever the mouse is heading.
   - Its legs scurry (the walk frames) while the mouse is moving, and it rests when still.
   - Holding a click squishes it: frames 1-2 play once, then frames 3-4 loop until you let go.
     Releasing plays the last frame, then it goes back to walking or resting.
   - It only runs on devices with a real mouse, and not for people who ask their
     system to reduce motion; those visitors keep their normal pointer.

   Art lives in /ladybug/ (walk-0..7.png, click-0..4.png), all 64x64 and facing up.
   The three `sound` functions below are empty on purpose: that's where the scurrying
   and squishing sounds will plug in later. */

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
  var STEP_PX = 9;             // mouse travel per walk frame
  var HEADING_PX = 6;          // mouse travel needed before the head re-aims
  var STILL_MS = 110;          // no movement for this long = at rest
  var LEAD_IN_MS = 55;         // time each of click frames 1 and 2 is shown
  var LOOP_MS = 90;            // time each of click frames 3 and 4 is shown
  var RELEASE_MS = 170;        // time the last click frame is shown
  var TURN_EASE = 0.28;        // 0..1, higher = head turns faster

  var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || calm) return;

  var root = document.documentElement;
  var base = '/ladybug/';

  // One <img> per frame, stacked; showing a frame is just toggling visibility, so nothing flickers.
  var bug = document.createElement('div');
  bug.id = 'ladybug';
  bug.setAttribute('aria-hidden', 'true');
  var frames = {};
  function addFrames(kind, count) {
    frames[kind] = [];
    for (var i = 0; i < count; i++) {
      var img = new Image(SIZE, SIZE);
      img.alt = '';
      img.draggable = false;
      img.src = base + kind + '-' + i + '.png';
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
  for (var k in frames) frames[k].forEach(function (img) { img.style.visibility = 'hidden'; });
  show('walk', 0);

  // ---- state ----
  var x = 0, y = 0;                 // pointer position
  var seen = false;                 // has the pointer been seen yet?
  var anchorX = 0, anchorY = 0;     // where the heading was last measured from
  var heading = 0, target = 0;      // degrees, 0 = facing up
  var stepDist = 0, walkFrame = 0;
  var lastMove = 0, moving = false;
  var pressed = false, pressAt = 0, releaseAt = 0, releaseWanted = false;
  var visible = false;

  function setVisible(on) {
    if (on === visible) return;
    visible = on;
    bug.style.opacity = on ? '1' : '0';
  }

  function onMove(e) {
    var now = performance.now();
    if (!seen) {
      seen = true;
      x = anchorX = e.clientX;
      y = anchorY = e.clientY;
      root.classList.add('ladybug-on');
      document.body.appendChild(bug);
    }
    var dx = e.clientX - x, dy = e.clientY - y;
    x = e.clientX; y = e.clientY;
    setVisible(true);

    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0) {
      if (!moving) sound.scurryStart();
      moving = true;
      lastMove = now;
      stepDist += d;
      while (stepDist >= STEP_PX) { stepDist -= STEP_PX; walkFrame = (walkFrame + 1) % WALK_FRAMES; }
    }
    var ax = x - anchorX, ay = y - anchorY;
    if (ax * ax + ay * ay >= HEADING_PX * HEADING_PX) {
      target = Math.atan2(ax, -ay) * 180 / Math.PI;
      anchorX = x; anchorY = y;
    }
  }

  function onDown(e) {
    if (e.button !== 0) return;
    onMove(e);
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
    if (seen) {
      // turn the head the short way round
      var diff = ((target - heading + 540) % 360) - 180;
      heading = Math.abs(diff) < 0.3 ? target : heading + diff * TURN_EASE;
      bug.style.transform = 'translate3d(' + (x - SIZE / 2) + 'px,' + (y - SIZE / 2) + 'px,0) rotate(' + heading + 'deg)';

      if (moving && now - lastMove > STILL_MS) {
        moving = false;
        walkFrame = 0;
        stepDist = 0;
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
        show('walk', moving ? walkFrame : 0);
      }
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  // ---- wiring ----
  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('blur', onUp);
  root.addEventListener('mouseleave', function () { setVisible(false); });
  root.addEventListener('mouseenter', function () { if (seen) setVisible(true); });

  // The video players are separate pages inside this one, so they keep the normal pointer.
  // Hide the ladybug while the mouse is over one; it comes back on the next move outside.
  document.addEventListener('mouseover', function (e) {
    if (e.target && e.target.tagName === 'IFRAME') setVisible(false);
  });
})();
