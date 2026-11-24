import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SYNC_MODES,
  UI_FONTS,
  UI_THEMES,
  type SyncMode,
  type UiFont,
  type UiSettings,
  type UiTheme,
} from "@life/shared";
import { getSyncSettings, saveSyncSettings, saveUiSettings } from "../api";
import { applyUiSettings, UI_SETTINGS_QUERY_KEY, useUiSettings } from "../lib/settings";

const FONT_LABELS: Record<UiFont, string> = {
  system: "System (default)",
  inter: "Inter",
  "jetbrains-mono": "JetBrains Mono",
  consolas: "Consolas (VS Code default)",
  georgia: "Georgia",
};
const THEME_LABELS: Record<UiTheme, string> = {
  dark: "Dark (default)",
  light: "Light",
  "royal-velvet": "Royal Velvet",
  sandbox: "Sandbox",
};
// Slider bounds mirror the zod schema in @life/shared.
const SPACING_MIN = 0.18;
const SPACING_MAX = 0.3;
const SPACING_DEFAULT = 0.25; // Tailwind's stock --spacing
const LINE_HEIGHT_MIN = 1;
const LINE_HEIGHT_MAX = 1.6;

const fieldClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none";

// Panel registry: one entry per settings panel so more (data, ...) can slot
// in later without touching the page shell.
const PANELS = ["style", "sync"] as const;
type Panel = (typeof PANELS)[number];
const PANEL_LABELS: Record<Panel, string> = { style: "Style", sync: "Sync" };

