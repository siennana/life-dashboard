// Shared SVG icon primitives for the whole web app. Each takes a `className`
// (size + color via text-*), so callers control layout; these only own the
// vector art. Chart drawings (Bank/Stocks hand-rolled SVG) are not icons and
// stay in their pages.

type IconProps = { className?: string };

// Funnel — the calendar's filter button.
export function FunnelIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
    </svg>
  );
}

// Solid teardrop — menstruating-day marker + the period context-menu toggle.
export function BloodDropIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2C11 3.3 5 11.2 5 15.5a7 7 0 0 0 14 0C19 11.2 13 3.3 12 2z" />
    </svg>
  );
}

// Exercise figure (a lunging/stretching person) — logged-workout marker.
// Source: SVG Repo "exercise-game" (single filled outline path, 24x24).
export function ExerciseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M19.4297562,14.1657133l-2.8271484-0.5654297l-1.4990234-2.2485352l0.8447266-2.5356445c0.0888672-0.2646484,0.0625-0.5532227-0.0712891-0.7978516c-0.1347656-0.2441406-0.3642578-0.4213867-0.6347656-0.4887695l-3.7304688-0.9326172L8.7070999,3.7926662C8.5098343,3.594424,8.2373734,3.4933498,7.9551463,3.500674c-0.28125,0.0126953-0.5429688,0.1430664-0.7236328,0.3588867l-5,6c-0.3007813,0.3608398-0.3095703,0.8828125-0.0205078,1.2539063L7.4092479,17.79706c1.335938,1.7177734,3.3496099,2.7026367,5.5253911,2.7026367h5.8671875c1.7636719,0,3.1982422-1.4345703,3.1982422-3.1982422C22.0000687,15.7824125,20.919014,14.4635649,19.4297562,14.1657133z M18.8018265,18.4996967H12.934639c-1.5537109,0-2.9931641-0.7036133-3.9472656-1.9301758l-4.704102-6.0483389l0.5373535-0.6447144l3.3981938,4.2477417c0.1982422,0.2470703,0.4882813,0.3754883,0.7822266,0.3754883c0.21875,0,0.4394531-0.0717773,0.6240234-0.2192383c0.4306641-0.3447266,0.5009766-0.9741211,0.15625-1.4052734L6.1277537,8.3082304L8.0674515,5.981143l2.2255859,2.2255859c0.1279297,0.128418,0.2890625,0.2192383,0.4648438,0.2631836l2.9521484,0.737793l-0.6582031,1.9755859c-0.0976563,0.2929688-0.0546875,0.6142578,0.1162109,0.8710938l2,3c0.1474609,0.2207031,0.3759766,0.3740234,0.6357422,0.4257813l3.2333984,0.6464834c0.5576172,0.1118164,0.9628906,0.605957,0.9628906,1.1748047C20.0000687,17.9620991,19.4629593,18.4996967,18.8018265,18.4996967z" />
    </svg>
  );
}

// Circular-arrow refresh; spins while a sync is in flight. Used by the sync
// status table and the weather widget.
export function RefreshIcon({
  spinning,
  className = "h-3.5 w-3.5",
}: {
  spinning: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} ${spinning ? "animate-spin" : ""}`}
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

// Right-pointing chevron (codicon-style). The sidebar rotates it 90deg via a
// caller-supplied class to signal an expanded tree section.
export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
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

// Left-pointing chevron — the mobile page header's back button.
export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 4L6 8l4 4" />
    </svg>
  );
}

// ---- Nav-tree icons (lucide-style outlines, same stroke system) ------------

// House — Home.
export function HomeIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

// Checkbox with a tick — Todos.
export function TodoIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

// Month grid — Calendar.
export function CalendarIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

// Wallet — the Finance section parent.
export function WalletIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  );
}

// Rising trend line — the stock account pages.
export function TrendingUpIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

// Columned building (landmark) — Bank.
export function BankIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="3" y1="22" x2="21" y2="22" />
      <line x1="6" y1="18" x2="6" y2="11" />
      <line x1="10" y1="18" x2="10" y2="11" />
      <line x1="14" y1="18" x2="14" y2="11" />
      <line x1="18" y1="18" x2="18" y2="11" />
      <polygon points="12 2 20 7 4 7" />
    </svg>
  );
}

// Open-spine book — Reading.
export function BookIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

// Folder — Projects.
export function FolderIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// Plain check mark — "Plaid linked" status on the Stocks page.
export function CheckIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="4 12.5 10 18.5 20 6" />
    </svg>
  );
}

// Lucide-style gear — the pinned Settings nav entry.
export function GearIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
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
