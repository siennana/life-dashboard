import { useSyncExternalStore } from "react";

// Tailwind v4's `md` breakpoint (48rem). Below it the sidebar is hidden and
// the mobile menu/header take over — keep in sync with the `md:` classes in
// App.tsx / SideNav.tsx / MobileNav.tsx.
const DESKTOP_QUERY = "(min-width: 48rem)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => !window.matchMedia(DESKTOP_QUERY).matches);
}
