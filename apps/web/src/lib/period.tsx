import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPeriods } from "../api";

// The set of days marked as menstruating, for the calendar's red-circle
// rendering. Each day is toggled independently — no ranges to expand.
export function usePeriodDays() {
  const periods = useQuery({ queryKey: ["periods"], queryFn: getPeriods });
  const periodDays = useMemo(() => new Set(periods.data?.days ?? []), [periods.data]);
  return { periodDays, periods };
}
