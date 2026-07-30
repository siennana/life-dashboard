import { WeatherWidget } from "../components/WeatherWidget";
import { WeekCalendar } from "../components/WeekCalendar";
import { FinanceWidget } from "../components/FinanceWidget";
import { TodosWidget } from "../components/TodosWidget";
import { SyncStatus } from "../components/SyncStatus";

export function Home() {
  return (
    // Single spacing knob for all Home widgets — adjust gap-4 to taste.
    <div className="flex flex-col gap-4">
      <WeatherWidget />
      <WeekCalendar />
      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        <FinanceWidget />
        <TodosWidget />
      </div>
      <SyncStatus />
    </div>
  );
}
