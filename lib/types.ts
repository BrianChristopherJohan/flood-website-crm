// Shared types for client and server components

/**
 * Discrete water-level ordinal: 0=dry, 1=low/alert, 2=mid/warning,
 * 3=high/critical. Mirrors the community site so the privacy
 * aggregator's `Zone` shape lines up across both apps.
 */
export type FloodLevel = 0 | 1 | 2 | 3;

/**
 * Anonymised single-node map circle emitted by `aggregateZones()` and
 * consumed by the `/map` page. Coordinates are rounded to 4 d.p.
 * (~11 m) and node identifiers are hashed — the browser never sees
 * raw GPS or the underlying `node_id` plaintext.
 */
export type Zone = {
  /** FNV-1a hash of the original node identifier; safe to use as React key. */
  id: string;
  /** Original node_id forwarded server-side for favourites / bell-menu only. */
  nodeId?: string;
  /** Coarse display name — area, NOT the raw node name. */
  name: string;
  state: string;
  area: string;
  centroidLat: number;
  centroidLng: number;
  radiusM: number;
  worstLevel: FloodLevel;
  anyOffline: boolean;
  allOffline: boolean;
  /** Cluster size band — always "single" since we emit one circle per node. */
  sensorBand: "single" | "small" | "medium" | "large";
  lastUpdated?: string;
};

// Node type definition based on MongoDB schema, extended with optional
// raw-telemetry fields that the CRM operator console now surfaces in
// the map InfoWindow (battery, signal, village, etc.).
// Community-side renders never use these because they hydrate from the
// privacy-aggregated /api/iot/zones route which strips them upstream.
export interface NodeData {
  _id: string;
  node_id: string;
  name?: string;       // human-readable name
  area?: string;       // e.g. "Kuching"
  location?: string;   // e.g. "Sungai Sarawak"
  state?: string;      // e.g. "Sarawak"
  latitude: number;
  longitude: number;
  current_level: number; // 0 = 0ft, 1 = 1ft, 2 = 2ft, 3 = 3ft
  is_dead: boolean; // false = alive, true = dead
  last_updated: Date | string;
  created_at: Date | string;
  // ── optional raw-telemetry fields (CRM-only, populated by
  //    iotNodeToNodeData; undefined when the data source is the
  //    privacy-aggregated /api/iot/zones route) ─────────────────────
  village_id?: string;       // e.g. "SIM-PITAS-SOSOP" or real village id
  battery_voltage?: number;  // volts, typical Li-Ion range 3.3-4.2
  float_bits?: number;       // raw float-switch bitmask 0..7
  rssi?: number;             // LoRa received signal strength dBm
  snr?: number;              // LoRa signal-to-noise ratio dB
  gps_fix?: boolean;         // whether lat/lng came from a live GPS lock
  parent_id?: string;        // LoRa relay (master or upstream node)
}

/**
 * Classify a LoRa node battery voltage into an operator-facing health band.
 * Thresholds match the map InfoWindow so the whole CRM (Sensors, Map,
 * Analytics, Dashboard) labels battery identically:
 *   ≤ 0.5 V  → Dead/disconnected (sensor not reporting a real cell)
 *   < 3.3 V  → Critical (replace soon)
 *   < 3.6 V  → Low
 *   ≥ 3.6 V  → Healthy
 * `pct` is an indicative state-of-charge mapped over a 3.0–4.2 V Li-ion span.
 */
export type BatterySeverity = "healthy" | "low" | "critical" | "dead" | "unknown";

export function getBatteryStatus(voltage: number | null | undefined): {
  label: string;
  hex: string;
  severity: BatterySeverity;
  pct: number | null;
} {
  if (typeof voltage !== "number" || !Number.isFinite(voltage)) {
    return { label: "No data", hex: "#9ca3af", severity: "unknown", pct: null };
  }
  const pct = Math.max(0, Math.min(100, Math.round(((voltage - 3.0) / (4.2 - 3.0)) * 100)));
  if (voltage <= 0.5) return { label: "Dead", hex: "#dc2626", severity: "dead", pct: 0 };
  if (voltage < 3.3) return { label: "Critical", hex: "#ea580c", severity: "critical", pct };
  if (voltage < 3.6) return { label: "Low", hex: "#f59e0b", severity: "low", pct };
  return { label: "Healthy", hex: "#16a34a", severity: "healthy", pct };
}

// Helper function to determine water level status
export function getWaterLevelStatus(level: number): {
  label: string;
  color: string;
  severity: "normal" | "warning" | "danger" | "critical";
} {
  switch (level) {
    case 0:
      return { label: "Normal (0ft)", color: "status-green", severity: "normal" };
    case 1:
      return { label: "Alert (1ft)", color: "status-warning-1", severity: "warning" };
    case 2:
      return { label: "Warning (2ft)", color: "status-warning-2", severity: "danger" };
    case 3:
      return { label: "Critical (3ft)", color: "status-danger", severity: "critical" };
    default:
      return { label: `Unknown (${level}ft)`, color: "light-grey", severity: "normal" };
  }
}

// Helper function to get node status
export function getNodeStatus(isDead: boolean): {
  label: string;
  color: string;
} {
  return isDead
    ? { label: "Offline", color: "status-danger" }
    : { label: "Online", color: "status-green" };
}

// Status hex colors for map markers — aligned with RISK_COLORS in
// lib/floodRiskMock.ts and statusHexMap in lib/data.ts so the entire CRM
// (Dashboard, Sensors, Map, Analytics, Alerts) speaks one palette.
export const statusHexMap: Record<number, string> = {
  0: "#22c55e", // green-500  — Normal
  1: "#f59e0b", // amber-500  — Alert
  2: "#f97316", // orange-500 — Warning
  3: "#dc2626", // red-600    — Critical
};

// Offline node color
export const offlineColor = "#6b7280";

// Get status label from level
export function getStatusLabel(level: number): string {
  switch (level) {
    case 0:
      return "Normal";
    case 1:
      return "Alert";
    case 2:
      return "Warning";
    case 3:
      return "Critical";
    default:
      return "Unknown";
  }
}

// Get marker color for a node
export function getMarkerColor(node: NodeData): string {
  if (node.is_dead) return offlineColor;
  return statusHexMap[node.current_level] || statusHexMap[0];
}

