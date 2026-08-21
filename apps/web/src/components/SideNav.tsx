import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { NAV_ITEMS, type NavItem } from "../nav";
import {
  BankIcon,
  BookIcon,
  CalendarIcon,
  ChevronRightIcon,
  ExerciseIcon,
  FolderIcon,
  GearIcon,
  HashtagIcon,
  HomeIcon,
  TodoIcon,
  TrendingUpIcon,
  WalletIcon,
  XIcon,
} from "./icons";
import { TagEditor } from "./TagEditor";

// Page icon per nav path (nav.ts stays plain data — no React imports there).
// Convention (subject to change): an icon marks a page that is a *report with
// data*; a pure navigation folder (Stocks — its bare path just redirects to a
// tab) gets only the expand chevron. Finance keeps its icon because /finance
// is itself a data page, not just a folder.
export const NAV_ICONS: Record<string, (props: { className?: string }) => React.ReactElement> = {
  "/home": HomeIcon,
  "/todos": TodoIcon,
  "/calendar": CalendarIcon,
  "/finance": WalletIcon,
  "/finance/stocks/individual": TrendingUpIcon,
  "/finance/stocks/nm": TrendingUpIcon,
  "/finance/stocks/factset": TrendingUpIcon,
  "/finance/bank": BankIcon,
  "/exercise": ExerciseIcon,
  "/reading": BookIcon,
  "/projects": FolderIcon,
  "/settings": GearIcon,
  "/tags": HashtagIcon,
};

// The icon column: fixed-size slot so labels align whether or not a row has
// an icon.
function NavIcon({ path }: { path: string }) {
  const Icon = NAV_ICONS[path];
  if (!Icon) return null;
  return (
    <span className="flex w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

// Sidebar width is a per-window layout dimension (like a scroll position),
// not a synced preference, so it lives in localStorage rather than the
// Settings > Style DB round-trip — it also needs to update at drag speed.
const WIDTH_KEY = "sidenav-width";
const MIN_WIDTH = 160;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 192; // matches the old fixed w-48

function readStoredWidth(): number {
  const n = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n)) : DEFAULT_WIDTH;
}

// File-tree styling: a rotating chevron on the left of expandable items
// (files get an aligned blank in the chevron column) and full-width
// bordered-chip rows. Nesting shows as an indent *inside* the chip (no
// indent-guide line), so every chip's border spans the whole panel.

// A `>` chevron that rotates 90deg to point down when expanded (codicon-style).
function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRightIcon
      className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    />
  );
}

// Every row reads as a small bordered chip on the panel; the selected row's
// lighter (zinc-500) border is what differentiates it, not just the fill.
const rowClass = (active: boolean) =>
  `flex items-center gap-1.5 rounded-md border px-2 py-1 text-[13px] transition-colors ${
    active
      ? "border-zinc-500 bg-zinc-800 text-zinc-100"
      : "border-zinc-800 bg-zinc-800/40 text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200"
  }`;

// Deep check: is the current path inside this item's subtree?
function inSubtree(item: NavItem, pathname: string): boolean {
  return (item.children ?? []).some(
    (c) => pathname.startsWith(c.path) || inSubtree(c, pathname),
  );
}

