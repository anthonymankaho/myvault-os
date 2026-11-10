import { describe, expect, it } from 'vitest';
import { RaceState } from '../src/game/logic/RaceState';

describe('RaceState rules', () => {
  it('1. enforces checkpoint order and ignores wrong checkpoints', () => {
    const race = new RaceState(3, 4);
    race.reset([0]);
    race.startCountdown(0);

    expect(race.getRacer(0)?.nextCheckpoint).toBe(1);

    // Passing checkpoint 2 or 0 before checkpoint 1 must fail
    expect(race.passCheckpoint(0, 2)).toBe(false);
    expect(race.passCheckpoint(0, 0)).toBe(false);
    expect(race.getRacer(0)?.nextCheckpoint).toBe(1);

    // Passing checkpoint 1 advances to 2
    expect(race.passCheckpoint(0, 1)).toBe(true);
    expect(race.getRacer(0)?.nextCheckpoint).toBe(2);

    // Passing checkpoint 1 again or 3 out of order is ignored
    expect(race.passCheckpoint(0, 1)).toBe(false);
    expect(race.passCheckpoint(0, 3)).toBe(false);
    expect(race.getRacer(0)?.nextCheckpoint).toBe(2);
  });

  it('2. does not count a lap when skipping checkpoints', () => {
    const race = new RaceState(3, 4);
    race.reset([0]);
    race.startCountdown(0);
    race.update(5);

    expect(race.passCheckpoint(0, 1)).toBe(true);
    expect(race.passCheckpoint(0, 2)).toBe(true);
    // Skip checkpoint 3 and attempt finish line (checkpoint 0)
    expect(race.passCheckpoint(0, 0)).toBe(false);
    expect(race.getRacer(0)?.completedLaps).toBe(0);
    expect(race.getRacer(0)?.nextCheckpoint).toBe(3);

    // Now pass checkpoint 3 and then 0 to complete the lap
    expect(race.passCheckpoint(0, 3)).toBe(true);
    expect(race.passCheckpoint(0, 0)).toBe(true);
    expect(race.getRacer(0)?.completedLaps).toBe(1);
    expect(race.getRacer(0)?.nextCheckpoint).toBe(1);
  });

  it('3. completes the race only after the required number of valid laps', () => {
    const race = new RaceState(3, 4);
    race.reset([0, 1]);
    race.startCountdown(0);

    const completeLap = (racerId: number, duration: number) => {
      race.update(duration);
      expect(race.passCheckpoint(racerId, 1)).toBe(true);
      expect(race.passCheckpoint(racerId, 2)).toBe(true);
      expect(race.passCheckpoint(racerId, 3)).toBe(true);
      expect(race.passCheckpoint(racerId, 0)).toBe(true);
    };

    completeLap(0, 12);
    expect(race.getRacer(0)?.finished).toBe(false);
    expect(race.phase).toBe('racing');

    completeLap(0, 11);
    expect(race.getRacer(0)?.finished).toBe(false);
    expect(race.phase).toBe('racing');

    completeLap(0, 10);
    const player = race.getRacer(0);
    expect(player?.completedLaps).toBe(3);
    expect(player?.finished).toBe(true);
    expect(player?.finishTime).toBeCloseTo(33, 5);
    expect(player?.bestLapTime).toBeCloseTo(10, 5);
    expect(race.phase).toBe('finished');
  });

  it('4. stops race time and blocks checkpoint triggers while paused', () => {
    const race = new RaceState(3, 4);
    race.reset([0]);
    race.startCountdown(3);

    race.update(3);
    expect(race.phase).toBe('racing');

    race.update(4.5);
    expect(race.raceTime).toBeCloseTo(4.5, 5);

    race.setPaused(true);
    race.update(10);
    expect(race.raceTime).toBeCloseTo(4.5, 5);
    expect(race.passCheckpoint(0, 1)).toBe(false);

    race.setPaused(false);
    race.update(2.5);
    expect(race.raceTime).toBeCloseTo(7.0, 5);
    expect(race.passCheckpoint(0, 1)).toBe(true);
  });

  it('5. resets laps, timers, and checkpoints on restart so a new valid race can finish', () => {
    const race = new RaceState(2, 3);
    race.reset([0]);
    race.startCountdown(0);

    race.update(10);
    race.passCheckpoint(0, 1);
    race.passCheckpoint(0, 2);
    race.passCheckpoint(0, 0);
    expect(race.getRacer(0)?.completedLaps).toBe(1);

    // Restart
    race.reset([0]);
    race.startCountdown(3);
    expect(race.phase).toBe('countdown');
    expect(race.raceTime).toBe(0);
    expect(race.getRacer(0)?.completedLaps).toBe(0);
    expect(race.getRacer(0)?.nextCheckpoint).toBe(1);
    expect(race.getRacer(0)?.finished).toBe(false);

    // Countdown then complete 2 valid laps
    race.update(3);
    expect(race.phase).toBe('racing');

    for (let lap = 0; lap < 2; lap++) {
      race.update(8);
      expect(race.passCheckpoint(0, 1)).toBe(true);
      expect(race.passCheckpoint(0, 2)).toBe(true);
      expect(race.passCheckpoint(0, 0)).toBe(true);
    }

    expect(race.getRacer(0)?.finished).toBe(true);
    expect(race.phase).toBe('finished');
  });

  it('6. ranks finished racers ahead of unfinished racers and sorts finished racers by finish time', () => {
    const race = new RaceState(1, 3);
    race.reset([0, 1, 2, 3]);
    race.startCountdown(0);

    // Racer 2 finishes at t = 15s
    race.update(15);
    race.passCheckpoint(2, 1);
    race.passCheckpoint(2, 2);
    race.passCheckpoint(2, 0);

    // Racer 1 finishes at t = 18s
    race.update(3);
    race.passCheckpoint(1, 1);
    race.passCheckpoint(1, 2);
    race.passCheckpoint(1, 0);

    // Racer 0 and 3 are still racing; Racer 0 has higher progress than Racer 3
    const progress = new Map<number, number>([
      [0, 950],
      [1, 1000],
      [2, 1000],
      [3, 1200], // Even if raw progress number is higher, finished racers rank ahead
    ]);

    const rankings = race.getRankings(progress);
    expect(rankings.map((r) => r.racerId)).toEqual([2, 1, 3, 0]);
    expect(rankings[0].position).toBe(1);
    expect(rankings[1].position).toBe(2);
    expect(rankings[2].position).toBe(3);
    expect(rankings[3].position).toBe(4);
  });
});
