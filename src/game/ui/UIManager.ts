import { StandingEntry } from '../logic/RaceState';
import { formatOrdinal, formatTime } from '../utils';

export interface HUDData {
  speedKmh: number;
  position: number;
  totalRacers: number;
  lap: number;
  totalLaps: number;
  currentLapTime: number;
  bestLapTime: number | null;
  nitroPercent: number;
  isOffTrack: boolean;
}

export interface UIHandlers {
  onStartRace: () => void;
  onResumeRace: () => void;
  onRestartRace: () => void;
  onToggleSound: () => void;
  onResetCar: () => void;
}

export class UIManager {
  private startScreen: HTMLElement;
  private pauseScreen: HTMLElement;
  private resultsScreen: HTMLElement;
  private hudContainer: HTMLElement;
  private countdownBanner: HTMLElement;
  private touchControls: HTMLElement;

  private speedValueEl: HTMLElement;
  private positionValueEl: HTMLElement;
  private lapValueEl: HTMLElement;
  private lapTimeValueEl: HTMLElement;
  private bestLapValueEl: HTMLElement;
  private nitroFillEl: HTMLElement;
  private offTrackBadgeEl: HTMLElement;

  private resultsHeadlineEl: HTMLElement;
  private resultsTableBodyEl: HTMLElement;
  private resultsBestLapEl: HTMLElement;

  private soundButtons: NodeListOf<HTMLButtonElement>;

  constructor(handlers: UIHandlers, isTouchDevice: boolean) {
    this.startScreen = document.getElementById('start-screen')!;
    this.pauseScreen = document.getElementById('pause-screen')!;
    this.resultsScreen = document.getElementById('results-screen')!;
    this.hudContainer = document.getElementById('hud')!;
    this.countdownBanner = document.getElementById('countdown-banner')!;
    this.touchControls = document.getElementById('touch-controls')!;

    this.speedValueEl = document.getElementById('hud-speed')!;
    this.positionValueEl = document.getElementById('hud-position')!;
    this.lapValueEl = document.getElementById('hud-lap')!;
    this.lapTimeValueEl = document.getElementById('hud-lap-time')!;
    this.bestLapValueEl = document.getElementById('hud-best-lap')!;
    this.nitroFillEl = document.getElementById('hud-nitro-fill')!;
    this.offTrackBadgeEl = document.getElementById('hud-offtrack')!;

    this.resultsHeadlineEl = document.getElementById('results-headline')!;
    this.resultsTableBodyEl = document.getElementById('results-tbody')!;
    this.resultsBestLapEl = document.getElementById('results-best-lap')!;

    this.soundButtons = document.querySelectorAll<HTMLButtonElement>('[data-action="toggle-sound"]');

    document
      .getElementById('btn-start-race')
      ?.addEventListener('click', () => handlers.onStartRace());
    document
      .getElementById('btn-resume-race')
      ?.addEventListener('click', () => handlers.onResumeRace());
    document
      .getElementById('btn-pause-restart')
      ?.addEventListener('click', () => handlers.onRestartRace());
    document
      .getElementById('btn-results-restart')
      ?.addEventListener('click', () => handlers.onRestartRace());
    document
      .getElementById('btn-hud-pause')
      ?.addEventListener('click', () => handlers.onResumeRace());
    document
      .getElementById('btn-hud-reset')
      ?.addEventListener('click', () => handlers.onResetCar());

    this.soundButtons.forEach((btn) => {
      btn.addEventListener('click', () => handlers.onToggleSound());
    });

    if (isTouchDevice) {
      this.touchControls.classList.remove('hidden');
    }
  }

  public getTouchControlsElement(): HTMLElement {
    return this.touchControls;
  }

  public setSoundEnabled(enabled: boolean): void {
    const label = `Sound: ${enabled ? 'ON' : 'OFF'}`;
    this.soundButtons.forEach((btn) => {
      btn.textContent = label;
      btn.setAttribute('aria-pressed', String(enabled));
    });
  }

  public showStartScreen(): void {
    this.startScreen.classList.remove('hidden');
    this.pauseScreen.classList.add('hidden');
    this.resultsScreen.classList.add('hidden');
    this.hudContainer.classList.add('hidden');
    this.countdownBanner.classList.add('hidden');
  }

  public showRacingHUD(): void {
    this.startScreen.classList.add('hidden');
    this.pauseScreen.classList.add('hidden');
    this.resultsScreen.classList.add('hidden');
    this.hudContainer.classList.remove('hidden');
  }

  public setPauseMenuVisible(visible: boolean): void {
    this.pauseScreen.classList.toggle('hidden', !visible);
  }

  public updateCountdownText(text: string | null): void {
    if (!text) {
      this.countdownBanner.classList.add('hidden');
      this.countdownBanner.textContent = '';
      return;
    }
    this.countdownBanner.classList.remove('hidden');
    this.countdownBanner.textContent = text;
    this.countdownBanner.classList.toggle('go', text === 'GO!');
  }

  public updateHUD(data: HUDData): void {
    this.speedValueEl.textContent = String(Math.round(data.speedKmh));
    this.positionValueEl.textContent = `${formatOrdinal(data.position)} / ${data.totalRacers}`;
    this.lapValueEl.textContent = `${data.lap} / ${data.totalLaps}`;
    this.lapTimeValueEl.textContent = formatTime(data.currentLapTime);
    this.bestLapValueEl.textContent = formatTime(data.bestLapTime);
    this.nitroFillEl.style.width = `${Math.round(data.nitroPercent)}%`;
    this.offTrackBadgeEl.classList.toggle('hidden', !data.isOffTrack);
  }

  public showResultsScreen(
    standings: StandingEntry[],
    racerNames: Map<number, string>,
    overallBestLap: number | null
  ): void {
    this.pauseScreen.classList.add('hidden');
    this.countdownBanner.classList.add('hidden');
    this.resultsScreen.classList.remove('hidden');

    const playerEntry = standings.find((s) => s.racerId === 0);
    const pos = playerEntry ? playerEntry.position : 4;
    this.resultsHeadlineEl.textContent =
      pos === 1
        ? 'VICTORY! YOU FINISHED 1ST!'
        : `RACE COMPLETE — YOU FINISHED ${formatOrdinal(pos)}`;

    this.resultsTableBodyEl.innerHTML = '';
    for (const entry of standings) {
      const tr = document.createElement('tr');
      if (entry.racerId === 0) {
        tr.classList.add('player-row');
      }

      const posTd = document.createElement('td');
      posTd.textContent = formatOrdinal(entry.position);

      const nameTd = document.createElement('td');
      nameTd.textContent = racerNames.get(entry.racerId) ?? `Car #${entry.racerId + 1}`;

      const statusTd = document.createElement('td');
      if (entry.finished && entry.finishTime !== null) {
        statusTd.textContent = formatTime(entry.finishTime);
      } else {
        statusTd.textContent = `${entry.completedLaps} / 3 Laps`;
      }

      const bestTd = document.createElement('td');
      bestTd.textContent = formatTime(entry.bestLapTime);

      tr.append(posTd, nameTd, statusTd, bestTd);
      this.resultsTableBodyEl.appendChild(tr);
    }

    this.resultsBestLapEl.textContent = `All-Time Best Lap: ${formatTime(overallBestLap)}`;
  }
}