// The per-depth tab inside a chip: children keep their parent-alignment
// indent, but as leading space within the full-width row rather than by
// narrowing the row itself.
function Indent({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return <span style={{ width: `${depth * 0.9}rem` }} className="shrink-0" aria-hidden="true" />;
}

// One tree entry at any depth; ones with children get a chevron that expands a
// nested list (recursively — Finance > Stocks > Individual/NM). A section
// auto-opens while any route in its subtree is active.
function NavEntry({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const location = useLocation();
  const childActive = inSubtree(item, location.pathname);
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const open = manuallyOpen || childActive;

  // A leaf item: no chevron, but a blank chevron column so labels line up.
  if (!item.children) {
    return (
      <li>
        <NavLink to={item.path} className={({ isActive }) => rowClass(isActive)}>
          <Indent depth={depth} />
          <span className="w-3.5 shrink-0" aria-hidden="true" />
          <NavIcon path={item.path} />
          <span className="truncate">{item.label}</span>
        </NavLink>
      </li>
    );
  }

  // Highlight the folder row only when the parent page itself is open (a child
  // route highlights the child row instead).
  const selfActive = location.pathname === item.path;

  return (
    <li>
      <div className={rowClass(selfActive)}>
        <Indent depth={depth} />
        {/* `end` on the label keeps the parent from matching child routes */}
        <button
          type="button"
          onClick={() => setManuallyOpen((v) => !v)}
          aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
          aria-expanded={open}
          className="flex w-3.5 shrink-0 items-center justify-center text-zinc-500 hover:text-zinc-200"
        >
          <Chevron open={open} />
        </button>
        <NavLink to={item.path} end className="flex min-w-0 flex-1 items-center gap-1.5">
          <NavIcon path={item.path} />
          <span className="truncate">{item.label}</span>
        </NavLink>
      </div>
      {open && (
        // Children stay full-width (their chips' borders span the panel) and
        // signal nesting via the Indent tab inside each row. Children recurse,
        // so a child with its own children (Stocks) gets a chevron + nested
        // list of its own.
        <ul className="mt-1 space-y-1">
          {item.children.map((child) => (
            <NavEntry key={child.path} item={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

// Drag handle straddling the sidebar's right border: a wide (8px) invisible
// hit target with a 1px line centered in it that lights up blue on hover and
// while dragging, so the affordance appears before the user commits to a drag.
function ResizeHandle({
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDoubleClick,
}: {
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar (double-click to reset)"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      className="group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none select-none"
    >
      <div
        className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${
          dragging ? "bg-blue-500" : "bg-transparent group-hover:bg-blue-500/70"
        }`}
      />
    </div>
  );
}

export function SideNav() {
  const mainItems = NAV_ITEMS.filter((i) => !i.bottom);
  const bottomItems = NAV_ITEMS.filter((i) => i.bottom);

  const [width, setWidth] = useState(readStoredWidth);
  const [dragging, setDragging] = useState(false);
  // The Edit Tags secondary drawer, sliding out beside the sidebar. Desktop
  // only — on mobile the same editor is the /tags page.
  const [tagsOpen, setTagsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const left = containerRef.current?.getBoundingClientRect().left ?? 0;
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX - left)));
  }

  function onPointerUp() {
    setDragging(false);
  }

  // Persist after each change (drag or double-click reset); cheap enough to
  // just follow `width` rather than special-casing "drag ended".
  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  // While dragging, force the resize cursor and block text selection
  // everywhere — otherwise fast pointer moves over page content flash the
  // wrong cursor and can select text.
  useEffect(() => {
    if (!dragging) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  return (
    <div ref={containerRef} className="relative hidden shrink-0 md:flex" style={{ width }}>
      {/* Floating-component styling: the panel sits inset from the viewport
          edges (m-2) with a full rounded border, so the page plane shows
          through the gap instead of the nav being flush/edge-to-edge. */}
      <nav className="m-2 flex min-w-0 flex-1 flex-col overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-3">
        <div className="px-2 text-sm font-semibold text-zinc-100">Life Dashboard</div>
        <ul className="mt-4 space-y-1">
          {mainItems.map((item) => (
            <NavEntry key={item.path} item={item} />
          ))}
        </ul>
        {/* Bottom-pinned entries below a divider: Edit Tags (opens the
            secondary drawer), then Settings. */}
        <ul className="mt-auto space-y-1 border-t border-zinc-800 pt-2">
          <li>
            <button
              type="button"
              onClick={() => setTagsOpen((v) => !v)}
              aria-expanded={tagsOpen}
              className={`w-full text-left ${rowClass(tagsOpen)}`}
            >
              <span className="flex w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
                <HashtagIcon className="h-3.5 w-3.5" />
              </span>
              <span className="truncate">Edit Tags</span>
            </button>
          </li>
          {bottomItems.map((item) => (
            <li key={item.path}>
              <NavLink to={item.path} className={({ isActive }) => rowClass(isActive)}>
                <span className="flex w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
                  <GearIcon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {tagsOpen && (
        <div className="absolute inset-y-0 left-full z-20 my-2 w-72 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-3 shadow-2xl">
          <div className="flex items-center justify-between px-1">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
              <HashtagIcon className="h-3.5 w-3.5 text-zinc-400" />
              Edit Tags
            </h2>
            <button
              type="button"
              onClick={() => setTagsOpen(false)}
              aria-label="Close tag editor"
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3">
            <TagEditor />
          </div>
        </div>
      )}
      <ResizeHandle
        dragging={dragging}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
      />
    </div>
  );
}
