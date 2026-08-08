import { Outlet } from "react-router-dom";
import { MobileHeader } from "./components/MobileNav";
import { SideNav } from "./components/SideNav";
import { ApplyUiSettings } from "./lib/settings";

export default function App() {
  return (
    // h-screen + overflow-hidden pins the shell to the viewport; only <main>
    // scrolls, so the sidebar stays put no matter how long a page gets.
    // Below `md` the sidebar is hidden — `/` renders the full-screen menu and
    // pages get the sticky back/breadcrumb header instead.
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Loads the stored font/theme and stamps them on <html>. */}
      <ApplyUiSettings />
      <SideNav />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        {/* Padding lives here (not on <main>) so the sticky header spans the
            full width and sits flush at the top of the scroll container. */}
        <div className="mx-auto max-w-3xl px-4 pt-3 pb-6 md:px-6 md:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
