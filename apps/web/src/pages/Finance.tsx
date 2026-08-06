import { FinanceWidget } from "../components/FinanceWidget";

// Finance landing page. Placeholder for now — will grow into a summary pulling
// from each sub-section (Stocks, Bank). Reuses the Home portfolio widget.
export function Finance() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Finance</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Summary coming soon — see Stocks and Bank in the sidebar for details.
      </p>
      <div className="mt-3">
        <FinanceWidget />
      </div>
    </>
  );
}
