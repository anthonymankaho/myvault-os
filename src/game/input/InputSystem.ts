import { CarControls } from '../vehicles/Car';

export class InputSystem {
  private keys = new Set<string>();
  private touchState = {
    left: false,
    right: false,
    gas: false,
    brake: false,
    nitro: false,
    drift: false,
  };

  private resetCallbacks: Array<() => void> = [];
  private pauseCallbacks: Array<() => void> = [];
  private interactionCallbacks: Array<() => void> = [];
  public readonly isTouchDevice: boolean;

  constructor() {
    this.isTouchDevice =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', this.onBlur);
    }
  }

  private fireInteraction(): void {
    for (const cb of this.interactionCallbacks) {
      cb();
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.fireInteraction();
    const code = e.code;

    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      e.preventDefault();
    }

    if (code === 'KeyR' && !e.repeat) {
      for (const cb of this.resetCallbacks) cb();
    }

    if (code === 'Escape' && !e.repeat) {
      for (const cb of this.pauseCallbacks) cb();
    }

    this.keys.add(code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.touchState.left = false;
    this.touchState.right = false;
    this.touchState.gas = false;
    this.touchState.brake = false;
    this.touchState.nitro = false;
    this.touchState.drift = false;
  };

  public bindTouchControls(container: HTMLElement): void {
    const bindBtn = (selector: string, key: keyof typeof this.touchState) => {
      const el = container.querySelector<HTMLElement>(selector);
      if (!el) return;

      const setActive = (active: boolean, ev: Event) => {
        ev.preventDefault();
        this.fireInteraction();
        this.touchState[key] = active;
        el.classList.toggle('active', active);
      };

      el.addEventListener('pointerdown', (e) => setActive(true, e));
      el.addEventListener('pointerup', (e) => setActive(false, e));
      el.addEventListener('pointerleave', (e) => setActive(false, e));
      el.addEventListener('pointercancel', (e) => setActive(false, e));
    };

    bindBtn('[data-touch="left"]', 'left');
    bindBtn('[data-touch="right"]', 'right');
    bindBtn('[data-touch="gas"]', 'gas');
    bindBtn('[data-touch="brake"]', 'brake');
    bindBtn('[data-touch="nitro"]', 'nitro');
    bindBtn('[data-touch="drift"]', 'drift');
  }

  public onReset(cb: () => void): void {
    this.resetCallbacks.push(cb);
  }

  public onPause(cb: () => void): void {
    this.pauseCallbacks.push(cb);
  }

  public onUserInteraction(cb: () => void): void {
    this.interactionCallbacks.push(cb);
  }

  public getControls(): CarControls {
    const accel =
      this.keys.has('KeyW') ||
      this.keys.has('ArrowUp') ||
      this.touchState.gas;
    const brake =
      this.keys.has('KeyS') ||
      this.keys.has('ArrowDown') ||
      this.touchState.brake;
    const left =
      this.keys.has('KeyA') ||
      this.keys.has('ArrowLeft') ||
      this.touchState.left;
    const right =
      this.keys.has('KeyD') ||
      this.keys.has('ArrowRight') ||
      this.touchState.right;
    const handbrake = this.keys.has('Space') || this.touchState.drift;
    const nitro =
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      this.touchState.nitro;

    let steer = 0;
    if (left) steer -= 1;
    if (right) steer += 1;

    return {
      throttle: accel ? 1 : 0,
      brake: brake ? 1 : 0,
      steer,
      handbrake,
      nitro,
    };
  }
}
