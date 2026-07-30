import { NavLink } from "react-router-dom";
import { NAV_ITEMS } from "../nav";

export function SideNav() {
  return (
    <nav className="w-48 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-900 p-4">
      <div className="px-2 text-sm font-semibold text-zinc-100">Life Dashboard</div>
      <ul className="mt-6 space-y-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
