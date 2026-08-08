import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WeatherDay, WeatherHour } from "@life/shared";
import { getWeather } from "../api";
import { RefreshIcon } from "./icons";
import { forecastWeekday, weatherEmoji } from "../lib/weather";

// How many hours ahead to show next to the current-conditions block.
const HOURS_SHOWN = 6;

function hourLabel(time: string, index: number) {
  if (index === 0) return "Now";
  return new Date(time).toLocaleTimeString(undefined, { hour: "numeric" });
}

function HourCard({ hour, index }: { hour: WeatherHour; index: number }) {
  return (
    <div className="flex min-w-12 flex-1 flex-col items-center gap-1">
      <span className="text-xs font-medium text-zinc-400">{hourLabel(hour.time, index)}</span>
      <span className="text-lg" title={weatherEmoji(hour.code)}>
        {weatherEmoji(hour.code)}
      </span>
      <span className="text-sm tabular-nums text-zinc-100">{hour.temp}&deg;</span>
    </div>
  );
}

function DayCard({ day, index }: { day: WeatherDay; index: number }) {
  return (
    <div className="flex min-w-16 flex-1 flex-col items-center gap-1 rounded-lg bg-zinc-800/50 px-2 py-3">
      <span className="text-xs font-medium text-zinc-400">{forecastWeekday(day.date, index)}</span>
      <span className="text-2xl" title={day.label}>
        {weatherEmoji(day.code)}
      </span>
      <span className="text-sm tabular-nums text-zinc-100">{day.tempMax}&deg;</span>
      <span className="text-xs tabular-nums text-zinc-500">{day.tempMin}&deg;</span>
      {day.precipProbability != null && day.precipProbability > 0 && (
        <span className="text-xs tabular-nums text-sky-400">{day.precipProbability}%</span>
      )}
    </div>
  );
}

// "Weather pulled" time, not "browser asked" time — the server caches Open-
// Meteo responses for 30min, so those can differ; the sync button forces a
// fresh pull and moves this forward.
const fmtFetchedAt = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function WeatherWidget() {
  const queryClient = useQueryClient();
  const weather = useQuery({ queryKey: ["weather"], queryFn: () => getWeather() });
  const resync = useMutation({
    mutationFn: () => getWeather(true),
    onSuccess: (data) => queryClient.setQueryData(["weather"], data),
  });

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Weather</h2>
          {weather.data?.location && (
            <span className="truncate text-xs text-zinc-500">{weather.data.location}</span>
          )}
        </div>
        {weather.data?.fetchedAt && (
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-xs text-zinc-500">As of {fmtFetchedAt(weather.data.fetchedAt)}</span>
            <button
              type="button"
              onClick={() => resync.mutate()}
              disabled={resync.isPending}
              aria-label="Refresh weather"
              title="Refresh weather"
              className="flex cursor-pointer text-zinc-500 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshIcon spinning={resync.isPending} />
            </button>
          </div>
        )}
      </div>

      {weather.isPending && <p className="mt-3 text-zinc-400">Loading forecast…</p>}
      {weather.isError && (
        <p className="mt-3 text-red-400">Couldn't load weather — {(weather.error as Error).message}</p>
      )}
      {weather.data && !weather.data.configured && (
        <p className="mt-3 text-sm text-zinc-400">
          Set <code>WEATHER_LOCATION</code> in <code>.env</code> to show your local forecast.
        </p>
      )}

      {weather.data?.configured && (
        <>
          {weather.data.current && (
            <div className="mt-3 flex items-center gap-4">
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-4xl" title={weather.data.current.label}>
                  {weatherEmoji(weather.data.current.code)}
                </span>
                <div>
                  <div className="text-3xl font-semibold text-zinc-100">
                    {weather.data.current.temp}&deg;
                  </div>
                  <div className="text-sm text-zinc-400">{weather.data.current.label}</div>
                </div>
              </div>
              {weather.data.hourly.length > 0 && (
                <div className="flex min-w-0 flex-1 items-center gap-1 border-l border-zinc-800 pl-4">
                  {weather.data.hourly.slice(0, HOURS_SHOWN).map((hour, i) => (
                    <HourCard key={hour.time} hour={hour} index={i} />
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="mt-4 flex gap-2 overflow-x-auto">
            {weather.data.daily.map((day, i) => (
              <DayCard key={day.date} day={day} index={i} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
