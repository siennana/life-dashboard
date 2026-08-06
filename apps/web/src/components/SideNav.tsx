import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { NAV_ITEMS, type NavItem } from "../nav";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${
    isActive
      ? "bg-zinc-800 text-zinc-100"
      : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
  }`;

// A top-level entry; ones with children get a chevron that expands a nested
// list. The section auto-opens while any of its child routes is active.
function NavEntry({ item }: { item: NavItem }) {
  const location = useLocation();
  const childActive = (item.children ?? []).some((c) => location.pathname.startsWith(c.path));
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const open = manuallyOpen || childActive;

  if (!item.children) {
    return (
      <li>
        <NavLink to={item.path} className={linkClass}>
          {item.label}
        </NavLink>
      </li>
    );
  }

  return (
    <li>
      <div className="flex items-center">
        {/* `end` so the parent doesn't highlight while a child route is active */}
        <NavLink to={item.path} end className={linkClass}>
          {item.label}
        </NavLink>
        <button
          type="button"
          aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
          aria-expanded={open}
          onClick={() => setManuallyOpen((v) => !v)}
          className="shrink-0 rounded-md px-1.5 py-1 text-xs text-zinc-500 hover:text-zinc-200"
        >
          {open ? "▾" : "▸"}
        </button>
      </div>
      {open && (
        <ul className="ml-3 mt-1 space-y-1 border-l border-zinc-800 pl-2">
          {item.children.map((child) => (
            <li key={child.path}>
              <NavLink to={child.path} className={linkClass}>
                {child.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function SideNav() {
  return (
    <nav className="w-48 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-900 p-4">
      <div className="px-2 text-sm font-semibold text-zinc-100">Life Dashboard</div>
      <ul className="mt-6 space-y-1">
        {NAV_ITEMS.map((item) => (
          <NavEntry key={item.path} item={item} />
        ))}
      </ul>
    </nav>
  );
}
