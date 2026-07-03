import type { StatusResponse } from "@life/shared";

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const getStatus = () => apiFetch<StatusResponse>("/api/status");
