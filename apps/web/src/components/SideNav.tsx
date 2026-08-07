import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { NAV_ITEMS, type NavItem } from "../nav";

// VS Code file-tree styling: a rotating chevron on the left of expandable
// items (files get an aligned blank in the chevron column), flat full-row
// highlight, and an indent-guide line down the left of nested children.

function Chevron({ open }: { open: boolean }) {
  // A `>` chevron that rotates 90deg to point down when expanded (codicon-style).
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

const rowClass = (active: boolean) =>
  `flex items-center gap-1.5 rounded px-2 py-1 text-[13px] transition-colors ${
    active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
  }`;

// A top-level entry; ones with children get a chevron that expands a nested
// list. The section auto-opens while any of its child routes is active.
function NavEntry({ item }: { item: NavItem }) {
  const location = useLocation();
  const childActive = (item.children ?? []).some((c) => location.pathname.startsWith(c.path));
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
        // under the parent's chevron.
        <ul className="mt-0.5 ml-[0.9rem] space-y-0.5 border-l border-zinc-700/70 pl-2">
          {item.children.map((child) => (
            <li key={child.path}>
              <NavLink to={child.path} className={({ isActive }) => rowClass(isActive)}>
                <span className="truncate">{child.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// Lucide-style gear for the pinned Settings entry.
function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function SideNav() {
  const mainItems = NAV_ITEMS.filter((i) => !i.bottom);
  const bottomItems = NAV_ITEMS.filter((i) => i.bottom);
  return (
    <nav className="flex w-48 shrink-0 flex-col overflow-y-auto border-r border-zinc-800 bg-zinc-900 p-3">
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
                <GearIcon />
              </span>
              <span className="truncate">{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
