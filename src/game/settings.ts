export type QualityLevel = 'low' | 'medium' | 'high';

export interface GameSettings {
  soundEnabled: boolean;
  quality: QualityLevel;
}

export const STORAGE_KEYS = {
  BEST_LAP: 'arcade-racer-best-lap-v1',
  SETTINGS: 'arcade-racer-settings-v1',
} as const;

export function detectInitialQuality(): QualityLevel {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'high';
  }
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const cores = navigator.hardwareConcurrency || 4;
  if (isTouch && cores <= 4) {
    return 'low';
  }
  if (isTouch || cores <= 4) {
    return 'medium';
  }
  return 'high';
}

export function loadSettings(): GameSettings {
  const defaultSettings: GameSettings = {
    soundEnabled: true,
    quality: detectInitialQuality(),
  };

  try {
    if (typeof localStorage === 'undefined') return defaultSettings;
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      soundEnabled:
        typeof parsed.soundEnabled === 'boolean'
          ? parsed.soundEnabled
          : defaultSettings.soundEnabled,
      quality:
        parsed.quality === 'low' || parsed.quality === 'medium' || parsed.quality === 'high'
          ? parsed.quality
          : defaultSettings.quality,
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch {
    // Ignore storage errors in private browsing or restricted contexts
  }
}

export function loadBestLap(): number | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEYS.BEST_LAP);
    if (!raw) return null;
    const val = Number.parseFloat(raw);
    return Number.isFinite(val) && val > 0 ? val : null;
  } catch {
    return null;
  }
}

export function saveBestLap(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const existing = loadBestLap();
    if (existing === null || seconds < existing) {
      localStorage.setItem(STORAGE_KEYS.BEST_LAP, seconds.toFixed(4));
    }
  } catch {
    // Ignore storage errors
  }
}
