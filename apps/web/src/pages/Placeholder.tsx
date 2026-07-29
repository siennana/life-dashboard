// Reused for every page that isn't built yet. Shows the section name so you
// can tell where you are; swap in a real page component when it's implemented.
export function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-zinc-500">Coming soon.</p>
    </div>
  );
}
