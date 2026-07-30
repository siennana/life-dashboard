import { WeatherWidget } from "../components/WeatherWidget";
import { WeekCalendar } from "../components/WeekCalendar";
import { FinanceWidget } from "../components/FinanceWidget";

export function Home() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Home</h1>
      <p className="mt-1 text-sm text-zinc-400">Your day at a glance.</p>
      <WeatherWidget />
      <WeekCalendar />
      <FinanceWidget />
    </>
  );
}
