/* ============================================================================
   cine-scroll1 engine — orbite 360°, vidéo scrubée, rail de caméra, textes calés
   ----------------------------------------------------------------------------
   Vanilla JS, zéro dépendance. Le moteur lit des attributs data-cs-* posés sur un
   HTML écrit à la main ; il ne fabrique jamais la page. Ne pas le modifier par
   projet : le comportement propre à un site s'écrit dans la page, branché sur
   l'événement `cs:progress` ou la variable CSS `--cs-p`.

   SCÈNE (la section qui se défile)
     <section data-cs-scene data-cs-length="300" data-cs-damp="10">
       <div data-cs-stage> … </div>          (épinglé pendant la scène)
     </section>
     data-cs-length : hauteur de défilement en vh (défaut 250).
     data-cs-damp   : amortissement exponentiel (λ, 1/s ; défaut 10 ; 0 = direct).
     Expose --cs-p (0..1, amorti) sur la scène et émet `cs:progress` {p, raw}.

   ORBITE (séquence d'images sur canvas)
     <canvas data-cs-orbit data-cs-src="f/orbit-{i}.webp" data-cs-count="72"
             data-cs-pad="3" data-cs-src-mobile="m/orbit-{i}.webp"
             data-cs-drive="both" data-cs-turns="1" data-cs-loop="true"
             data-cs-fit="contain" aria-label="…"></canvas>
     <img data-cs-poster src="f/orbit-001.webp" alt="…">   (repli, toujours là)
     drive : scroll | drag | both. loop=false : arc partiel, bornes fermes.
     Chargement : image 0 d'abord, puis passes grossières → fines autour de l'angle
     courant (6 requêtes en bureau, 3 sur téléphone). Une image absente est
     remplacée par la plus proche déjà chargée : jamais d'écran vide.
     Glisser (pointer capture, inertie), clavier (flèches, Maj+flèche, Début/Fin).

   VIDÉO SCRUBÉE (survol, orbite filmée)
     <video data-cs-video muted playsinline preload="none"
            data-cs-src="v/vol.mp4" data-cs-src-mobile="v/vol-m.mp4"
            data-cs-range="0,1"></video>
     <img data-cs-poster src="v/vol-debut.webp" data-cs-poster-end="v/vol-fin.webp" alt="…">
     Chargée en blob (toujours seekable), recherches regroupées (jamais de nouvelle
     consigne pendant `seeking`), image affichée seulement quand une vraie image est
     peinte, amorçage iOS au premier toucher. Mouvement réduit : pas de vidéo,
     l'affiche de fin (ou de début) reste.

     data-cs-curve="0:0, 0.35:0.55, 0.7:0.62, 1:1" : rampe de vitesse (progression:temps).
     Ici le vol file jusqu'à 55 %, puis presque s'arrête sur la révélation, puis repart.

   ANCRES (texte collé à un plan filmé, suivi par scripts/suivre.py)
     <p data-cs-anchor="v/vol-ancre.json" data-cs-anchor-mode="plan">Terrasse · 120 m²</p>
     plan  : le texte est posé sur la surface (sol, mur), perspective comprise.
     point : le texte suit le centre de la zone, à plat (étiquette de visite).
     data-cs-for="idVideo" si la scène a plusieurs vidéos. Plan perdu : fondu, jamais
     de texte qui flotte. Mouvement réduit : ancres masquées (la vidéo n'est pas jouée).

   TEXTES CALÉS
     <p data-cs-cue="0.15,0.45">…</p>   apparaît entre 15 % et 45 % de la scène.
     Fin à 1 : le texte reste. Sans JavaScript, tout est visible.

   RAIL DE CAMÉRA (pour Three.js ou tout moteur 3D)
     const rail = CineScroll.route([{p:[0,40,120], look:[0,0,0]}, …]);
     scene.addEventListener('cs:progress', e => { const s = rail.at(e.detail.p);
       camera.position.set(...s.position); camera.lookAt(...s.target); });
     Catmull-Rom centripète, paramétré à la longueur d'arc (vitesse régulière).

   ÉTAT (pour le harnais de vérification) : CineScroll.state()
   ========================================================================== */
