// remark-roulette v0.3 — reusable roulette for remark decks (overlay UI)
// Usage after remark.create(...):
//   <script src="path/to/roulette.js"></script>
//   <script>Roulette.init(slideshow);</script>
(function () {
  'use strict';

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
        if (root.classList.contains('group-roulette')) this._mountGroupRoulette(root);
      });

      // before hiding a slide, commit config or tear down overlays
      slideshow.on('beforeHideSlide', () => {
        const root = visibleSlideRoot();
        if (!root) return;
        if (root.classList.contains('roulette-config')) this._commitConfig(root);
        if (root.classList.contains('roulette')) this._teardownRoulette();
        if (root.classList.contains('group-roulette')) this._teardownGroupRoulette();
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

    // ----- GROUP ROULETTE SLIDE -----
    _parseIntPos(v) {
      if (v == null) return null;
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
      if (typeof v === 'string') {
        const n = parseInt(v.trim(), 10);
        return (Number.isFinite(n) && n > 0) ? n : null;
      }
      return null;
    },
    _getHeaderGroups(root) {
      const P = this._currentSlideProps || {};
      // Accept groups:, group_count:, groupsCount:
      const fromProps = this._parseIntPos(P.groups) ??
                        this._parseIntPos(P.group_count) ??
                        this._parseIntPos(P.groupsCount);
      if (fromProps) return fromProps;
      // Fallback to data- attributes if you ever want DOM config
      if (root) {
        const ds = root.dataset || {};
        const fromDom = this._parseIntPos(ds.groups) ??
                        this._parseIntPos(ds.groupCount) ??
                        this._parseIntPos(root.getAttribute('data-groups'));
        if (fromDom) return fromDom;
      }
      return null;
    },
    _escape(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    },
    _mountGroupRoulette(root) {
      // --- Top controls (reuse .rr-controls style) ---
      let controls = root.querySelector('.rr-controls');
      if (!controls) {
        controls = document.createElement('div');
        controls.className = 'rr-controls';
        controls.innerHTML = `
          <label>Groups: <input type="number" min="1" step="1" value="4" id="gr-count"></label>
          <span class="rr-sep">|</span>
          <label>Seed: <input type="text" placeholder="optional" id="gr-seed"></label>
          <span class="rr-sep">|</span>
          <button type="button" class="rr-btn" id="gr-go">Group!</button>
        `;
        root.appendChild(controls);
      }

      // Prefill from slide header (optional)
      const countInput = controls.querySelector('#gr-count');
      const headerGroups = this._getHeaderGroups(root);
      if (Number.isFinite(headerGroups) && headerGroups > 0) {
        countInput.value = String(headerGroups);
      }
      const seedInput = controls.querySelector('#gr-seed');
      const P = this._currentSlideProps || {};
      if (seedInput && typeof P.seed === 'string' && P.seed.trim()) {
        seedInput.value = P.seed.trim();
      }

      // --- Groups grid: prefer placing it inside the first .boxed-content ---
      const container = root.querySelector('.boxed-content') || root;
      let grid = container.querySelector('.gr-overlay');
      if (!grid) {
        grid = document.createElement('div');
        // If we’re inside .boxed-content, render the grid in-flow
        grid.className = 'gr-overlay' + (container !== root ? ' in-box' : '');
        container.appendChild(grid);    // append after the last child
      } else {
        grid.innerHTML = '';
      }

      // Click handler to (re)group
      const btn = controls.querySelector('#gr-go');
      const clickHandler = () => this._groupify(root);
      btn.addEventListener('click', clickHandler);

      // Keep references for teardown
      this._grpActive = { root, btn, clickHandler, grid };
    },

    _groupify(root) {
      const attendees = Array.isArray(this.state.attendees) ? this.state.attendees.slice() : [];
      const grid = root.querySelector('.gr-overlay');

      if (!attendees.length) {
        grid.innerHTML = `
          <div class="gr-group">
            <div class="gr-title">No attendees configured</div>
            <div class="gr-empty">Add names on the roster slide (class: roulette-config)</div>
          </div>`;
        return;
      }

      const countInput  = root.querySelector('#gr-count');
      const seedInput   = root.querySelector('#gr-seed');
      let k = this._parseIntPos(countInput && countInput.value) || 4;
      k = Math.max(1, k);

      const seed = (seedInput && seedInput.value || '').trim();
      const shuffled = seededShuffle(attendees, seed ? `GROUPS|${seed}|${k}` : `GROUPS|${Date.now()}`);

      // Partition into k nearly equal groups (first groups get the +1 remainder)
      const n = shuffled.length;
      const base = Math.floor(n / k), extra = n % k;
      const groups = [];
      let idx = 0;
      for (let i = 0; i < k; i++) {
        const size = base + (i < extra ? 1 : 0);
        groups.push(shuffled.slice(idx, idx + size));
        idx += size;
      }

      this._renderGroups(grid, groups);
    },

    _renderGroups(grid, groups) {
      grid.innerHTML = '';
      groups.forEach((names, i) => {
        const card = document.createElement('div');
        card.className = 'gr-group';
        const title = `Group ${i + 1} (${names.length})`;
        if (!names.length) {
          card.innerHTML = `<div class="gr-title">${title}</div><div class="gr-empty">—</div>`;
        } else {
          const lis = names.map(n => `<li>${this._escape(n)}</li>`).join('');
          card.innerHTML = `<div class="gr-title">${title}</div><ul class="gr-list">${lis}</ul>`;
        }
        grid.appendChild(card);
      });
    },

    _teardownGroupRoulette() {
      const A = this._grpActive;
      const root = A ? A.root : null;
      if (A && A.btn && A.clickHandler) {
        try { A.btn.removeEventListener('click', A.clickHandler); } catch(_) {}
      }
      if (root) {
        const grid = root.querySelector('.gr-overlay');
        if (grid) grid.innerHTML = '';
      }
      this._grpActive = null;
    },


  };

  // expose
  window.Roulette = Roulette;
})();
