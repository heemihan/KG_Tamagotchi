(function (global) {
  'use strict';

  const DEFAULT_BASE = typeof document !== 'undefined'
    ? new URL('.', document.currentScript ? document.currentScript.src : document.baseURI) : null;
  const POSES = Object.freeze({ normal: '평범_느리게.gif', eating: '식사.gif', showering: '샤워.gif' });
  // One cycle is 13 × 90 ms + 100 ms = 1270 ms; four cycles end at 5080 ms.
  const EATING_DURATION = 5080;
  const SHOWER_DURATION = 5080;

  class JaewonGif {
    constructor(target, options = {}) {
      this.host = typeof target === 'string' ? document.querySelector(target) : target;
      if (!this.host) throw new Error('재원 캐릭터를 표시할 영역이 없습니다.');
      this.assetBase = new URL(options.assetBase || DEFAULT_BASE, document.baseURI);
      this.pose = null;
      this.returnTimer = null;
      this.image = document.createElement('img');
      this.image.className = 'jaewon-gif-image';
      this.image.alt = '평소 모습의 재원';
      this.image.width = 462;
      this.image.height = 560;
      this.image.draggable = false;
      this.host.classList.add('jaewon-gif');
      this.host.appendChild(this.image);
      this.setPose('normal');
      // Load action GIFs early so the first tap starts without a network wait.
      this.preloadedActions = ['eating', 'showering'].map(pose => {
        const image = new Image();
        image.src = new URL(POSES[pose], this.assetBase).href;
        return image;
      });
    }

    setPose(pose) {
      if (!Object.hasOwn(POSES, pose)) throw new Error('알 수 없는 재원 포즈: ' + pose);
      clearTimeout(this.returnTimer);
      this.returnTimer = null;
      if (this.pose === pose) return;
      this.pose = pose;
      this.image.src = new URL(POSES[pose], this.assetBase).href;
      this.image.alt = pose === 'eating' ? '식사하는 재원'
        : pose === 'showering' ? '샤워하는 재원' : '평소 모습의 재원';
      this.host.dataset.pose = pose;
      this.host.dispatchEvent(new CustomEvent('jaewonposechange', { detail: { pose } }));
    }

    playTimedPose(pose, duration) {
      if (this.pose === pose) return;
      this.setPose(pose);
      this.returnTimer = setTimeout(() => this.setPose('normal'), duration);
    }

    eat() { this.playTimedPose('eating', EATING_DURATION); }
    shower() { this.playTimedPose('showering', SHOWER_DURATION); }

    eatOnce() { this.eat(); } // Keep older game integrations working.

    destroy() {
      clearTimeout(this.returnTimer);
      this.image.remove();
      this.host.classList.remove('jaewon-gif');
      delete this.host.dataset.pose;
    }
  }

  global.JaewonGif = JaewonGif;
  if (typeof module !== 'undefined' && module.exports) module.exports = { JaewonGif, POSES, EATING_DURATION, SHOWER_DURATION };
})(typeof window !== 'undefined' ? window : globalThis);
