import { Car, CarControls } from '../vehicles/Car';
import { Track } from '../track/Track';
import { clamp, normalizeAngle } from '../utils';

export interface AIPersonality {
  skillFactor: number; // 0.88..1.02
  preferredLaneOffset: number; // -3..3
  nitroAggression: number; // 0..1
}

export class AIDriver {
  public readonly car: Car;
  private readonly personality: AIPersonality;
  private stuckTimer = 0;
  private recoveryTimer = 0;

  constructor(car: Car, personality: AIPersonality) {
    this.car = car;
    this.personality = personality;
  }

  public reset(): void {
    this.stuckTimer = 0;
    this.recoveryTimer = 0;
  }

  public update(dt: number, track: Track, allCars: Car[]): CarControls {
    const speed = this.car.getSpeed();

    // Recovery state if AI car gets wedged against a barrier or stalled
    if (this.recoveryTimer > 0) {
      this.recoveryTimer -= dt;
      return {
        throttle: 0,
        brake: 0.9,
        steer: -Math.sign(this.car.lateralOffset || 1) * 0.8,
        handbrake: false,
        nitro: false,
      };
    }

    if (speed < 2.2) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2.1) {
        this.stuckTimer = 0;
        this.recoveryTimer = 0.85;
        // If badly off-angle, snap back onto the track after prolonged stall
        if (Math.abs(this.car.lateralOffset) > track.roadHalfWidth) {
          this.car.resetToTrack(track);
          this.recoveryTimer = 0;
        }
      }
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    }

    // Dynamic lookahead based on current speed
    const lookaheadSamples = Math.round(clamp(6 + speed * 0.26, 7, 22));
    const targetSampleIdx =
      (this.car.currentSampleIndex + lookaheadSamples) % track.sampleCount;
    const targetSample = track.samples[targetSampleIdx];

    // Obstacle avoidance with nearby cars ahead
    let avoidanceOffset = this.personality.preferredLaneOffset;
    let shouldSlowForTraffic = false;
    const fwd = this.car.getForwardVector();

    for (const other of allCars) {
      if (other.id === this.car.id) continue;
      const toOtherX = other.position.x - this.car.position.x;
      const toOtherZ = other.position.z - this.car.position.z;
      const dist = Math.hypot(toOtherX, toOtherZ);
      if (dist < 14 && dist > 0.01) {
        const forwardDot = (toOtherX * fwd.x + toOtherZ * fwd.z) / dist;
        if (forwardDot > 0.55) {
          // Car is ahead in our lane
          const lateralDiff = other.lateralOffset - this.car.lateralOffset;
          if (Math.abs(lateralDiff) < 3.2) {
            avoidanceOffset = clamp(
              this.car.lateralOffset + (lateralDiff >= 0 ? -3.8 : 3.8),
              -track.roadHalfWidth * 0.72,
              track.roadHalfWidth * 0.72
            );
            if (dist < 7.0) {
              shouldSlowForTraffic = true;
            }
          }
        }
      }
    }

    const targetPos = targetSample.position
      .clone()
      .addScaledVector(targetSample.right, avoidanceOffset);

    const dx = targetPos.x - this.car.position.x;
    const dz = targetPos.z - this.car.position.z;
    const desiredHeading = Math.atan2(dx, dz);

    // Heading error: positive means desired is to the left (+heading), negative means right (-heading)
    const headingError = normalizeAngle(desiredHeading - this.car.heading);
    const steer = clamp(-headingError * 1.95, -1, 1);

    // Corner awareness: inspect maximum curvature ahead
    const curvatureLookahead = Math.round(clamp(10 + speed * 0.45, 12, 32));
    const maxCurvature = track.getMaxCurvatureAhead(
      this.car.currentSampleIndex,
      curvatureLookahead
    );

    // Map curvature (0..~0.8 rad) to target cornering speed
    const cornerPenalty = clamp(maxCurvature * 1.65, 0, 0.62);
    const targetSpeed =
      this.car.maxSpeed * this.personality.skillFactor * (1 - cornerPenalty);

    let throttle = 1.0;
    let brake = 0.0;

    if (speed > targetSpeed + 2.5) {
      throttle = 0.0;
      brake = clamp((speed - targetSpeed) / 18, 0.15, 0.95);
    } else if (speed > targetSpeed) {
      throttle = 0.35;
    }

    if (shouldSlowForTraffic) {
      throttle *= 0.55;
    }

    const handbrake = maxCurvature > 0.52 && Math.abs(headingError) > 0.48 && speed > 26;

    const useNitro =
      maxCurvature < 0.14 &&
      Math.abs(headingError) < 0.14 &&
      this.car.nitro > 45 &&
      !this.car.isOffTrack &&
      Math.random() < this.personality.nitroAggression * 0.12;

    return {
      throttle,
      brake,
      steer,
      handbrake,
      nitro: useNitro,
    };
  }
}
