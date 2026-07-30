// Single source of truth for the sidebar + routes. Add a page here and it
// shows up in the nav and gets a route automatically.
export type NavItem = { path: string; label: string; implemented?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { path: "/home", label: "Home", implemented: true },
  { path: "/todos", label: "Todos", implemented: true },
  { path: "/calendar", label: "Calendar", implemented: true },
  { path: "/finance", label: "Finance", implemented: true },
  { path: "/exercise", label: "Exercise", implemented: true },
  { path: "/reading", label: "Reading", implemented: true },
  { path: "/projects", label: "Projects" },
  { path: "/wedding", label: "Wedding" },
];
