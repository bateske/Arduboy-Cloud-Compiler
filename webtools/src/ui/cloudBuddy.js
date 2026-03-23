/**
 * Cloud Buddy — An animated cloud wisp that introduces the navbar tabs.
 *
 * A particle system that forms a bubbly cloud "spirit". It performs a
 * theatrical Disney-star entrance, then glides to each navbar tab,
 * settling into a cloud-shaped tooltip that describes the tab. If the
 * user mouses over it, the cloud "bursts" and reforms after a delay.
 *
 * Particles are opaque yellow circles — when clustered they look like one
 * solid cloud element; when scattered, individual circles become visible
 * creating a diffuse cloud-burst effect.
 */

export class CloudBuddy {
  constructor() {
    /* ── state ───────────────────────────────────────────────────────────── */
    this._active = false;
    this._raf = null;
    this._lastTs = 0;
    this._time = 0;
    this._stateTime = 0;
    this._state = 'idle';
    this._tabIndex = -1;
    this._burstTab = -1;

    /* ── leader (the "heart" the swarm follows) ─────────────────────────── */
    this._leader = { x: -200, y: -200, vx: 0, vy: 0 };
    this._travelFrom = { x: 0, y: 0 };
    this._travelTo = { x: 0, y: 0 };

    /* ── particles ──────────────────────────────────────────────────────── */
    this._particles = [];
    this._trails = [];
    this._N = 80;

    /* ── DOM ─────────────────────────────────────────────────────────────── */
    this._canvas = null;
    this._ctx = null;
    this._tooltipEl = null;
    this._w = 0;
    this._h = 0;

    /* ── mouse ──────────────────────────────────────────────────────────── */
    this._mouseX = -9999;
    this._mouseY = -9999;
    this._prevMouseX = -9999;
    this._prevMouseY = -9999;
    this._mouseVX = 0;
    this._mouseVY = 0;

    /* ── burst tracking ─────────────────────────────────────────────────── */
    this._burstEnergy = 0;           // accumulated displacement energy
    this._burstThreshold = 19;       // energy needed for full burst
    this._isFadingOut = false;

    /* ── timers ─────────────────────────────────────────────────────────── */
    this._reformTO = null;
    this._nextTO = null;

    /* ── tab descriptors ────────────────────────────────────────────────── */
    this._tabs = [
      { panel: 'code',    text: 'Write & compile games right in your browser' },
      { panel: 'sketch',  text: 'Upload sketches & back up your Arduboy' },
      { panel: 'fx',      text: 'Manage your Arduboy\'s external flash' },
      { panel: 'eeprom',  text: 'Back up & restore your game saves' },
      { panel: 'package', text: 'Bundle games into .arduboy packages' },
      { panel: 'cart',    text: 'Build multi-game flash carts' },
      { panel: 'image',   text: 'Convert images to sprite code' },
      { panel: 'music',   text: 'Compose chiptune music for your games' },
      { panel: 'fxdata',  text: 'Build FX data & game assets' },
    ];

    /* ── timing (seconds) ───────────────────────────────────────────────── */
    this._INTRO = 4.0;
    this._TRAVEL = 1.2;
    this._SETTLE = 0.6;
    this._DWELL = 3.5;
    this._BURST_WAIT = 5.0;
    this._REFORM = 0.8;

    this._init();
  }

  /* ====================================================================
     Initialisation
     ==================================================================== */

