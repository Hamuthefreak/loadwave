/**
 * Where the app shows its touch shortcut layer — the floating driver action and
 * the quick-actions sheet.
 *
 * Phones are covered by the width clause; an iPad in *landscape* is 1024–1366px,
 * wider than the phone breakpoint, and used to get neither the bottom nav nor
 * any shortcut. `pointer: coarse` brings it back on, and it is false for a mouse
 * or trackpad — including iPad Safari's desktop-class user agent — so a desktop
 * of the same width is unaffected.
 *
 * Keep this string in step with the `@media (max-width: 960px), (pointer: coarse)`
 * rule that positions the driver FAB in styles.css.
 */
export const TOUCH_SHORTCUTS_QUERY = '(max-width: 960px), (pointer: coarse)';

/** True when the touch shortcut layer is (or should be) on screen. */
export function touchShortcutsShown(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(TOUCH_SHORTCUTS_QUERY).matches;
}

/** Subscribe to changes — a tablet rotating, or an external display. */
export function watchTouchShortcuts(onChange: (shown: boolean) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(TOUCH_SHORTCUTS_QUERY);
  const handler = () => onChange(mq.matches);
  handler();
  // Safari < 14 only has the deprecated listener API.
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }
  mq.addListener(handler);
  return () => mq.removeListener(handler);
}
