import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UiSettings } from "@life/shared";
import { getUiSettings } from "../api";

// Stamp the saved font/theme onto <html> as data attributes; index.css maps
// them to a font stack and (for light) a remapped zinc scale. Called on load
// and again right after a save so changes take effect immediately.
export function applyUiSettings(s: UiSettings) {
  const root = document.documentElement;
  root.dataset.font = s.font;
  root.dataset.theme = s.theme;
  // Density sliders write the CSS vars directly (inline style on <html>
  // outranks the @theme defaults in index.css). Base text reads slightly
  // looser than xs/sm so paragraphs don't collapse at tight settings.
  root.style.setProperty("--spacing", `${s.spacing}rem`);
  root.style.setProperty("--text-xs--line-height", String(s.lineHeight));
  root.style.setProperty("--text-sm--line-height", String(s.lineHeight));
  root.style.setProperty("--text-base--line-height", String(Math.min(s.lineHeight + 0.1, 1.6)));
}

export const UI_SETTINGS_QUERY_KEY = ["ui-settings"];

export function useUiSettings() {
  return useQuery({ queryKey: UI_SETTINGS_QUERY_KEY, queryFn: getUiSettings });
}

// Mounted once in App: applies the stored settings whenever they (re)load.
export function ApplyUiSettings() {
  const settings = useUiSettings();
  useEffect(() => {
    if (settings.data) applyUiSettings(settings.data);
  }, [settings.data]);
  return null;
}
