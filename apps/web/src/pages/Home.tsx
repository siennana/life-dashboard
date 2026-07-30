import { WeatherWidget } from "../components/WeatherWidget";
import { WeekCalendar } from "../components/WeekCalendar";
import { FinanceWidget } from "../components/FinanceWidget";
import { SyncStatus } from "../components/SyncStatus";

export function Home() {
  return (
    <>
      <WeatherWidget />
      <WeekCalendar />
      <FinanceWidget />
      <SyncStatus />
    </>
  );
}
