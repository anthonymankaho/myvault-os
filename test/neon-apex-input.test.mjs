import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONTROL_IDS,
  chooseFullscreenAction,
  createPointerTracker,
  detectTouchCapable,
  normalizeControlMode,
  shouldClearTouches,
  touchControlsVisible,
} from "../games/neon-apex-input.mjs";

test("touch controls follow capability in auto mode and can be forced on or off", () => {
  assert.equal(detectTouchCapable({ maxTouchPoints: 5 }, {}), true);
  assert.equal(detectTouchCapable({ maxTouchPoints: 0, msMaxTouchPoints: 1 }, {}), true);
  assert.equal(detectTouchCapable({ maxTouchPoints: 0 }, { ontouchstart: null }), true);
  assert.equal(detectTouchCapable({ maxTouchPoints: 0 }, {}), false);

  assert.equal(touchControlsVisible("auto", true), true);
  assert.equal(touchControlsVisible("auto", false), false);
  assert.equal(touchControlsVisible("touch", false), true);
  assert.equal(touchControlsVisible("keyboard", true), false);
  assert.equal(normalizeControlMode("tablet"), "auto");
  assert.equal(touchControlsVisible("tablet", false), false);
});

test("each pointer is tracked separately and simultaneous controls stay held", () => {
  const input = createPointerTracker(CONTROL_IDS);
  assert.equal(input.press(1, "left"), true);
  assert.equal(input.press(2, "gas"), true);
  assert.equal(input.press(3, "boost"), true);
  assert.equal(input.press(4, "not-a-control"), false);
  assert.deepEqual(input.held, {
    left: true,
    right: false,
    gas: true,
    brake: false,
    boost: true,
  });

  assert.equal(input.release(2), true);
  assert.equal(input.held.gas, false);
  assert.equal(input.held.left, true);
  assert.equal(input.held.boost, true);

  input.press(5, "gas");
  input.press(6, "gas");
  assert.equal(input.release(5), true);
  assert.equal(input.held.gas, true);
  assert.equal(input.release(6), true);
  assert.equal(input.held.gas, false);
});

test("interrupted touches clear every held control without dropping a later press", () => {
  const input = createPointerTracker();
  input.press(11, "brake");
  input.press(12, "right");
  assert.deepEqual(input.releaseAll(), [11, 12]);
  assert.equal(input.pointerCount(), 0);
  assert.equal(input.held.brake, false);
  assert.equal(input.held.right, false);

  input.press(13, "left");
  assert.equal(input.release(99), false);
  assert.equal(input.held.left, true);
  assert.equal(input.release(13), true);
  assert.equal(input.held.left, false);
});

test("held inputs clear on release, cancel, capture loss, pause, hide, and blur, not on pointerleave", () => {
  for (const eventName of [
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "pause",
    "visibilityhidden",
    "pagehide",
    "blur",
  ]) {
    assert.equal(shouldClearTouches(eventName), true, eventName);
  }
  assert.equal(shouldClearTouches("pointerleave"), false);
  assert.equal(shouldClearTouches("pointerdown"), false);
  assert.equal(shouldClearTouches("resize"), false);
});

test("fullscreen asks for the native API first and exits whichever mode is active", () => {
  assert.equal(
    chooseFullscreenAction({ nativeActive: false, fallbackActive: false, nativeSupported: true }),
    "request-native",
  );
  assert.equal(
    chooseFullscreenAction({ nativeActive: false, fallbackActive: false, nativeSupported: false }),
    "fallback",
  );
  assert.equal(
    chooseFullscreenAction({ nativeActive: true, fallbackActive: false, nativeSupported: true }),
    "exit",
  );
  assert.equal(
    chooseFullscreenAction({ nativeActive: false, fallbackActive: true, nativeSupported: false }),
    "exit",
  );
});

test("the game page wires pointer capture, control modes, and a labelled fullscreen control", () => {
  const html = readFileSync(new URL("../games/neon-apex.html", import.meta.url), "utf8");
  assert.match(html, /setPointerCapture/);
  assert.match(html, /createPointerTracker/);
  assert.match(html, /touchControlsVisible/);
  assert.match(html, /chooseFullscreenAction/);
  assert.match(html, /data-mode="auto"/);
  assert.match(html, /data-mode="touch"/);
  assert.match(html, /data-mode="keyboard"/);
  assert.match(html, /data-control="left"/);
  assert.match(html, /data-control="right"/);
  assert.match(html, /data-control="gas"/);
  assert.match(html, /data-control="brake"/);
  assert.match(html, /data-control="boost"/);
  assert.match(html, /id="game"/);
  assert.match(html, />Fullscreen</);
  assert.match(html, /Exit fullscreen/);
  assert.doesNotMatch(html, /pointerleave/);
  assert.doesNotMatch(html, />FULL</);
  assert.doesNotMatch(html, /@media[^{]*max-width[\s\S]{0,500}\.touch-controls\s*\{[^}]*display:\s*flex/);
  assert.match(html, /requestFullscreen \|\|/);
});
