import * as THREE from 'three';
import { clamp, distanceToSegment2D } from '../utils';

export interface TrackSample {
  index: number;
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  distance: number;
  curvature: number;
}

export interface CheckpointData {
  index: number;
  sampleIndex: number;
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  leftPost: THREE.Vector3;
  rightPost: THREE.Vector3;
  radius: number;
}

export interface TrackProjection {
  sampleIndex: number;
  sample: TrackSample;
  lateralOffset: number;
  distanceAlongTrack: number;
  headingAngle: number;
}

export class Track {
  public readonly roadHalfWidth = 9.5;
  public readonly barrierHalfWidth = 13.0;
  public readonly sampleCount = 360;
  public readonly checkpointCount = 12;

  public readonly samples: TrackSample[] = [];
  public readonly checkpoints: CheckpointData[] = [];
  public readonly totalLength: number;
  public readonly group: THREE.Group;

  constructor() {
    this.group = new THREE.Group();
    this.totalLength = this.generateSamples();
    this.generateCheckpoints();
    this.buildVisuals();
  }

  private generateSamples(): number {
    // Control points forming a closed loop with long straights, sweepers, tight hairpins, and elevation changes
    const controlPoints = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -90),
      new THREE.Vector3(10, 2.5, -175),
      new THREE.Vector3(65, 6.0, -220),
      new THREE.Vector3(135, 7.5, -205),
      new THREE.Vector3(175, 4.0, -145),
      new THREE.Vector3(145, 1.5, -85),
      new THREE.Vector3(95, 0.0, -55),
      new THREE.Vector3(115, -1.5, 10),
      new THREE.Vector3(175, 2.0, 65),
      new THREE.Vector3(165, 5.5, 140),
      new THREE.Vector3(100, 3.0, 175),
      new THREE.Vector3(30, 0.5, 145),
      new THREE.Vector3(-5, 0, 80),
    ];

    const curve = new THREE.CatmullRomCurve3(controlPoints, true, 'catmullrom', 0.5);
    const rawPoints = curve.getSpacedPoints(this.sampleCount);

    let accumDist = 0;
    const worldUp = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < this.sampleCount; i++) {
      const pos = rawPoints[i].clone();
      const prev = rawPoints[(i - 1 + this.sampleCount) % this.sampleCount];
      const next = rawPoints[(i + 1) % this.sampleCount];

      if (i > 0) {
        accumDist += pos.distanceTo(rawPoints[i - 1]);
      }

      const tangent = next.clone().sub(prev).normalize();
      const flatTangent = new THREE.Vector3(tangent.x, 0, tangent.z).normalize();
      const right = new THREE.Vector3().crossVectors(flatTangent, worldUp).normalize();
      const up = new THREE.Vector3().crossVectors(right, tangent).normalize();

      this.samples.push({
        index: i,
        position: pos,
        tangent,
        right,
        up,
        distance: accumDist,
        curvature: 0,
      });
    }

    const closingDist = rawPoints[0].distanceTo(rawPoints[this.sampleCount - 1]);
    const totalLen = accumDist + closingDist;

    // Compute smoothed lookahead curvature for AI corner awareness
    for (let i = 0; i < this.sampleCount; i++) {
      const prevSample = this.samples[(i - 4 + this.sampleCount) % this.sampleCount];
      const nextSample = this.samples[(i + 4) % this.sampleCount];
      const t1 = new THREE.Vector2(prevSample.tangent.x, prevSample.tangent.z).normalize();
      const t2 = new THREE.Vector2(nextSample.tangent.x, nextSample.tangent.z).normalize();
      const dot = clamp(t1.dot(t2), -1, 1);
      const angle = Math.acos(dot);
      this.samples[i].curvature = angle;
    }

    return totalLen;
  }

  private generateCheckpoints(): void {
    const step = Math.floor(this.sampleCount / this.checkpointCount);
    for (let c = 0; c < this.checkpointCount; c++) {
      const sampleIdx = (c * step) % this.sampleCount;
      const sample = this.samples[sampleIdx];
      const leftPost = sample.position
        .clone()
        .addScaledVector(sample.right, -this.barrierHalfWidth);
      const rightPost = sample.position
        .clone()
        .addScaledVector(sample.right, this.barrierHalfWidth);

      this.checkpoints.push({
        index: c,
        sampleIndex: sampleIdx,
        position: sample.position.clone(),
        tangent: sample.tangent.clone(),
        right: sample.right.clone(),
        leftPost,
        rightPost,
        radius: this.barrierHalfWidth + 3.5,
      });
    }
  }

  public projectPosition(pos: THREE.Vector3, hintIndex?: number): TrackProjection {
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintIndex !== undefined) {
      const searchWindow = 28;
      for (let offset = -searchWindow; offset <= searchWindow; offset++) {
        const idx = (hintIndex + offset + this.sampleCount) % this.sampleCount;
        const p = this.samples[idx].position;
        const dx = pos.x - p.x;
        const dz = pos.z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = idx;
        }
      }
    }

    if (bestDistSq > 900 || hintIndex === undefined) {
      bestDistSq = Infinity;
      for (let i = 0; i < this.sampleCount; i++) {
        const p = this.samples[i].position;
        const dx = pos.x - p.x;
        const dz = pos.z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }
    }

    const sample = this.samples[bestIdx];
    const rel = new THREE.Vector3().subVectors(pos, sample.position);
    const lateralOffset = rel.x * sample.right.x + rel.z * sample.right.z;
    const forwardOffset = rel.x * sample.tangent.x + rel.z * sample.tangent.z;
    let distanceAlongTrack = sample.distance + forwardOffset;
    if (distanceAlongTrack < 0) distanceAlongTrack += this.totalLength;
    if (distanceAlongTrack >= this.totalLength) distanceAlongTrack -= this.totalLength;

    const headingAngle = Math.atan2(sample.tangent.x, sample.tangent.z);

    return {
      sampleIndex: bestIdx,
      sample,
      lateralOffset,
      distanceAlongTrack,
      headingAngle,
    };
  }

  public checkCheckpointTrigger(
    prevPos: THREE.Vector3,
    currPos: THREE.Vector3,
    checkpointIndex: number
  ): boolean {
    const cp = this.checkpoints[checkpointIndex];
    if (!cp) return false;

    const dist = distanceToSegment2D(
      cp.position.x,
      cp.position.z,
      prevPos.x,
      prevPos.z,
      currPos.x,
      currPos.z
    );

    return dist <= cp.radius;
  }

  public getMaxCurvatureAhead(startIndex: number, lookaheadSamples: number): number {
    let maxCurv = 0;
    for (let i = 1; i <= lookaheadSamples; i++) {
      const idx = (startIndex + i) % this.sampleCount;
      if (this.samples[idx].curvature > maxCurv) {
        maxCurv = this.samples[idx].curvature;
      }
    }
    return maxCurv;
  }

  public getStartTransform(slotIndex: number): { position: THREE.Vector3; heading: number } {
    const row = Math.floor(slotIndex / 2);
    const col = slotIndex % 2;
    const sampleIdx = (this.sampleCount - 4 - row * 3 + this.sampleCount) % this.sampleCount;
    const sample = this.samples[sampleIdx];
    const lateral = col === 0 ? -3.2 : 3.2;
    const pos = sample.position.clone().addScaledVector(sample.right, lateral);
    pos.y += 0.05;
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);
    return { position: pos, heading };
  }

  private createRoadTexture(): THREE.CanvasTexture {
    if (typeof document === 'undefined') {
      return new THREE.CanvasTexture(null as unknown as HTMLCanvasElement);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#2b2f36';
      ctx.fillRect(0, 0, 512, 512);

      // Subtle asphalt grain
      for (let i = 0; i < 2400; i++) {
        const x = (i * 73) % 512;
        const y = (i * 137) % 512;
        ctx.fillStyle = i % 2 === 0 ? '#343942' : '#23272e';
        ctx.fillRect(x, y, 2, 2);
      }

      // Red and white curbs on edges
      const curbWidth = 28;
      for (let y = 0; y < 512; y += 64) {
        ctx.fillStyle = (y / 64) % 2 === 0 ? '#e63946' : '#f1faee';
        ctx.fillRect(0, y, curbWidth, 64);
        ctx.fillRect(512 - curbWidth, y, curbWidth, 64);
      }

      // Edge solid lines
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(curbWidth + 6, 0, 6, 512);
      ctx.fillRect(512 - curbWidth - 12, 0, 6, 512);

      // Center dashed line
      ctx.fillStyle = '#ffd166';
      for (let y = 16; y < 512; y += 64) {
        ctx.fillRect(252, y, 8, 34);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 48);
    return tex;
  }

  private createBarrierTexture(): THREE.CanvasTexture {
    if (typeof document === 'undefined') {
      return new THREE.CanvasTexture(null as unknown as HTMLCanvasElement);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      for (let x = 0; x < 256; x += 32) {
        ctx.fillStyle = (x / 32) % 2 === 0 ? '#d90429' : '#edf2f4';
        ctx.fillRect(x, 0, 32, 64);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, 46, 256, 18);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(60, 1);
    return tex;
  }

  private createCheckerTexture(): THREE.CanvasTexture {
    if (typeof document === 'undefined') {
      return new THREE.CanvasTexture(null as unknown as HTMLCanvasElement);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const size = 16;
      for (let y = 0; y < 64; y += size) {
        for (let x = 0; x < 256; x += size) {
          const even = ((x / size) + (y / size)) % 2 === 0;
          ctx.fillStyle = even ? '#ffffff' : '#111111';
          ctx.fillRect(x, y, size, size);
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  private buildVisuals(): void {
    // Ground terrain plane
    const groundGeo = new THREE.PlaneGeometry(900, 900);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x2d6a4f });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(70, -3.2, -20);
    ground.receiveShadow = true;
    this.group.add(ground);

    // Build road ribbon and shoulders
    this.buildRibbonMesh(this.roadHalfWidth, 0.06, new THREE.MeshStandardMaterial({
      map: this.createRoadTexture(),
      roughness: 0.85,
      metalness: 0.05,
    }), true);

    // Grassy/gravel shoulder embankment beneath road
    this.buildRibbonMesh(this.barrierHalfWidth + 1.2, -0.08, new THREE.MeshLambertMaterial({
      color: 0x40916c,
    }), true);

    // Build left and right barrier walls
    const barrierMat = new THREE.MeshStandardMaterial({
      map: this.createBarrierTexture(),
      roughness: 0.6,
    });
    this.buildBarrierWall(-this.barrierHalfWidth, barrierMat);
    this.buildBarrierWall(this.barrierHalfWidth, barrierMat);

    // Start/Finish line & arch at checkpoint 0
    this.buildStartFinishLine();

    // Scenery trees and rocks outside barriers
    this.buildScenery();
  }

  private buildRibbonMesh(
    halfWidth: number,
    yOffset: number,
    material: THREE.Material,
    receiveShadow: boolean
  ): void {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const count = this.sampleCount;
    for (let i = 0; i <= count; i++) {
      const s = this.samples[i % count];
      const v = i / count;

      const left = s.position.clone().addScaledVector(s.right, -halfWidth);
      const right = s.position.clone().addScaledVector(s.right, halfWidth);
      left.y += yOffset;
      right.y += yOffset;

      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, v, 1, v);

      if (i < count) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = receiveShadow;
    this.group.add(mesh);
  }

  private buildBarrierWall(lateralOffset: number, material: THREE.Material): void {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const wallHeight = 1.15;
    const count = this.sampleCount;

    for (let i = 0; i <= count; i++) {
      const s = this.samples[i % count];
      const u = i / count;
      const basePos = s.position.clone().addScaledVector(s.right, lateralOffset);
      const topPos = basePos.clone();
      topPos.y += wallHeight;

      positions.push(basePos.x, basePos.y - 0.2, basePos.z);
      positions.push(topPos.x, topPos.y, topPos.z);
      uvs.push(u, 0, u, 1);

      if (i < count) {
        const b = i * 2;
        if (lateralOffset > 0) {
          indices.push(b, b + 2, b + 1);
          indices.push(b + 1, b + 2, b + 3);
        } else {
          indices.push(b, b + 1, b + 2);
          indices.push(b + 1, b + 3, b + 2);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildStartFinishLine(): void {
    const startSample = this.samples[0];
    const checkerTex = this.createCheckerTexture();

    const lineGeo = new THREE.PlaneGeometry(this.roadHalfWidth * 2, 3.2);
    lineGeo.rotateX(-Math.PI / 2);
    const lineMat = new THREE.MeshBasicMaterial({ map: checkerTex });
    const lineMesh = new THREE.Mesh(lineGeo, lineMat);

    const angle = Math.atan2(startSample.tangent.x, startSample.tangent.z);
    lineMesh.position.copy(startSample.position);
    lineMesh.position.y += 0.09;
    lineMesh.rotation.y = angle;
    this.group.add(lineMesh);

    // Overhead Start/Finish Gantry Arch
    const archGroup = new THREE.Group();
    archGroup.position.copy(startSample.position);
    archGroup.rotation.y = angle;

    const pillarGeo = new THREE.BoxGeometry(0.9, 7.5, 0.9);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.5 });

    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(-this.barrierHalfWidth, 3.6, 0);
    leftPillar.castShadow = true;

    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(this.barrierHalfWidth, 3.6, 0);
    rightPillar.castShadow = true;

    const bannerGeo = new THREE.BoxGeometry(this.barrierHalfWidth * 2 + 1.4, 1.6, 1.1);
    const bannerMat = new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 0.4 });
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(0, 7.1, 0);
    banner.castShadow = true;

    archGroup.add(leftPillar, rightPillar, banner);
    this.group.add(archGroup);
  }

  private buildScenery(): void {
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 2.2, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6c462f });
    const foliageGeo = new THREE.ConeGeometry(2.2, 5.2, 7);
    const foliageMat = new THREE.MeshLambertMaterial({ color: 0x1b4332 });
    const rockGeo = new THREE.DodecahedronGeometry(1.8, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x6c757d });

    for (let i = 0; i < this.sampleCount; i += 6) {
      const s = this.samples[i];
      const side = (i / 6) % 2 === 0 ? 1 : -1;
      const distOut = this.barrierHalfWidth + 8 + ((i * 17) % 18);
      const pos = s.position.clone().addScaledVector(s.right, side * distOut);

      // Keep clear of other parts of the track
      const proj = this.projectPosition(pos);
      if (Math.abs(proj.lateralOffset) < this.barrierHalfWidth + 4.5) {
        continue;
      }

      if (i % 18 === 0) {
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.set(pos.x, pos.y + 0.5, pos.z);
        rock.rotation.set(i * 0.3, i * 0.7, 0);
        const scale = 0.8 + ((i * 13) % 10) * 0.12;
        rock.scale.set(scale, scale * 0.75, scale);
        rock.castShadow = true;
        this.group.add(rock);
      } else {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 1.1;
        trunk.castShadow = true;

        const crown = new THREE.Mesh(foliageGeo, foliageMat);
        crown.position.y = 4.2;
        crown.castShadow = true;

        tree.add(trunk, crown);
        const scale = 0.85 + ((i * 7) % 8) * 0.1;
        tree.scale.setScalar(scale);
        tree.position.set(pos.x, pos.y - 0.3, pos.z);
        this.group.add(tree);
      }
    }
  }
}