(function () {
  'use strict';
  if (window.CineScroll) return;

  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const small = matchMedia('(max-width: 760px)');
  const isMobile = () => coarse || small.matches;
  const reduced = () => mqReduce.matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const DPR = () => Math.min(window.devicePixelRatio || 1, 2);

  const scenes = [], orbits = [], videos = [], cues = [], anchors = [];
  let raf = 0, lastT = 0, vh = innerHeight;

  /* ---------------------------------------------------------------- scènes */
  function Scene(el) {
    this.el = el;
    this.stage = el.querySelector('[data-cs-stage]');
    this.length = parseFloat(el.dataset.csLength || '250');
    this.damp = parseFloat(el.dataset.csDamp ?? '10');
    this.raw = 0; this.p = 0; this.visible = false; this.near = false;
    el.style.setProperty('--cs-length', this.length);
    el.style.height = this.length + 'svh';
    this.top = 0; this.height = 0;
  }
  Scene.prototype.measure = function () {
    const r = this.el.getBoundingClientRect();
    this.top = r.top + scrollY; this.height = r.height;
  };
  Scene.prototype.read = function () {
    const span = Math.max(1, this.height - vh);
    this.raw = clamp((scrollY - this.top) / span);
  };
  Scene.prototype.step = function (dt) {
    const prev = this.p;
    if (reduced() || !this.damp || dt === 0) this.p = this.raw;
    else this.p = this.raw + (this.p - this.raw) * Math.exp(-this.damp * dt);
    if (Math.abs(this.p - this.raw) < 0.0004) this.p = this.raw;
    if (this.p !== prev || this._first !== true) {
      this._first = true;
      this.el.style.setProperty('--cs-p', this.p.toFixed(4));
      this.el.dispatchEvent(new CustomEvent('cs:progress', { detail: { p: this.p, raw: this.raw } }));
    }
    return this.p !== this.raw;
  };

  /* ---------------------------------------------------------------- orbite */
  function Orbit(canvas) {
    this.el = canvas;
    const d = canvas.dataset;
    this.scene = scenes.find(s => s.el.contains(canvas)) || null;
    this.count = parseInt(d.csCount, 10);
    this.pad = parseInt(d.csPad || '3', 10);
    this.tpl = (isMobile() && d.csSrcMobile) ? d.csSrcMobile : d.csSrc;
    this.drive = d.csDrive || (this.scene ? 'both' : 'drag');
    this.turns = parseFloat(d.csTurns || '1');
    this.loop = d.csLoop !== 'false';
    this.fit = d.csFit || 'contain';
    this.start = parseInt(d.csStart || '0', 10);
    this.reverse = d.csReverse === 'true';
    this.imgs = new Array(this.count); this.loaded = 0; this.queue = null; this.inflight = 0;
    this.dragOffset = 0; this.velocity = 0; this.dragging = false; this.frame = -1; this.drawn = -1;
    this.poster = canvas.parentElement.querySelector('[data-cs-poster]');
    this.ctx = canvas.getContext('2d');
    this.interacted = false;
    canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
    canvas.setAttribute('role', 'slider');
    canvas.setAttribute('aria-valuemin', '0');
    canvas.setAttribute('aria-valuemax', '359');
    if (!canvas.hasAttribute('aria-label')) canvas.setAttribute('aria-label', 'Vue à 360°');
    this.bind();
    this.resize();
  }
  Orbit.prototype.src = function (i) {
    return this.tpl.replace('{i}', String(i + 1).padStart(this.pad, '0'));
  };
  Orbit.prototype.order = function (around) {
    const n = this.count, seen = new Uint8Array(n), out = [];
    const dist = i => { const d = Math.abs(i - around); return this.loop ? Math.min(d, n - d) : d; };
    const add = i => { if (!seen[i]) { seen[i] = 1; out.push(i); } };
    add(this.start % n);
    for (const stride of [16, 8, 4, 2, 1]) {
      const pass = [];
      for (let i = 0; i < n; i += stride) if (!seen[i]) pass.push(i);
      pass.sort((a, b) => dist(a) - dist(b)).forEach(add);
    }
    return out;
  };
  Orbit.prototype.load = function () {
    if (this.queue) return;
    this.queue = this.order(this.start);
    this.pump();
  };
  Orbit.prototype.pump = function () {
    const max = isMobile() ? 3 : 6;
    while (this.inflight < max && this.queue.length) {
      const i = this.queue.shift();
      if (this.imgs[i]) continue;
      const img = new Image();
      img.decoding = 'async';
      img.src = this.src(i);
      this.inflight++;
      const done = ok => {
        this.inflight--;
        if (ok) { this.imgs[i] = img; this.loaded++; this.drawn = -1; wake(); }
        this.pump();
      };
      (img.decode ? img.decode() : new Promise((r, j) => { img.onload = r; img.onerror = j; }))
        .then(() => done(true), () => done(false));
    }
  };
  Orbit.prototype.reprioritise = function () {
    if (!this.queue || !this.queue.length) return;
    const n = this.count, at = this.frame;
    const dist = i => { const d = Math.abs(i - at); return this.loop ? Math.min(d, n - d) : d; };
    this.queue.sort((a, b) => dist(a) - dist(b));
  };
  Orbit.prototype.nearestLoaded = function (i) {
    if (this.imgs[i]) return i;
    for (let k = 1; k < this.count; k++) {
      for (const j of [i + k, i - k]) {
        const m = this.loop ? ((j % this.count) + this.count) % this.count : j;
        if (m >= 0 && m < this.count && this.imgs[m]) return m;
      }
    }
    return -1;
  };
  Orbit.prototype.target = function () {
    const n = this.count;
    let base = this.start;
    if (this.scene && this.drive !== 'drag' && !reduced()) {
      base += this.loop ? this.scene.p * this.turns * n : this.scene.p * (n - 1);
    }
    let f = base + this.dragOffset * (this.reverse ? -1 : 1);
    f = Math.round(f);
    return this.loop ? ((f % n) + n) % n : clamp(f, 0, n - 1);
  };
  Orbit.prototype.step = function (dt) {
    let moving = false;
    if (!this.dragging && Math.abs(this.velocity) > 0.5) {
      this.dragOffset += this.velocity * dt;
      this.velocity *= Math.exp(-3.2 * dt);
      if (!this.loop) this.clampOffset();
      moving = true;
    } else if (!this.dragging) this.velocity = 0;
    const f = this.target();
    if (f !== this.frame) {
      const jump = Math.abs(f - this.frame);
      this.frame = f;
      this.el.setAttribute('aria-valuenow', String(Math.round(f / this.count * 360)));
      this.el.setAttribute('aria-valuetext', 'Vue à ' + Math.round(f / this.count * 360) + ' degrés');
      if (jump > 4) this.reprioritise();
    }
    this.draw();
    this.el.dataset.csFrame = this.frame;
    this.el.dataset.csLoaded = this.loaded;
    return moving;
  };
  Orbit.prototype.clampOffset = function () {
    const n = this.count;
    const scrollPart = (this.scene && this.drive !== 'drag' && !reduced()) ? this.scene.p * (n - 1) : 0;
    this.dragOffset = clamp(this.dragOffset, -this.start - scrollPart, n - 1 - this.start - scrollPart);
  };
  Orbit.prototype.draw = function () {
    const i = this.nearestLoaded(this.frame);
    if (i < 0 || i === this.drawn) return;
    const img = this.imgs[i], c = this.el, ctx = this.ctx;
    const cw = c.width, ch = c.height, iw = img.naturalWidth, ih = img.naturalHeight;
    const s = this.fit === 'cover' ? Math.max(cw / iw, ch / ih) : Math.min(cw / iw, ch / ih);
    const w = iw * s, h = ih * s;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    this.drawn = i;
    if (!c.classList.contains('cs-painted')) {
      c.classList.add('cs-painted');
      if (this.poster) this.poster.classList.add('cs-hidden');
    }
  };
  Orbit.prototype.resize = function () {
    const r = this.el.getBoundingClientRect(), d = DPR();
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (w !== this.el.width || h !== this.el.height) { this.el.width = w; this.el.height = h; this.drawn = -1; }
  };
  Orbit.prototype.firstTouch = function () {
    if (this.interacted) return;
    this.interacted = true;
    const box = this.el.closest('[data-cs-stage]') || this.el.parentElement;
    box.querySelectorAll('[data-cs-hint]').forEach(h => h.classList.add('cs-hidden'));
  };
  Orbit.prototype.bind = function () {
    const c = this.el;
    if (this.drive === 'scroll') return;
    let lastX = 0, lastT = 0;
    c.style.touchAction = 'pan-y';
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this.dragging = true; this.velocity = 0; lastX = e.clientX; lastT = performance.now();
      try { c.setPointerCapture(e.pointerId); } catch (_) {}
      c.classList.add('cs-grabbing'); this.firstTouch(); wake();
    });
    c.addEventListener('pointermove', e => {
      if (!this.dragging) return;
      const now = performance.now(), dx = e.clientX - lastX;
      const perFrame = c.getBoundingClientRect().width / this.count;
      const df = dx / Math.max(2, perFrame);
      this.dragOffset += df;
      if (!this.loop) this.clampOffset();
      const dts = Math.max(0.008, (now - lastT) / 1000);
      this.velocity = this.velocity * 0.6 + (df / dts) * 0.4;
      lastX = e.clientX; lastT = now; wake();
    });
    const end = e => {
      if (!this.dragging) return;
      this.dragging = false; c.classList.remove('cs-grabbing');
      if (performance.now() - lastT > 90 || reduced()) this.velocity = 0;
      try { c.releasePointerCapture(e.pointerId); } catch (_) {}
      wake();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('keydown', e => {
      const big = Math.max(1, Math.round(this.count / 8));
      const k = e.key;
      let d = 0;
      if (k === 'ArrowRight' || k === 'ArrowUp') d = e.shiftKey ? big : 1;
      else if (k === 'ArrowLeft' || k === 'ArrowDown') d = e.shiftKey ? -big : -1;
      else if (k === 'Home') d = -this.frame;
      else if (k === 'End') d = this.count - 1 - this.frame;
      else return;
      e.preventDefault();
      this.velocity = 0; this.dragOffset += d * (this.reverse ? -1 : 1);
      if (!this.loop) this.clampOffset();
      this.firstTouch(); wake();
    });
  };

  /* ---------------------------------------------------------------- vidéo */
  function Scrub(v) {
    this.el = v;
    const d = v.dataset;
    this.scene = scenes.find(s => s.el.contains(v)) || null;
    this.src = (isMobile() && d.csSrcMobile) ? d.csSrcMobile : d.csSrc;
    const r = (d.csRange || '0,1').split(',').map(Number);
    this.r0 = r[0]; this.r1 = r[1] ?? 1;
    // Rampe de vitesse : "p:t, p:t, …" (progression → temps, 0..1), linéaire par morceaux.
    this.curve = (d.csCurve || '').split(',').map(s => s.trim()).filter(Boolean)
      .map(s => s.split(':').map(Number)).filter(q => q.length === 2 && q.every(Number.isFinite))
      .sort((a, b) => a[0] - b[0]);
    if (this.curve.length) {
      if (this.curve[0][0] > 0) this.curve.unshift([0, 0]);
      if (this.curve[this.curve.length - 1][0] < 1) this.curve.push([1, 1]);
    }
    this.poster = v.parentElement.querySelector('[data-cs-poster]');
    this.pending = null; this.painted = false; this.ready = false; this.loading = false;
    v.muted = true; v.playsInline = true; v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.removeAttribute('src'); v.preload = 'none';
    if (reduced() && this.poster && this.poster.dataset.csPosterEnd) this.poster.src = this.poster.dataset.csPosterEnd;
  }
  Scrub.prototype.load = function () {
    if (this.loading || reduced() || !this.src) return;
    this.loading = true;
    const v = this.el;
    fetch(this.src).then(r => r.ok ? r.blob() : Promise.reject(new Error(r.status)))
      .then(b => {
        v.src = URL.createObjectURL(b);
        v.addEventListener('loadedmetadata', () => { this.ready = true; this.seek(); }, { once: true });
        // Si la cible est déjà 0, aucune recherche n'a lieu : marquer peinte dès la première image.
        v.addEventListener('loadeddata', () => this.markPainted(), { once: true });
        v.addEventListener('seeked', () => { this.markPainted(); if (this.pending != null) { const t = this.pending; this.pending = null; this.apply(t); } });
        v.load();
      })
      .catch(err => { this.el.dataset.csError = String(err && err.message || err); });
  };
  Scrub.prototype.markPainted = function () {
    const v = this.el;
    const done = () => {
      if (this.painted) return;
      this.painted = true; v.classList.add('cs-painted');
      if (this.poster) this.poster.classList.add('cs-hidden');
    };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(done); else done();
    if (v.readyState >= 2) setTimeout(done, 120);
  };
  Scrub.prototype.ramp = function (p) {
    const c = this.curve;
    if (!c.length) return p;
    for (let i = 1; i < c.length; i++) {
      if (p <= c[i][0]) {
        const [p0, t0] = c[i - 1], [p1, t1] = c[i];
        return p1 > p0 ? t0 + (t1 - t0) * (p - p0) / (p1 - p0) : t1;
      }
    }
    return c[c.length - 1][1];
  };
  Scrub.prototype.time = function () {
    const p = this.ramp(this.scene ? this.scene.p : 0);
    const d = this.el.duration || 0;
    return clamp(this.r0 + (this.r1 - this.r0) * p) * Math.max(0, d - 0.04);
  };

  /* ---------------------------------------------------------------- ancres */
  // Coin-pin : homographie qui envoie le rectangle (0,0)-(w,h) sur le quad q (px).
  function quadMatrix(w, h, q) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = q;
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    const g = (sx * dy2 - dx2 * sy) / den, k = (dx1 * sy - sx * dy1) / den;
    const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3, d = y1 - y0 + g * y1, e = y3 - y0 + k * y3;
    const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, x0, y0, 0, 1];
    return `matrix3d(${m.map(v => +v.toFixed(8)).join(',')})`;
  }
  function Anchor(el) {
    this.el = el;
    this.scene = scenes.find(s => s.el.contains(el)) || null;
    const stage = el.closest('[data-cs-stage]') || el.parentElement;
    const id = el.dataset.csFor;
    this.video = id ? document.getElementById(id) : stage.querySelector('[data-cs-video]');
    this.mode = el.dataset.csAnchorMode || 'plan';     // plan : posé sur la surface ; point : suit le centre
    this.fade = parseFloat(el.dataset.csAnchorFade || '0.12');
    this.track = null; this.o = -1; this.box = null;
    el.style.position = 'absolute'; el.style.left = '0'; el.style.top = '0';
    el.style.transformOrigin = '0 0'; el.style.pointerEvents = el.style.pointerEvents || 'none';
    el.style.opacity = '0'; el.style.visibility = 'hidden';
    if (reduced()) return;
    fetch(el.dataset.csAnchor).then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
      .then(j => { this.track = j; this.measure(); wake(); })
      .catch(err => { el.dataset.csError = String(err && err.message || err); });
  }
  Anchor.prototype.measure = function () {
    const v = this.video, host = this.el.offsetParent;
    if (!v || !host || !this.track) return;
    const vr = v.getBoundingClientRect(), hr = host.getBoundingClientRect();
    const iw = v.videoWidth || this.track.w, ih = v.videoHeight || this.track.h;
    const fit = getComputedStyle(v).objectFit;
    const s = fit === 'contain' ? Math.min(vr.width / iw, vr.height / ih) : Math.max(vr.width / iw, vr.height / ih);
    this.box = { x: vr.left - hr.left + (vr.width - iw * s) / 2, y: vr.top - hr.top + (vr.height - ih * s) / 2, w: iw * s, h: ih * s };
    this.size = [this.el.offsetWidth || 1, this.el.offsetHeight || 1];
  };
  Anchor.prototype.step = function () {
    const v = this.video, t = this.track;
    if (!t || !v || !this.box) return;
    const n = t.quads.length;
    const f = clamp(Math.round((v.currentTime || 0) * t.fps), 0, n - 1);
    const q = v.classList.contains('cs-painted') ? t.quads[f] : null;
    // fondu : le texte s'efface juste avant que le plan soit perdu (ou en bord de prise)
    let o = 0;
    if (q) {
      const span = Math.max(1, Math.round(this.fade * t.fps));
      let near = span;
      for (let i = 1; i <= span; i++) {
        if ((f - i >= 0 && !t.quads[f - i]) || (f + i < n && !t.quads[f + i])) { near = i - 1; break; }
      }
      o = clamp(near / span + 0.15);
    }
    if (q) {
      const B = this.box;
      const px = q.map((c, i) => (i % 2 ? B.y + c * B.h : B.x + c * B.w));
      if (this.mode === 'point') {
        const cx = (px[0] + px[2] + px[4] + px[6]) / 4, cy = (px[1] + px[3] + px[5] + px[7]) / 4;
        this.el.style.transform = `translate3d(${(cx - this.size[0] / 2).toFixed(1)}px, ${(cy - this.size[1]).toFixed(1)}px, 0)`;
      } else {
        this.el.style.transform = quadMatrix(this.size[0], this.size[1], px);
      }
    }
    if (Math.abs(o - this.o) < 0.01) return;
    this.o = o;
    this.el.style.opacity = o.toFixed(3);
    this.el.style.visibility = o < 0.01 ? 'hidden' : 'visible';
  };
  Scrub.prototype.apply = function (t) {
    const v = this.el;
    if (v.seeking) { this.pending = t; return; }
    if (Math.abs(v.currentTime - t) > 0.008) v.currentTime = t;
  };
  Scrub.prototype.seek = function () { if (this.ready) this.apply(this.time()); };
  Scrub.prototype.prime = function () {
    const v = this.el;
    if (!this.ready || this.primed) return;
    this.primed = true;
    const p = v.play(); if (p && p.then) p.then(() => { v.pause(); this.seek(); }).catch(() => {});
  };

  /* ---------------------------------------------------------------- textes */
  function Cue(el) {
    this.el = el;
    this.scene = scenes.find(s => s.el.contains(el)) || null;
    const a = (el.dataset.csCue || '0,1').split(',').map(Number);
    this.a = a[0]; this.b = a[1] ?? 1; this.o = -1;
  }
  Cue.prototype.step = function () {
    if (!this.scene) return;
    const p = this.scene.p, ramp = 0.06;
    let o;
    if (reduced()) o = (p >= this.a - 0.001 && (this.b >= 1 || p <= this.b)) ? 1 : 0;
    else {
      const inn = this.a <= 0 ? 1 : clamp((p - this.a) / ramp);   // un texte calé dès 0 est visible au premier écran
      const out = this.b >= 1 ? 1 : clamp((this.b - p) / ramp);
      o = Math.min(inn, out);
    }
    if (Math.abs(o - this.o) < 0.002) return;
    this.o = o;
    this.el.style.opacity = o.toFixed(3);
    this.el.style.transform = reduced() ? '' : `translate3d(0, ${((1 - o) * 14).toFixed(2)}px, 0)`;
    this.el.style.visibility = o < 0.01 ? 'hidden' : 'visible';
  };

  /* ---------------------------------------------------------------- rail */
  function route(points, opts = {}) {
    const P = points.map(q => (Array.isArray(q) ? { p: q } : q));
    const closed = !!opts.closed, alpha = opts.alpha ?? 0.5;
    const get = (arr, i) => {
      const n = arr.length;
      if (closed) return arr[((i % n) + n) % n];
      return arr[clamp(i, 0, n - 1)];
    };
    const cr = (arr, seg, u) => {
      const p0 = get(arr, seg - 1), p1 = get(arr, seg), p2 = get(arr, seg + 1), p3 = get(arr, seg + 2);
      const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-4, alpha);
      const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
      const t = t1 + (t2 - t1) * u;
      const lerp = (a, b, ta, tb) => a.map((v, k) => (tb - t) / (tb - ta) * v + (t - ta) / (tb - ta) * b[k]);
      const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
      return lerp(B1, B2, t1, t2);
    };
    const segs = closed ? P.length : P.length - 1;
    const pos = P.map(q => q.p);
    const hasLook = P.every(q => q.look);
    const look = hasLook ? P.map(q => q.look) : null;
    const raw = u => { const x = clamp(u) * segs; const s = Math.min(segs - 1, Math.floor(x)); return [s, x - s]; };
    const N = 512, lut = [0];
    let prev = cr(pos, 0, 0), len = 0;
    for (let k = 1; k <= N; k++) {
      const [s, f] = raw(k / N); const q = cr(pos, s, f);
      len += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]); lut.push(len); prev = q;
    }
    const toU = t => {
      const target = clamp(t) * len; let lo = 0, hi = N;
      while (lo < hi) { const m = (lo + hi) >> 1; if (lut[m] < target) lo = m + 1; else hi = m; }
      const i = Math.max(1, lo), a = lut[i - 1], b = lut[i];
      return ((i - 1) + (b > a ? (target - a) / (b - a) : 0)) / N;
    };
    return {
      length: len,
      at(t, ahead = 0.012) {
        const u = toU(t); const [s, f] = raw(u);
        const position = cr(pos, s, f);
        let target;
        if (look) target = cr(look, s, f);
        else { const [s2, f2] = raw(toU(Math.min(1, t + ahead))); target = cr(pos, s2, f2); if (t + ahead > 1) { const [s0, f0] = raw(toU(t - ahead)); const b = cr(pos, s0, f0); target = position.map((v, k) => v + (v - b[k])); } }
        return { position, target };
      },
    };
  }

  /* ---------------------------------------------------------------- boucle */
  function wake() { if (!raf) { lastT = 0; raf = requestAnimationFrame(tick); } }
  function tick(t) {
    raf = 0;
    const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
    lastT = t;
    let busy = false;
    for (const s of scenes) { if (!s.near) continue; s.read(); if (s.step(dt)) busy = true; }
    for (const o of orbits) if (!o.scene || o.scene.near) { if (o.step(dt) || o.dragging) busy = true; }
    for (const v of videos) if (v.scene && v.scene.near) v.seek();
    for (const c of cues) if (c.scene && c.scene.near) c.step();
    for (const a of anchors) if (a.scene && a.scene.near) { a.step(); if (a.video && a.video.seeking) busy = true; }
    if (busy) raf = requestAnimationFrame(tick);
  }

  function measureAll() {
    vh = innerHeight;
    scenes.forEach(s => s.measure());
    orbits.forEach(o => o.resize());
    anchors.forEach(a => a.measure());
    wake();
  }

  function mount(root = document) {
    document.documentElement.classList.add('cs-ready');
    if (reduced()) document.documentElement.classList.add('cs-reduced');
    root.querySelectorAll('[data-cs-scene]').forEach(el => scenes.push(new Scene(el)));
    root.querySelectorAll('[data-cs-orbit]').forEach(el => orbits.push(new Orbit(el)));
    root.querySelectorAll('[data-cs-video]').forEach(el => videos.push(new Scrub(el)));
    root.querySelectorAll('[data-cs-cue]').forEach(el => cues.push(new Cue(el)));
    root.querySelectorAll('[data-cs-anchor]').forEach(el => anchors.push(new Anchor(el)));
    // une vidéo qui vient de se recaler redemande une image : les ancres la suivent
    videos.forEach(v => v.el.addEventListener('seeked', () => { anchors.forEach(a => { if (a.video === v.el && !a.box) a.measure(); }); wake(); }));
    videos.forEach(v => v.el.addEventListener('loadedmetadata', () => { anchors.forEach(a => a.measure()); wake(); }));

    const nearIO = new IntersectionObserver(entries => {
      entries.forEach(e => {
        const s = scenes.find(x => x.el === e.target);
        if (s) s.near = e.isIntersecting;
        if (e.isIntersecting) {
          orbits.filter(o => o.scene === s || (!o.scene && e.target.contains(o.el))).forEach(o => o.load());
          videos.filter(v => v.scene === s).forEach(v => v.load());
        }
      });
      wake();
    }, { rootMargin: '150% 0px 150% 0px' });
    scenes.forEach(s => nearIO.observe(s.el));
    const loose = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { const o = orbits.find(x => x.el === e.target); if (o) { o.load(); wake(); } } });
    }, { rootMargin: '100% 0px' });
    orbits.filter(o => !o.scene).forEach(o => loose.observe(o.el));

    addEventListener('scroll', wake, { passive: true });
    addEventListener('resize', () => { measureAll(); });
    if ('ResizeObserver' in window) new ResizeObserver(() => measureAll()).observe(document.body);
    addEventListener('load', measureAll);
    const prime = () => { videos.forEach(v => v.prime()); };
    addEventListener('touchstart', prime, { passive: true, once: true });
    addEventListener('pointerdown', prime, { passive: true, once: true });
    mqReduce.addEventListener && mqReduce.addEventListener('change', () => location.reload());
    measureAll();
  }

  function state() {
    return {
      reduced: reduced(), mobile: isMobile(),
      scenes: scenes.map(s => ({ id: s.el.id || null, raw: +s.raw.toFixed(4), p: +s.p.toFixed(4), settled: Math.abs(s.p - s.raw) < 0.0005, top: Math.round(s.top), height: Math.round(s.height) })),
      orbits: orbits.map(o => ({ id: o.el.id || null, frame: o.frame, loaded: o.loaded, count: o.count, painted: o.el.classList.contains('cs-painted'), velocity: +o.velocity.toFixed(2) })),
      videos: videos.map(v => ({ id: v.el.id || null, time: +(v.el.currentTime || 0).toFixed(3), target: +v.time().toFixed(3), duration: v.el.duration || 0, ready: v.ready, painted: v.painted, seeking: v.el.seeking, error: v.el.dataset.csError || null })),
      cues: cues.map(c => ({ scene: c.scene && (c.scene.el.id || scenes.indexOf(c.scene)), at: [c.a, c.b], opacity: +Math.max(0, c.o).toFixed(3), text: (c.el.textContent || '').trim().slice(0, 40), removed: getComputedStyle(c.el).display === 'none' })),
      anchors: anchors.map(a => ({ text: (a.el.textContent || '').trim().slice(0, 40), loaded: !!a.track, measured: !!a.box, opacity: +Math.max(0, a.o).toFixed(3), error: a.el.dataset.csError || null })),
    };
  }

  window.CineScroll = { mount, route, state, wake, quadMatrix, version: '2.1.0' };
  if (!document.documentElement.hasAttribute('data-cs-manual')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount());
    else mount();
  }
})();
