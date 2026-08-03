import { WeatherWidget } from "../components/WeatherWidget";
import { WeekCalendar } from "../components/WeekCalendar";
import { FinanceWidget } from "../components/FinanceWidget";
import { TodosWidget } from "../components/TodosWidget";
import { SyncStatus } from "../components/SyncStatus";

export function Home() {
  return (
    // Single spacing knob for all Home widgets — adjust gap-3 to taste.
    // Matches the mt-3 block spacing used on the Exercise/Finance pages.
    <div className="flex flex-col gap-3">
      <WeatherWidget />
      <WeekCalendar />
      <div className="grid gap-3 lg:grid-cols-2 lg:items-stretch">
        <FinanceWidget />
        <TodosWidget />
      </div>
      <SyncStatus />
    </div>
  );
}
