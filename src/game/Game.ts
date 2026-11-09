import * as THREE from 'three';
import { AIDriver } from './ai/AIDriver';
import { AudioSystem } from './audio/AudioSystem';
import { EffectsSystem } from './effects/EffectsSystem';
import { InputSystem } from './input/InputSystem';
import { RaceState } from './logic/RaceState';
import {
  GameSettings,
  QualityLevel,
  loadBestLap,
  loadSettings,
  saveBestLap,
  saveSettings,
} from './settings';
import { Track } from './track/Track';
import { UIManager } from './ui/UIManager';
import { clamp, lerp } from './utils';
import { Car } from './vehicles/Car';

const FIXED_STEP = 1 / 60;
const TOTAL_LAPS = 3;

export class Game {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sunLight: THREE.DirectionalLight;

  private readonly track: Track;
  private readonly raceState: RaceState;
  private readonly input: InputSystem;
  private readonly audio: AudioSystem;
  private readonly effects: EffectsSystem;
  private readonly ui: UIManager;

  private settings: GameSettings;
  private playerCar!: Car;
  private aiDrivers: AIDriver[] = [];
  private allCars: Car[] = [];
  private racerNames = new Map<number, string>();

  private cameraPosition = new THREE.Vector3();
  private cameraLookTarget = new THREE.Vector3();

  private lastTimestamp = 0;
  private accumulator = 0;
  private goBannerTimer = 0;
  private lastCountdownNumber = 0;
  private resultsShown = false;

