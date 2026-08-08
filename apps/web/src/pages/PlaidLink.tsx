import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createPlaidLinkToken, exchangePlaidToken } from "../api";

// Plaid Link's script attaches a global.
declare global {
  interface Window {
    Plaid?: {
      create: (opts: {
        token: string;
        onSuccess: (publicToken: string) => void;
        onExit?: () => void;
      }) => { open: () => void };
    };
  }
}

function loadPlaidScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Plaid) return resolve();
    const s = document.createElement("script");
    s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Plaid Link script"));
    document.head.appendChild(s);
  });
}

// One-time setup page (not in the nav — visit /plaid-link directly, or via
// the Stocks page CTAs): runs the Plaid Link flow, then shows the permanent
// access token to paste into .env. The default links the bank (transactions →
// PLAID_US_BANK_ACCESS_TOKEN); ?mode=investments links a brokerage — NM by default
// (PLAID_NM_ACCESS_TOKEN), or &account=individual for Fidelity
// (PLAID_FIDELITY_ACCESS_TOKEN).
export function PlaidLink() {
  const [params] = useSearchParams();
  const investments = params.get("mode") === "investments";
  const individual = investments && params.get("account") === "individual";
  const envVar = individual
    ? "PLAID_FIDELITY_ACCESS_TOKEN"
    : investments
      ? "PLAID_NM_ACCESS_TOKEN"
      : "PLAID_US_BANK_ACCESS_TOKEN";
  const target = individual ? "Fidelity" : investments ? "Northwestern Mutual" : "a bank";
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  async function connect() {
    try {
      setBusy(true);
      setStatus("Loading Plaid Link…");
      await loadPlaidScript();
      const { link_token } = await createPlaidLinkToken(investments ? "investments" : "transactions");
      setStatus("Opening bank login…");
      window.Plaid!.create({
        token: link_token,
        onSuccess: (publicToken) => {
          setStatus("Exchanging for access token…");
          exchangePlaidToken(publicToken)
            .then((res) => {
              setAccessToken(res.access_token);
              setStatus(null);
            })
            .catch((err) => setStatus((err as Error).message))
            .finally(() => setBusy(false));
        },
        onExit: () => {
          setBusy(false);
          setStatus(null);
        },
      }).open();
    } catch (err) {
      setStatus((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Connect {target}</h1>
      <p className="mt-1 text-sm text-zinc-400">
        One-time Plaid setup. Requires <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code> in{" "}
        <code>.env</code> first.
      </p>

      <section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        {!accessToken ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={connect}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? "Working…" : `Connect ${individual ? "Fidelity" : investments ? "NM" : "bank"} via Plaid`}
            </button>
            {status && <p className="mt-3 text-sm text-zinc-400">{status}</p>}
          </>
        ) : (
          <>
            <p className="text-sm text-emerald-400">
              {investments ? "Account" : "Bank"} connected. Final step:
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-zinc-300">
              <li>
                Copy this access token into <code>.env</code> as <code>{envVar}=…</code>
              </li>
              <li>
                Restart the API — {investments ? "holdings" : "transactions"} sync on boot, then
                every 5 minutes.
              </li>
            </ol>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs text-zinc-100">
              {accessToken}
            </pre>
            <p className="mt-2 text-xs text-zinc-500">
              Treat this like a password — it grants read access to your{" "}
              {investments ? "investment holdings" : "bank transactions"}.
            </p>
          </>
        )}
      </section>
    </>
  );
}
