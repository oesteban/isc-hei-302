// roulette.js v6 — no config slide; optional roster.yml loader
(function () {
  'use strict';

  // ---------- Utils ----------
  const DEFAULT_ROSTER = {
    attendees: [],
    organizers: []
  };

  const uniqSort = (arr) => {
    const seen = new Map();
    for (const s of arr || []) {
      const t = (s || '').trim();
      if (!t) continue;
      const k = t.toLocaleLowerCase();
      if (!seen.has(k)) seen.set(k, t);
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  };

  function parseRosterYAML(text) {
    // Tiny YAML parser for:
    // attendees:
    //   - Name
    // organizers:
    //   - Name
    const out = { attendees: [], organizers: [] };
    let cur = null;
    (text || '').split(/\r?\n/).forEach(line => {
      const raw = line.replace(/#.*$/, ''); // strip comments
      const t = raw.trim();
      if (!t) return;
      const sect = t.match(/^([A-Za-z_]+)\s*:\s*$/);
      if (sect) { cur = sect[1].toLowerCase(); return; }
      const item = t.match(/^-+\s*(.+)$/);
      if (item && (cur === 'attendees' || cur === 'organizers')) out[cur].push(item[1].trim());
    });
    return {
      attendees: uniqSort(out.attendees),
      organizers: uniqSort(out.organizers)
    };
  }

  function seededShuffle(arr, seedStr) {
    // xmur3 + mulberry32
    function xmur3(str) { let h = 1779033703 ^ str.length;
      for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
      return function () { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
    }
    function mulberry32(a) { return function () { let t = a += 0x6D2B79F5; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
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

  function fmtSecs(ms) {
    ms = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(ms / 60), s = ms % 60;
    return m ? `${m}m ${s}s` : `${s}s`;
  }

  // ---------- Module ----------
  const Roulette = {
    _slideshow: null,
    state: { attendees: [], organizers: [] },
    _active: null,
    _keyHandler: null,
    _rosterReady: false,
    _readyCallbacks: [],

    init(slideshow) {
      this._slideshow = slideshow;
      this.state = {
        attendees: uniqSort(DEFAULT_ROSTER.attendees),
        organizers: uniqSort(DEFAULT_ROSTER.organizers)
      };
      this._loadRoster(); // async; overrides defaults if roster.yml exists

      slideshow.on('afterShowSlide', (slide) => {
        const root = visibleSlideRoot();
        if (!root) return;
        if (root.classList.contains('roulette')) this._mountRoulette(root, slide);
        if (root.classList.contains('group-roulette')) this._mountGroup(root, slide);
      });

      slideshow.on('beforeHideSlide', () => {
        const root = visibleSlideRoot();
        if (!root) return;
        if (root.classList.contains('roulette')) this._teardownRoulette();
      });
    },

    // ----- Roster loader -----
    async _loadRoster() {
      try {
        const url = new URL('roster.yml', window.location.href);
        const res = await fetch(url.toString(), { cache: 'no-store' });
        if (!res.ok) throw new Error(`roster.yml ${res.status}`);
        const text = await res.text();
        const parsed = parseRosterYAML(text);
        if (parsed.attendees.length) this.state.attendees = parsed.attendees;
        if (parsed.organizers.length) this.state.organizers = parsed.organizers;
      } catch (_) {
        // keep defaults
      } finally {
        this._rosterReady = true;
        this._readyCallbacks.splice(0).forEach(fn => { try { fn(); } catch {} });
      }
    },
    _onRosterReady(cb) {
      if (this._rosterReady) cb(); else this._readyCallbacks.push(cb);
    },

    _getProps(slide) {
      // remark passes the Slide object to event handlers; properties holds slide params
      return (slide && (slide.properties || slide.getProperties?.())) || {};
    },

    // ----- Roulette (timed speaking order) -----
    _mountRoulette(root, slide) {
      const props = this._getProps(slide);
      const secsDefault = props.time ? Math.max(5, parseInt(props.time, 10) || 60) : 60;
      const includeOrgParam = ('' + (props.include_org ?? '')).toLowerCase() === 'true';
      const seedParam = props.seed || '';

      // Controls (top)
      let controls = root.querySelector('.rr-controls');
      if (!controls) {
        controls = document.createElement('div');
        controls.className = 'rr-controls';
        controls.innerHTML = `
          <label>Seconds: <input type="number" min="5" step="5" value="${secsDefault}" id="rr-seconds"></label>
          <span class="rr-sep">|</span>
          <label>Seed: <input type="text" placeholder="e.g., 302-2025-09-18" value="${seedParam}" id="rr-seed"></label>
          <span class="rr-sep">|</span>
          <label title="Include organizer names first.">
            <input type="checkbox" id="rr-include-org" ${includeOrgParam ? 'checked' : ''}> Include organizers
          </label>
        `;
        root.appendChild(controls);
      } else {
        const secs = controls.querySelector('#rr-seconds');
        if (secs && !props.time) secs.value = secs.value || secsDefault;
        const seed = controls.querySelector('#rr-seed');
        if (seed && !seed.value && seedParam) seed.value = seedParam;
        const inc = controls.querySelector('#rr-include-org');
        if (inc && props.include_org !== undefined) inc.checked = includeOrgParam;
      }

      // Overlay (bottom-left): name + progress ring
      let overlay = root.querySelector('.rr-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'rr-overlay';
        overlay.innerHTML = `
          <div class="rr-progress rr-hidden">
            <svg viewBox="0 0 160 160" aria-hidden="true">
              <circle class="rr-bg" cx="80" cy="80" r="60"></circle>
              <circle class="rr-fg" cx="80" cy="80" r="60"></circle>
            </svg>
            <div class="rr-time">0s</div>
          </div>
          <div class="rr-name" aria-live="polite"></div>
        `;
        root.appendChild(overlay);
      }

      const ring = root.querySelector('.rr-progress');
      const fg = ring.querySelector('.rr-fg');
      const nameBox = root.querySelector('.rr-name');
      const timeLabel = ring.querySelector('.rr-time');

      // Initialize ring stroke
      const r = parseFloat(fg.getAttribute('r')) || 60;
      const circumference = Math.PI * 2 * r;
      fg.setAttribute('stroke-dasharray', `${circumference}`);
      fg.setAttribute('stroke-dashoffset', `${circumference}`);

      // Keyboard controls: Space=start/pause, S=skip, K=kill/end
      this._keyHandler = (ev) => {
        const inEditable = /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName);
        if (!root.classList.contains('roulette')) return;
        if (ev.code === 'Space') {
          ev.preventDefault(); ev.stopPropagation();
          if (!this._active) this._startRoulette(root);
          else this._togglePause();
        } else if (!inEditable && (ev.key === 's' || ev.key === 'S')) {
          ev.preventDefault(); ev.stopPropagation();
          if (this._active) this._skip();
        } else if (!inEditable && (ev.key === 'k' || ev.key === 'K')) {
          ev.preventDefault(); ev.stopPropagation();
          this._teardownRoulette(); // allow next slide
        }
      };
      document.addEventListener('keydown', this._keyHandler, true);

      // If roster still loading, show a friendly placeholder
      if (!this._rosterReady && !this._active) {
        nameBox.textContent = 'Loading roster…';
        this._onRosterReady(() => {
          if (!this._active && root.classList.contains('roulette')) nameBox.textContent = '';
        });
      } else {
        // reset view
        nameBox.textContent = '';
      }

      // Keep controls visible, ring hidden until start
      controls.classList.remove('rr-hidden');
      ring.classList.add('rr-hidden');
    },

    _buildRunOrder(seed, includeOrg) {
      const p = this.state.attendees.slice();
      const o = this.state.organizers.slice();
      const pp = seededShuffle(p, seed + '|P');
      const oo = seededShuffle(o, seed + '|O');
      return includeOrg ? oo.concat(pp) : pp;
    },

    _startRoulette(root) {
      const secsInput  = root.querySelector('#rr-seconds');
      const seedInput  = root.querySelector('#rr-seed');
      const includeOrg = root.querySelector('#rr-include-org')?.checked;

      const secs = Math.max(5, parseInt(secsInput.value || '60', 10));
      const seed = (seedInput.value || '').trim();

      const list = this._buildRunOrder(seed, includeOrg);

      const controls = root.querySelector('.rr-controls');
      const ring     = root.querySelector('.rr-progress');
      const fg       = ring.querySelector('.rr-fg');
      const nameBox  = root.querySelector('.rr-name');
      const timeLbl  = ring.querySelector('.rr-time');

      if (!list.length) { nameBox.textContent = 'No names configured'; return; }

      controls.classList.add('rr-hidden');
      ring.classList.remove('rr-hidden');

      const r = parseFloat(fg.getAttribute('r')) || 60;
      const circumference = Math.PI * 2 * r;

      this._active = {
        root, list, secs,
        idx: 0,
        paused: false,
        remainingMs: secs * 1000,
        startedAt: performance.now(),
        rafId: null,
        circumference,
        fg, timeLbl, nameBox
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

      const ratio = left / (A.secs * 1000);
      const offset = A.circumference * ratio;
      A.fg.setAttribute('stroke-dashoffset', offset.toFixed(1));
      A.timeLbl.textContent = fmtSecs(left);

      if (left <= 0) { this._next(); return; }
      A.rafId = requestAnimationFrame(this._tick.bind(this));
    },

    _togglePause() {
      const A = this._active; if (!A) return;
      if (!A.paused) {
        const elapsed = performance.now() - A.startedAt;
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
        A.nameBox.textContent = 'All done 🎉';
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
      const root = this._active ? this._active.root : visibleSlideRoot();
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

    // ----- Group roulette (teams) -----
    _parseIntPos(v) {
      if (v == null) return null;
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
      if (typeof v === 'string') {
        const n = parseInt(v.trim(), 10);
        return (Number.isFinite(n) && n > 0) ? n : null;
      }
      return null;
    },

    _escape(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    },

    _mountGroup(root, slide) {
      const props = this._getProps(slide);
      const groupsDefault = props.groups ? Math.max(2, parseInt(props.groups, 10) || 4) : 4;
      const seedParam = props.seed || '';

      // Controls
      let controls = root.querySelector('.rr-controls');
      if (!controls) {
        controls = document.createElement('div');
        controls.className = 'rr-controls';
        controls.innerHTML = `
          <label>Groups: <input type="number" min="2" max="12" step="1" value="${groupsDefault}" id="gr-num"></label>
          <span class="rr-sep">|</span>
          <label>Seed: <input type="text" placeholder="e.g., grp-302" value="${seedParam}" id="gr-seed"></label>
          <button type="button" id="gr-go" class="rr-btn" title="Create groups">Group!</button>
        `;
        root.appendChild(controls);
      }

      // Overlay goes inside .boxed-content if present
      let container = root.querySelector('.boxed-content') || root;
      let overlay = container.querySelector('.gr-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'gr-overlay';
        container.appendChild(overlay);
      } else {
        overlay.innerHTML = '';
      }

      // Click handler to (re)group
      const btn = controls.querySelector('#gr-go');
      const clickHandler = () => this._groupify(root);
      btn.addEventListener('click', clickHandler);

      // Keep references for teardown
      this._grpActive = { root, btn, clickHandler, overlay };
    },

    _groupify(root) {
      const attendees = Array.isArray(this.state.attendees) ? this.state.attendees.slice() : [];
      const overlay = root.querySelector('.gr-overlay');

      if (!attendees.length) {
        overlay.innerHTML = `
          <div class="gr-group">
            <div class="gr-title">No attendees configured</div>
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

      this._renderGroups(overlay, groups);
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

    _teardownGroup() {
      const root = visibleSlideRoot();
      if (!root) return;
      const overlay = root.querySelector('.gr-overlay');
      if (overlay) overlay.innerHTML = '';
      const controls = root.querySelector('.rr-controls');
      if (controls) { /* keep controls */ }
    }
  };

  window.Roulette = Roulette;
})();
