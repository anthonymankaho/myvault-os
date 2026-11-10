import * as THREE from 'three';
import { Track, TrackProjection } from '../track/Track';
import { clamp, lerp } from '../utils';

export interface CarControls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1 (left is +1 or -1: we'll map left = -1, right = +1)
  handbrake: boolean;
  nitro: boolean;
}

export interface CarConfig {
  id: number;
  name: string;
  color: number;
  maxSpeed?: number;
  accelForce?: number;
}

export class Car {
  public readonly id: number;
  public readonly name: string;
  public readonly color: number;
  public readonly radius = 1.45;

  public position = new THREE.Vector3();
  public prevPosition = new THREE.Vector3();
  public velocity = new THREE.Vector3();
  public heading = 0; // radians, 0 = +Z, atan2(x, z)
  public steerAngle = 0;

  public nitro = 100;
  public isUsingNitro = false;
  public isDrifting = false;
  public isOffTrack = false;
  public slipAmount = 0;

  public currentSampleIndex = 0;
  public distanceAlongTrack = 0;
  public lateralOffset = 0;

  public readonly maxSpeed: number;
  public readonly accelForce: number;
  public readonly brakeForce = 38;
  public readonly reverseForce = 24;
  public readonly maxReverseSpeed = 16;

  public readonly mesh: THREE.Group;
  private wheelMeshes: THREE.Mesh[] = [];
  private bodyMesh!: THREE.Mesh;
  private flameMesh!: THREE.Mesh;
  private wheelSpin = 0;

  constructor(config: CarConfig) {
    this.id = config.id;
    this.name = config.name;
    this.color = config.color;
    this.maxSpeed = config.maxSpeed ?? 52;
    this.accelForce = config.accelForce ?? 34;
    this.mesh = this.buildCarMesh(config.color);
  }

