import { Outlet } from "react-router-dom";
import { SideNav } from "./components/SideNav";

export default function App() {
  return (
    // h-screen + overflow-hidden pins the shell to the viewport; only <main>
    // scrolls, so the sidebar stays put no matter how long a page gets.
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <SideNav />
      <main className="flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto max-w-3xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
