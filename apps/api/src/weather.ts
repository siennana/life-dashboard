import type { WeatherResponse } from "@life/shared";

// Live read from Open-Meteo (free, no API key). Not stored — cached in memory,
// like the finance portfolio endpoint. Labels are ASCII only; the web app maps
// the WMO code to an emoji (non-ASCII in this file would mojibake under tsx).
const FORECAST_TTL_MS = 30 * 60 * 1000; // 30 min

// WMO weather codes -> short ASCII label.
const WMO_LABELS: Record<number, string> = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm, hail",
  99: "Thunderstorm, hail",
};
const label = (code: number) => WMO_LABELS[code] ?? "Unknown";

type Coords = { lat: number; lon: number; label: string };
const geocodeCache = new Map<string, Coords>();

// Turn a place name into coordinates via Open-Meteo's geocoder (cached; a
// place name almost never changes coordinates).
async function geocode(name: string): Promise<Coords | null> {
  const cached = geocodeCache.get(name);
  if (cached) return cached;
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`geocode failed: ${res.status}`);
  const body = (await res.json()) as {
    results?: { latitude: number; longitude: number; name: string; admin1?: string }[];
  };
  const hit = body.results?.[0];
  if (!hit) return null;
  const coords: Coords = {
    lat: hit.latitude,
    lon: hit.longitude,
    label: hit.admin1 ? `${hit.name}, ${hit.admin1}` : hit.name,
  };
  geocodeCache.set(name, coords);
  return coords;
}

let forecastCache: { key: string; expires: number; data: WeatherResponse } | null = null;

type Config = {
  weatherLocation?: string;
  weatherLatitude?: number;
  weatherLongitude?: number;
};

const EMPTY: WeatherResponse = { configured: false, location: null, current: null, daily: [] };

export async function getWeather(config: Config): Promise<WeatherResponse> {
  // Explicit coordinates win; otherwise geocode the location name.
  let coords: Coords | null = null;
  if (config.weatherLatitude != null && config.weatherLongitude != null) {
    coords = {
      lat: config.weatherLatitude,
      lon: config.weatherLongitude,
      label: config.weatherLocation ?? "your area",
    };
  } else if (config.weatherLocation) {
    coords = await geocode(config.weatherLocation);
  }
  if (!coords) return EMPTY;

  const key = `${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}`;
  const now = Date.now();
  if (forecastCache && forecastCache.key === key && forecastCache.expires > now) {
    return forecastCache.data;
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(coords.lat));
  url.searchParams.set("longitude", String(coords.lon));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
  );
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "7");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo forecast failed: ${res.status}`);
  const body = (await res.json()) as {
    current?: { temperature_2m: number; weather_code: number };
    daily: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: (number | null)[];
    };
  };

  const daily = body.daily.time.map((date, i) => ({
    date,
    code: body.daily.weather_code[i]!,
    label: label(body.daily.weather_code[i]!),
    tempMax: Math.round(body.daily.temperature_2m_max[i]!),
    tempMin: Math.round(body.daily.temperature_2m_min[i]!),
    precipProbability: body.daily.precipitation_probability_max[i] ?? null,
  }));

  const data: WeatherResponse = {
    configured: true,
    location: coords.label,
    current: body.current
      ? {
          temp: Math.round(body.current.temperature_2m),
          code: body.current.weather_code,
          label: label(body.current.weather_code),
        }
      : null,
    daily,
  };

  forecastCache = { key, expires: now + FORECAST_TTL_MS, data };
  return data;
}
