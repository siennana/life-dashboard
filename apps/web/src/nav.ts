// Single source of truth for the sidebar + routes. Add a page here and it
// shows up in the nav and gets a route automatically. Items with `children`
// render as a dropdown in the sidebar; the parent path is its own page too.
export type NavItem = {
  path: string;
  label: string;
  implemented?: boolean;
  children?: NavItem[];
  // Pinned to the bottom of the sidebar (Settings), below the main tree.
  bottom?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { path: "/home", label: "Home", implemented: true },
  { path: "/todos", label: "Todos", implemented: true },
  { path: "/calendar", label: "Calendar", implemented: true },
  {
    path: "/finance",
    label: "Finance",
    implemented: true,
    children: [
      { path: "/finance/stocks", label: "Stocks", implemented: true },
      { path: "/finance/bank", label: "Bank", implemented: true },
    ],
  },
  { path: "/exercise", label: "Exercise", implemented: true },
  { path: "/reading", label: "Reading", implemented: true },
  { path: "/projects", label: "Projects" },
  { path: "/wedding", label: "Wedding" },
  { path: "/settings", label: "Settings", implemented: true, bottom: true },
];

// The tree flattened (parents then children) — for route generation.
export const ALL_NAV_ITEMS: NavItem[] = NAV_ITEMS.flatMap((item) => [
  item,
  ...(item.children ?? []),
]);
