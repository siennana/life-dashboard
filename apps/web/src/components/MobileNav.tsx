import { Link, Navigate, useLocation } from "react-router-dom";
import { NAV_ITEMS, type NavItem } from "../nav";
import { useIsMobile } from "../lib/useIsMobile";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

// Mobile navigation (below the `md` breakpoint): the index route (`/`) shows
// the nav tree as a full-screen menu, and every page gets a sticky header
// with a back-to-menu button + breadcrumbs. Desktop never sees any of this —
// `/` redirects to /home and the sidebar handles navigation.

// One tappable row — taller than the desktop sidebar rows on purpose
// (comfortable touch target), trailing chevron as the "drills in" affordance.
function MenuRow({ item }: { item: NavItem }) {
  return (
    <Link
      to={item.path}
      className="flex items-center justify-between rounded-lg px-3 py-3 text-base text-zinc-200 active:bg-zinc-800"
    >
      <span className="truncate">{item.label}</span>
      <span className="shrink-0 text-zinc-500">
        <ChevronRightIcon className="h-4 w-4" />
      </span>
    </Link>
  );
}

// Recursive branch: a row plus (when present) its indented children — same
// indent-guide styling as the desktop sidebar tree, any depth.
function MenuBranch({ item }: { item: NavItem }) {
  return (
    <li>
      <MenuRow item={item} />
      {item.children && (
        <ul className="ml-5 space-y-1 border-l border-zinc-700/70 pl-2">
          {item.children.map((child) => (
            <MenuBranch key={child.path} item={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function MobileNavMenu() {
  const mainItems = NAV_ITEMS.filter((i) => !i.bottom);
  const bottomItems = NAV_ITEMS.filter((i) => i.bottom);

  return (
    <div>
      <h1 className="px-3 text-lg font-semibold text-zinc-100">Life Dashboard</h1>
      <ul className="mt-4 space-y-1">
        {mainItems.map((item) => (
          <MenuBranch key={item.path} item={item} />
        ))}
      </ul>
      <ul className="mt-4 space-y-1 border-t border-zinc-800 pt-3">
        {bottomItems.map((item) => (
          <li key={item.path}>
            <MenuRow item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// Breadcrumb trail for the current page, derived from the nav tree — deepest
// match wins, so nested pages (Finance > Stocks > NM) come out as one crumb
// per level. Pages not in the tree (e.g. /plaid-link) fall back to a
// prettified path segment.
function findTrail(items: NavItem[], pathname: string): NavItem[] | null {
  for (const item of items) {
    const childTrail = item.children ? findTrail(item.children, pathname) : null;
    if (childTrail) return [item, ...childTrail];
    if (pathname.startsWith(item.path)) return [item];
  }
  return null;
}

function findCrumbs(pathname: string): { path: string; label: string }[] {
  const trail = findTrail(NAV_ITEMS, pathname);
  if (trail) return trail;
  const seg = pathname.split("/")[1] ?? "";
  const label = seg ? seg[0].toUpperCase() + seg.slice(1).replace(/-/g, " ") : "";
  return [{ path: pathname, label }];
}

export function MobileHeader() {
  const { pathname } = useLocation();
  // The menu itself has no header (nothing to go back to).
  if (pathname === "/") return null;

  const crumbs = findCrumbs(pathname);

  return (
    <header className="sticky top-0 z-20 flex items-center gap-1 border-b border-zinc-800 bg-zinc-950/95 px-2 py-2 backdrop-blur md:hidden">
      <Link
        to="/"
        aria-label="Back to menu"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-300 active:bg-zinc-800"
      >
        <ChevronLeftIcon className="h-4.5 w-4.5" />
      </Link>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, i) =>
          i < crumbs.length - 1 ? (
            <span key={crumb.path} className="flex items-center gap-1.5">
              <Link to={crumb.path} className="text-zinc-400 active:text-zinc-200">
                {crumb.label}
              </Link>
              <span className="text-zinc-600" aria-hidden="true">
                /
              </span>
            </span>
          ) : (
            <span key={crumb.path} className="truncate font-medium text-zinc-100">
              {crumb.label}
            </span>
          ),
        )}
      </nav>
    </header>
  );
}

// The `/` index route: menu on mobile, the usual /home redirect on desktop.
// Reacts to viewport changes, so crossing the breakpoint while on `/` resolves
// to the right view without a reload.
export function IndexRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileNavMenu /> : <Navigate to="/home" replace />;
}