  _init() {
    // Canvas (fixed overlay, click-through)
    const c = document.createElement('canvas');
    c.id = 'cloud-buddy-canvas';
    c.style.cssText =
      'position:fixed;inset:0;width:100vw;height:100vh;' +
      'z-index:999;pointer-events:none;opacity:0;transition:opacity 0.6s;';
    document.body.appendChild(c);
    this._canvas = c;
    this._ctx = c.getContext('2d');

    // Tooltip DOM
    const t = document.createElement('div');
    t.className = 'cloud-buddy-tooltip';
    document.body.appendChild(t);
    this._tooltipEl = t;

    // Seed particles
    for (let i = 0; i < this._N; i++) {
      const r = 10 + Math.random() * 17;
      // Mound shape: flat bottom, dome top
      const d = Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const ox = d * 130 * Math.cos(a) * (0.5 + Math.random() * 0.5);
      // Y goes from 0 (bottom floor) upward; height scales with how close to center
      const xNorm = Math.abs(ox) / 130; // 0 at center, 1 at edge
      const maxUp = 60 * (1 - xNorm * xNorm); // dome: taller in center, shorter at edges
      const oy = -Math.random() * maxUp; // negative = upward
      this._particles.push({
        x: -200, y: -200,
        tx: 0, ty: 0,
        vx: 0, vy: 0,
        r,
        baseR: r,
        ox, oy,
        opacity: 0.75 + Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
        drift: 0.008 + Math.random() * 0.018,
      });
    }

    // Listeners
    window.addEventListener('resize', () => { if (this._active) this._resize(); });
    document.addEventListener('mousemove', (e) => {
      this._prevMouseX = this._mouseX;
      this._prevMouseY = this._mouseY;
      this._mouseX = e.clientX;
      this._mouseY = e.clientY;
      this._mouseVX = this._mouseX - this._prevMouseX;
      this._mouseVY = this._mouseY - this._prevMouseY;
    });
  }

