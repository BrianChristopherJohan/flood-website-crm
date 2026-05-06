/**
 * lib/data.ts — UI constants only.
 *
 * ⚠️  All hardcoded data arrays (nodes, alerts, sensor readings, trend series)
 * have been removed. Live data now comes from the Neon PostgreSQL database
 * via the Java backend APIs — see lib/javaApi.ts and the /api/* routes.
 *
 * This file retains only UI presentation helpers (colour maps, legends)
 * that are used by components like StatusPill.
 */

export type WaterLevel = 0 | 1 | 2 | 3;
export type NodeStatus =
  | "Safe"
  | "Warning Level 1"
  | "Warning Level 2"
  | "Danger";
export type AlertType = "DANGER" | "WARNING" | "NEW NODE" | "INACTIVE";

/** Derive human-readable status from a numeric water level. */
export const deriveStatusFromLevel = (level: WaterLevel): NodeStatus => {
  switch (level) {
    case 0:  return "Safe";
    case 1:  return "Warning Level 1";
    case 2:  return "Warning Level 2";
    default: return "Danger";
  }
};

/** Tailwind colour classes for each status — used by StatusPill and table rows. */
export const statusToneMap: Record<
  NodeStatus,
  { bg: string; text: string; border: string; dot: string }
> = {
  Safe: {
    bg: "bg-status-green/15",
    text: "text-status-green",
    border: "border-status-green/30",
    dot: "bg-status-green",
  },
  "Warning Level 1": {
    bg: "bg-status-warning-1/20",
    text: "text-status-warning-1",
    border: "border-status-warning-1/30",
    dot: "bg-status-warning-1",
  },
  "Warning Level 2": {
    bg: "bg-status-warning-2/20",
    text: "text-status-warning-2",
    border: "border-status-warning-2/40",
    dot: "bg-status-warning-2",
  },
  Danger: {
    bg: "bg-status-danger/15",
    text: "text-status-danger",
    border: "border-status-danger/30",
    dot: "bg-status-danger",
  },
};

/** Hex colour per status — used for chart fills and map markers. */
export const statusHexMap: Record<NodeStatus, string> = {
  Safe: "#56E40A",
  "Warning Level 1": "#FFD54F",
  "Warning Level 2": "#FF9F1C",
  Danger: "#ED1C24",
};

/** Legend entries for map and chart colour keys. */
export const statusLegend = [
  {
    label: "Safe" as NodeStatus,
    description: "Water Level 0 (Normal)",
    color: "bg-status-green/15 text-status-green",
    water_level: 0,
  },
  {
    label: "Warning Level 1" as NodeStatus,
    description: "Water Level 1",
    color: "bg-status-warning-1/20 text-status-warning-1",
    water_level: 1,
  },
  {
    label: "Warning Level 2" as NodeStatus,
    description: "Water Level 2",
    color: "bg-status-warning-2/20 text-status-warning-2",
    water_level: 2,
  },
  {
    label: "Danger" as NodeStatus,
    description: "Water Level 3",
    color: "bg-status-danger/15 text-status-danger",
    water_level: 3,
  },
];
