export const CONTROL_IDS = ["left", "right", "gas", "brake", "boost"];

export const CONTROL_MODE_KEY = "myvault_neon_apex_controls";

export const TOUCH_CLEAR_EVENTS = new Set([
  "pointerup",
  "pointercancel",
  "lostpointercapture",
  "pause",
  "visibilityhidden",
  "pagehide",
  "blur",
]);

export function normalizeControlMode(mode) {
  return mode === "touch" || mode === "keyboard" || mode === "auto" ? mode : "auto";
}

export function detectTouchCapable(nav = {}, win = {}) {
  const points = Number(nav.maxTouchPoints || nav.msMaxTouchPoints || 0);
  if (points > 0) return true;
  return "ontouchstart" in win;
}

export function touchControlsVisible(mode, touchCapable) {
  const normalized = normalizeControlMode(mode);
  if (normalized === "touch") return true;
  if (normalized === "keyboard") return false;
  return Boolean(touchCapable);
}

export function shouldClearTouches(eventName) {
  return TOUCH_CLEAR_EVENTS.has(eventName);
}

export function createPointerTracker(controlIds = CONTROL_IDS) {
  const ids = [...controlIds];
  const pointers = new Map();
  const held = Object.fromEntries(ids.map((id) => [id, false]));

  function sync() {
    for (const id of ids) held[id] = false;
    for (const control of pointers.values()) {
      if (Object.prototype.hasOwnProperty.call(held, control)) held[control] = true;
    }
  }

  return {
    held,
    press(pointerId, control) {
      if (pointerId == null || !ids.includes(control)) return false;
      pointers.set(pointerId, control);
      sync();
      return true;
    },
    release(pointerId) {
      const removed = pointers.delete(pointerId);
      sync();
      return removed;
    },
    releaseAll() {
      const idsHeld = [...pointers.keys()];
      pointers.clear();
      sync();
      return idsHeld;
    },
    pointerCount() {
      return pointers.size;
    },
  };
}

export function chooseFullscreenAction({ nativeActive, fallbackActive, nativeSupported }) {
  if (nativeActive || fallbackActive) return "exit";
  if (nativeSupported) return "request-native";
  return "fallback";
}
