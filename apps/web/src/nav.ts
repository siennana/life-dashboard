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
      {
        path: "/finance/stocks",
        label: "Stocks",
        implemented: true,
        // One route per account tab — the Stocks page's folder tabs and these
        // nav entries drive the same URL (/finance/stocks redirects to the
        // last-viewed one).
        children: [
          { path: "/finance/stocks/individual", label: "Individual", implemented: true },
          { path: "/finance/stocks/nm", label: "NM", implemented: true },
          { path: "/finance/stocks/factset", label: "FactSet 401k", implemented: true },
        ],
      },
      { path: "/finance/bank", label: "Bank", implemented: true },
    ],
  },
  { path: "/exercise", label: "Exercise", implemented: true },
  { path: "/reading", label: "Reading", implemented: true },
  { path: "/projects", label: "Projects", implemented: true },
  { path: "/settings", label: "Settings", implemented: true, bottom: true },
];

// The tree flattened (parents then descendants, any depth) — for route generation.
const flatten = (items: NavItem[]): NavItem[] =>
  items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
export const ALL_NAV_ITEMS: NavItem[] = flatten(NAV_ITEMS);
