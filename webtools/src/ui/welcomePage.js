/**
 * Welcome Page — Scroll reveals + celebration particle effects.
 */

export class WelcomePage {
  constructor() {
    this._observed = false;
    this._particleCanvas = null;
    this._particleCtx = null;
    this._particles = [];
    this._raf = null;
    this._visible = false;

    this._wireRevealObserver();
    this._wireLicenseToggles();
  }

  /* ── Scroll-reveal via IntersectionObserver ───────────────────────────── */

  _wireRevealObserver() {
    const els = document.querySelectorAll('.welcome-reveal');
    if (!els.length) return;
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          observer.unobserve(e.target);
        }
      }
    }, { threshold: 0.12 });
    els.forEach((el) => observer.observe(el));
  }

  /* ── Collapsible license entries ──────────────────────────────────────── */

  _wireLicenseToggles() {
    document.querySelectorAll('.license-header').forEach((hdr) => {
      hdr.addEventListener('click', () => {
        hdr.closest('.license-entry').classList.toggle('open');
      });
    });
  }

  /* ── Celebration particles (canvas inside credits stage) ─────────────── */

  show() {
    if (this._visible) return;
    this._visible = true;
    this._initParticles();
  }

  hide() {
    this._visible = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _initParticles() {
    const container = document.querySelector('.welcome-credits-particles');
    if (!container) return;

    if (!this._particleCanvas) {
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      container.appendChild(canvas);
      this._particleCanvas = canvas;
      this._particleCtx = canvas.getContext('2d');
    }

    this._resizeCanvas();
    this._seedParticles();
    this._animateParticles();
  }

  _resizeCanvas() {
    const c = this._particleCanvas;
    const rect = c.parentElement.getBoundingClientRect();
    c.width = rect.width * devicePixelRatio;
    c.height = rect.height * devicePixelRatio;
    c.style.width = rect.width + 'px';
    c.style.height = rect.height + 'px';
    this._particleCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  _seedParticles() {
    this._particles = [];
    const rect = this._particleCanvas.parentElement.getBoundingClientRect();
    const count = Math.min(60, Math.floor(rect.width * rect.height / 6000));

    const palette = [
      'rgba(251, 241, 87, 0.7)',   // yellow
      'rgba(139, 45, 180, 0.6)',   // purple
      'rgba(168, 77, 212, 0.5)',   // lighter purple
      'rgba(96, 165, 250, 0.5)',   // blue
      'rgba(52, 211, 153, 0.4)',   // green
      'rgba(251, 191, 36, 0.5)',   // gold
    ];

    for (let i = 0; i < count; i++) {
      this._particles.push({
        x: Math.random() * rect.width,
        y: Math.random() * rect.height,
        r: 1 + Math.random() * 2.5,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.2 - Math.random() * 0.4,
        color: palette[Math.floor(Math.random() * palette.length)],
        alpha: 0.3 + Math.random() * 0.7,
        phase: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.02 + Math.random() * 0.03,
      });
    }
  }

  _animateParticles() {
    if (!this._visible) return;
    const ctx = this._particleCtx;
    const rect = this._particleCanvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    for (const p of this._particles) {
      p.phase += p.twinkleSpeed;
      const twinkle = 0.5 + 0.5 * Math.sin(p.phase);
      const alpha = p.alpha * twinkle;

      p.x += p.vx;
      p.y += p.vy;

      // wrap around
      if (p.y < -5) p.y = h + 5;
      if (p.x < -5) p.x = w + 5;
      if (p.x > w + 5) p.x = -5;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color.replace(/[\d.]+\)$/, alpha.toFixed(2) + ')');
      ctx.fill();

      // soft glow
      if (p.r > 1.5) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        glow.addColorStop(0, p.color.replace(/[\d.]+\)$/, (alpha * 0.3).toFixed(2) + ')'));
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fill();
      }
    }

    this._raf = requestAnimationFrame(() => this._animateParticles());
  }
}