function StylePanel() {
  const queryClient = useQueryClient();
  const stored = useUiSettings();
  const [font, setFont] = useState<UiFont>("system");
  const [theme, setTheme] = useState<UiTheme>("dark");
  const [spacing, setSpacing] = useState(0.225);
  const [lineHeight, setLineHeight] = useState(1.25);
  const [savedNote, setSavedNote] = useState(false);

  // Prefill from the stored settings once they load (and after saves).
  useEffect(() => {
    if (!stored.data) return;
    setFont(stored.data.font);
    setTheme(stored.data.theme);
    setSpacing(stored.data.spacing);
    setLineHeight(stored.data.lineHeight);
  }, [stored.data]);

  // Live preview: a dropdown change applies to the whole app immediately, but
  // it's only a preview — leaving the panel without saving reverts to the last
  // stored settings (tracked via ref so the unmount cleanup sees the latest).
  const storedRef = useRef(stored.data);
  useEffect(() => {
    storedRef.current = stored.data;
  }, [stored.data]);
  useEffect(
    () => () => {
      if (storedRef.current) applyUiSettings(storedRef.current);
    },
    [],
  );

  function preview(next: UiSettings) {
    setFont(next.font);
    setTheme(next.theme);
    setSpacing(next.spacing);
    setLineHeight(next.lineHeight);
    setSavedNote(false);
    applyUiSettings(next);
  }
  const draft: UiSettings = { font, theme, spacing, lineHeight };

  const save = useMutation({
    mutationFn: (value: UiSettings) => saveUiSettings(value),
    onSuccess: (value) => {
      queryClient.setQueryData(UI_SETTINGS_QUERY_KEY, value);
      applyUiSettings(value); // take effect immediately, app-wide
      setSavedNote(true);
    },
  });

  const dirty =
    stored.data != null &&
    (font !== stored.data.font ||
      theme !== stored.data.theme ||
      spacing !== stored.data.spacing ||
      lineHeight !== stored.data.lineHeight);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Style</h2>
      {/* Bracketed (fixed) gaps on purpose: this form configures --spacing, so
          its own rhythm shouldn't warp with the value it controls. */}
      <div className="mt-[0.6rem] grid max-w-md grid-cols-1 gap-[0.25rem]">
        <label className="block">
          <span className="text-xs text-zinc-500">Font</span>
          <select
            value={font}
            onChange={(e) => preview({ ...draft, font: e.target.value as UiFont })}
            className={`${fieldClass} mt-1`}
          >
            {UI_FONTS.map((f) => (
              <option key={f} value={f}>
                {FONT_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Theme</span>
          <select
            value={theme}
            onChange={(e) => preview({ ...draft, theme: e.target.value as UiTheme })}
            className={`${fieldClass} mt-1`}
          >
            {UI_THEMES.map((t) => (
              <option key={t} value={t}>
                {THEME_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="flex justify-between text-xs text-zinc-500">
            <span>Spacing</span>
            <span className="tabular-nums text-zinc-400">
              {Math.round((spacing / SPACING_DEFAULT) * 100)}% of default
            </span>
          </span>
          <input
            type="range"
            min={SPACING_MIN}
            max={SPACING_MAX}
            step={0.005}
            value={spacing}
            onChange={(e) => preview({ ...draft, spacing: Number(e.target.value) })}
            className="mt-1 w-full accent-emerald-600"
          />
          <span className="flex justify-between text-[10px] text-zinc-600">
            <span>tighter</span>
            <span>roomier</span>
          </span>
        </label>
        <label className="block">
          <span className="flex justify-between text-xs text-zinc-500">
            <span>Line height</span>
            <span className="tabular-nums text-zinc-400">{lineHeight.toFixed(2)}×</span>
          </span>
          <input
            type="range"
            min={LINE_HEIGHT_MIN}
            max={LINE_HEIGHT_MAX}
            step={0.05}
            value={lineHeight}
            onChange={(e) => preview({ ...draft, lineHeight: Number(e.target.value) })}
            className="mt-1 w-full accent-emerald-600"
          />
          <span className="flex justify-between text-[10px] text-zinc-600">
            <span>terminal (1.15)</span>
            <span>airy</span>
          </span>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => save.mutate(draft)}
          disabled={save.isPending || stored.isPending || !dirty}
          className="cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {savedNote && !dirty && <span className="text-sm text-emerald-400">Saved</span>}
        {save.isError && (
          <span className="text-sm text-red-400">{(save.error as Error).message}</span>
        )}
      </div>
      <p className="mt-3 text-xs text-zinc-600">
        Changes preview live across the app — Save to keep them, or leave the page to revert.
      </p>
    </section>
  );
}

// Sync-loop behavior. Radio per mode with the trade-off spelled out; saving
// applies on this machine's API immediately (the other machine picks it up
// on its next DB touch). Stored in the shared settings table, so one choice
// governs both machines.
const SYNC_MODE_INFO: Record<SyncMode, { label: string; detail: string }> = {
  auto: {
    label: "Automatic",
    detail: "Sync every 5 minutes whenever dev is running. Keeps Neon's compute awake 24/7 — burns the free plan's monthly allowance in about 16 days.",
  },
  active: {
    label: "Active use (default)",
    detail: "Sync only while the dashboard is being used, plus one catch-up cycle a day so daily series (portfolio value, GitHub contributions) never gap. Neon sleeps the rest of the time.",
  },
  manual: {
    label: "Manual",
    detail: "No background syncing at all — only the sync buttons on the status widget and Todos page. Daily series gap on days you don't sync.",
  },
};

function SyncPanel() {
  const stored = useQuery({ queryKey: ["sync-settings"], queryFn: getSyncSettings });
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<SyncMode>("active");
  const [savedNote, setSavedNote] = useState(false);

  useEffect(() => {
    if (stored.data) setMode(stored.data.mode);
  }, [stored.data]);

  const save = useMutation({
    mutationFn: () => saveSyncSettings({ mode }),
    onSuccess: (value) => {
      queryClient.setQueryData(["sync-settings"], value);
      // The status widget's Interval column shows the mode.
      queryClient.invalidateQueries({ queryKey: ["status"] });
      setSavedNote(true);
    },
  });

  const dirty = stored.data != null && mode !== stored.data.mode;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Sync</h2>
      <p className="mt-2 max-w-xl text-xs text-zinc-500">
        When the API pulls from Todoist, iCloud, Plaid, GitHub, WakaTime, and the market data
        providers. One setting for both machines (shared database).
      </p>
      <div className="mt-3 max-w-xl space-y-2">
        {SYNC_MODES.map((m) => (
          <label
            key={m}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
              mode === m ? "border-zinc-600 bg-zinc-800/60" : "border-zinc-800 hover:bg-zinc-800/30"
            }`}
          >
            <input
              type="radio"
              name="sync-mode"
              checked={mode === m}
              onChange={() => {
                setMode(m);
                setSavedNote(false);
              }}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer border-zinc-600 bg-zinc-900 text-blue-500 focus:ring-0"
            />
            <span className="min-w-0">
              <span className="block text-sm text-zinc-100">{SYNC_MODE_INFO[m].label}</span>
              <span className="mt-0.5 block text-xs text-zinc-500">{SYNC_MODE_INFO[m].detail}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || stored.isPending || !dirty}
          className="cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {savedNote && !dirty && <span className="text-sm text-emerald-400">Saved</span>}
        {save.isError && (
          <span className="text-sm text-red-400">{(save.error as Error).message}</span>
        )}
      </div>
    </section>
  );
}

export function Settings() {
  const [panel, setPanel] = useState<Panel>("style");

  return (
    <>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="mt-4 flex gap-4">
        {/* Panel list; grows as more settings groups are added. */}
        <nav className="w-36 shrink-0">
          <ul className="space-y-0.5">
            {PANELS.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => setPanel(p)}
                  className={`w-full rounded px-2 py-1 text-left text-[13px] transition-colors ${
                    panel === p
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                  }`}
                >
                  {PANEL_LABELS[p]}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">
          {panel === "style" && <StylePanel />}
          {panel === "sync" && <SyncPanel />}
        </div>
      </div>
    </>
  );
}
