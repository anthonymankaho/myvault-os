import * as THREE from 'three';
import { QualityLevel } from '../settings';
import { Car } from '../vehicles/Car';

interface SmokeParticle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  maxAge: number;
  active: boolean;
}

export class EffectsSystem {
  public readonly group = new THREE.Group();

  private skidMeshes: THREE.Mesh[] = [];
  private skidHead = 0;
  private maxSkids = 160;

  private smokeParticles: SmokeParticle[] = [];
  private smokeHead = 0;
  private maxSmoke = 48;
  private smokeEmitAccumulator = 0;

  private sparkLight: THREE.PointLight;
  private sparkTimer = 0;

  constructor(quality: QualityLevel) {
    this.sparkLight = new THREE.PointLight(0xffbe0b, 0, 12);
    this.group.add(this.sparkLight);

    this.initPools();
    this.setQuality(quality);
  }

  private createSmokeTexture(): THREE.CanvasTexture {
    if (typeof document === 'undefined') {
      return new THREE.CanvasTexture(null as unknown as HTMLCanvasElement);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
      grad.addColorStop(0, 'rgba(235, 240, 245, 0.75)');
      grad.addColorStop(0.55, 'rgba(200, 208, 216, 0.35)');
      grad.addColorStop(1, 'rgba(180, 190, 200, 0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
    }
    return new THREE.CanvasTexture(canvas);
  }

  private initPools(): void {
    const skidGeo = new THREE.PlaneGeometry(0.34, 0.95);
    skidGeo.rotateX(-Math.PI / 2);
    const skidMat = new THREE.MeshBasicMaterial({
      color: 0x111317,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });

    for (let i = 0; i < 200; i++) {
      const mesh = new THREE.Mesh(skidGeo, skidMat);
      mesh.visible = false;
      this.group.add(mesh);
      this.skidMeshes.push(mesh);
    }

    const smokeTex = this.createSmokeTexture();
    for (let i = 0; i < 64; i++) {
      const mat = new THREE.SpriteMaterial({
        map: smokeTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.group.add(sprite);
      this.smokeParticles.push({
        sprite,
        velocity: new THREE.Vector3(),
        age: 0,
        maxAge: 0.7,
        active: false,
      });
    }
  }

  public setQuality(quality: QualityLevel): void {
    if (quality === 'low') {
      this.maxSkids = 60;
      this.maxSmoke = 18;
    } else if (quality === 'medium') {
      this.maxSkids = 120;
      this.maxSmoke = 36;
    } else {
      this.maxSkids = 200;
      this.maxSmoke = 64;
    }
  }

  public reset(): void {
    for (const m of this.skidMeshes) {
      m.visible = false;
    }
    for (const p of this.smokeParticles) {
      p.active = false;
      p.sprite.visible = false;
    }
    this.skidHead = 0;
    this.smokeHead = 0;
    this.sparkTimer = 0;
    this.sparkLight.intensity = 0;
  }

  public emitFromCars(dt: number, cars: Car[]): void {
    this.smokeEmitAccumulator += dt;
    const shouldEmitStep = this.smokeEmitAccumulator >= 0.04;
    if (shouldEmitStep) {
      this.smokeEmitAccumulator = 0;
    }

    for (const car of cars) {
      if (!car.isDrifting || car.isOffTrack) continue;
      if (!shouldEmitStep) continue;

      const [leftWheel, rightWheel] = car.getRearWheelWorldPositions();
      this.spawnSkid(leftWheel, car.heading);
      this.spawnSkid(rightWheel, car.heading);

      if (car.slipAmount > 4.5) {
        this.spawnSmoke(leftWheel);
        this.spawnSmoke(rightWheel);
      }
    }
  }

  private spawnSkid(pos: THREE.Vector3, heading: number): void {
    if (this.maxSkids <= 0) return;
    const idx = this.skidHead % this.maxSkids;
    this.skidHead = (this.skidHead + 1) % this.maxSkids;
    const mesh = this.skidMeshes[idx];
    mesh.position.set(pos.x, pos.y + 0.03, pos.z);
    mesh.rotation.y = heading;
    mesh.visible = true;
  }

  private spawnSmoke(pos: THREE.Vector3): void {
    if (this.maxSmoke <= 0) return;
    const idx = this.smokeHead % this.maxSmoke;
    this.smokeHead = (this.smokeHead + 1) % this.maxSmoke;
    const p = this.smokeParticles[idx];
    p.active = true;
    p.age = 0;
    p.maxAge = 0.55 + Math.random() * 0.25;
    p.sprite.position.set(
      pos.x + (Math.random() - 0.5) * 0.35,
      pos.y + 0.25,
      pos.z + (Math.random() - 0.5) * 0.35
    );
    p.velocity.set(
      (Math.random() - 0.5) * 1.6,
      1.4 + Math.random() * 1.1,
      (Math.random() - 0.5) * 1.6
    );
    p.sprite.scale.setScalar(0.65);
    p.sprite.material.opacity = 0.65;
    p.sprite.visible = true;
  }

  public triggerCollisionFeedback(pos: THREE.Vector3, intensity: number): void {
    this.sparkLight.position.set(pos.x, pos.y + 1.0, pos.z);
    this.sparkLight.intensity = Math.min(5, 1.2 + intensity * 0.15);
    this.sparkTimer = 0.12;
    this.spawnSmoke(pos);
  }

  public update(dt: number): void {
    if (this.sparkTimer > 0) {
      this.sparkTimer -= dt;
      if (this.sparkTimer <= 0) {
        this.sparkLight.intensity = 0;
      }
    }

    for (let i = 0; i < this.smokeParticles.length; i++) {
      const p = this.smokeParticles[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }

      const lifeRatio = p.age / p.maxAge;
      p.sprite.position.addScaledVector(p.velocity, dt);
      const scale = 0.65 + lifeRatio * 1.55;
      p.sprite.scale.setScalar(scale);
      p.sprite.material.opacity = 0.6 * (1 - lifeRatio);
    }
  }
}
