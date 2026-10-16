/** Supported ports. Evaluation only accepts these, so route geometry is always known. */

export type LngLat = [number, number];

export const PORTS: Record<string, LngLat> = {
  "Port of Shanghai": [121.8, 30.6],
  "Port of Shenzhen": [114.0, 22.5],
  "Port of Hong Kong": [114.2, 22.3],
  "Port of Kaohsiung": [120.3, 22.6],
  "Port of Busan": [129.0, 35.1],
  "Port of Tokyo": [139.7, 35.6],
  "Port of Singapore": [103.8, 1.3],
  "Port of Mumbai": [72.8, 18.9],
  "Port of Dubai": [55.3, 25.3],
  "Port of Rotterdam": [4.5, 51.9],
  "Port of Hamburg": [9.9, 53.5],
  "Port of Antwerp": [4.4, 51.3],
  "Port of New York": [-74.0, 40.7],
  "Port of Los Angeles": [-118.2, 33.7],
  "Port of Long Beach": [-118.2, 33.7],
  "Port of Sydney": [151.2, -33.9],
  "Port of Felixstowe": [1.3, 51.95],
  "Port of Valencia": [-0.3, 39.4],
  "Port of Jeddah": [39.2, 21.5],
  "Port of Colombo": [79.8, 6.9],
  "Port Klang": [101.4, 3.0],
  "Port of Savannah": [-81, 32],
  "Port of Manila": [121, 14.6],
  "Port of Cai Mep": [107, 10.5],
};

export const PORT_NAMES = Object.keys(PORTS);

function key(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ").replace(/^port of /, "");
}

const BY_KEY = new Map(PORT_NAMES.map((name) => [key(name), name]));

/** Canonical port name for user input ("rotterdam", "Port of Rotterdam"), or null if unsupported. */
export function resolvePort(input: string): string | null {
  return BY_KEY.get(key(input)) ?? null;
}
