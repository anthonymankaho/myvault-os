import { clamp } from '../utils';

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private screechNode: AudioBufferSourceNode | null = null;
  private screechFilter: BiquadFilterNode | null = null;
  private screechGain: GainNode | null = null;

  private enabled: boolean;
  private initialized = false;
  private lastCollisionSoundTime = 0;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  public initOnUserGesture(): void {
    if (this.initialized || typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.enabled ? 0.38 : 0.0;
      this.masterGain.connect(this.ctx.destination);

      // Dual-oscillator procedural engine synthesizer
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;

      const engineFilter = this.ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;

      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc1.frequency.value = 55;

      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'triangle';
      this.engineOsc2.frequency.value = 110;

      this.engineOsc1.connect(engineFilter);
      this.engineOsc2.connect(engineFilter);
      engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.engineOsc1.start();
      this.engineOsc2.start();

      // Looping filtered noise for tire screech
      const bufferSize = this.ctx.sampleRate * 1.5;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      this.screechNode = this.ctx.createBufferSource();
      this.screechNode.buffer = noiseBuffer;
      this.screechNode.loop = true;

      this.screechFilter = this.ctx.createBiquadFilter();
      this.screechFilter.type = 'bandpass';
      this.screechFilter.frequency.value = 1350;
      this.screechFilter.Q.value = 4.5;

      this.screechGain = this.ctx.createGain();
      this.screechGain.gain.value = 0.0;

      this.screechNode.connect(this.screechFilter);
      this.screechFilter.connect(this.screechGain);
      this.screechGain.connect(this.masterGain);
      this.screechNode.start();

      this.initialized = true;
    } catch {
      // Ignore Web Audio API restrictions
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(enabled ? 0.38 : 0.0, this.ctx.currentTime, 0.04);
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public updateDrivingSound(
    speed: number,
    maxSpeed: number,
    throttle: number,
    isDrifting: boolean,
    isUsingNitro: boolean,
    active: boolean
  ): void {
    if (!this.initialized || !this.ctx || !this.engineGain || !this.screechGain) return;

    if (this.ctx.state === 'suspended' && this.enabled) {
      this.ctx.resume().catch(() => {});
    }

    const now = this.ctx.currentTime;
    if (!active || !this.enabled) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      this.screechGain.gain.setTargetAtTime(0, now, 0.08);
      return;
    }

    const speedRatio = clamp(Math.abs(speed) / Math.max(1, maxSpeed), 0, 1.3);
    const baseFreq = 50 + speedRatio * 135 + throttle * 25 + (isUsingNitro ? 35 : 0);
    this.engineOsc1?.frequency.setTargetAtTime(baseFreq, now, 0.05);
    this.engineOsc2?.frequency.setTargetAtTime(baseFreq * 1.98, now, 0.05);

    const targetEngineGain = 0.08 + throttle * 0.12 + speedRatio * 0.08;
    this.engineGain.gain.setTargetAtTime(targetEngineGain, now, 0.06);

    const targetScreechGain = isDrifting ? clamp(speedRatio * 0.22, 0.04, 0.2) : 0.0;
    this.screechGain.gain.setTargetAtTime(targetScreechGain, now, 0.05);
  }

  public playCollision(intensity: number): void {
    if (!this.initialized || !this.ctx || !this.masterGain || !this.enabled) return;

    const now = this.ctx.currentTime;
    if (now - this.lastCollisionSoundTime < 0.12) return;
    this.lastCollisionSoundTime = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    const startFreq = clamp(90 + intensity * 4, 90, 210);
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.18);

    const vol = clamp(intensity / 25, 0.08, 0.45);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playCountdownBeep(isGo: boolean): void {
    if (!this.initialized || !this.ctx || !this.masterGain || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(isGo ? 880 : 440, now);

    const duration = isGo ? 0.36 : 0.18;
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playLapComplete(isFinish: boolean): void {
    if (!this.initialized || !this.ctx || !this.masterGain || !this.enabled) return;
    const now = this.ctx.currentTime;
    const notes = isFinish ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25];

    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const start = now + idx * 0.09;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.22, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  }
}
