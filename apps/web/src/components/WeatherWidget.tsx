import { useQuery } from "@tanstack/react-query";
import type { WeatherDay } from "@life/shared";
import { getWeather } from "../api";
import { forecastWeekday, weatherEmoji } from "../lib/weather";

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

export function WeatherWidget() {
  const weather = useQuery({ queryKey: ["weather"], queryFn: getWeather });

  return (
    <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">Weather</h2>
        {weather.data?.location && (
          <span className="text-xs text-zinc-500">{weather.data.location}</span>
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
            <div className="mt-3 flex items-center gap-3">
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
