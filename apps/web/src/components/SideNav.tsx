import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { NAV_ITEMS, type NavItem } from "../nav";
import { ChevronRightIcon, GearIcon } from "./icons";

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

// VS Code file-tree styling: a rotating chevron on the left of expandable
// items (files get an aligned blank in the chevron column), flat full-row
// highlight, and an indent-guide line down the left of nested children.

// A `>` chevron that rotates 90deg to point down when expanded (codicon-style).
function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRightIcon
      className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    />
  );
}

const rowClass = (active: boolean) =>
  `flex items-center gap-1.5 rounded px-2 py-1 text-[13px] transition-colors ${
    active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
  }`;

// Deep check: is the current path inside this item's subtree?
function inSubtree(item: NavItem, pathname: string): boolean {
  return (item.children ?? []).some(
    (c) => pathname.startsWith(c.path) || inSubtree(c, pathname),
  );
}

// One tree entry at any depth; ones with children get a chevron that expands a
// nested list (recursively — Finance > Stocks > Individual/NM). A section
// auto-opens while any route in its subtree is active.
function NavEntry({ item }: { item: NavItem }) {
  const location = useLocation();
  const childActive = inSubtree(item, location.pathname);
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const open = manuallyOpen || childActive;

  // A leaf item: no chevron, but a blank chevron column so labels line up.
  if (!item.children) {
    return (
      <li>
        <NavLink to={item.path} className={({ isActive }) => rowClass(isActive)}>
          <span className="w-3.5 shrink-0" aria-hidden="true" />
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
        <NavLink to={item.path} end className="min-w-0 flex-1 truncate">
          {item.label}
        </NavLink>
      </div>
      {open && (
        // Indent guide: the vertical line down the left of the children, aligned
        // under the parent's chevron. Children recurse, so a child with its own
        // children (Stocks) gets a chevron + nested list of its own.
        <ul className="mt-0.5 ml-[0.9rem] space-y-0.5 border-l border-zinc-700/70 pl-2">
          {item.children.map((child) => (
            <NavEntry key={child.path} item={child} />
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
      <nav className="flex w-full flex-col overflow-y-auto border-r border-zinc-800 bg-zinc-900 p-3">
        <div className="px-2 text-sm font-semibold text-zinc-100">Life Dashboard</div>
        <ul className="mt-4 space-y-0.5">
          {mainItems.map((item) => (
            <NavEntry key={item.path} item={item} />
          ))}
        </ul>
        {/* Bottom-pinned entries (Settings) below a divider. */}
        <ul className="mt-auto space-y-0.5 border-t border-zinc-800 pt-2">
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
