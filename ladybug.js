/* The ladybug mouse pointer.

   - The ladybug replaces the mouse arrow. Its head turns toward wherever the mouse is heading.
   - Its legs scurry (the walk frames) while the mouse is moving, and it rests when still.
   - Holding a click squishes it: frames 1-2 play once, then frames 3-4 loop until you let go.
     Releasing plays the last frame, then it goes back to walking or resting.
   - The video player is a separate page inside this one, so once the mouse is over it the page
     can't see the mouse at all. The ladybug can't follow, so it wanders aimlessly: drifting and
     turning at random, stopping now and then, keeping off the player. You get the normal arrow
     meanwhile. When the mouse comes back out, the ladybug runs over to it.
   - It has a soft drop shadow, and leaves footprints where its feet land (three at a time, like a real
     insect: left-front, right-middle and left-back, then the other three) that fade after a couple of seconds.
   - It never fades: it's either there or it isn't.
   - It only runs on devices with a real mouse, and not for people who ask their
     system to reduce motion; those visitors keep their normal pointer.

   Art lives in /ladybug/ (walk-0..7.png, click-0..4.png), all 64x64 and facing up.
   Everything it needs to look right is set in this file, so it doesn't depend on style.css.
   The `sound` functions below are empty on purpose: that's where the scurrying and
   squishing sounds will plug in later. */

