import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPeriods } from "../api";
import { dateKey } from "./calendar";
import { localToday } from "./todos";

// One day later than `date` (YYYY-MM-DD), as a YYYY-MM-DD string.
function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

// Fetches logged period ranges and expands them into the set of covered days
// (inclusive), for the calendar's red-circle rendering. An ongoing period
// (no end date yet) is treated as covering through today.
export function usePeriodDays() {
  const periods = useQuery({ queryKey: ["periods"], queryFn: getPeriods });

  const periodDays = useMemo(() => {
    const set = new Set<string>();
    const today = localToday();
    for (const p of periods.data?.periods ?? []) {
      const end = p.endDate ?? (p.startDate <= today ? today : p.startDate);
      for (let d = p.startDate; d <= end; d = nextDay(d)) set.add(d);
    }
    return set;
  }, [periods.data]);

  return { periodDays, periods };
}
