import { useSyncExternalStore } from "react";

/**
 * The width from which a role's desktop design is used; below it the phone design is used. It equals Tailwind's
 * `lg` breakpoint, so a screen can switch with `lg:` classes alone. The Store has both designs
 * (desktop 1440×900, phone 390×844); a tablet held upright gets the phone design, sideways the desktop one.
 */
export const DESKTOP_MIN_WIDTH = 1024;

let media: MediaQueryList | null = null;

/** One shared query, created on first use. */
function desktopMedia(): MediaQueryList {
  media ??= window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);
  return media;
}

function subscribe(onChange: () => void) {
  const query = desktopMedia();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True when the desktop design applies. Use it where the two designs need different components (a sidebar or a
 * tab bar, a dialog or a page); where they differ only in layout, prefer `lg:` classes.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, () => desktopMedia().matches);
}