  // Runtime FPS quality adaptation
  private fpsFrameCount = 0;
  private fpsElapsed = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.settings = loadSettings();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8ecae6);
    this.scene.fog = new THREE.FogExp2(0x8ecae6, 0.0028);

    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.2,
      700
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: this.settings.quality !== 'low' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.container.appendChild(this.renderer.domElement);

    // Lighting
    const hemiLight = new THREE.HemisphereLight(0xd8f3dc, 0x2d6a4f, 0.75);
    this.scene.add(hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff8e7, 1.35);
    this.sunLight.position.set(110, 150, 80);
    this.sunLight.shadow.camera.left = -220;
    this.sunLight.shadow.camera.right = 220;
    this.sunLight.shadow.camera.top = 220;
    this.sunLight.shadow.camera.bottom = -220;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 420;
    this.scene.add(this.sunLight);

    // Track & Effects
    this.track = new Track();
    this.scene.add(this.track.group);

    this.effects = new EffectsSystem(this.settings.quality);
    this.scene.add(this.effects.group);

    this.applyQuality(this.settings.quality);

    // Cars & AI
    this.createRacers();

    // RaceState
    const savedBest = loadBestLap();
    this.raceState = new RaceState(TOTAL_LAPS, this.track.checkpointCount, savedBest);
    this.raceState.reset(this.allCars.map((c) => c.id));

    // Input, Audio, UI
    this.input = new InputSystem();
    this.audio = new AudioSystem(this.settings.soundEnabled);

    this.ui = new UIManager(
      {
        onStartRace: () => this.startNewRace(),
        onResumeRace: () => this.togglePause(),
        onRestartRace: () => this.startNewRace(),
        onToggleSound: () => this.toggleSound(),
        onResetCar: () => this.resetPlayerToTrack(),
      },
      this.input.isTouchDevice
    );

    this.ui.setSoundEnabled(this.settings.soundEnabled);
    this.input.bindTouchControls(this.ui.getTouchControlsElement());

    this.input.onUserInteraction(() => {
      this.audio.initOnUserGesture();
    });

    this.input.onReset(() => {
      this.resetPlayerToTrack();
    });

    this.input.onPause(() => {
      if (this.raceState.phase === 'countdown' || this.raceState.phase === 'racing') {
        this.togglePause();
      }
    });

    this.placeCarsOnGrid();
    this.snapCameraImmediate();
    this.ui.showStartScreen();

    window.addEventListener('resize', this.onResize);
  }

  private createRacers(): void {
    this.playerCar = new Car({
      id: 0,
      name: 'YOU (APEX-01)',
      color: 0xff0055,
      maxSpeed: 54,
      accelForce: 36,
    });
    this.racerNames.set(0, this.playerCar.name);
    this.scene.add(this.playerCar.mesh);

    const aiConfigs = [
      {
        id: 1,
        name: 'BLAZE (AI)',
        color: 0x00bbf9,
        maxSpeed: 53.5,
        accelForce: 34.5,
        skillFactor: 0.99,
        preferredLaneOffset: -2.6,
        nitroAggression: 0.65,
      },
      {
        id: 2,
        name: 'VORTEX (AI)',
        color: 0xfee440,
        maxSpeed: 51.8,
        accelForce: 33.5,
        skillFactor: 0.95,
        preferredLaneOffset: 2.5,
        nitroAggression: 0.45,
      },
      {
        id: 3,
        name: 'COBRA (AI)',
        color: 0x00f5d4,
        maxSpeed: 50.0,
        accelForce: 32.0,
        skillFactor: 0.91,
        preferredLaneOffset: 0.0,
        nitroAggression: 0.3,
      },
    ];

    this.allCars = [this.playerCar];
    this.aiDrivers = [];

    for (const cfg of aiConfigs) {
      const car = new Car({
        id: cfg.id,
        name: cfg.name,
        color: cfg.color,
        maxSpeed: cfg.maxSpeed,
        accelForce: cfg.accelForce,
      });
      this.racerNames.set(cfg.id, cfg.name);
      this.scene.add(car.mesh);
      this.allCars.push(car);

      this.aiDrivers.push(
        new AIDriver(car, {
          skillFactor: cfg.skillFactor,
          preferredLaneOffset: cfg.preferredLaneOffset,
          nitroAggression: cfg.nitroAggression,
        })
      );
    }
  }

  private placeCarsOnGrid(): void {
    // Player starts in slot 3 (back right) or slot 0; let's place AI in 0,1,2 and player in 3 for exciting overtakes
    const gridOrder = [this.allCars[1], this.allCars[2], this.allCars[3], this.playerCar];
    gridOrder.forEach((car, slotIdx) => {
      const transform = this.track.getStartTransform(slotIdx);
      car.nitro = 100;
      car.setTransform(transform.position, transform.heading, this.track);
    });

    for (const ai of this.aiDrivers) {
      ai.reset();
    }
  }

  public startNewRace(): void {
    this.audio.initOnUserGesture();
    this.effects.reset();
    this.placeCarsOnGrid();
    this.snapCameraImmediate();

    this.raceState.reset(this.allCars.map((c) => c.id));
    this.raceState.startCountdown(3);
    this.lastCountdownNumber = 4;
    this.goBannerTimer = 0;
    this.resultsShown = false;

    this.ui.showRacingHUD();
    this.ui.setPauseMenuVisible(false);
    this.ui.updateCountdownText('3');
  }

  private togglePause(): void {
    if (this.raceState.phase !== 'countdown' && this.raceState.phase !== 'racing') {
      return;
    }
    const paused = this.raceState.togglePause();
    this.ui.setPauseMenuVisible(paused);
    if (paused) {
      this.audio.updateDrivingSound(0, 50, 0, false, false, false);
    }
  }

  private toggleSound(): void {
    this.audio.initOnUserGesture();
    this.settings.soundEnabled = !this.settings.soundEnabled;
    this.audio.setEnabled(this.settings.soundEnabled);
    this.ui.setSoundEnabled(this.settings.soundEnabled);
    saveSettings(this.settings);
  }

  private resetPlayerToTrack(): void {
    if (
      (this.raceState.phase === 'racing' || this.raceState.phase === 'countdown') &&
      !this.raceState.paused
    ) {
      this.playerCar.resetToTrack(this.track);
    }
  }

  private applyQuality(quality: QualityLevel): void {
    this.settings.quality = quality;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    if (quality === 'low') {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      this.sunLight.castShadow = false;
    } else if (quality === 'medium') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.5));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(1024, 1024);
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(2048, 2048);
    }

    this.effects.setQuality(quality);
  }

  private adaptQualityRuntime(dt: number): void {
    this.fpsFrameCount++;
    this.fpsElapsed += dt;
    if (this.fpsElapsed >= 3.0) {
      const fps = this.fpsFrameCount / this.fpsElapsed;
      this.fpsFrameCount = 0;
      this.fpsElapsed = 0;

      if (fps < 36 && this.settings.quality === 'high') {
        this.applyQuality('medium');
      } else if (fps < 28 && this.settings.quality === 'medium') {
        this.applyQuality('low');
      }
    }
  }

  private fixedUpdate(dt: number): void {
    const prevPhase = this.raceState.phase;
    this.raceState.update(dt);

    if (this.raceState.paused) {
      return;
    }

    // Countdown beep and banner updates
    if (this.raceState.phase === 'countdown') {
      const ceilSec = Math.ceil(this.raceState.countdownTimer);
      if (ceilSec !== this.lastCountdownNumber && ceilSec >= 1 && ceilSec <= 3) {
        this.lastCountdownNumber = ceilSec;
        this.ui.updateCountdownText(String(ceilSec));
        this.audio.playCountdownBeep(false);
      }
    } else if (prevPhase === 'countdown' && this.raceState.phase === 'racing') {
      this.goBannerTimer = 1.1;
      this.ui.updateCountdownText('GO!');
      this.audio.playCountdownBeep(true);
    }

    if (this.goBannerTimer > 0) {
      this.goBannerTimer -= dt;
      if (this.goBannerTimer <= 0 && this.raceState.phase === 'racing') {
        this.ui.updateCountdownText(null);
      }
    }

    const canDrive = this.raceState.phase === 'racing';

    // Update Player Car
    const playerControls = this.input.getControls();
    const playerProj = this.playerCar.updatePhysics(dt, playerControls, this.track, canDrive);
    const playerWallHit = this.playerCar.resolveBarrierCollision(this.track, playerProj);
    if (playerWallHit > 3.5) {
      this.audio.playCollision(playerWallHit);
      this.effects.triggerCollisionFeedback(this.playerCar.position, playerWallHit);
    }

    // Update AI Cars
    for (const ai of this.aiDrivers) {
      const aiRec = this.raceState.getRacer(ai.car.id);
      const aiControls =
        canDrive && !aiRec?.finished
          ? ai.update(dt, this.track, this.allCars)
          : { throttle: 0, brake: 0.6, steer: 0, handbrake: false, nitro: false };

      const aiProj = ai.car.updatePhysics(dt, aiControls, this.track, canDrive);
      ai.car.resolveBarrierCollision(this.track, aiProj);
    }

    // Car-to-Car Collisions
    for (let i = 0; i < this.allCars.length; i++) {
      for (let j = i + 1; j < this.allCars.length; j++) {
        const impact = Car.resolveCarCollision(this.allCars[i], this.allCars[j]);
        if (impact > 2.5 && (i === 0 || j === 0)) {
          this.audio.playCollision(impact);
          this.effects.triggerCollisionFeedback(this.playerCar.position, impact);
        }
      }
    }

    // Checkpoint trigger checks
    if (this.raceState.phase === 'racing') {
      for (const car of this.allCars) {
        const rec = this.raceState.getRacer(car.id);
        if (!rec || rec.finished) continue;

        const triggered = this.track.checkCheckpointTrigger(
          car.prevPosition,
          car.position,
          rec.nextCheckpoint
        );

        if (triggered) {
          const wasLapFinish = rec.nextCheckpoint === 0;
          const passed = this.raceState.passCheckpoint(car.id, rec.nextCheckpoint);
          if (passed && wasLapFinish && car.id === 0) {
            const updatedPlayer = this.raceState.getRacer(0);
            if (updatedPlayer?.bestLapTime) {
              saveBestLap(updatedPlayer.bestLapTime);
            }
            this.audio.playLapComplete(Boolean(updatedPlayer?.finished));
          }
        }
      }
    }

    // Effects & Audio
    this.effects.emitFromCars(dt, this.allCars);
    this.effects.update(dt);

    const isDrivingAudioActive =
      this.raceState.phase === 'racing' && !this.raceState.paused;
    this.audio.updateDrivingSound(
      this.playerCar.getSpeed(),
      this.playerCar.maxSpeed,
      playerControls.throttle,
      this.playerCar.isDrifting,
      this.playerCar.isUsingNitro,
      isDrivingAudioActive
    );

    this.updateChaseCamera(dt);
  }

  private computeProgressMap(): Map<number, number> {
    const map = new Map<number, number>();
    for (const car of this.allCars) {
      const rec = this.raceState.getRacer(car.id);
      const laps = rec ? rec.completedLaps : 0;
      const nextCp = rec ? rec.nextCheckpoint : 1;

      // Combine completed laps, checkpoint milestone, and distance along track for monotonic progress
      const cpMilestone = nextCp === 0 ? this.track.checkpointCount : nextCp;
      const progress =
        laps * this.track.totalLength +
        cpMilestone * (this.track.totalLength / this.track.checkpointCount) * 0.15 +
        car.distanceAlongTrack * 0.85;
      map.set(car.id, progress);
    }
    return map;
  }

  private snapCameraImmediate(): void {
    const fwd = this.playerCar.getForwardVector();
    this.cameraPosition
      .copy(this.playerCar.position)
      .addScaledVector(fwd, -9.5)
      .add(new THREE.Vector3(0, 4.4, 0));

    this.cameraLookTarget
      .copy(this.playerCar.position)
      .addScaledVector(fwd, 5.5)
      .add(new THREE.Vector3(0, 1.1, 0));

    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraLookTarget);
  }

  private updateChaseCamera(dt: number): void {
    const speed = this.playerCar.getSpeed();
    const speedRatio = clamp(speed / this.playerCar.maxSpeed, 0, 1.3);

    const fwd = this.playerCar.getForwardVector();
    const followDistance = 8.6 + speedRatio * 2.8 + (this.playerCar.isUsingNitro ? 1.1 : 0);
    const followHeight = 4.0 + speedRatio * 0.9;

    const desiredPos = this.playerCar.position
      .clone()
      .addScaledVector(fwd, -followDistance);
    desiredPos.y += followHeight;

    const desiredTarget = this.playerCar.position
      .clone()
      .addScaledVector(fwd, 6.0);
    desiredTarget.y += 1.2;

    this.cameraPosition.lerp(desiredPos, clamp(7.5 * dt, 0, 1));
    this.cameraLookTarget.lerp(desiredTarget, clamp(11.0 * dt, 0, 1));

    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraLookTarget);

    const targetFov =
      62 + speedRatio * 10 + (this.playerCar.isUsingNitro ? 7 : 0);
    this.camera.fov = lerp(this.camera.fov, targetFov, clamp(6.0 * dt, 0, 1));
    this.camera.updateProjectionMatrix();
  }

  private updateUI(): void {
    if (this.raceState.phase === 'idle') return;

    const standings = this.raceState.getRankings(this.computeProgressMap());
    const playerStanding = standings.find((s) => s.racerId === 0);
    const playerRec = this.raceState.getRacer(0);

    this.ui.updateHUD({
      speedKmh: this.playerCar.getSpeed() * 3.6,
      position: playerStanding?.position ?? 1,
      totalRacers: this.allCars.length,
      lap: playerRec?.lap ?? 1,
      totalLaps: this.raceState.totalLaps,
      currentLapTime: this.raceState.getCurrentLapTime(0),
      bestLapTime: this.raceState.overallBestLap,
      nitroPercent: this.playerCar.nitro,
      isOffTrack: this.playerCar.isOffTrack,
    });

    if (this.raceState.phase === 'finished' && !this.resultsShown) {
      this.resultsShown = true;
      this.audio.updateDrivingSound(0, 50, 0, false, false, false);
      this.ui.showResultsScreen(
        standings,
        this.racerNames,
        this.raceState.overallBestLap
      );
    }
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  public start(): void {
    this.lastTimestamp = performance.now();
    requestAnimationFrame(this.loop);
  }

  private loop = (timestamp: number): void => {
    const rawDt = (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;
    const frameDt = clamp(rawDt, 0, 0.1);

    this.adaptQualityRuntime(frameDt);

    this.accumulator += frameDt;
    while (this.accumulator >= FIXED_STEP) {
      this.fixedUpdate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }

    this.updateUI();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  };
}