  _resize() {
    const dpr = devicePixelRatio || 1;
    this._w = window.innerWidth;
    this._h = window.innerHeight;
    this._canvas.width = this._w * dpr;
    this._canvas.height = this._h * dpr;
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ====================================================================
     Public API
     ==================================================================== */

  start() {
    if (this._active) return;
    this._active = true;
    this._resize();
    this._burstEnergy = 0;
    this._isFadingOut = false;
    this._canvas.style.transition = 'opacity 0.6s';
    this._canvas.style.opacity = '1';
    this._tabIndex = -1;
    this._trails = [];

    // Start all particles off-screen at the randomized entry point
    this._randomizeIntro();
    for (const p of this._particles) {
      p.x = this._introStart.x + Math.random() * 40;
      p.y = this._introStart.y + (Math.random() - 0.5) * 30;
      p.vx = 0;
      p.vy = 0;
    }

    this._enter('intro');
    this._lastTs = 0;
    this._raf = requestAnimationFrame((ts) => this._loop(ts));
  }

  _clearGlow() {
    document.querySelectorAll('.tab-btn--cloud-glow').forEach(el => el.classList.remove('tab-btn--cloud-glow'));
  }

  stop() {
    this._active = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    clearTimeout(this._reformTO);
    clearTimeout(this._nextTO);
    this._canvas.style.opacity = '0';
    this._tooltipEl.style.opacity = '0';
    this._clearGlow();
  }

  /* ====================================================================
     Animation Loop
     ==================================================================== */

  _loop(ts) {
    if (!this._active) return;
    const dt = this._lastTs ? Math.min((ts - this._lastTs) / 1000, 0.05) : 0.016;
    this._lastTs = ts;
    this._time += dt;
    this._stateTime += dt;

    this._update(dt);
    this._render();

    this._raf = requestAnimationFrame((t) => this._loop(t));
  }

  /* ====================================================================
     State Machine
     ==================================================================== */

  _enter(s) {
    this._state = s;
    this._stateTime = 0;
    if (s !== 'tooltip') clearTimeout(this._nextTO);

    switch (s) {
      case 'intro':
        this._leader.x = this._introStart.x;
        this._leader.y = this._introStart.y;
        break;

      case 'traveling':
        this._clearGlow();
        this._tooltipEl.style.opacity = '0';
        this._travelFrom = { x: this._leader.x, y: this._leader.y };
        this._travelTo = this._tabPos(this._tabIndex);
        break;

      case 'settling':
        this._leader.vx = 0;
        this._leader.vy = 0;
        // Don't snap targets to tooltip scale here — _upSettle will
        // gradually interpolate from travel scale to tooltip scale
        this._fromIntro = false;
        break;

      case 'tooltip': {
        const pos = this._tabPos(this._tabIndex);
        const btn = document.querySelector(`.tab-btn[data-panel="${this._tabs[this._tabIndex].panel}"]`);
        const btnBottom = btn ? btn.getBoundingClientRect().bottom : pos.y - 80;
        this._tooltipEl.textContent = this._tabs[this._tabIndex].text;
        this._tooltipEl.style.left = pos.x + 'px';
        this._tooltipEl.style.top = (btnBottom + 53) + 'px';
        this._clearGlow();
        if (btn) btn.classList.add('tab-btn--cloud-glow');
        requestAnimationFrame(() => { this._tooltipEl.style.opacity = '1'; });
        this._nextTO = setTimeout(() => {
          if (this._state === 'tooltip' && this._active) this._advance();
        }, this._DWELL * 1000);
        break;
      }

      case 'cloudburst':
        clearTimeout(this._nextTO);
        this._clearGlow();
        this._tooltipEl.style.opacity = '0';
        this._burstTab = this._tabIndex;
        // Spawn burst trails at scattered particle positions
        for (let i = 0; i < 12; i++) {
          const rp = this._particles[Math.floor(Math.random() * this._N)];
          this._trail(rp.x, rp.y);
        }
        // Fade speed scales with how hard the cloud was hit
        {
          let avgSpeed = 0;
          for (const p of this._particles) avgSpeed += Math.hypot(p.vx, p.vy);
          avgSpeed /= this._N;
          // Only really fast hits fade quickly; moderate bursts get full scatter time
          const fadeDur = Math.max(0.15, 1.2 - avgSpeed * 0.0008);
          this._isFadingOut = true;
          this._canvas.style.transition = `opacity ${fadeDur.toFixed(2)}s ease`;
          this._canvas.style.opacity = '0';
        }
        this._reformTO = setTimeout(() => {
          if (this._active) this._enter('reforming');
        }, this._BURST_WAIT * 1000);
        break;

      case 'reforming':
        this._tabIndex = this._burstTab;
        this._leader.x = this._tabPos(this._tabIndex).x;
        this._leader.y = this._tabPos(this._tabIndex).y;
        this._setCloudTargets(this._tabPos(this._tabIndex));
        // Reset particles near their targets so reform looks clean
        for (const p of this._particles) {
          p.x = p.tx + (Math.random() - 0.5) * 60;
          p.y = p.ty + (Math.random() - 0.5) * 40;
          p.vx = 0;
          p.vy = 0;
        }
        this._burstEnergy = 0;
        this._isFadingOut = false;
        // Fade canvas back in
        this._canvas.style.transition = 'opacity 0.8s ease';
        this._canvas.style.opacity = '1';
        break;
    }
  }

  _advance() {
    this._tooltipEl.style.opacity = '0';
    // Wait for text fade-out before moving
    setTimeout(() => {
      if (!this._active) return;
      this._tabIndex = (this._tabIndex + 1) % this._tabs.length;
      this._enter('traveling');
    }, 400);
  }

  /* ====================================================================
     Per-State Updates
     ==================================================================== */

  _update(dt) {
    // Per-particle mouse interaction (only when cloud is visible & interactable)
    const interactive = this._state === 'settling' || this._state === 'tooltip';
    if (interactive && !this._isFadingOut) this._applyMouseForces();

    // Organic size breathing
    for (const p of this._particles) {
      p.phase += p.drift;
      p.r = p.baseR * (1 + Math.sin(p.phase) * 0.09);
    }

    switch (this._state) {
      case 'intro':      this._upIntro(dt); break;
      case 'traveling':  this._upTravel(dt); break;
      case 'settling':   this._upSettle(dt); break;
      case 'tooltip':    this._upTooltip(dt); break;
      case 'cloudburst': this._upBurst(dt); break;
      case 'reforming':  this._upReform(dt); break;
    }

    // Decay trails
    for (let i = this._trails.length - 1; i >= 0; i--) {
      const t = this._trails[i];
      t.life -= dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.r *= 0.984;
      if (t.life <= 0) this._trails.splice(i, 1);
    }
  }

  /* ── intro: theatrical shooting-star sweep ────────────────────────────── */

  _upIntro(dt) {
    const t = Math.min(this._stateTime / this._INTRO, 1);
    const pos = this._introPos(t);
    this._leader.vx = (pos.x - this._leader.x) / Math.max(dt, 0.001);
    this._leader.vy = (pos.y - this._leader.y) / Math.max(dt, 0.001);
    this._leader.x = pos.x;
    this._leader.y = pos.y;

    // ── All particles use cohesive formation ──
    // Shift home positions opposite to velocity so the cloud
    // gets "mushed" in the direction of travel
    const pushX = -(this._leader.vx || 0) * 0.04;
    const pushY = -(this._leader.vy || 0) * 0.04;
    for (let i = 0; i < this._N; i++) {
      const p = this._particles[i];
      const breathX = Math.sin(p.phase * 1.1 + this._time * 1.8) * 4;
      const breathY = Math.cos(p.phase * 0.7 + this._time * 1.3) * 3;
      const scaledOx = p.ox * 0.8;
      const scaledOy = p.oy * 0.8;
      const dist = Math.hypot(scaledOx, scaledOy);
      const pushScale = 0.5 + dist * 0.004;
      const homeX = this._leader.x + scaledOx + breathX + pushX * pushScale;
      const homeY = this._leader.y + scaledOy + breathY + pushY * pushScale;
      const stiffness = 0.22 - Math.min(dist * 0.0006, 0.10);
      const dx = homeX - p.x;
      const dy = homeY - p.y;
      p.vx = (p.vx + dx * stiffness) * 0.70;
      p.vy = (p.vy + dy * stiffness) * 0.70;
      p.x += p.vx;
      p.y += p.vy;
    }

    // Trail wafts — more when moving faster
    const speed = Math.hypot(this._leader.vx || 0, this._leader.vy || 0);
    const trailChance = Math.min(speed * 0.0004, 0.4);
    if (Math.random() < trailChance) {
      const rp = this._particles[Math.floor(Math.random() * this._N)];
      this._trail(rp.x, rp.y);
    }

    if (t >= 1) {
      this._tabIndex = 0;
      this._fromIntro = true;
      this._enter('settling');
    }
  }

  /* ── traveling: smooth glide between tabs ─────────────────────────────── */

  _upTravel(dt) {
    const t = Math.min(this._stateTime / this._TRAVEL, 1);
    const e = t * t * (3 - 2 * t); // smoothstep

    const nx = this._travelFrom.x + (this._travelTo.x - this._travelFrom.x) * e;
    const ny = this._travelFrom.y + (this._travelTo.y - this._travelFrom.y) * e
      - Math.sin(e * Math.PI) * 16; // gentle arc

    this._leader.vx = (nx - this._leader.x) / Math.max(dt, 0.001);
    this._leader.vy = (ny - this._leader.y) / Math.max(dt, 0.001);
    this._leader.x = nx;
    this._leader.y = ny;

    // Squish peaks at midpoint, eased with an extra smoothstep so
    // the onset/offset are extra gentle (no pop at state transitions)
    const bell = Math.sin(e * Math.PI);          // 0 → 1 → 0
    const eased = bell * bell;                     // softer onset & offset
    const squish = eased * 0.15;
    const sx = 1.25 - squish;
    const sy = 1.2  - squish;
    // Ease spring stiffness in — start very soft so the physics swap isn't jarring
    const stiffBlend = Math.min(t * 4, 1);        // 0→1 over first 25% of travel
    this._cohesiveFollow(sx, sy, stiffBlend);
    const speed = Math.hypot(this._leader.vx || 0, this._leader.vy || 0);
    const trailChance = Math.min(speed * 0.0004, 0.4);
    if (Math.random() < trailChance) {
      const rp = this._particles[Math.floor(Math.random() * this._N)];
      this._trail(rp.x, rp.y);
    }

    if (t >= 1) this._enter('settling');
  }

  /* ── settling: particles converge to cloud shape ──────────────────────── */

  _upSettle(dt) {
    const t = Math.min(this._stateTime / this._SETTLE, 1);
    const ease = t * t * (3 - 2 * t); // smoothstep — no spring overshoot
    const floor = this._leader.y;
    const pos = this._tabPos(this._tabIndex);
    // Scale is constant at tooltip level — no expansion needed
    const scaleX = 1.25;
    const scaleY = 1.2;
    for (const p of this._particles) {
      const tx = pos.x + p.ox * scaleX;
      const rawTy = pos.y + p.oy * scaleY;
      const ty = Math.min(rawTy, pos.y - p.r);
      const ox = Math.sin(p.phase * 1.1) * 1.5 + Math.sin(p.phase * 0.3) * 0.8;
      const oy = Math.cos(p.phase * 0.7) * 1.2 + Math.sin(p.phase * 0.5) * 0.6;
      const goalX = tx + ox * ease;
      const goalY = ty + oy * ease;
      // Kill velocity smoothly, transition to pure lerp
      p.vx *= (1 - ease) * 0.80;
      p.vy *= (1 - ease) * 0.80;
      const lerp = 0.04 + ease * 0.05;
      p.x += p.vx + (goalX - p.x) * lerp;
      p.y += p.vy + (goalY - p.y) * lerp;
      // Gradually introduce the hard floor
      if (p.y + p.r > floor) {
        p.y = p.y * (1 - ease) + (floor - p.r) * ease;
      }
    }
    if (t >= 1) {
      this._setCloudTargets(this._tabPos(this._tabIndex));
      this._enter('tooltip');
    }
  }

  /* ── tooltip: gentle idle pulsing ─────────────────────────────────────── */

  _upTooltip(_dt) {
    const floor = this._leader.y;
    for (const p of this._particles) {
      const ox = Math.sin(p.phase * 1.1) * 1.5 + Math.sin(p.phase * 0.3) * 0.8;
      const oy = Math.cos(p.phase * 0.7) * 1.2 + Math.sin(p.phase * 0.5) * 0.6;
      // Apply any velocity from mouse pushes, then decay it
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.88;
      p.vy *= 0.88;
      // Gentle pull back toward formation
      p.x += (p.tx + ox - p.x) * 0.04;
      p.y += (p.ty + oy - p.y) * 0.04;
      // Hard floor — particles slide horizontally but can't drop below
      if (p.y + p.r > floor) p.y = floor - p.r;
    }
  }

  /* ── cloudburst: scatter outward ──────────────────────────────────────── */

  _upBurst(dt) {
    for (const p of this._particles) {
      p.vx *= 0.965;
      p.vy *= 0.965;
      p.vy += 22 * dt; // slight gravity
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /* ── reforming: spring back to cloud positions ────────────────────────── */

  _upReform(dt) {
    const t = Math.min(this._stateTime / this._REFORM, 1);
    const ease = t * t * (3 - 2 * t);
    const floor = this._leader.y;
    for (const p of this._particles) {
      const ox = Math.sin(p.phase * 1.1) * 1.5 + Math.sin(p.phase * 0.3) * 0.8;
      const oy = Math.cos(p.phase * 0.7) * 1.2 + Math.sin(p.phase * 0.5) * 0.6;
      const goalX = p.tx + ox * ease;
      const goalY = p.ty + oy * ease;
      p.vx *= (1 - ease) * 0.80;
      p.vy *= (1 - ease) * 0.80;
      const lerp = 0.04 + ease * 0.06;
      p.x += p.vx + (goalX - p.x) * lerp;
      p.y += p.vy + (goalY - p.y) * lerp;
      if (p.y + p.r > floor) {
        p.y = p.y * (1 - ease) + (floor - p.r) * ease;
      }
    }
    if (t >= 1) this._enter('tooltip');
  }

  /* ====================================================================
     Particle Helpers
     ==================================================================== */

  /** Cohesive formation follow — all particles spring toward their home
   *  offset from the leader with breathing and velocity-push squish. */
  _cohesiveFollow(scaleX = 0.8, scaleY = 0.8, stiffBlend = 1) {
    const pushX = -(this._leader.vx || 0) * 0.04;
    const pushY = -(this._leader.vy || 0) * 0.04;
    const floor = this._leader.y;
    for (let i = 0; i < this._N; i++) {
      const p = this._particles[i];
      const breathX = Math.sin(p.phase * 1.1 + this._time * 1.8) * 4;
      const breathY = Math.cos(p.phase * 0.7 + this._time * 1.3) * 3;
      const scaledOx = p.ox * scaleX;
      const scaledOy = p.oy * scaleY;
      const dist = Math.hypot(scaledOx, scaledOy);
      const pushScale = 0.5 + dist * 0.004;
      const homeX = this._leader.x + scaledOx + breathX + pushX * pushScale;
      const homeY = this._leader.y + scaledOy + breathY + pushY * pushScale;
      const baseStiff = 0.22 - Math.min(dist * 0.0006, 0.10);
      const stiffness = baseStiff * stiffBlend;
      const dx = homeX - p.x;
      const dy = homeY - p.y;
      p.vx = (p.vx + dx * stiffness) * 0.70;
      // Clamp downward velocity so particles don't droop below the floor
      if (p.vy > 3) p.vy = 3;
      p.vy = (p.vy + dy * stiffness) * 0.70;
      p.x += p.vx;
      p.y += p.vy;
      // Soft floor — nudge particles back up if they slip below leader
      if (p.y + p.r > floor) {
        p.y += (floor - p.r - p.y) * 0.3;
        if (p.vy > 0) p.vy *= 0.3;
      }
    }
  }

  /** Like _follow but operates on a sub-range [from, to). The first few
   *  follow the leader; the rest chain-follow the particle behind them
   *  (higher index = further back) so they always trail, never overshoot. */
  _followRange(from, to, spring, damp) {
    // Process in reverse so each particle follows the one closer to the leader
    for (let i = to - 1; i >= from; i--) {
      const p = this._particles[i];
      let targetX, targetY;
      if (i < from + 4) {
        // Front of the trailing group → follow leader directly
        targetX = this._leader.x;
        targetY = this._leader.y;
      } else {
        // Follow a particle closer to the front (lower index = closer to leader)
        const ahead = this._particles[Math.max(from, i - 2 - Math.floor(Math.random() * 2))];
        const chainWeight = 0.6;
        targetX = ahead.x * chainWeight + this._leader.x * (1 - chainWeight);
        targetY = ahead.y * chainWeight + this._leader.y * (1 - chainWeight);
      }
      const dx = targetX - p.x;
      const dy = targetY - p.y;
      const lag = 1 - ((i - from) / (to - from)) * 0.6;
      p.vx = (p.vx + dx * spring * lag) * damp;
      p.vy = (p.vy + dy * spring * lag) * damp;
      p.x += p.vx;
      p.y += p.vy;
    }
  }

  /** Spawn a fading trail puff directly under the cloud. */
  _trail(x, y) {
    if (this._trails.length > 30) return;

    // Small scatter around the chosen particle
    const offX = (Math.random() - 0.5) * 12;
    const offY = (Math.random() - 0.2) * 10;

    const life = 0.7 + Math.random() * 0.9;
    this._trails.push({
      x: x + offX,
      y: y + offY,
      vx: (Math.random() - 0.5) * 2,
      vy: 0.5 + Math.random() * 1.5, // gentle downward drift
      r: 8 + Math.random() * 14,
      life,
      max: life,
    });
  }

  /** Set tooltip targets from each particle's own formation offset,
   *  scaled to the tooltip cloud shape. No random reassignment — each
   *  particle settles where it already is relative to the cloud. */
  _setCloudTargets(pos) {
    const scaleX = 1.27;
    const scaleY = 1.2;
    for (let i = 0; i < this._N; i++) {
      const p = this._particles[i];
      const tx = pos.x + p.ox * scaleX;
      // oy is negative (upward) in the mound shape — scale it
      const ty = pos.y + p.oy * scaleY;
      p.tx = tx;
      // Clamp: nothing below the floor
      p.ty = Math.min(ty, pos.y - p.r);
    }
  }

  /**
   * Per-particle mouse interaction.
   * Particles near the cursor get pushed based on mouse speed.
   * Slow movement = gentle nudge;  fast swipe = strong shove.
   * If enough particles are displaced, triggers a full burst.
   */
  _applyMouseForces() {
    const mx = this._mouseX, my = this._mouseY;
    const mvx = this._mouseVX, mvy = this._mouseVY;
    const mouseSpeed = Math.hypot(mvx, mvy);

    // No interaction if mouse is far from the cloud or barely moving
    const cloudDist = Math.hypot(mx - this._leader.x, my - this._leader.y);
    if (cloudDist > 200 || mouseSpeed < 1) {
      // Decay burst energy when mouse is away
      this._burstEnergy *= 0.96;
      return;
    }

    const interactionRadius = 70; // how close to a particle the mouse needs to be
    let pushed = 0;

    for (const p of this._particles) {
      const dx = p.x - mx;
      const dy = p.y - my;
      const dist = Math.hypot(dx, dy);
      if (dist > interactionRadius) continue;

      // Proximity factor — stronger when closer (1 at center, 0 at edge)
      const prox = 1 - dist / interactionRadius;

      // Push force scales with mouse speed and proximity
      const force = prox * Math.min(mouseSpeed, 80) * 0.55;

      // Push direction: mix of mouse velocity direction + away-from-mouse
      const awayX = dist > 1 ? dx / dist : (Math.random() - 0.5);
      const awayY = dist > 1 ? dy / dist : (Math.random() - 0.5);
      const dirX = mvx * 0.6 + awayX * mouseSpeed * 0.4;
      const dirY = mvy * 0.6 + awayY * mouseSpeed * 0.4;
      const dirLen = Math.max(Math.hypot(dirX, dirY), 1);

      p.vx += (dirX / dirLen) * force;
      p.vy += (dirY / dirLen) * force * 0.35;  // dampen vertical
      pushed++;
    }

    // Accumulate burst energy based on how many particles were hit and how fast
    if (pushed > 0) {
      this._burstEnergy += pushed * mouseSpeed * 0.015;
    }
    this._burstEnergy *= 0.97; // natural decay

    // Full burst threshold — fast swipe through the cloud triggers it
    if (this._burstEnergy > this._burstThreshold) {
      // Physics burst: each particle reacts based on its position relative
      // to the mouse. Closer particles get hit harder, further ones get
      // a shockwave. The mouse velocity sets the overall direction.
      // Clamp mouse speed used for burst forces
      const clampedSpeed = Math.min(mouseSpeed, 60);
      const mNorm = Math.max(clampedSpeed, 1);
      const mdx = mvx / Math.max(mouseSpeed, 1);  // direction from actual velocity
      const mdy = mvy / Math.max(mouseSpeed, 1);

      for (const p of this._particles) {
        const toX = p.x - mx;
        const toY = p.y - my;
        const toDist = Math.max(Math.hypot(toX, toY), 1);
        const toNx = toX / toDist;
        const toNy = toY / toDist;

        const proximity = Math.max(1 - toDist / 180, 0.15);

        const pushStr = clampedSpeed * (20 + Math.random() * 15) * proximity;
        const awayStr = clampedSpeed * (10 + Math.random() * 15) * proximity;

        p.vx += mdx * pushStr + toNx * awayStr;
        p.vy += (mdy * pushStr + toNy * awayStr) * 0.35;
      }
      this._enter('cloudburst');
    }
  }

  /* ====================================================================
     Position Helpers
     ==================================================================== */

  /** Get the tooltip anchor position below a tab button. */
  _tabPos(idx) {
    if (idx < 0 || idx >= this._tabs.length) return { x: this._w / 2, y: 55 };
    const btn = document.querySelector(`.tab-btn[data-panel="${this._tabs[idx].panel}"]`);
    if (!btn) return { x: this._w / 2, y: 55 };
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom + 90 };
  }

  /**
   * Randomize the intro flight path parameters.
   * Called once per start() so each page load feels different.
   */
  _randomizeIntro() {
    const w = this._w, h = this._h;
    const margin = 80; // how far off-screen to start

    // Always enter from the right, at a random height
    this._introStart = { x: w + margin, y: h * (0.3 + Math.random() * 0.4) };

    // Loop parameters
    this._introLoopDir = Math.random() < 0.5 ? 1 : -1;
    this._introLoops = 1 + Math.floor(Math.random() * 2);
    this._introLoopSize = 0.25 + Math.random() * 0.20;
    this._introLoopPhase = Math.random() * Math.PI * 2;

    // ── Keep the path on-screen ──
    // Sample 20 points along the path; if too many are off-screen,
    // shrink the loop radius until they fit (allow small 60px bleed).
    const pad = 60;
    const dest = this._tabPos(0);
    const start = this._introStart;
    for (let attempt = 0; attempt < 6; attempt++) {
      let offCount = 0;
      const R = Math.min(w, h) * this._introLoopSize;
      for (let i = 1; i <= 20; i++) {
        const t = i / 20;
        const u = 1 - (1 - t) * (1 - t);
        const bx = start.x + (dest.x - start.x) * u;
        const by = start.y + (dest.y - start.y) * u;
        const s = t * t;
        const env = Math.sin(s * Math.PI);
        const ang = this._introLoopPhase + s * Math.PI * 2 * this._introLoops * this._introLoopDir;
        const px = bx + Math.sin(ang) * R * env;
        const py = by - Math.cos(ang) * R * env;
        if (px < -pad || px > w + pad || py < -pad || py > h + pad) offCount++;
      }
      // If more than 3 out of 20 samples are off-screen, shrink & retry
      if (offCount <= 3) break;
      this._introLoopSize *= 0.7;
    }
  }

  /**
   * Intro path — randomized theatrical entrance.
   * Entry edge, loop count, loop size, and direction are all random.
   */
  _introPos(t) {
    const dest = this._tabPos(0);
    const w = this._w, h = this._h;
    const start = this._introStart;

    // Ease-out (constant deceleration) — fast at start, gentle at end.
    const u = 1 - (1 - t) * (1 - t);

    // Base path: straight line from entry to destination, decelerated.
    const baseX = start.x + (dest.x - start.x) * u;
    const baseY = start.y + (dest.y - start.y) * u;

    // Loop overlay — peaks in the middle of the journey, fades at start/end.
    const s = t * t; // remap so loop peaks in the back half
    const envelope = Math.sin(s * Math.PI);
    const R = Math.min(w, h) * this._introLoopSize;
    const angle = this._introLoopPhase + s * Math.PI * 2 * this._introLoops * this._introLoopDir;

    return {
      x: baseX + Math.sin(angle) * R * envelope,
      y: baseY - Math.cos(angle) * R * envelope,
    };
  }

  /* ====================================================================
     Rendering
     ==================================================================== */

  _render() {
    const ctx = this._ctx;
    ctx.clearRect(0, 0, this._w, this._h);

    // ── trail puffs (fading) ──
    ctx.fillStyle = '#FBF157';
    for (const t of this._trails) {
      ctx.globalAlpha = (t.life / t.max) * 0.4;
      ctx.beginPath();
      ctx.arc(t.x, t.y, Math.max(t.r, 0.4), 0, Math.PI * 2);
      ctx.fill();
    }

    // ── main particles ──
    for (const p of this._particles) {
      ctx.globalAlpha = p.opacity;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
}
