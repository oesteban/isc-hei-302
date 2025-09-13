// remark-roulette v0.3 — reusable roulette for remark decks (overlay UI)
// Usage after remark.create(...):
//   <script src="path/to/roulette.js"></script>
//   <script>Roulette.init(slideshow);</script>
(function () {
  'use strict';

  // ---------- Styles ----------
  function injectStyles() {
    if (document.getElementById('rr-styles')) return;
    const css = `
      /* Anchor overlays to the visible slide */
      .remark-slide-content { position: relative; }

      /* Top floating controls (don’t affect layout) */
      .rr-controls{
        position:absolute; top:10px; left:50%; transform:translateX(-50%);
        display:flex; gap:12px; align-items:center; flex-wrap:wrap;
        z-index: 100; pointer-events: auto;
        background: rgba(255,255,255,.85); padding:.35rem .6rem; border-radius:8px;
        box-shadow: 0 2px 8px rgba(0,0,0,.08);
      }
      .rr-controls label{ font-size: 0.95rem; }
      .rr-controls input[type="number"]{ width:6em; }
      .rr-controls input[type="text"]{ width:12em; }
      .rr-controls .rr-sep{ opacity:.35; }
      .rr-hidden{ display:none !important; }

      /* Bottom-left overlay container (name + timer) */
      .rr-overlay{
        position:absolute; left:20px; bottom:20px; z-index: 90;
        display:flex; align-items:center; gap:14px; pointer-events:none;
        color: var(--rr-fg, #111827);
      }

      .rr-name{
        max-width: 55vw; font-size: 2rem; line-height: 1.1; font-weight: 800;
        background: rgba(255,255,255,.88); padding: 6px 10px; border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,.10);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      .rr-progress{ position:relative; width:140px; height:140px; }
      .rr-progress svg{ width:100%; height:100%; transform:rotate(-90deg); }
      .rr-progress .rr-bg{ stroke:#e5e7eb; stroke-width:10; fill:none; }
      .rr-progress .rr-fg{ stroke: currentColor; stroke-width:10; stroke-linecap:round; fill:none; }
      .rr-progress .rr-time{
        position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
        font-size:1.05rem; font-weight:600; color:#111827;
        background: rgba(255,255,255,.85); padding:.15rem .4rem; border-radius:6px;
      }

      /* Config slide editors */
      .rr-config-wrap{ display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top: 16px; }
      .rr-config-wrap [data-roulette]{
        width:100%; min-height:240px; font-size:0.95rem; display:block;
        white-space:pre-wrap; padding:.5rem; border:1px solid #ccc; border-radius:6px;
      }
      .rr-config-wrap .rr-col > label{ font-weight:600; display:block; margin-bottom: 6px; }
      .rr-help{ font-size: .85rem; opacity: .8; margin-top: 6px; }
      @media (max-width: 1000px) {
        .rr-config-wrap{ grid-template-columns:1fr; }
        .rr-name{ font-size: 1.6rem; max-width: 65vw; }
        .rr-progress{ width:120px; height:120px; }
      }
    `;
    const style = document.createElement('style');
    style.id = 'rr-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------- Utils ----------
  const uniqSort = (arr) => {
    const seen = new Map();
    for (const s of arr) {
      const t = (s || '').trim();
      if (!t) continue;
      const k = t.toLocaleLowerCase();
      if (!seen.has(k)) seen.set(k, t);
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  };
  const parseList = (txt) => uniqSort((txt || '').split(/\r?\n/));

  // Seeded RNG (xmur3 + mulberry32)
  function xmur3(str) { let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return function () { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
  }
  function mulberry32(a) { return function () { let t = a += 0x6D2B79F5; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function seededShuffle(arr, seedStr) {
    const seed = xmur3(seedStr || (Date.now() + ''))();
    const rng = mulberry32(seed);
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function visibleSlideRoot() {
    const nodes = document.querySelectorAll('.remark-slide-container.remark-visible .remark-slide-content');
    return nodes[nodes.length - 1] || null;
  }

  // ---------- Module ----------
  const Roulette = {
    _slideshow: null,
    state: { attendees: [], organizers: [] },
    _active: null,
    _keyHandler: null,

    init(slideshow) {
      this._slideshow = slideshow;

      // will hold per-slide header props (e.g., time:, seed:, include_org:)
      this._currentSlideProps = {};

      // after a slide is shown, capture its properties and mount UIs
      slideshow.on('afterShowSlide', (slide) => {
        // Try event arg first; fall back to slideshow API if needed
        let props = {};
        if (slide && slide.properties) {
          props = slide.properties || {};
        } else if (this._slideshow && this._slideshow.getSlides && this._slideshow.getCurrentSlideIndex) {
          try {
            const idx = this._slideshow.getCurrentSlideIndex();
            const slides = this._slideshow.getSlides();
            if (slides && slides[idx] && slides[idx].properties) {
              props = slides[idx].properties || {};
            }
          } catch (_) { /* ignore */ }
        }
        this._currentSlideProps = props;

        const root = visibleSlideRoot();
        if (!root) return;
        if (root.classList.contains('roulette-config')) this._mountConfig(root);
        if (root.classList.contains('roulette')) this._mountRoulette(root);
      });

      // before hiding a slide, commit config or tear down overlays
      slideshow.on('beforeHideSlide', () => {
        const root = visibleSlideRoot();
        if (!root) return;
        if (root.classList.contains('roulette-config')) this._commitConfig(root);
        if (root.classList.contains('roulette')) this._teardownRoulette();
      });
    },

    // ----- CONFIG SLIDE -----
    _mountConfig(root) {
      // Accept either <textarea> or <div contenteditable>
      let a = root.querySelector('[data-roulette="attendees"]');
      let o = root.querySelector('[data-roulette="organizers"]');

      // If explicit fields are not present, create contenteditable DIVs (no default text)
      if (!a || !o) {
        let wrap = root.querySelector('.rr-config-wrap');
        if (!wrap) {
          wrap = document.createElement('div');
          wrap.className = 'rr-config-wrap';
          root.appendChild(wrap);
        }

        if (!a) {
          const colA = document.createElement('div');
          colA.className = 'rr-col';
          colA.innerHTML = `<label>Attendees (one per line)</label>`;
          const edA = document.createElement('div');
          edA.setAttribute('data-roulette','attendees');
          edA.setAttribute('contenteditable','true');
          edA.setAttribute('role','textbox');
          edA.setAttribute('aria-multiline','true');
          edA.setAttribute('data-gramm','false');
          edA.setAttribute('data-gramm_editor','false');
          edA.setAttribute('data-lt-active','false');
          edA.setAttribute('spellcheck','false');
          colA.appendChild(edA);
          colA.insertAdjacentHTML('beforeend', `<div class="rr-help">Deduplicated + sorted on slide exit.</div>`);
          wrap.appendChild(colA);
          a = edA;
        }

        if (!o) {
          const colB = document.createElement('div');
          colB.className = 'rr-col';
          colB.innerHTML = `<label>Organizers (one per line)</label>`;
          const edO = document.createElement('div');
          edO.setAttribute('data-roulette','organizers');
          edO.setAttribute('contenteditable','true');
          edO.setAttribute('role','textbox');
          edO.setAttribute('aria-multiline','true');
          edO.setAttribute('data-gramm','false');
          edO.setAttribute('data-gramm_editor','false');
          edO.setAttribute('data-lt-active','false');
          edO.setAttribute('spellcheck','false');
          colB.appendChild(edO);
          colB.insertAdjacentHTML('beforeend', `<div class="rr-help">You can include organizers in the roulette.</div>`);
          wrap.appendChild(colB);
          o = edO;
        }
      }

      // Prefill from state iff empty
      const setIfEmpty = (el, lines) => {
        const val = el.tagName === 'TEXTAREA' ? el.value : el.innerText;
        if (!val && lines.length) {
          if (el.tagName === 'TEXTAREA') el.value = lines.join('\n');
          else el.innerText = lines.join('\n');
        }
      };
      setIfEmpty(a, this.state.attendees);
      setIfEmpty(o, this.state.organizers);
    },

    _commitConfig(root) {
      const a = root.querySelector('[data-roulette="attendees"]');
      const o = root.querySelector('[data-roulette="organizers"]');
      if (!a || !o) return;

      const getValue = (el) => el.tagName === 'TEXTAREA' ? el.value : el.innerText;
      this.state.attendees  = parseList(getValue(a));
      this.state.organizers = parseList(getValue(o));
    },

    // ----- ROULETTE SLIDE -----
    _mountRoulette(root) {
      // --- Top floating controls ---
      let controls = root.querySelector('.rr-controls');
      if (!controls) {
        controls = document.createElement('div');
        controls.className = 'rr-controls';
        controls.innerHTML = `
          <label>Seconds: <input type="number" min="5" step="5" value="60" id="rr-seconds"></label>
          <span class="rr-sep">|</span>
          <label>Seed: <input type="text" placeholder="e.g., 302-2025-09-15" id="rr-seed"></label>
          <span class="rr-sep">|</span>
          <label title="Include organizer names first in the run.">
            <input type="checkbox" id="rr-include-org"> Include organizers
          </label>
        `;
        root.appendChild(controls);
      }

      // If the slide header provided 'time:', prefill the seconds input
      const secsInput = controls.querySelector('#rr-seconds');
      const headerSecs = this._getHeaderSeconds(root);
      if (Number.isFinite(headerSecs) && headerSecs > 0) {
        secsInput.value = String(headerSecs);
      }

      // --- Bottom-left overlay (name + timer) ---
      let overlay = root.querySelector('.rr-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'rr-overlay';
        overlay.innerHTML = `
          <div class="rr-progress rr-hidden">
            <svg viewBox="0 0 160 160" aria-hidden="true">
              <circle class="rr-bg" cx="80" cy="80" r="60"></circle>
              <circle class="rr-fg" cx="80" cy="80" r="60" stroke-dasharray="${Math.PI * 2 * 60}" stroke-dashoffset="${Math.PI * 2 * 60}"></circle>
            </svg>
            <div class="rr-time">0s</div>
          </div>
          <div class="rr-name" aria-live="polite"></div>
        `;
        root.appendChild(overlay);
      }

      // Keys: space=start/pause, s=skip
      this._keyHandler = (ev) => {
        const inEditable = /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName);
        if (!root.classList.contains('roulette')) return;
        if (ev.code === 'Space' || ev.key === ' ' || ev.key === 'Spacebar') {
          ev.preventDefault(); ev.stopPropagation();
          if (!this._active) this._startRoulette(root);
          else this._togglePause();
        } else if (!inEditable && (ev.key === 's' || ev.key === 'S')) {
          ev.preventDefault(); ev.stopPropagation();
          if (this._active) this._skip();
        }
      };
      document.addEventListener('keydown', this._keyHandler, true);

      // Reset overlay state (don’t alter slide content)
      const ring = root.querySelector('.rr-progress');
      const nameBox = root.querySelector('.rr-name');
      if (controls) controls.classList.remove('rr-hidden');
      if (ring) ring.classList.add('rr-hidden');
      if (nameBox) nameBox.textContent = '';
    },

    _buildRunOrder(seed, includeOrg) {
      const p = this.state.attendees.slice();
      const o = this.state.organizers.slice();

      const pp = seededShuffle(p, seed ? seed + '|P' : '');
      const oo = seededShuffle(o, seed ? seed + '|O' : '');

      return includeOrg ? (oo.concat(pp)) : pp;
    },

    _startRoulette(root) {
      const secsInput  = root.querySelector('#rr-seconds');
      const seedInput  = root.querySelector('#rr-seed');
      const includeOrg = root.querySelector('#rr-include-org').checked;

      const secs = Math.max(5, parseInt(secsInput.value || '60', 10));
      const seed = (seedInput.value || '').trim();

      const list = this._buildRunOrder(seed, includeOrg);

      const controls   = root.querySelector('.rr-controls');
      const ring       = root.querySelector('.rr-progress');
      const fg         = ring.querySelector('.rr-fg');
      const timeLabel  = ring.querySelector('.rr-time');
      const nameBox    = root.querySelector('.rr-name');

      if (!list.length) {
        if (nameBox) nameBox.textContent = 'No names configured';
        return;
      }

      // Show overlays
      if (controls) controls.classList.add('rr-hidden');
      if (ring) ring.classList.remove('rr-hidden');

      const r = parseFloat(fg.getAttribute('r'));            // 60
      const circumference = Math.PI * 2 * r;
      fg.setAttribute('stroke-dasharray', String(circumference));

      this._active = {
        root, list, secs,
        idx: 0,
        paused: false,
        remainingMs: secs * 1000,
        startedAt: performance.now(),
        rafId: null,
        circumference, fg, timeLabel, nameBox
      };

      nameBox.textContent = list[0];
      this._tick();
    },

    _tick() {
      if (!this._active) return;
      const A = this._active;
      if (A.paused) return;

      const now = performance.now();
      const elapsed = now - A.startedAt;
      const left = Math.max(0, A.remainingMs - elapsed);

      const ratio  = left / (A.secs * 1000);          // 1 -> 0
      const offset = A.circumference * ratio;
      A.fg.setAttribute('stroke-dashoffset', offset.toFixed(1));
      A.timeLabel.textContent = (left >= 1000 ? Math.ceil(left/1000) : 0) + 's';

      if (left <= 0) { this._next(); return; }

      A.rafId = requestAnimationFrame(this._tick.bind(this));
    },

    _togglePause() {
      const A = this._active; if (!A) return;
      if (!A.paused) {
        const now = performance.now();
        const elapsed = now - A.startedAt;
        A.remainingMs = Math.max(0, A.remainingMs - elapsed);
        A.paused = true;
        if (A.rafId) cancelAnimationFrame(A.rafId);
        A.rafId = null;
      } else {
        A.startedAt = performance.now();
        A.paused = false;
        this._tick();
      }
    },

    _skip() {
      if (!this._active) return;
      this._next(true);
    },

    _next() {
      const A = this._active; if (!A) return;
      A.idx += 1;
      if (A.idx >= A.list.length) {
        if (A.nameBox) A.nameBox.textContent = 'All done 🎉';
        this._teardownRoulette(true);
        return;
      }
      A.nameBox.textContent = A.list[A.idx];
      A.remainingMs = A.secs * 1000;
      A.startedAt = performance.now();
      A.paused = false;
      this._tick();
    },

    _teardownRoulette(keepFace = false) {
      const root = this._active ? this._active.root : null;
      if (this._active && this._active.rafId) cancelAnimationFrame(this._active.rafId);

      const controls = root && root.querySelector('.rr-controls');
      const ring     = root && root.querySelector('.rr-progress');
      const nameBox  = root && root.querySelector('.rr-name');

      if (controls) controls.classList.remove('rr-hidden');
      if (ring) ring.classList.add('rr-hidden');
      if (nameBox && !keepFace) nameBox.textContent = '';

      if (this._keyHandler) {
        document.removeEventListener('keydown', this._keyHandler, true);
        this._keyHandler = null;
      }
      this._active = null;
    },

    _parseSeconds(v) {
      if (v == null) return null;
      if (typeof v === 'number' && Number.isFinite(v)) return v > 0 ? v : null;
      if (typeof v === 'string') {
        const n = parseInt(v.trim(), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      return null;
    },

    _getHeaderSeconds(root) {
      // Prefer slide header properties
      const P = this._currentSlideProps || {};
      const tryProps = this._parseSeconds(P.time) ??
                      this._parseSeconds(P.seconds) ??
                      this._parseSeconds(P.secs) ??
                      this._parseSeconds(P.duration);
      if (tryProps) return tryProps;

      // Fallback: check data- attributes on the slide DOM
      if (root) {
        const ds = root.dataset || {};
        const tryDom = this._parseSeconds(ds.rrSeconds) ??
                      this._parseSeconds(ds.seconds) ??
                      this._parseSeconds(ds.time) ??
                      this._parseSeconds(root.getAttribute('data-rr-seconds')) ??
                      this._parseSeconds(root.getAttribute('data-seconds')) ??
                      this._parseSeconds(root.getAttribute('data-time'));
        if (tryDom) return tryDom;
      }
      return null;
    },
  };

  // expose
  window.Roulette = Roulette;
})();
