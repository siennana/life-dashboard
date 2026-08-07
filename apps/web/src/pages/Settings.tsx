import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UI_FONTS, UI_THEMES, type UiFont, type UiSettings, type UiTheme } from "@life/shared";
import { saveUiSettings } from "../api";
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
};
// Slider bounds mirror the zod schema in @life/shared.
const SPACING_MIN = 0.18;
const SPACING_MAX = 0.3;
const SPACING_DEFAULT = 0.25; // Tailwind's stock --spacing
const LINE_HEIGHT_MIN = 1;
const LINE_HEIGHT_MAX = 1.6;

const fieldClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none";

// Panel registry: one entry per settings panel so more (sync, data, ...) can
// slot in later without touching the page shell.
const PANELS = ["style"] as const;
type Panel = (typeof PANELS)[number];
const PANEL_LABELS: Record<Panel, string> = { style: "Style" };

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
        <div className="min-w-0 flex-1">{panel === "style" && <StylePanel />}</div>
      </div>
    </>
  );
}
