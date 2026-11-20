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
   - Leave the mouse still for a few seconds and the ladybug wanders off the same way; move the mouse
     and it runs back to it.
   - It never fades: it's either there or it isn't.
   - It only runs on devices with a real mouse, and not for people who ask their
     system to reduce motion; those visitors keep their normal pointer.

   Art lives in /ladybug/ (walk-0..7.png, click-0..4.png), all 64x64 and facing up.
   Everything it needs to look right is set in this file, so it doesn't depend on style.css.
   - Sound (see "sound" below): a scurry loop that speeds up and slows with the ladybug; a press and a release
     sound that vary a little each time; a held click swells a loop and a rising scream. All of it pans left
     and right with where the ladybug is, and the scurry turns way down while it wanders. A mute button
     (top-left, art in /volume/) and the M key switch it off; a big "M to mute audio" appears once per visit. */

(function () {
  'use strict';

  // ---- sound ----
  // All in /ladybug/:
  //   walk-loop.mp3     plays on a seamless loop while the ladybug walks: faster and higher when it moves faster,
  //                     slower and lower when it slows, silent when it rests, way down when it has wandered off
  //   click-press.mp3   once, the moment a click goes down (a little different every time)
  //   click-release.mp3 once, the moment it's let go (a little different every time)
  //   click-loop.mp3    starts when a click is held and slowly swells; stops on release
  //   click-scream.mp3  starts at the same moment, from silence, swelling and rising in pitch; stops on release
  // Everything pans left and right with where the ladybug is on the page.
  // Browsers won't play sound until the visitor has clicked or pressed a key on the page, so sound starts
  // after the first click (or key press) on each page.
  var SOUND_URLS = {
    walk: '/ladybug/walk-loop.mp3',
    press: '/ladybug/click-press.mp3',
    release: '/ladybug/click-release.mp3',
    loop: '/ladybug/click-loop.mp3',
    scream: '/ladybug/click-scream.mp3'
  };
  var SCURRY_VOLUME = 0.8;     // 0..1, for each sound in turn
  var PRESS_VOLUME = 1;
  var RELEASE_VOLUME = 0.708;  // 3 dB down from the recording
  var LOOP_VOLUME = 10.1;        // the held-click recordings are recorded quiet, so these are boosted (above 1 = louder than the file)
  var SCREAM_VOLUME = 15.1;
  var SCURRY_RATE_MIN = 0.25;  // walk sound: slowest it ever plays (1 = the recording as it is)
  var SCURRY_RATE_MAX = 2.4;   // fastest
  var IDLE_VOLUME = 0.12;      // walk sound while it wanders (mouse left still, or over a video), as a share of full volume
  var PAN_WIDTH = 0.9;         // how far the sound swings to each side: 0 = stays centred, 1 = fully into one ear at the window edge
  var PRESS_PITCH = 0.1;       // press and release: pitch (and so length) varies by up to this much either way, each time
  var PRESS_TRIM = [0.75, 1];  // and each time it may also be cut short, to this share of its length
  var LOOP_START = 0.095;       // held click: the loop starts at this share of its full level (a quiet start)
  var HOLD_WALK_RATE = 0.5;    // held click: the walk sound slows to this multiple of its speed (and drops in pitch with it)
  var HOLD_DELAY_MS = 250;     // held click: how long you must hold before the loops begin (a quick click only gets the press and release sounds)
  var HOLD_RAMP_MS = 6000;     // held click: how long the loop and the scream take to swell to full
  var SCREAM_PITCH_END = 1.5;  // the scream rises to this multiple of its normal pitch by then

  var audio = (function () {
    var noop = function () {};
    var none = { live: function () { return false; }, walk: noop, pan: noop, mute: noop, shot: noop, holdStart: noop, hold: noop, holdStop: noop };
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !window.fetch) return none;
    var ctx = null, master = null, panner = null, bus = null;
    try {
      ctx = new AC();
      master = ctx.createGain();                       // the mute switch
      if (ctx.createDynamicsCompressor) {              // a limiter, so loud moments never distort
        var lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.15;
        master.connect(lim);
        lim.connect(ctx.destination);
      } else master.connect(ctx.destination);
      if (ctx.createStereoPanner) { panner = ctx.createStereoPanner(); panner.connect(master); }
      bus = panner || master;                          // every sound goes in here
    } catch (e) { return none; }

    var buffers = {}, walkSrc = null, walkGain = null, held = null;

    Object.keys(SOUND_URLS).forEach(function (name) {
      fetch(SOUND_URLS[name]).then(function (r) {
        if (!r.ok) throw new Error(r.status + ' ' + SOUND_URLS[name]);
        return r.arrayBuffer();
      }).then(function (raw) {
        var ok = function (b) { buffers[name] = b; if (name === 'walk') startWalk(); };
        var p = ctx.decodeAudioData(raw, ok, noop);    // callback form works in older Safari too
        if (p && p.catch) p.catch(function (e) { if (window.console) console.warn('ladybug: could not decode ' + SOUND_URLS[name]); });
      }).catch(function (e) { if (window.console) console.warn('ladybug: sound missing: ' + e.message); });
    });

    function startWalk() {
      if (walkSrc || !buffers.walk || ctx.state !== 'running') return;
      walkGain = ctx.createGain(); walkGain.gain.value = 0; walkGain.connect(bus);
      walkSrc = ctx.createBufferSource();
      walkSrc.buffer = buffers.walk;
      walkSrc.loop = true;
      walkSrc.connect(walkGain);
      walkSrc.start(0);
    }
    function unlock() {
      var go = function () { startWalk(); if (ctx.state === 'running') off(); };
      if (ctx.state === 'running') go(); else ctx.resume().then(go, noop);
    }
    var evs = ['pointerdown', 'mousedown', 'keydown', 'touchstart'];
    function off() { for (var i = 0; i < evs.length; i++) window.removeEventListener(evs[i], unlock, true); }
    for (var i = 0; i < evs.length; i++) window.addEventListener(evs[i], unlock, true);
    ctx.onstatechange = startWalk;

    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

    // press and release: one play, with its pitch, length and loudness nudged at random so it's never quite the same
    function shot(name, vol) {
      var b = buffers[name];
      if (!b) return;
      var t = ctx.currentTime;
      var rate = 1 + (Math.random() * 2 - 1) * PRESS_PITCH;
      var trim = PRESS_TRIM[0] + Math.random() * (PRESS_TRIM[1] - PRESS_TRIM[0]);
      var len = b.duration / rate * trim;
      var g = ctx.createGain();
      g.gain.value = vol * (0.9 + Math.random() * 0.2);
      g.connect(bus);
      var s = ctx.createBufferSource();
      s.buffer = b;
      s.playbackRate.value = rate;
      s.connect(g);
      s.start(t);
      if (trim < 1) g.gain.setTargetAtTime(0, t + Math.max(0, len - 0.08), 0.025);   // a quick fade instead of a chop
      s.stop(t + len + 0.25);
    }

    // a held click: both loops begin together, at silence
    function holdStart() {
      holdStop();
      var t = ctx.currentTime, h = {};
      ['loop', 'scream'].forEach(function (n) {
        if (!buffers[n]) { h[n] = null; return; }   // if one is missing the other still plays
        var g = ctx.createGain(); g.gain.value = 0; g.connect(bus);
        var s = ctx.createBufferSource(); s.buffer = buffers[n]; s.loop = true; s.connect(g); s.start(t);
        h[n] = { src: s, gain: g };
      });
      held = h;
    }
    function hold(p) {   // p: how far through the swell, 0..1
      if (!held) return;
      var t = ctx.currentTime;
      if (held.loop) held.loop.gain.gain.setTargetAtTime(LOOP_VOLUME * (LOOP_START + (1 - LOOP_START) * p * p), t, 0.05);   // a quiet start, then swells (slowly at first)
      if (held.scream) {
        held.scream.gain.gain.setTargetAtTime(SCREAM_VOLUME * Math.pow(p, 3), t, 0.05);                              // from silence
        held.scream.src.playbackRate.setTargetAtTime(1 + (SCREAM_PITCH_END - 1) * p, t, 0.05);
      }
    }
    function holdStop() {
      if (!held) return;
      var t = ctx.currentTime, h = held;
      held = null;
      ['loop', 'scream'].forEach(function (n) {
        if (!h[n]) return;
        h[n].gain.gain.setTargetAtTime(0, t, 0.04);
        h[n].src.stop(t + 0.4);
      });
    }

    return {
      live: function () { return !!walkSrc; },
      // rate: how fast the legs are going; level: 0 = silent, 1 = full
      walk: function (rate, level) {
        if (!walkSrc) return;
        var t = ctx.currentTime;
        walkSrc.playbackRate.setTargetAtTime(clamp(rate, SCURRY_RATE_MIN, SCURRY_RATE_MAX), t, 0.04);
        walkGain.gain.setTargetAtTime(level * SCURRY_VOLUME, t, 0.08);
      },
      pan: function (p) { if (panner) panner.pan.setTargetAtTime(clamp(p, -1, 1) * PAN_WIDTH, ctx.currentTime, 0.04); },
      mute: function (m, instant) {
        if (instant) master.gain.value = m ? 0 : 1;
        else master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.03);
      },
      shot: shot, holdStart: holdStart, hold: hold, holdStop: holdStop
    };
  })();

  var sound = {
    scurryStart: function () {},   // the ladybug started scurrying (following, chasing or wandering)
    scurryStop: function () {},    // it came to rest
    squish: function () { audio.shot('press', PRESS_VOLUME); },   // a click went down (the held sounds start a moment later, in the frame loop)
    release: function () { audio.holdStop(); audio.shot('release', RELEASE_VOLUME); } // a click was let go
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

  // Wandering: when the mouse is somewhere the page can't see, or has been left still (milliseconds, pixels)
  var IDLE_MS = 4000;          // mouse left still this long: the ladybug wanders off
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
  var SHADOW_HELD = 'drop-shadow(2px 3px 0.5px rgba(0,0,0,0.35))'; // while a click is held it tightens: a smaller blur radius
  var SHADOW_EASE_MS = 120;    // how quickly the shadow tightens and relaxes
  var FOOT_PX = 13;            // how far it walks between steps
  // Where the feet touch down, measured from the middle of the ladybug in the art (64px, facing up):
  // out almost to the edge of the sprite on each side (28.8 px of the 32; was the full 32 until trimmed 10%); front feet 20 px ahead, middle level, back feet 22 px behind.
  var LEG_OUT = 28.8 * SCALE, LEG_FRONT = 20 * SCALE, LEG_BACK = -22 * SCALE;
  var FOOT_LIFE = 250;         // how long a footprint lasts (milliseconds)
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
    'pointer-events:none;z-index:2147483647;opacity:0;will-change:transform;filter:' + SHADOW + ';' +
    'transition:filter ' + SHADOW_EASE_MS + 'ms ease-out;';
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
  var lastInput = 0;                // when the mouse (or the page) last moved
  var shadowHeld = false;            // is the shadow in its tightened (click held) state?
  var holdStarted = false;           // have the held-click loops begun?
  var lastBx = 0, lastBy = 0, speedNow = 0;   // for the scurry sound: how fast the ladybug is moving (px per second)

  // wander-mode state
  var videoEl = null;               // the video the mouse is inside (none if it's just been left still)
  var curve = 0;                    // how much it's turning right now (degrees per second)
  var resting = false;              // stopped for a moment
  var phaseUntil = 0;               // when the current walk or rest ends
  var curveUntil = 0;               // when to pick a new curve
  var clock = 0;                    // time in wander mode

  function place() {
    bug.style.transform = 'translate3d(' + (bx - SIZE / 2) + 'px,' + (by - SIZE / 2) + 'px,0)';
    rot.style.transform = 'rotate(' + heading + 'deg)';
  }

  // ---- mute button and the "M to mute audio" notice ----
  // The button sits in the top-left corner (press M to do the same). The choice is remembered between pages.
  var muted = false, soundPlaying = false;
  try { muted = window.localStorage.getItem('elue-muted') === '1'; } catch (e) {}
  audio.mute(muted, true);

  var ICON_PX = 36;
  var ICON_FRAMES = { on: 12, turnoff: 8, off: 4 };
  var ICON_ON_MS = 100;        // sound-on icon: time per frame (it moves only while the ladybug is making noise)
  var ICON_TURN_MS = 40;       // time per frame turning on or off
  var ICON_OFF_MS = 125;       // crossed-out icon: time per frame
  var HINT_MS = 4200;          // how long the big "M to mute audio" stays up

  var muteBtn = document.createElement('button');
  muteBtn.id = 'elue-mute';
  muteBtn.type = 'button';
  muteBtn.setAttribute('data-flower-ignore', '');
  muteBtn.style.cssText = 'position:fixed;left:10px;top:10px;width:' + ICON_PX + 'px;height:' + ICON_PX + 'px;' +
    'margin:0;padding:0;border:0;background:none;z-index:2147483000;';
  var iconSets = {};
  Object.keys(ICON_FRAMES).forEach(function (kind) {
    iconSets[kind] = [];
    for (var i = 0; i < ICON_FRAMES[kind]; i++) {
      var im = new Image();
      im.alt = '';
      im.draggable = false;
      im.style.cssText = 'position:absolute;left:0;top:0;width:' + ICON_PX + 'px;height:' + ICON_PX + 'px;' +
        'user-select:none;-webkit-user-drag:none;visibility:hidden;pointer-events:none;';
      im.src = '/volume/' + kind + '-' + i + '.png';
      muteBtn.appendChild(im);
      iconSets[kind].push(im);
    }
  });
  var iconShown = null;
  function showIcon(kind, i) {
    var next = iconSets[kind][i];
    if (next === iconShown) return;
    if (iconShown) iconShown.style.visibility = 'hidden';
    next.style.visibility = 'visible';
    iconShown = next;
  }
  var iconState = muted ? 'off' : 'on';   // 'on', 'off', or 'turn' (the switch animation)
  var turnPos = 0, turnDir = 1;           // where in the switch animation, and which way it's playing
  var iconT0 = 0, onPos = 0, iconLast = 0;

  function muteIcon(now) {
    var dt = iconLast ? Math.min(now - iconLast, 100) : 0;
    iconLast = now;
    if (iconState === 'turn') {
      turnPos += turnDir * dt / ICON_TURN_MS;
      if (turnPos >= ICON_FRAMES.turnoff) { iconState = 'off'; iconT0 = now; }
      else if (turnPos < 0) { iconState = 'on'; onPos = 0; }
    }
    if (iconState === 'turn') showIcon('turnoff', Math.max(0, Math.min(ICON_FRAMES.turnoff - 1, Math.floor(turnPos))));
    else if (iconState === 'off') showIcon('off', Math.floor((now - iconT0) / ICON_OFF_MS) % ICON_FRAMES.off);
    else {
      // moves while the ladybug is making noise, then finishes the loop and rests on the first frame
      var n = onPos + dt / ICON_ON_MS, N = ICON_FRAMES.on;
      if (!soundPlaying && Math.floor(n / N) > Math.floor(onPos / N)) n = Math.floor(n / N) * N;
      if (soundPlaying || onPos % N !== 0) onPos = n;
      showIcon('on', Math.floor(onPos) % N);
    }
  }

  function setMuted(m) {
    if (m === muted) return;
    muted = m;
    audio.mute(m);
    try { window.localStorage.setItem('elue-muted', m ? '1' : '0'); } catch (e) {}
    muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
    muteBtn.setAttribute('aria-label', m ? 'Unmute audio' : 'Mute audio');
    muteBtn.title = m ? 'Unmute (M)' : 'Mute (M)';
    if (iconState === 'turn') turnDir = m ? 1 : -1;
    else { iconState = 'turn'; turnDir = m ? 1 : -1; turnPos = m ? 0 : ICON_FRAMES.turnoff - 0.01; }
    hideHint();
  }
  muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  muteBtn.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
  muteBtn.title = muted ? 'Unmute (M)' : 'Mute (M)';
  muteBtn.addEventListener('click', function () { setMuted(!muted); });
  window.addEventListener('keydown', function (e) {
    if ((e.key !== 'm' && e.key !== 'M') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    var t = e.target, tag = t && t.nodeName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    setMuted(!muted);
  });

  css.textContent += '#elue-mute:focus-visible{outline:2px solid #000;outline-offset:2px;}';
  showIcon(iconState, 0);
  document.body.appendChild(muteBtn);

  // the big notice, once per visit (not again on every page), and not if they've already muted
  var hint = null, hintTimer = 0;
  function hideHint() {
    if (!hint) return;
    clearTimeout(hintTimer);
    var h = hint; hint = null;
    h.style.opacity = '0';
    setTimeout(function () { if (h.parentNode) h.parentNode.removeChild(h); }, 900);
  }
  var hintSeen = false;
  try { hintSeen = window.sessionStorage.getItem('elue-hint') === '1'; window.sessionStorage.setItem('elue-hint', '1'); } catch (e) {}
  if (!muted && !hintSeen) {
    hint = document.createElement('div');
    hint.setAttribute('aria-hidden', 'true');
    hint.setAttribute('data-flower-ignore', '');
    hint.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483000;' +
      'pointer-events:none;white-space:nowrap;background:rgba(255,255,255,0.94);padding:0.3em 0.6em;' +
      'font:700 clamp(2rem,8vw,5.5rem)/1.1 "Inter",-apple-system,"Helvetica Neue",Arial,sans-serif;letter-spacing:-0.02em;' +
      'color:#000;opacity:0;transition:opacity 0.5s ease;';
    hint.innerHTML = '<span style="display:inline-block;border:0.07em solid #000;padding:0 0.22em;margin-right:0.25em;">M</span>to mute audio';
    document.body.appendChild(hint);
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (hint) hint.style.opacity = '1'; }); });
    hintTimer = setTimeout(hideHint, HINT_MS);
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
  var prevCx = 0, prevCy = 0, havePrev = false;   // where the last step was taken, to know which way the path runs

  // Call every frame with where the ladybug is; takes a step every FOOT_PX of walking.
  function leaveSteps(nx, ny, now) {
    if (!ctx) return;
    if (!haveLast || !out) { lastFx = nx; lastFy = ny; haveLast = out; stepAcc = 0; havePrev = false; return; }
    var dx = nx - lastFx, dy = ny - lastFy, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 300) { lastFx = nx; lastFy = ny; stepAcc = 0; havePrev = false; return; }   // it jumped (e.g. the mouse came back in), no trail across the gap
    if (d === 0) return;
    var ux = dx / d, uy = dy / d, done = 0;
    while (stepAcc + (d - done) >= FOOT_PX) {
      done += FOOT_PX - stepAcc;
      stepAcc = 0;
      footSide = -footSide;
      // three feet land: (front, one side), (middle, other side), (back, same side as front)
      // The feet are laid out across the path the ladybug is actually walking (from the last step to this
      // one), not across where its head happens to point, so tight turns can't fling them outward.
      var cx = lastFx + ux * done, cy = lastFy + uy * done;
      var fwdX = ux, fwdY = uy;
      if (havePrev) {
        var pdx = cx - prevCx, pdy = cy - prevCy, pl = Math.sqrt(pdx * pdx + pdy * pdy);
        if (pl > 1) { fwdX = pdx / pl; fwdY = pdy / pl; }
      }
      prevCx = cx; prevCy = cy; havePrev = true;
      var rtX = -fwdY, rtY = fwdX;
      var hr = Math.atan2(fwdX, -fwdY);
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
    if (pressed && !releaseWanted) audio.holdStop();   // wandered off mid-click: the held sounds end
    pressed = false; releaseWanted = false;
    setMode('wander');
  }

  function onMove(e) {
    var now = performance.now();
    lastInput = now;
    if (!seen) {
      seen = true;
      x = bx = anchorX = lastBx = e.clientX;
      y = by = anchorY = lastBy = e.clientY;
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
    lastInput = performance.now();
    onMove(e);
    if (mode !== 'follow') return;
    pressed = true;
    releaseWanted = false;
    releaseAt = 0;
    pressAt = performance.now();
    holdStarted = false;
    sound.squish();
  }

  function onUp() {
    if (!pressed || releaseWanted) return;
    releaseWanted = true;   // the frame loop plays the release once the lead-in has finished
    sound.release();        // the sound doesn't wait for it: it plays the moment the button comes up
  }

  // ---- animation loop ----
  function tick(now) {
    var dt = Math.min(now - lastTick, 100);
    lastTick = now;
    if (seen) {
      var legsGoing = false;

      if (mode === 'wander') {
        if (videoEl && !document.documentElement.contains(videoEl)) {
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
            var W = window.innerWidth, H = window.innerHeight;
            var near = false, r = null;
            if (videoEl) {
              r = videoEl.getBoundingClientRect();
              near = bx > r.left - KEEP_OFF && bx < r.right + KEEP_OFF && by > r.top - KEEP_OFF && by < r.bottom + KEEP_OFF;
            }
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

      // scurry sound: its speed follows how fast the ladybug is actually moving, smoothed so it glides
      var mdx = bx - lastBx, mdy = by - lastBy;
      lastBx = bx; lastBy = by;
      if (dt > 0) speedNow += (Math.sqrt(mdx * mdx + mdy * mdy) / dt * 1000 - speedNow) * (1 - Math.exp(-dt / 120));
      var audible = out && !document.hidden && (legsGoing || (mode === 'follow' && moving));
      var holding = pressed && !releaseWanted;
      if (holding !== shadowHeld) { shadowHeld = holding; bug.style.filter = holding ? SHADOW_HELD : SHADOW; }
      // wandering (the mouse was left still, or it's over a video) or a held click: turn it way down
      var level = !audible || muted ? 0 : (mode === 'wander' || holding ? IDLE_VOLUME : 1);
      // 85 px/s (its wandering pace) plays the recording as it is; faster scampering rises, slower slows down.
      // While a click is held it drags along at half speed, pitched down.
      audio.walk((0.55 + 0.5 * Math.log(1 + speedNow / 60)) * (holding ? HOLD_WALK_RATE : 1), level);
      audio.pan((bx / Math.max(window.innerWidth, 1)) * 2 - 1);   // follows the ladybug across the window
      soundPlaying = level > 0 && audio.live();
      if (pressed && !releaseWanted) {                       // a held click: after a short wait the loops begin, then swell
        var heldFor = now - pressAt - HOLD_DELAY_MS;
        if (heldFor >= 0) {
          if (!holdStarted) { holdStarted = true; audio.holdStart(); }
          audio.hold(Math.min(1, heldFor / HOLD_RAMP_MS));
        }
      }

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
        // the mouse has been left still for a while: off it wanders
        if (out && !pressed && now - lastInput > IDLE_MS) startWander(null, now);
      }

      if (pressed && mode === 'follow') {
        var pt = now - pressAt;
        var leadIn = LEAD_IN_MS * 2;
        if (releaseWanted && pt >= leadIn) {
          pressed = false;
          releaseWanted = false;
          releaseAt = now;
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
    muteIcon(now);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- wiring ----
  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('scroll', function () { lastInput = performance.now(); }, { passive: true });
  window.addEventListener('wheel', function () { lastInput = performance.now(); }, { passive: true });
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
