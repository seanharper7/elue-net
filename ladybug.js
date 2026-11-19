/* The ladybug mouse pointer.

   - The ladybug replaces the mouse arrow. Its head turns toward wherever the mouse is heading.
   - Its legs scurry (the walk frames) while the mouse is moving, and it rests when still.
   - Holding a click squishes it: frames 1-2 play once, then frames 3-4 loop until you let go.
     Releasing plays the last frame, then it goes back to walking or resting.
   - The video player is a separate page inside this one, so once the mouse is over it the page
     can't see the mouse at all. There the ladybug can't follow, so it scrabbles around the
     player's edge trying to get to the mouse (running, then stopping to face inward), and you
     get the normal arrow. When the mouse comes back out, the ladybug runs over to it.
   - It only runs on devices with a real mouse, and not for people who ask their
     system to reduce motion; those visitors keep their normal pointer.

   Art lives in /ladybug/ (walk-0..7.png, click-0..4.png), all 64x64 and facing up.
   Everything it needs to look right is set in this file, so it doesn't depend on style.css.
   The `sound` functions below are empty on purpose: that's where the scurrying and
   squishing sounds will plug in later. */

(function () {
  'use strict';

  var sound = {
    scurryStart: function () {},   // the ladybug started scurrying (following, chasing or on the video edge)
    scurryStop: function () {},    // it came to rest
    squish: function () {},        // a click went down
    release: function () {}        // a click was let go
  };

  var WALK_FRAMES = 8;
  var CLICK_FRAMES = 5;
  var SCALE = 0.8;             // size of the ladybug, 1 = the 64px art as drawn
  var SIZE = 64 * SCALE;
  var STEP_PX = 9;             // mouse travel per walk frame (at most one frame per screen refresh)
  var HEADING_PX = 12;         // mouse travel needed before the head re-aims (ignores hand jitter)
  var TURN_MS = 70;            // head turning speed: smaller = snappier
  var STILL_MS = 110;          // no movement for this long = at rest
  var LEAD_IN_MS = 55;         // time each of click frames 1 and 2 is shown
  var LOOP_MS = 90;            // time each of click frames 3 and 4 is shown
  var RELEASE_MS = 170;        // time the last click frame is shown
  var VIDEO_MARGIN = 14;       // how close to a video player the ladybug gives up following
  var EDGE_GAP = 8;            // how far outside the video's border the ladybug walks
  var EDGE_SPEED = 150;        // px per second along the border
  var RUN_MS = [450, 1300];    // how long it runs along the border before stopping to scrabble
  var SCRABBLE_MS = [300, 800];// how long it stops, facing the video, legs going
  var LEG_MS = 55;             // legs: time per walk frame while squirming
  var CHASE_SPEED = 900;       // px per second when running back to the mouse

  var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || calm) return;

  var root = document.documentElement;

  // Hide the normal arrow only while the ladybug is following the mouse.
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
      var img = new Image();
      img.alt = '';
      img.draggable = false;
      img.style.cssText = 'position:absolute;left:0;top:0;width:' + SIZE + 'px;height:' + SIZE + 'px;' +
        'user-select:none;-webkit-user-drag:none;visibility:hidden;';
      img.src = '/ladybug/' + kind + '-' + i + '.png';
      bug.appendChild(img);
      frames[kind].push(img);
    }
  }
  addFrames('walk', WALK_FRAMES);
  addFrames('click', CLICK_FRAMES);

  var shownImg = null;
  function show(kind, i) {
    var next = frames[kind][i];
    if (next === shownImg) return;
    if (shownImg) shownImg.style.visibility = 'hidden';
    next.style.visibility = 'visible';
    shownImg = next;
  }
  show('walk', 0);

  // ---- state ----
  // mode: 'follow' = glued to the mouse; 'edge' = scrabbling round a video; 'chase' = running back to the mouse
  var mode = 'follow';
  var x = 0, y = 0;                 // where the mouse last was
  var bx = 0, by = 0;               // where the ladybug is
  var seen = false;
  var anchorX = 0, anchorY = 0;     // where the heading was last measured from
  var heading = 0, target = 0;      // degrees, 0 = facing up
  var phase = 0;                    // walk-cycle position, in frames
  var travelled = 0;                // mouse travel since the last screen refresh
  var lastMove = 0, moving = false;
  var pressed = false, pressAt = 0, releaseAt = 0, releaseWanted = false;
  var out = false;                  // is the ladybug on screen?
  var lastTick = 0;

  // edge-mode state
  var edgeEl = null;                // the video being scrabbled around
  var edgeS = 0;                    // distance along its border, clockwise from the top-left corner
  var edgeDir = 1;                  // 1 = clockwise, -1 = anticlockwise
  var edgeResting = false;          // stopped, facing the video
  var edgeUntil = 0;
  var legClock = 0;

  function place() {
    bug.style.transform = 'translate3d(' + (bx - SIZE / 2) + 'px,' + (by - SIZE / 2) + 'px,0) rotate(' + heading + 'deg)';
  }

  // The normal arrow is hidden whenever the ladybug is out and standing in for it,
  // but not while it's on a video's edge (the arrow is what you steer with there).
  function syncCursor() {
    root.classList.toggle('ladybug-on', out && mode !== 'edge');
  }

  function setOut(on) {
    if (on !== out) {
      out = on;
      bug.style.opacity = on ? '1' : '0';
    }
    syncCursor();
  }

  function setMode(m) {
    mode = m;
    syncCursor();
  }

  function rand(range) { return range[0] + Math.random() * (range[1] - range[0]); }

  // The video players on the page, and the one (if any) the pointer is at or about to reach.
  function videoAt(px, py, vx, vy) {
    var list = document.getElementsByTagName('iframe');
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      var m = VIDEO_MARGIN;
      if (px > r.left - m && px < r.right + m && py > r.top - m && py < r.bottom + m) return list[i];
      // a fast flick can jump over the margin, so also look a little ahead
      var ax = px + vx * 4, ay = py + vy * 4;
      if (ax > r.left && ax < r.right && ay > r.top && ay < r.bottom) return list[i];
    }
    return null;
  }

  // ---- walking round a video's border ----
  function border(el) {
    var r = el.getBoundingClientRect();
    var g = EDGE_GAP;
    var l = r.left - g, t = r.top - g, w = r.width + 2 * g, h = r.height + 2 * g;
    return { l: l, t: t, w: w, h: h, len: 2 * (w + h) };
  }

  // Where is distance s along the border, which way does walking that way face, and which way is "into the video"?
  function onBorder(b, s) {
    s = ((s % b.len) + b.len) % b.len;
    if (s < b.w) return { x: b.l + s, y: b.t, run: 90, inward: 180 };
    s -= b.w;
    if (s < b.h) return { x: b.l + b.w, y: b.t + s, run: 180, inward: 270 };
    s -= b.h;
    if (s < b.w) return { x: b.l + b.w - s, y: b.t + b.h, run: 270, inward: 0 };
    s -= b.w;
    return { x: b.l, y: b.t + b.h - s, run: 0, inward: 90 };
  }

  // The point on the border nearest to (px, py), as a distance along it.
  function nearestS(b, px, py) {
    var cx = Math.min(Math.max(px, b.l), b.l + b.w);
    var cy = Math.min(Math.max(py, b.t), b.t + b.h);
    var dl = cx - b.l, dr = b.l + b.w - cx, dt = cy - b.t, db = b.t + b.h - cy;
    var m = Math.min(dl, dr, dt, db);
    if (m === dt) return cx - b.l;
    if (m === dr) return b.w + (cy - b.t);
    if (m === db) return b.w + b.h + (b.l + b.w - cx);
    return 2 * b.w + b.h + (b.t + b.h - cy);
  }

  function startEdge(el, now) {
    var b = border(el);
    edgeEl = el;
    edgeS = nearestS(b, bx, by);
    edgeDir = Math.random() < 0.5 ? 1 : -1;
    edgeResting = false;
    edgeUntil = now + rand(RUN_MS);
    legClock = 0;
    if (!moving) { moving = true; sound.scurryStart(); }
    setMode('edge');
    pressed = false; releaseWanted = false;
  }

  function onMove(e) {
    var now = performance.now();
    if (!seen) {
      seen = true;
      x = bx = anchorX = e.clientX;
      y = by = anchorY = e.clientY;
      document.body.appendChild(bug);
      lastTick = now;
    }
    var dx = e.clientX - x, dy = e.clientY - y;
    x = e.clientX; y = e.clientY;

    if (pressed && e.buttons === 0) onUp();   // the button was let go somewhere we couldn't see

    var video = videoAt(x, y, dx, dy);
    if (video) {
      // the mouse is at or heading into a video: the ladybug can't follow, so it goes round the edge
      setOut(true);
      if (mode !== 'edge' || edgeEl !== video) startEdge(video, now);
      return;
    }

    setOut(true);
    if (mode === 'edge') {
      // the mouse is back out: run to it
      setMode('chase');
      edgeEl = null;
    }

    if (mode === 'follow') {
      bx = x; by = y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0) {
        if (!moving) { moving = true; sound.scurryStart(); }
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
  }

  function onDown(e) {
    if (e.button !== 0) return;
    onMove(e);
    if (mode !== 'follow') return;
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
      var legsGoing = false;

      if (mode === 'edge') {
        if (!edgeEl || !document.documentElement.contains(edgeEl)) {
          setMode('follow'); edgeEl = null;
        } else {
          var b = border(edgeEl);
          if (now >= edgeUntil) {
            edgeResting = !edgeResting;
            if (edgeResting) {
              edgeUntil = now + rand(SCRABBLE_MS);
            } else {
              edgeUntil = now + rand(RUN_MS);
              if (Math.random() < 0.45) edgeDir = -edgeDir;
            }
          }
          if (!edgeResting) edgeS += edgeDir * EDGE_SPEED * dt / 1000;
          var p = onBorder(b, edgeS);
          bx = p.x; by = p.y;
          // running: face the way it's walking; resting: face the video
          target = edgeResting ? p.inward : (edgeDir > 0 ? p.run : (p.run + 180) % 360);
          legsGoing = true;
          legClock += dt;
          phase = legClock / LEG_MS;
        }
      } else if (mode === 'chase') {
        var cx = x - bx, cy = y - by;
        var dist = Math.sqrt(cx * cx + cy * cy);
        var stepLen = CHASE_SPEED * dt / 1000;
        if (dist <= stepLen + 1) {
          bx = x; by = y;
          anchorX = x; anchorY = y;
          setMode('follow');
          moving = true; lastMove = now;
        } else {
          bx += cx / dist * stepLen;
          by += cy / dist * stepLen;
          target = Math.atan2(cx, -cy) * 180 / Math.PI;
          legsGoing = true;
          phase += 1;
        }
      }

      // turn the head the short way round, at the same speed whatever the screen refresh rate
      var diff = ((target - heading + 540) % 360) - 180;
      heading = Math.abs(diff) < 0.3 ? target : heading + diff * (1 - Math.exp(-dt / TURN_MS));
      place();

      if (mode === 'follow') {
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
      }

      if (pressed && mode === 'follow') {
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
        var walking = legsGoing || (mode === 'follow' && moving);
        show('walk', walking ? Math.floor(phase) % WALK_FRAMES : 0);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- wiring ----
  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('blur', function () {
    onUp();
    if (mode !== 'edge') setOut(false);   // clicking into the video player also blurs the page; the ladybug stays on its edge
  });
  root.addEventListener('mouseleave', function () {
    if (videoAt(x, y, 0, 0)) return;       // it's just the video player taking over the mouse
    setOut(false);
    setMode('follow');
  });
})();
