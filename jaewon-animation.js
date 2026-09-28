/* Original PNGs are composed at their original 1650 x 2000 coordinates. */
(function (global) {
  'use strict';

  const ASSETS = {
    body: ['000.png'], eyes: ['000_1.png', '000_2.png'],
    hair: ['001_1.png', '001_2.png'], mouth: ['002_1.png', '002_2.png'],
    leftHand: ['003_1.png', '003_2.png'], rightHand: ['003_1.png', '003_2.png']
  };
  const PROFILES = {
    calm: { interval: 1.35, amplitude: 0.65 },
    natural: { interval: 1, amplitude: 1 },
    lively: { interval: 0.75, amplitude: 1.2 }
  };
  const INTERVALS = {
    eyes: [3600, 6800], hair: [4400, 8800], mouth: [6200, 11500],
    leftHand: [5200, 10500], rightHand: [6200, 12800]
  };
  const PARTS = Object.keys(INTERVALS);
  const DEFAULT_BASE = typeof document !== 'undefined'
    ? new URL('.', document.currentScript ? document.currentScript.src : location.href).href : '';
  let instanceNumber = 0;

  class MotionModel {
    constructor(options = {}) {
      this.random = options.random || Math.random;
      this.profile = PROFILES[options.motion] ? options.motion : 'natural';
      this.time = 0;
      this.breathPhase = 0;
      this.breathPeriod = this.range(4700, 6200);
      this.breathAmplitude = this.range(0.003, 0.0045);
      this.channels = {};
      PARTS.forEach((name, index) => {
        this.channels[name] = {
          frame: 0, queue: [],
          nextAt: name === 'eyes' ? this.range(1100, 2300) : this.range(1900 + index * 520, 3600 + index * 750)
        };
      });
    }

    range(min, max) { return min + (max - min) * (this.random() + this.random()) / 2; }
    setMotion(name) {
      if (!PROFILES[name]) throw new Error('Unknown motion profile: ' + name);
      this.profile = name;
    }
    nextDelay(name) {
      return this.range(...INTERVALS[name]) * PROFILES[this.profile].interval;
    }
    plan(name) {
      if (name === 'eyes') {
        const shut = this.range(105, 150);
        const sequence = [{ offset: 0, frame: 1 }, { offset: shut, frame: 0 }];
        if (this.random() < 0.09) {
          const second = shut + this.range(140, 240);
          sequence.push({ offset: second, frame: 1 }, { offset: second + this.range(95, 135), frame: 0 });
        }
        return sequence;
      }
      if (name === 'hair') {
        const flutter = this.range(240, 400);
        const sequence = [{ offset: 0, frame: 1 }, { offset: flutter, frame: 0 }];
        if (this.random() < 0.18) {
          const second = flutter + this.range(280, 460);
          sequence.push({ offset: second, frame: 1 }, { offset: second + this.range(180, 260), frame: 0 });
        }
        return sequence;
      }
      if (name === 'mouth') return [{ offset: 0, frame: 1 }, { offset: this.range(1800, 3600), frame: 0 }];
      return [{ offset: 0, frame: 1 }, { offset: this.range(580, 1100), frame: 0 }];
    }
    schedule(name, sequence, delay = 0) {
      const channel = this.channels[name];
      channel.queue = sequence.map(item => ({ at: this.time + delay + item.offset, frame: item.frame }));
      channel.nextAt = Infinity;
    }
    react() {
      this.schedule('mouth', [{ offset: 0, frame: 1 }, { offset: 2600, frame: 0 }]);
      this.schedule('leftHand', [{ offset: 0, frame: 1 }, { offset: 680, frame: 0 }], 150);
      this.schedule('rightHand', [{ offset: 0, frame: 1 }, { offset: 750, frame: 0 }], 480);
      this.schedule('eyes', this.plan('eyes'), 700);
    }
    tick(delta) {
      if (!Number.isFinite(delta) || delta < 0) throw new Error('delta must be a nonnegative number');
      this.time += delta;
      this.breathPhase += delta / this.breathPeriod * Math.PI * 2;
      if (this.breathPhase >= Math.PI * 2) {
        this.breathPhase %= Math.PI * 2;
        this.breathPeriod = this.range(4700, 6200);
        // A new cycle starts at zero displacement, so changing the amplitude does not jump.
        this.breathAmplitude = this.range(0.003, 0.0045);
      }
      PARTS.forEach(name => {
        const channel = this.channels[name];
        if (!channel.queue.length && this.time >= channel.nextAt) this.schedule(name, this.plan(name));
        let advanced = false;
        while (channel.queue.length && channel.queue[0].at <= this.time) {
          channel.frame = channel.queue.shift().frame;
          advanced = true;
        }
        if (advanced && !channel.queue.length) channel.nextAt = this.time + this.nextDelay(name);
      });
      return this.snapshot();
    }
    snapshot() {
      const amplitude = PROFILES[this.profile].amplitude;
      return {
        time: this.time,
        frames: Object.fromEntries(PARTS.map(name => [name, this.channels[name].frame])),
        scaleY: 1 - (1 - Math.cos(this.breathPhase)) / 2 * this.breathAmplitude * amplitude,
        rotation: Math.sin(this.time / 5800) * 0.12 * amplitude + Math.sin(this.time / 9700) * 0.045 * amplitude
      };
    }
  }

  class JaewonAnimation {
    constructor(target, options = {}) {
      this.host = typeof target === 'string' ? document.querySelector(target) : target;
      if (!this.host) throw new Error('Character container not found');
      this.assetBase = new URL(options.assetBase || DEFAULT_BASE, document.baseURI).href;
      this.model = new MotionModel(options);
      this.userPaused = false;
      this.motionOptIn = false;
      this.destroyed = false;
      this.loaded = false;
      this.raf = null;
      this.lastTime = null;
      this.media = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.respectReducedMotion = options.respectReducedMotion !== false;
      this.layers = {};
      this.id = 'jaewon-' + (++instanceNumber);
      this.build();
      this.onVisibility = () => this.syncPlayback();
      this.onMotionPreference = () => this.syncPlayback();
      document.addEventListener('visibilitychange', this.onVisibility);
      if (this.media.addEventListener) this.media.addEventListener('change', this.onMotionPreference);
      this.ready = this.preload().then(() => {
        if (this.destroyed) return this;
        this.loaded = true;
        this.host.classList.add('is-ready');
        this.host.removeAttribute('aria-busy');
        this.render(this.model.snapshot());
        this.syncPlayback();
        return this;
      }).catch(error => {
        if (!this.destroyed) {
          this.host.removeAttribute('aria-busy');
          this.host.dispatchEvent(new CustomEvent('charactererror', { detail: error }));
        }
        throw error;
      });
    }

    make(tag, attrs = {}, parent) {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
      if (parent) parent.appendChild(element);
      return element;
    }
    build() {
      this.host.classList.add('jaewon-character');
      this.host.setAttribute('aria-busy', 'true');
      this.svg = this.make('svg', {
        viewBox: '350 405 740 1310', role: 'img', 'aria-label': '천천히 숨 쉬며 눈을 깜빡이는 재원',
        'data-character': 'jaewon', preserveAspectRatio: 'xMidYMid meet'
      }, this.host);
      const defs = this.make('defs', {}, this.svg);
      const left = this.make('clipPath', { id: this.id + '-left', clipPathUnits: 'userSpaceOnUse' }, defs);
      const right = this.make('clipPath', { id: this.id + '-right', clipPathUnits: 'userSpaceOnUse' }, defs);
      this.make('rect', { x: 0, y: 0, width: 800, height: 2000 }, left);
      this.make('rect', { x: 800, y: 0, width: 850, height: 2000 }, right);
      this.bodyGroup = this.make('g', { 'data-breathing': '' }, this.svg);
      // Hands sit behind the sleeves so switching finger poses never reveals the wrist join.
      ['leftHand', 'rightHand', 'body', 'eyes', 'mouth', 'hair'].forEach(name => {
        const attributes = { 'data-part': name };
        if (name === 'leftHand') attributes['clip-path'] = 'url(#' + this.id + '-left)';
        if (name === 'rightHand') attributes['clip-path'] = 'url(#' + this.id + '-right)';
        const group = this.make('g', attributes, this.bodyGroup);
        this.layers[name] = ASSETS[name].map((file, index) => {
          const img = this.make('image', {
            href: new URL(file, this.assetBase).href, x: 0, y: 0, width: 1650, height: 2000,
            'data-frame': index + 1, visibility: index === 0 ? 'visible' : 'hidden'
          }, group);
          return img;
        });
      });
    }
    preload() {
      const names = [...new Set(Object.values(ASSETS).flat())];
      return Promise.all(names.map(file => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(file + ' 이미지를 불러오지 못했어요.'));
        img.src = new URL(file, this.assetBase).href;
      })));
    }
    get playing() {
      return this.loaded && !this.destroyed && !this.userPaused && !document.hidden &&
        !(this.respectReducedMotion && this.media.matches && !this.motionOptIn);
    }
    syncPlayback() {
      if (this.destroyed) return;
      if (this.playing && this.raf === null) {
        this.lastTime = null;
        this.raf = requestAnimationFrame(time => this.loop(time));
      } else if (!this.playing && this.raf !== null) {
        cancelAnimationFrame(this.raf);
        this.raf = null;
        this.lastTime = null;
      }
      this.host.dataset.playing = String(this.playing);
      this.host.dispatchEvent(new CustomEvent('characterplaybackchange', {
        detail: { playing: this.playing, pausedByUser: this.userPaused, motion: this.model.profile }
      }));
    }
    loop(time) {
      this.raf = null;
      if (!this.playing) return;
      // Freeze time while hidden; never replay a backlog of blinks after returning.
      const delta = this.lastTime === null ? 0 : Math.max(0, Math.min(64, time - this.lastTime));
      this.lastTime = time;
      this.render(this.model.tick(delta));
      this.raf = requestAnimationFrame(next => this.loop(next));
    }
    render(state) {
      PARTS.forEach(name => {
        this.layers[name].forEach((img, index) => {
          const visibility = index === state.frames[name] ? 'visible' : 'hidden';
          if (img.getAttribute('visibility') !== visibility) img.setAttribute('visibility', visibility);
        });
      });
      // One shared transform keeps the glasses, eyes, mouth and sleeves registered to the body.
      this.bodyGroup.setAttribute('transform',
        'translate(775 1655) rotate(' + state.rotation.toFixed(4) + ') scale(1 ' + state.scaleY.toFixed(6) + ') translate(-775 -1655)');
    }
    play() { this.userPaused = false; this.motionOptIn = true; this.syncPlayback(); }
    pause() { this.userPaused = true; this.syncPlayback(); }
    setMotion(name) { this.model.setMotion(name); this.syncPlayback(); }
    react() { if (!this.loaded || this.destroyed) return; this.model.react(); }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      document.removeEventListener('visibilitychange', this.onVisibility);
      if (this.media.removeEventListener) this.media.removeEventListener('change', this.onMotionPreference);
      this.svg.remove();
      this.host.classList.remove('jaewon-character', 'is-ready');
      this.host.removeAttribute('aria-busy');
      delete this.host.dataset.playing;
    }
  }

  global.JaewonAnimation = JaewonAnimation;
  if (typeof module !== 'undefined' && module.exports) module.exports = { MotionModel, ASSETS };
})(typeof window !== 'undefined' ? window : globalThis);
