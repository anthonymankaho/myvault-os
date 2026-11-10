export type RacePhase = 'idle' | 'countdown' | 'racing' | 'finished';

export interface RacerRecord {
  racerId: number;
  lap: number;
  completedLaps: number;
  nextCheckpoint: number;
  lapStartTime: number;
  lastLapTime: number | null;
  bestLapTime: number | null;
  finished: boolean;
  finishTime: number | null;
}

export interface StandingEntry {
  racerId: number;
  position: number;
  completedLaps: number;
  currentLap: number;
  nextCheckpoint: number;
  finished: boolean;
  finishTime: number | null;
  bestLapTime: number | null;
  lastLapTime: number | null;
  progress: number;
}

export class RaceState {
  public readonly totalLaps: number;
  public readonly checkpointCount: number;
  public phase: RacePhase = 'idle';
  public countdownTimer = 0;
  public raceTime = 0;
  public paused = false;
  public overallBestLap: number | null = null;

  private racers: Map<number, RacerRecord> = new Map();

  constructor(totalLaps = 3, checkpointCount = 12, initialBestLap: number | null = null) {
    this.totalLaps = Math.max(1, totalLaps);
    this.checkpointCount = Math.max(2, checkpointCount);
    this.overallBestLap = initialBestLap;
  }

  public reset(racerIds: number[]): void {
    this.phase = 'idle';
    this.countdownTimer = 0;
    this.raceTime = 0;
    this.paused = false;
    this.racers.clear();

    for (const id of racerIds) {
      this.racers.set(id, {
        racerId: id,
        lap: 1,
        completedLaps: 0,
        nextCheckpoint: 1,
        lapStartTime: 0,
        lastLapTime: null,
        bestLapTime: null,
        finished: false,
        finishTime: null,
      });
    }
  }

  public startCountdown(seconds = 3): void {
    if (this.racers.size === 0) {
      this.reset([0, 1, 2, 3]);
    }
    this.countdownTimer = Math.max(0, seconds);
    this.raceTime = 0;
    this.paused = false;
    for (const rec of this.racers.values()) {
      rec.lap = 1;
      rec.completedLaps = 0;
      rec.nextCheckpoint = 1;
      rec.lapStartTime = 0;
      rec.lastLapTime = null;
      rec.bestLapTime = null;
      rec.finished = false;
      rec.finishTime = null;
    }
    this.phase = this.countdownTimer > 0 ? 'countdown' : 'racing';
  }

  public setPaused(paused: boolean): void {
    if (this.phase === 'countdown' || this.phase === 'racing') {
      this.paused = paused;
    } else {
      this.paused = false;
    }
  }

  public togglePause(): boolean {
    this.setPaused(!this.paused);
    return this.paused;
  }

  public update(dt: number): void {
    if (this.paused || dt <= 0) return;

    if (this.phase === 'countdown') {
      this.countdownTimer -= dt;
      if (this.countdownTimer <= 0) {
        const leftover = -this.countdownTimer;
        this.countdownTimer = 0;
        this.phase = 'racing';
        if (leftover > 0) {
          this.raceTime += leftover;
        }
      }
      return;
    }

    if (this.phase === 'racing') {
      this.raceTime += dt;
    }
  }

  public passCheckpoint(racerId: number, checkpointIndex: number): boolean {
    if (this.phase !== 'racing' || this.paused) return false;
    const rec = this.racers.get(racerId);
    if (!rec || rec.finished) return false;

    if (checkpointIndex !== rec.nextCheckpoint) {
      return false;
    }

    if (checkpointIndex === 0) {
      const lapDuration = Math.max(0.001, this.raceTime - rec.lapStartTime);
      rec.lastLapTime = lapDuration;
      if (rec.bestLapTime === null || lapDuration < rec.bestLapTime) {
        rec.bestLapTime = lapDuration;
      }
      if (this.overallBestLap === null || lapDuration < this.overallBestLap) {
        this.overallBestLap = lapDuration;
      }

      rec.completedLaps += 1;
      rec.lapStartTime = this.raceTime;

      if (rec.completedLaps >= this.totalLaps) {
        rec.finished = true;
        rec.finishTime = this.raceTime;
        rec.lap = this.totalLaps;
        if (racerId === 0 || this.areAllRacersFinished()) {
          this.phase = 'finished';
        }
      } else {
        rec.lap = rec.completedLaps + 1;
        rec.nextCheckpoint = 1;
      }
      return true;
    }

    const next = checkpointIndex + 1;
    rec.nextCheckpoint = next >= this.checkpointCount ? 0 : next;
    return true;
  }

  public areAllRacersFinished(): boolean {
    if (this.racers.size === 0) return false;
    for (const rec of this.racers.values()) {
      if (!rec.finished) return false;
    }
    return true;
  }

  public getRacer(racerId: number): RacerRecord | undefined {
    const rec = this.racers.get(racerId);
    return rec ? { ...rec } : undefined;
  }

  public getCurrentLapTime(racerId: number): number {
    const rec = this.racers.get(racerId);
    if (!rec) return 0;
    if (rec.finished && rec.finishTime !== null) {
      return rec.lastLapTime ?? 0;
    }
    if (this.phase !== 'racing' && this.phase !== 'finished') return 0;
    return Math.max(0, this.raceTime - rec.lapStartTime);
  }

  public getRankings(progressValues: Map<number, number>): StandingEntry[] {
    const entries: StandingEntry[] = [];
    for (const rec of this.racers.values()) {
      const progress = progressValues.get(rec.racerId) ?? rec.completedLaps * 1000;
      entries.push({
        racerId: rec.racerId,
        position: 1,
        completedLaps: rec.completedLaps,
        currentLap: Math.min(this.totalLaps, rec.completedLaps + 1),
        nextCheckpoint: rec.nextCheckpoint,
        finished: rec.finished,
        finishTime: rec.finishTime,
        bestLapTime: rec.bestLapTime,
        lastLapTime: rec.lastLapTime,
        progress,
      });
    }

    entries.sort((a, b) => {
      if (a.finished && b.finished) {
        return (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity);
      }
      if (a.finished !== b.finished) {
        return a.finished ? -1 : 1;
      }
      if (b.progress !== a.progress) {
        return b.progress - a.progress;
      }
      return a.racerId - b.racerId;
    });

    entries.forEach((entry, idx) => {
      entry.position = idx + 1;
    });

    return entries;
  }
}