(function () {
  'use strict';

  var sound = {
    scurryStart: function () {},   // the ladybug started scurrying (following, chasing or wandering)
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
  var CHASE_SPEED = 900;       // px per second when running back to the mouse

  // Wandering, when the mouse is somewhere the page can't see (milliseconds, pixels)
  var WANDER_SPEED = 85;       // px per second
  var WANDER_TURN = 75;        // most it curves, degrees per second
  var WALK_RANGE = [900, 2600];// how long it walks before it might stop
  var REST_RANGE = [400, 1300];// how long it stops for
  var REST_CHANCE = 0.55;      // how often a walk ends in a stop
  var STEER_RANGE = [300, 900];// how often it picks a new curve
  var KEEP_OFF = 22;           // stays this far from the video player
  var KEEP_IN = 30;            // and this far from the edge of the window
  var LEG_MS = 60;             // legs: time per walk frame

  // Drop shadow and footprints
  var SHADOW = 'drop-shadow(2px 3px 2px rgba(0,0,0,0.35))';   // same direction however it turns
  var FOOT_PX = 13;            // how far it walks between steps
  // Where the feet touch down, measured from the middle of the ladybug in the art (64px, facing up):
  // 28 px out to each side; front feet 20 px ahead, middle level, back feet 22 px behind.
  var LEG_OUT = 28 * SCALE, LEG_FRONT = 20 * SCALE, LEG_BACK = -22 * SCALE;
  var FOOT_LIFE = 2200;        // how long a footprint lasts (milliseconds)
  var FOOT_ALPHA = 0.5;        // how dark a fresh footprint is, 0..1
  var FOOT_MAX = 240;          // most footprints on screen at once

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
    'pointer-events:none;z-index:2147483647;opacity:0;will-change:transform;filter:' + SHADOW + ';';
  // The ladybug turns inside this; the shadow filter sits outside it, so the shadow doesn't turn too.
  var rot = document.createElement('div');
  rot.style.cssText = 'position:absolute;left:0;top:0;width:' + SIZE + 'px;height:' + SIZE + 'px;will-change:transform;';
  bug.appendChild(rot);
  var frames = { walk: [], click: [] };
  function addFrames(kind, count) {
    for (var i = 0; i < count; i++) {
      var img = new Image();
      img.alt = '';
      img.draggable = false;
      img.style.cssText = 'position:absolute;left:0;top:0;width:' + SIZE + 'px;height:' + SIZE + 'px;' +
        'user-select:none;-webkit-user-drag:none;visibility:hidden;';
      img.src = '/ladybug/' + kind + '-' + i + '.png';
      rot.appendChild(img);
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
  // mode: 'follow' = glued to the mouse; 'wander' = the mouse is inside a video, so wandering; 'chase' = running back to the mouse
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

  // wander-mode state
  var videoEl = null;               // the video the mouse is inside
  var curve = 0;                    // how much it's turning right now (degrees per second)
  var resting = false;              // stopped for a moment
  var phaseUntil = 0;               // when the current walk or rest ends
  var curveUntil = 0;               // when to pick a new curve
  var clock = 0;                    // time in wander mode

  function place() {
    bug.style.transform = 'translate3d(' + (bx - SIZE / 2) + 'px,' + (by - SIZE / 2) + 'px,0)';
    rot.style.transform = 'rotate(' + heading + 'deg)';
  }

  // ---- footprints ----
  // Drawn on a see-through canvas over the page. Each print is remembered by its place on the page
  // (not the window), so scrolling doesn't drag the trail along with it.
  var canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483646;';
  var ctx = canvas.getContext && canvas.getContext('2d');
  var dpr = 1;
  function sizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
  }
  var prints = [];
  var lastFx = 0, lastFy = 0, haveLast = false, stepAcc = 0, footSide = 1, drawnSome = false;

  // Call every frame with where the ladybug is; takes a step every FOOT_PX of walking.
  function leaveSteps(nx, ny, now) {
    if (!ctx) return;
    if (!haveLast || !out) { lastFx = nx; lastFy = ny; haveLast = out; stepAcc = 0; return; }
    var dx = nx - lastFx, dy = ny - lastFy, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 300) { lastFx = nx; lastFy = ny; stepAcc = 0; return; }   // it jumped (e.g. the mouse came back in), no trail across the gap
    if (d === 0) return;
    var ux = dx / d, uy = dy / d, done = 0;
    while (stepAcc + (d - done) >= FOOT_PX) {
      done += FOOT_PX - stepAcc;
      stepAcc = 0;
      footSide = -footSide;
      // three feet land: (front, one side), (middle, other side), (back, same side as front)
      var hr = heading * Math.PI / 180;
      var fwdX = Math.sin(hr), fwdY = -Math.cos(hr), rtX = Math.cos(hr), rtY = Math.sin(hr);
      var cx = lastFx + ux * done, cy = lastFy + uy * done;
      var feet = [[LEG_FRONT, footSide], [0, -footSide], [LEG_BACK, footSide]];
      for (var f = 0; f < feet.length; f++) {
        var lon = feet[f][0], lat = feet[f][1] * LEG_OUT;
        prints.push({
          x: cx + fwdX * lon + rtX * lat + window.pageXOffset,
          y: cy + fwdY * lon + rtY * lat + window.pageYOffset,
          a: hr,
          born: now
        });
      }
    }
    stepAcc += d - done;
    lastFx = nx; lastFy = ny;
    if (prints.length > FOOT_MAX) prints.splice(0, prints.length - FOOT_MAX);
  }

  function drawSteps(now) {
    if (!ctx || (!prints.length && !drawnSome)) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    var i = 0;
    while (i < prints.length) {
      var age = now - prints[i].born;
      if (age >= FOOT_LIFE) { prints.splice(i, 1); continue; }
      var p = prints[i++];
      ctx.save();
      ctx.translate(p.x - window.pageXOffset, p.y - window.pageYOffset);
      ctx.rotate(p.a);
      ctx.fillStyle = 'rgba(0,0,0,' + (FOOT_ALPHA * (1 - age / FOOT_LIFE)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(0, 0, 1.3, 2.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    drawnSome = prints.length > 0;
  }

  // The normal arrow is hidden whenever the ladybug is out and standing in for it,
  // but not while it's wandering at a video (the arrow is what you steer with there).
  function syncCursor() {
    root.classList.toggle('ladybug-on', out && mode !== 'wander');
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

  // The video player (if any) the pointer is at, within `margin` of, or about to reach.
  function videoAt(px, py, vx, vy, margin) {
    var list = document.getElementsByTagName('iframe');
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (px > r.left - margin && px < r.right + margin && py > r.top - margin && py < r.bottom + margin) return list[i];
      // a fast flick can jump over the margin, so also look a little ahead
      var ax = px + vx * 4, ay = py + vy * 4;
      if (ax > r.left && ax < r.right && ay > r.top && ay < r.bottom) return list[i];
    }
    return null;
  }

  // ---- wandering ----
  function rand(range) { return range[0] + Math.random() * (range[1] - range[0]); }

  function startWander(video, now) {
    videoEl = video;
    resting = false;
    clock = 0;
    phaseUntil = rand(WALK_RANGE);
    curveUntil = 0;
    curve = 0;
    target = heading;
    if (!moving) { moving = true; sound.scurryStart(); }
    pressed = false; releaseWanted = false;
    setMode('wander');
  }

  function onMove(e) {
    var now = performance.now();
    if (!seen) {
      seen = true;
      x = bx = anchorX = e.clientX;
      y = by = anchorY = e.clientY;
      sizeCanvas();
      if (ctx) document.body.appendChild(canvas);
      document.body.appendChild(bug);
      lastTick = now;
    }
    var dx = e.clientX - x, dy = e.clientY - y;
    x = e.clientX; y = e.clientY;

    var d = Math.sqrt(dx * dx + dy * dy);
    if (pressed && e.buttons === 0) onUp();   // the button was let go somewhere we couldn't see

    var video = videoAt(x, y, dx, dy, VIDEO_MARGIN);
    if (video) {
      // the mouse is at or heading into a video: the ladybug can't follow
      setOut(true);
      if (mode !== 'wander' || videoEl !== video) startWander(video, now);
      return;
    }

    setOut(true);
    if (mode === 'wander') {
      // the mouse is back out: run to it
      setMode('chase');
      videoEl = null;
    }

    if (mode === 'follow') {
      bx = x; by = y;
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

      if (mode === 'wander') {
        if (!videoEl || !document.documentElement.contains(videoEl)) {
          setMode('follow'); videoEl = null;
        } else {
          clock += dt;
          if (clock >= phaseUntil) {                        // end of a walk or a rest
            if (resting) { resting = false; phaseUntil = clock + rand(WALK_RANGE); }
            else if (Math.random() < REST_CHANCE) { resting = true; phaseUntil = clock + rand(REST_RANGE); }
            else phaseUntil = clock + rand(WALK_RANGE);
          }
          if (clock >= curveUntil) {                        // pick a new gentle curve
            curve = (Math.random() * 2 - 1) * WANDER_TURN;
            curveUntil = clock + rand(STEER_RANGE);
          }
          if (!resting) {
            target += curve * dt / 1000;
            // keep off the video player and inside the window: steer away or back in
            var r = videoEl.getBoundingClientRect();
            var W = window.innerWidth, H = window.innerHeight;
            var near = bx > r.left - KEEP_OFF && bx < r.right + KEEP_OFF && by > r.top - KEEP_OFF && by < r.bottom + KEEP_OFF;
            var edge = bx < KEEP_IN || by < KEEP_IN || bx > W - KEEP_IN || by > H - KEEP_IN;
            var gx = null, gy = null;
            if (near) {
              var ccx = (r.left + r.right) / 2, ccy = (r.top + r.bottom) / 2;
              gx = bx - ccx; gy = by - ccy;                  // away from the video's middle
            } else if (edge) {
              gx = W / 2 - bx; gy = H / 2 - by;              // toward the middle of the window
            }
            if (gx !== null) {
              var away = Math.atan2(gx, -gy) * 180 / Math.PI;
              var turn = ((away - target + 540) % 360) - 180;
              target += turn * (1 - Math.exp(-dt / 120));
            }
            // walk the way it's facing
            var hr = heading * Math.PI / 180, step = WANDER_SPEED * dt / 1000;
            bx += Math.sin(hr) * step;
            by -= Math.cos(hr) * step;
            phase += dt / LEG_MS;
            legsGoing = true;
          }
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
      leaveSteps(bx, by, now);
      drawSteps(now);

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
        var pt = now - pressAt;
        var leadIn = LEAD_IN_MS * 2;
        if (releaseWanted && pt >= leadIn) {
          pressed = false;
          releaseWanted = false;
          releaseAt = now;
          sound.release();
          show('click', 4);
        } else if (pt < LEAD_IN_MS) {
          show('click', 0);
        } else if (pt < leadIn) {
          show('click', 1);
        } else {
          show('click', 2 + (Math.floor((pt - leadIn) / LOOP_MS) % 2));
        }
      } else if (releaseAt && now - releaseAt < RELEASE_MS) {
        show('click', 4);
      } else {
        releaseAt = 0;
        var walking = legsGoing || (mode === 'follow' && moving);
        var wf = ((Math.floor(phase) % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES;
        show('walk', walking ? wf : 0);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- wiring ----
  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('resize', sizeCanvas);
  window.addEventListener('blur', onUp);   // clicking into the video player also blurs the page; the ladybug carries on
  // When the mouse slips into a video player the page is told the mouse "left". If it left onto a
  // video (not out of the window), the ladybug stays and starts wandering where it lost the mouse.
  root.addEventListener('mouseleave', function (e) {
    if (!seen) return;
    var inView = e.clientX >= 0 && e.clientY >= 0 && e.clientX <= window.innerWidth && e.clientY <= window.innerHeight;
    var video = (inView && videoAt(e.clientX, e.clientY, 0, 0, VIDEO_MARGIN * 2)) || videoAt(x, y, 0, 0, VIDEO_MARGIN * 3);
    if (video) {
      setOut(true);
      if (mode !== 'wander' || videoEl !== video) startWander(video, performance.now());
    } else {
      setOut(false);       // the mouse really left the window
      setMode('follow');
    }
  });
})();
