// Weather presentation helpers. The emoji mapping lives here (frontend) rather
// than in the API's weather.ts because non-ASCII in the API source mojibakes
// under tsx/esbuild on Windows — the API sends WMO codes + ASCII labels.

// WMO weather code -> emoji.
export function weatherEmoji(code: number): string {
  if (code === 0) return "☀️";
  if (code === 1) return "🌤️";
  if (code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 57) return "🌦️";
  if (code >= 61 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "🌨️";
  if (code >= 80 && code <= 82) return "🌧️";
  if (code === 85 || code === 86) return "🌨️";
  if (code >= 95) return "⛈️";
  return "❓";
}

// Short weekday label for a forecast day; index 0 is always "Today".
export const forecastWeekday = (date: string, index: number) =>
  index === 0
    ? "Today"
    : new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
