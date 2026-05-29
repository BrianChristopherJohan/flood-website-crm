// FloodWatch IoTNode → CRM NodeData adapter.
//
// Shared by the operator-facing pages that need the FULL per-sensor record
// (map, sensors table, dashboard battery panel). Unlike the privacy-aggregated
// /api/iot/zones feed, this preserves raw telemetry — battery_voltage, rssi,
// snr, gps_fix — which operators are authorised to see. The community site
// must NOT use this; it hydrates from the anonymised zones route instead.

import type { IoTNode } from "@/lib/floodwatch/types";
import type { NodeData } from "@/lib/types";

export function iotNodeToNodeData(n: IoTNode): NodeData {
  const lat =
    typeof n.lat === "number" && n.lat !== 0
      ? n.lat
      : typeof n.install_lat === "number" && n.install_lat !== 0
        ? n.install_lat
        : 0;
  const lng =
    typeof n.lng === "number" && n.lng !== 0
      ? n.lng
      : typeof n.install_lng === "number" && n.install_lng !== 0
        ? n.install_lng
        : 0;
  return {
    _id: n.node_id,
    node_id: n.node_id,
    name: n.node_id,
    area: n.village_id,
    location: n.village_id,
    state: "Sabah",
    latitude: lat,
    longitude: lng,
    current_level: n.water_level ?? 0,
    is_dead: n.status === "offline",
    last_updated: n.last_seen ?? new Date().toISOString(),
    created_at: n.first_seen ?? new Date().toISOString(),
    // raw telemetry — operator-only, not present in the community Zone shape
    village_id: n.village_id,
    battery_voltage: n.battery_voltage,
    float_bits: n.float_bits,
    rssi: n.rssi,
    snr: n.snr,
    gps_fix: n.gps_fix,
    parent_id: n.parent_id,
  };
}