  private buildCarMesh(colorHex: number): THREE.Group {
    const root = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.35,
      metalness: 0.25,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1a1d24,
      roughness: 0.7,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x90e0ef,
      roughness: 0.15,
      metalness: 0.6,
    });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });

    const chassis = new THREE.Group();

    // Lower chassis
    const lowerGeo = new THREE.BoxGeometry(2.0, 0.55, 4.1);
    const lowerMesh = new THREE.Mesh(lowerGeo, bodyMat);
    lowerMesh.position.y = 0.52;
    lowerMesh.castShadow = true;
    lowerMesh.receiveShadow = true;
    chassis.add(lowerMesh);

    // Cabin roof
    const cabinGeo = new THREE.BoxGeometry(1.65, 0.48, 1.9);
    const cabinMesh = new THREE.Mesh(cabinGeo, bodyMat);
    cabinMesh.position.set(0, 0.98, -0.2);
    cabinMesh.castShadow = true;
    chassis.add(cabinMesh);

    // Windshield
    const windGeo = new THREE.BoxGeometry(1.52, 0.4, 1.98);
    const windMesh = new THREE.Mesh(windGeo, glassMat);
    windMesh.position.set(0, 0.96, -0.18);
    chassis.add(windMesh);

    // Rear spoiler wing
    const wingGeo = new THREE.BoxGeometry(1.95, 0.1, 0.42);
    const wingMesh = new THREE.Mesh(wingGeo, darkMat);
    wingMesh.position.set(0, 1.05, -1.85);
    wingMesh.castShadow = true;
    chassis.add(wingMesh);

    // Headlights (+Z is forward)
    const headGeo = new THREE.BoxGeometry(0.38, 0.18, 0.1);
    const leftHead = new THREE.Mesh(headGeo, lightMat);
    leftHead.position.set(-0.65, 0.55, 2.04);
    const rightHead = new THREE.Mesh(headGeo, lightMat);
    rightHead.position.set(0.65, 0.55, 2.04);
    chassis.add(leftHead, rightHead);

    // Taillights (-Z is rear)
    const leftTail = new THREE.Mesh(headGeo, tailMat);
    leftTail.position.set(-0.65, 0.58, -2.04);
    const rightTail = new THREE.Mesh(headGeo, tailMat);
    rightTail.position.set(0.65, 0.58, -2.04);
    chassis.add(leftTail, rightTail);

    // Nitro exhaust flame
    const flameGeo = new THREE.ConeGeometry(0.28, 1.1, 8);
    flameGeo.rotateX(-Math.PI / 2);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x00f5d4 });
    this.flameMesh = new THREE.Mesh(flameGeo, flameMat);
    this.flameMesh.position.set(0, 0.42, -2.55);
    this.flameMesh.visible = false;
    chassis.add(this.flameMesh);

    this.bodyMesh = lowerMesh;
    root.add(chassis);

    // 4 Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelOffsets = [
      new THREE.Vector3(-1.02, 0.38, 1.28),
      new THREE.Vector3(1.02, 0.38, 1.28),
      new THREE.Vector3(-1.02, 0.38, -1.28),
      new THREE.Vector3(1.02, 0.38, -1.28),
    ];

    for (const offset of wheelOffsets) {
      const w = new THREE.Mesh(wheelGeo, darkMat);
      w.position.copy(offset);
      w.castShadow = true;
      root.add(w);
      this.wheelMeshes.push(w);
    }

    return root;
  }

  public setTransform(position: THREE.Vector3, heading: number, track?: Track): void {
    this.position.copy(position);
    this.prevPosition.copy(position);
    this.velocity.set(0, 0, 0);
    this.heading = heading;
    this.steerAngle = 0;
    this.isDrifting = false;
    this.isUsingNitro = false;
    this.slipAmount = 0;

    if (track) {
      const proj = track.projectPosition(this.position);
      this.currentSampleIndex = proj.sampleIndex;
      this.distanceAlongTrack = proj.distanceAlongTrack;
      this.lateralOffset = proj.lateralOffset;
      this.position.y = proj.sample.position.y + 0.08;
      this.prevPosition.copy(this.position);
    }

    this.syncMesh();
  }

  public resetToTrack(track: Track): void {
    const proj = track.projectPosition(this.position, this.currentSampleIndex);
    const safePos = proj.sample.position.clone();
    safePos.y += 0.08;
    this.setTransform(safePos, proj.headingAngle, track);
  }

  public getForwardVector(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  public getRightVector(): THREE.Vector3 {
    // Right vector in XZ plane when forward is (sin(h), 0, cos(h))
    return new THREE.Vector3(-Math.cos(this.heading), 0, Math.sin(this.heading));
  }

  public getSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  public getForwardSpeed(): number {
    const fwd = this.getForwardVector();
    return this.velocity.x * fwd.x + this.velocity.z * fwd.z;
  }

  public updatePhysics(dt: number, controls: CarControls, track: Track, canMove: boolean): TrackProjection {
    this.prevPosition.copy(this.position);

    const projBefore = track.projectPosition(this.position, this.currentSampleIndex);
    this.currentSampleIndex = projBefore.sampleIndex;
    this.isOffTrack = Math.abs(projBefore.lateralOffset) > track.roadHalfWidth;

    if (!canMove) {
      this.velocity.set(0, 0, 0);
      this.isUsingNitro = false;
      this.isDrifting = false;
      this.slipAmount = 0;
      this.syncMesh();
      return projBefore;
    }

    const throttle = clamp(controls.throttle, 0, 1);
    const brake = clamp(controls.brake, 0, 1);
    const steerInput = clamp(controls.steer, -1, 1);

    let forward = this.getForwardVector();
    let right = this.getRightVector();

    let forwardSpeed = this.velocity.x * forward.x + this.velocity.z * forward.z;
    let lateralSpeed = this.velocity.x * right.x + this.velocity.z * right.z;

    // Nitro handling (reduced effectiveness or unavailable off-track)
    const wantsNitro = controls.nitro && throttle > 0.1 && this.nitro > 1 && !this.isOffTrack;
    if (wantsNitro) {
      this.isUsingNitro = true;
      this.nitro = clamp(this.nitro - 28 * dt, 0, 100);
    } else {
      this.isUsingNitro = false;
      if (!controls.nitro) {
        this.nitro = clamp(this.nitro + 12 * dt, 0, 100);
      }
    }

    const nitroMultiplier = this.isUsingNitro ? 1.42 : 1.0;
    const effectiveMaxSpeed =
      (this.isOffTrack ? this.maxSpeed * 0.62 : this.maxSpeed) *
      (this.isUsingNitro ? 1.24 : 1.0);

    // Acceleration / Braking / Reverse
    if (throttle > 0) {
      if (forwardSpeed < 0) {
        forwardSpeed += this.brakeForce * throttle * dt;
      } else if (forwardSpeed < effectiveMaxSpeed) {
        forwardSpeed += this.accelForce * nitroMultiplier * throttle * dt;
      }
    }

    if (brake > 0) {
      if (forwardSpeed > 1.2) {
        forwardSpeed = Math.max(0, forwardSpeed - this.brakeForce * brake * dt);
      } else {
        forwardSpeed = Math.max(-this.maxReverseSpeed, forwardSpeed - this.reverseForce * brake * dt);
      }
    }

    if (controls.handbrake) {
      forwardSpeed *= Math.max(0, 1 - 1.9 * dt);
    }

    // Drag and off-track resistance
    const baseDrag = this.isOffTrack ? 2.6 : 0.55;
    forwardSpeed *= Math.max(0, 1 - baseDrag * dt);
    if (forwardSpeed > effectiveMaxSpeed) {
      forwardSpeed = lerp(forwardSpeed, effectiveMaxSpeed, 4.0 * dt);
    }

    // Steering response
    this.steerAngle = lerp(this.steerAngle, steerInput, 12 * dt);
    const speedFactor = clamp(Math.abs(forwardSpeed) / 7.0, 0, 1);
    const highSpeedDamp = 1 - clamp(Math.abs(forwardSpeed) / (this.maxSpeed * 1.9), 0, 0.42);
    const driftTurnBoost = controls.handbrake ? 1.32 : 1.0;
    const turnRate = 2.55 * highSpeedDamp * driftTurnBoost;
    const directionSign = forwardSpeed >= -0.2 ? 1 : -1;

    // steerInput: -1 = left (+heading in right-handed Y-up when forward is sin/cos), +1 = right (-heading)
    this.heading -= this.steerAngle * turnRate * speedFactor * directionSign * dt;

    // Recompute basis after steering rotation
    forward = this.getForwardVector();
    right = this.getRightVector();

    // Inject mild lateral slip from turning at speed, then damp based on grip
    lateralSpeed += this.steerAngle * forwardSpeed * (controls.handbrake ? 0.52 : 0.16) * dt * 8;

    const lateralGrip = controls.handbrake
      ? 2.2
      : this.isOffTrack
        ? 4.2
        : 8.8;
    lateralSpeed *= Math.exp(-lateralGrip * dt);

    this.slipAmount = Math.abs(lateralSpeed) + (controls.handbrake && Math.abs(forwardSpeed) > 10 ? 5 : 0);
    this.isDrifting =
      Math.abs(forwardSpeed) > 11 &&
      (controls.handbrake || Math.abs(lateralSpeed) > 4.2);

    this.velocity.x = forward.x * forwardSpeed + right.x * lateralSpeed;
    this.velocity.z = forward.z * forwardSpeed + right.z * lateralSpeed;

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // Project onto track and enforce barrier collision
    const projAfter = track.projectPosition(this.position, this.currentSampleIndex);
    this.currentSampleIndex = projAfter.sampleIndex;
    this.distanceAlongTrack = projAfter.distanceAlongTrack;
    this.lateralOffset = projAfter.lateralOffset;
    this.isOffTrack = Math.abs(projAfter.lateralOffset) > track.roadHalfWidth;

    // Smooth elevation following
    const targetY = projAfter.sample.position.y + 0.08;
    this.position.y = lerp(this.position.y, targetY, clamp(18 * dt, 0, 1));

    this.wheelSpin += forwardSpeed * dt * 1.6;
    this.syncMesh();

    return projAfter;
  }

  public resolveBarrierCollision(track: Track, proj: TrackProjection): number {
    const maxLateral = track.barrierHalfWidth - this.radius * 0.75;
    if (Math.abs(proj.lateralOffset) <= maxLateral) {
      return 0;
    }

    const sign = Math.sign(proj.lateralOffset);
    const clampedLateral = sign * maxLateral;
    this.position.x = proj.sample.position.x + proj.sample.right.x * clampedLateral;
    this.position.z = proj.sample.position.z + proj.sample.right.z * clampedLateral;
    this.lateralOffset = clampedLateral;

    // Reflect / damp lateral velocity against the barrier normal
    const normalX = -sign * proj.sample.right.x;
    const normalZ = -sign * proj.sample.right.z;
    const vn = this.velocity.x * normalX + this.velocity.z * normalZ;
    let impactSpeed = 0;

    if (vn < 0) {
      impactSpeed = -vn;
      const restitution = 0.35;
      this.velocity.x -= (1 + restitution) * vn * normalX;
      this.velocity.z -= (1 + restitution) * vn * normalZ;
      // Scrape friction along the wall
      this.velocity.multiplyScalar(0.88);
    }

    // Slightly nudge heading back toward track tangent so cars don't stay wedged
    const tangentHeading = proj.headingAngle;
    const angleDiff = Math.atan2(
      Math.sin(tangentHeading - this.heading),
      Math.cos(tangentHeading - this.heading)
    );
    this.heading += angleDiff * 0.18;

    this.syncMesh();
    return impactSpeed;
  }

  public static resolveCarCollision(carA: Car, carB: Car): number {
    const dx = carB.position.x - carA.position.x;
    const dz = carB.position.z - carA.position.z;
    const minDist = carA.radius + carB.radius;
    const distSq = dx * dx + dz * dz;

    if (distSq >= minDist * minDist) {
      return 0;
    }

    const dist = Math.sqrt(distSq) || 0.001;
    const nx = dx / dist;
    const nz = dz / dist;
    const overlap = minDist - dist;

    // Separate cars equally in XZ
    carA.position.x -= nx * (overlap * 0.52);
    carA.position.z -= nz * (overlap * 0.52);
    carB.position.x += nx * (overlap * 0.52);
    carB.position.z += nz * (overlap * 0.52);

    // Relative velocity along collision normal
    const rvx = carB.velocity.x - carA.velocity.x;
    const rvz = carB.velocity.z - carA.velocity.z;
    const velAlongNormal = rvx * nx + rvz * nz;

    if (velAlongNormal > 0) {
      carA.syncMesh();
      carB.syncMesh();
      return 0;
    }

    const restitution = 0.45;
    const impulse = (-(1 + restitution) * velAlongNormal) * 0.5;
    carA.velocity.x -= impulse * nx;
    carA.velocity.z -= impulse * nz;
    carB.velocity.x += impulse * nx;
    carB.velocity.z += impulse * nz;

    carA.syncMesh();
    carB.syncMesh();
    return Math.abs(velAlongNormal);
  }

  public getRearWheelWorldPositions(): [THREE.Vector3, THREE.Vector3] {
    const fwd = this.getForwardVector();
    const right = this.getRightVector();
    const rearCenter = this.position.clone().addScaledVector(fwd, -1.25);
    const leftWheel = rearCenter.clone().addScaledVector(right, -0.92);
    const rightWheel = rearCenter.clone().addScaledVector(right, 0.92);
    leftWheel.y = this.position.y + 0.05;
    rightWheel.y = this.position.y + 0.05;
    return [leftWheel, rightWheel];
  }

  public syncMesh(): void {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.heading;

    // Subtle body roll when cornering
    if (this.bodyMesh) {
      this.bodyMesh.rotation.z = this.steerAngle * 0.06;
    }

    if (this.flameMesh) {
      this.flameMesh.visible = this.isUsingNitro;
      if (this.isUsingNitro) {
        const pulse = 0.85 + Math.random() * 0.35;
        this.flameMesh.scale.set(1, 1, pulse);
      }
    }

    for (let i = 0; i < this.wheelMeshes.length; i++) {
      const w = this.wheelMeshes[i];
      w.rotation.x = this.wheelSpin;
      if (i < 2) {
        w.rotation.y = -this.steerAngle * 0.45;
      }
    }
  }
}
