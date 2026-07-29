import { Outlet } from "react-router-dom";
import { SideNav } from "./components/SideNav";

export default function App() {
  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <SideNav />
      <main className="flex-1 px-6 py-10">
        <div className="mx-auto max-w-3xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
