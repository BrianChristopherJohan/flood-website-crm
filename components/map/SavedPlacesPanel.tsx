"use client";

/**
 * <SavedPlacesPanel /> — operator-side bookmarks for high-risk areas.
 *
 * Mirrors the community website's saved-locations feature but kept lean
 * for CRM scope:
 *   • Persistence: localStorage (no server round-trip). Each admin's
 *     bookmarks live on their own machine — that's fine for FYP scope,
 *     and avoids touching the Java backend.
 *   • Geocoding: the address is reverse-geocoded once via Google Maps'
 *     JS Geocoder when a place is added (same key already loaded for
 *     the map; no extra env var).
 *   • Node count: pure-JS haversine sum against the live `nodes` prop
 *     so the badge stays accurate every time the IoT API pushes a
 *     change. No re-fetch needed.
 *
 * The panel renders below the operator map on /map. Click a row to
 * pan the map; click "+ Add" to open the editor; click ✎ to edit; ✕
 * to delete (with a confirm step).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { NodeData } from "@/lib/types";

export interface SavedPlace {
  id: string;
  label: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusKm: number;
  createdAt: string;
}

interface SavedPlacesPanelProps {
  /** Live node list — used to compute per-place node counts. */
  nodes: NodeData[];
  /** Pan the map when the admin clicks a saved place row. */
  onFocusPlace?: (lat: number, lng: number) => void;
  /** Map's current centre — used to prefill the editor when adding. */
  defaultCentre?: { lat: number; lng: number } | null;
  /** Dark mode flag for surface colours. */
  isDark?: boolean;
  /** Notified whenever the saved-places list changes (load/add/edit/delete)
   *  so the map can draw the radius circles. Pass a stable setter. */
  onPlacesChange?: (places: SavedPlace[]) => void;
  /** When `nonce` changes, open the editor prefilled at this coordinate —
   *  driven by a right-click on the map. */
  addRequest?: { lat: number; lng: number; nonce: number } | null;
}

const STORAGE_KEY = "crm:saved-places:v1";
const RADIUS_OPTIONS_KM = [0.5, 1, 2, 3, 5, 10, 20];
const R_EARTH_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in metres between two lat/lng pairs. */
function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(h));
}

interface NodeBreakdown {
  total: number;
  normal: number;
  alert: number;
  warning: number;
  critical: number;
  offline: number;
}

function countNodesInRadius(
  centre: { lat: number; lng: number },
  radiusKm: number,
  nodes: NodeData[],
): NodeBreakdown {
  const limit = radiusKm * 1000;
  const out: NodeBreakdown = {
    total: 0, normal: 0, alert: 0, warning: 0, critical: 0, offline: 0,
  };
  for (const n of nodes) {
    if (haversineM(centre, { lat: n.latitude, lng: n.longitude }) > limit) continue;
    out.total++;
    if (n.is_dead) out.offline++;
    else if (n.current_level >= 3) out.critical++;
    else if (n.current_level === 2) out.warning++;
    else if (n.current_level === 1) out.alert++;
    else out.normal++;
  }
  return out;
}

interface InRadiusNode { node: NodeData; distM: number; }

/** The actual sensors within a radius, nearest-first. */
function nodesInRadius(
  centre: { lat: number; lng: number },
  radiusKm: number,
  nodes: NodeData[],
): InRadiusNode[] {
  const limit = radiusKm * 1000;
  const out: InRadiusNode[] = [];
  for (const n of nodes) {
    const distM = haversineM(centre, { lat: n.latitude, lng: n.longitude });
    if (distM <= limit) out.push({ node: n, distM });
  }
  return out.sort((a, b) => a.distM - b.distM);
}

// Per-sensor flood-level presentation (matches the map's severity palette).
const LEVEL_LABEL = ["Normal", "Alert", "Warning", "Critical"] as const;
const LEVEL_HEX = ["#16a34a", "#facc15", "#f97316", "#dc2626"] as const;
const OFFLINE_HEX = "#6b7280";
const nodeAlertLabel = (n: NodeData): string => LEVEL_LABEL[n.current_level] ?? "Unknown";
const nodeAlertHex = (n: NodeData): string => LEVEL_HEX[n.current_level] ?? OFFLINE_HEX;

function loadSaved(): SavedPlace[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is SavedPlace =>
        !!p && typeof p === "object" &&
        typeof (p as SavedPlace).id === "string" &&
        typeof (p as SavedPlace).label === "string" &&
        typeof (p as SavedPlace).latitude === "number" &&
        typeof (p as SavedPlace).longitude === "number" &&
        typeof (p as SavedPlace).radiusKm === "number",
    );
  } catch {
    return [];
  }
}

/** Returns true on success, false when storage is unavailable (private
 *  mode / quota) so callers can warn the operator instead of silently
 *  losing the place. */
function persist(places: SavedPlace[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
    return true;
  } catch {
    return false;
  }
}

export default function SavedPlacesPanel({
  nodes,
  onFocusPlace,
  defaultCentre,
  isDark = false,
  onPlacesChange,
  addRequest,
}: SavedPlacesPanelProps) {
  const [places, setPlaces] = useState<SavedPlace[]>(() => loadSaved());
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SavedPlace | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftLat, setDraftLat] = useState<string>("");
  const [draftLng, setDraftLng] = useState<string>("");
  const [draftRadius, setDraftRadius] = useState<number>(3);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Surface the list to the parent (map) so it can draw radius circles.
  // `onPlacesChange` must be a stable reference (e.g. a useState setter).
  useEffect(() => {
    onPlacesChange?.(places);
  }, [places, onPlacesChange]);

  const totals = useMemo(
    () => places.map((p) =>
      countNodesInRadius({ lat: p.latitude, lng: p.longitude }, p.radiusKm, nodes),
    ),
    [places, nodes],
  );

  // The actual sensors inside each place's radius (nearest-first), for the
  // expandable per-place detail list.
  const inRadius = useMemo(
    () => places.map((p) =>
      nodesInRadius({ lat: p.latitude, lng: p.longitude }, p.radiusKm, nodes),
    ),
    [places, nodes],
  );

  // Which place cards have their sensor list expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Reverse-geocode (lat/lng → street address) for the sensors of EXPANDED
  // places, using the Google Geocoder already loaded by the map on this page
  // (no extra API key). Results are cached by rounded coord; failures resolve
  // to a coordinate string so they aren't retried.
  const [addrCache, setAddrCache] = useState<Record<string, string>>({});
  const geocodingRef = useRef<Set<string>>(new Set());
  const coordKey = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof google === "undefined" || !google.maps?.Geocoder) return;
    const geocoder = new google.maps.Geocoder();
    places.forEach((p, i) => {
      if (!expanded.has(p.id)) return;
      for (const { node } of inRadius[i] ?? []) {
        const key = coordKey(node.latitude, node.longitude);
        if (addrCache[key] !== undefined || geocodingRef.current.has(key)) continue;
        geocodingRef.current.add(key);
        geocoder.geocode(
          { location: { lat: node.latitude, lng: node.longitude } },
          (results, status) => {
            geocodingRef.current.delete(key);
            const addr =
              status === "OK" && results && results[0]
                ? results[0].formatted_address
                : `${node.latitude.toFixed(5)}°N, ${node.longitude.toFixed(5)}°E`;
            setAddrCache((prev) => ({ ...prev, [key]: addr }));
          },
        );
      }
    });
  }, [expanded, places, inRadius, addrCache]);

  const openAdd = useCallback(() => {
    setEditing(null);
    setDraftLabel("");
    const c = defaultCentre ?? { lat: 1.553, lng: 110.344 };
    setDraftLat(c.lat.toFixed(6));
    setDraftLng(c.lng.toFixed(6));
    setDraftRadius(3);
    setEditorOpen(true);
  }, [defaultCentre]);

  // Open the editor prefilled at a specific coordinate (right-click flow).
  // Also kicks off a reverse-geocode to suggest a friendly label, which the
  // operator can keep or overwrite.
  const openAddAt = useCallback((lat: number, lng: number) => {
    setEditing(null);
    setDraftLabel("");
    setDraftLat(lat.toFixed(6));
    setDraftLng(lng.toFixed(6));
    setDraftRadius(3);
    setEditorOpen(true);
    if (typeof google !== "undefined" && google.maps?.Geocoder) {
      try {
        new google.maps.Geocoder().geocode(
          { location: { lat, lng } },
          (results, status) => {
            if (status === "OK" && results && results[0]) {
              // Use the most specific name (first address component line).
              setDraftLabel((cur) => cur || results[0].formatted_address.split(",")[0]);
            }
          },
        );
      } catch {
        /* geocoder unavailable — operator types the label */
      }
    }
  }, []);

  // Right-click on the map (via `addRequest` nonce) → open prefilled editor.
  const lastAddNonce = useRef(0);
  useEffect(() => {
    if (!addRequest || addRequest.nonce === lastAddNonce.current) return;
    lastAddNonce.current = addRequest.nonce;
    const id = window.setTimeout(() => {
      openAddAt(addRequest.lat, addRequest.lng);
    }, 0);
    return () => window.clearTimeout(id);
  }, [addRequest, openAddAt]);

  const openEdit = useCallback((p: SavedPlace) => {
    setEditing(p);
    setDraftLabel(p.label);
    setDraftLat(String(p.latitude));
    setDraftLng(String(p.longitude));
    setDraftRadius(p.radiusKm);
    setEditorOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    const lat = parseFloat(draftLat);
    const lng = parseFloat(draftLng);
    const label = draftLabel.trim();
    if (!label) { toast.error("Please enter a label for this place."); return; }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) { toast.error("Latitude must be between -90 and 90."); return; }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) { toast.error("Longitude must be between -180 and 180."); return; }
    const radius = Number.isFinite(draftRadius) && draftRadius > 0 ? draftRadius : 3;

    const wasEditing = !!editing;
    setPlaces((prev) => {
      const next: SavedPlace[] = editing
        ? prev.map((p) =>
            p.id === editing.id
              ? { ...p, label, latitude: lat, longitude: lng, radiusKm: radius }
              : p,
          )
        : [
            ...prev,
            {
              id: (typeof crypto !== "undefined" && crypto.randomUUID)
                ? crypto.randomUUID()
                : String(Date.now()),
              label,
              address: null,
              latitude: lat,
              longitude: lng,
              radiusKm: radius,
              createdAt: new Date().toISOString(),
            },
          ];
      // Tell the operator the truth: saved places live in this browser
      // only, and warn loudly if storage is unavailable rather than
      // silently losing the entry.
      if (persist(next)) {
        toast.success(wasEditing ? "Place updated." : "Place saved to this browser.");
      } else {
        toast.error("Could not save — browser storage is unavailable (private mode or full).");
      }
      return next;
    });
    setEditorOpen(false);
  }, [draftLabel, draftLat, draftLng, draftRadius, editing]);

  const handleDelete = useCallback((id: string) => {
    setPlaces((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (persist(next)) toast.success("Place removed.");
      else toast.error("Could not update browser storage.");
      return next;
    });
    setPendingDelete(null);
  }, []);

  const cardBg = isDark ? "bg-dark-card border-dark-border" : "bg-pure-white border-light-grey";
  const rowBg = isDark ? "bg-dark-bg border-dark-border" : "bg-very-light-grey border-light-grey";
  const body = isDark ? "text-dark-text" : "text-dark-charcoal";
  const muted = isDark ? "text-dark-text-muted" : "text-dark-charcoal/60";
  const sub = isDark ? "text-dark-text-secondary" : "text-dark-charcoal/70";

  return (
    <article className={`rounded-3xl border p-5 shadow-sm transition-colors ${cardBg}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className={`text-base font-semibold ${body}`}>My Saved Places</h2>
          <p className={`text-xs ${muted}`}>
            Bookmark high-risk areas — we&apos;ll count nearby sensors so you can monitor coverage.
            <span className="block">Tip: right-click anywhere on the map to drop a place.</span>
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="rounded-full bg-primary-blue px-4 py-1.5 text-xs font-semibold text-pure-white transition hover:bg-primary-blue/90"
        >
          + Add place
        </button>
      </div>

      {places.length === 0 ? (
        <div className={`flex flex-col items-center gap-2 rounded-2xl py-10 text-center ${rowBg}`}>
          <p className={`text-sm font-semibold ${body}`}>No saved places yet.</p>
          <p className={`text-xs ${muted}`}>
            Add a place + radius to see how many sensors cover it.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {places.map((p, i) => {
            const t = totals[i];
            const inR = inRadius[i] ?? [];
            const isOpen = expanded.has(p.id);
            return (
              <li
                key={p.id}
                className={`rounded-2xl border px-4 py-3 ${rowBg}`}
              >
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onFocusPlace?.(p.latitude, p.longitude)}
                    className="flex-1 text-left"
                  >
                    <p className={`text-sm font-semibold ${body}`}>{p.label}</p>
                    <p className={`text-xs ${sub}`}>
                      Radius {p.radiusKm} km · {p.latitude.toFixed(4)}°N, {p.longitude.toFixed(4)}°E
                    </p>
                    <p className={`mt-1 text-xs ${muted}`}>
                      <strong className={body}>{t.total}</strong> sensor{t.total === 1 ? "" : "s"} in range
                      {t.total > 0 && (
                        <>
                          {" · "}
                          <span className="text-status-green">{t.normal} normal</span>
                          {t.alert > 0 && <>{" · "}<span className="text-status-warning-1">{t.alert} alert</span></>}
                          {t.warning > 0 && <>{" · "}<span className="text-status-warning-2">{t.warning} warning</span></>}
                          {t.critical > 0 && <>{" · "}<span className="text-status-danger">{t.critical} critical</span></>}
                          {t.offline > 0 && <>{" · "}<span className={muted}>{t.offline} offline</span></>}
                        </>
                      )}
                    </p>
                  </button>
                  <div className="ml-3 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      aria-label="Edit place"
                      title="Edit"
                      className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs transition ${
                        isDark ? "hover:bg-dark-border" : "hover:bg-light-grey"
                      } ${sub}`}
                    >
                      ✎
                    </button>
                    {pendingDelete === p.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDelete(p.id)}
                          className="rounded-lg bg-status-danger px-2 py-1 text-[10px] font-semibold text-pure-white"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(null)}
                          className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${sub}`}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDelete(p.id)}
                        aria-label="Delete place"
                        title="Delete"
                        className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs transition hover:bg-status-danger/20 hover:text-status-danger ${sub}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Detected sensors within radius: node id + alert level +
                    online/offline + reverse-geocoded address. Scrollable. */}
                {t.total > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleExpand(p.id)}
                      aria-expanded={isOpen}
                      className={`mt-2 flex w-full items-center justify-center gap-1 rounded-lg border py-1 text-[11px] font-semibold transition ${
                        isDark ? "border-dark-border hover:bg-dark-border/40" : "border-light-grey hover:bg-light-grey/60"
                      } ${sub}`}
                    >
                      {isOpen ? "Hide sensors" : `Show ${t.total} sensor${t.total === 1 ? "" : "s"}`}
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                           className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden>
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>

                    {isOpen && (
                      <div className={`mt-2 max-h-64 overflow-y-auto rounded-xl border ${isDark ? "border-dark-border" : "border-light-grey"}`}>
                        <ul className={`divide-y ${isDark ? "divide-dark-border" : "divide-light-grey"}`}>
                          {inR.map(({ node, distM }) => {
                            const offline = node.is_dead;
                            const key = coordKey(node.latitude, node.longitude);
                            const addr = addrCache[key];
                            return (
                              <li key={node._id}>
                                <button
                                  type="button"
                                  onClick={() => onFocusPlace?.(node.latitude, node.longitude)}
                                  title="Focus this sensor on the map"
                                  className={`flex w-full flex-col gap-1 px-3 py-2 text-left transition ${
                                    isDark ? "hover:bg-dark-border/40" : "hover:bg-light-grey/50"
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="h-2 w-2 flex-shrink-0 rounded-full"
                                          style={{ backgroundColor: offline ? OFFLINE_HEX : nodeAlertHex(node) }} aria-hidden />
                                    <span className={`truncate font-mono text-xs font-semibold ${body}`}>{node.node_id}</span>
                                    <span className="ml-auto flex flex-shrink-0 items-center gap-1.5">
                                      <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                                            style={offline
                                              ? { background: "rgba(107,114,128,0.18)", color: OFFLINE_HEX }
                                              : { background: `${nodeAlertHex(node)}26`, color: nodeAlertHex(node) }}>
                                        {offline ? "—" : nodeAlertLabel(node)}
                                      </span>
                                      <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                                            style={offline
                                              ? { background: "rgba(107,114,128,0.18)", color: OFFLINE_HEX }
                                              : { background: "rgba(22,163,74,0.15)", color: "#16a34a" }}>
                                        {offline ? "Offline" : "Online"}
                                      </span>
                                      <span className={`text-[10px] tabular-nums ${muted}`}>{(distM / 1000).toFixed(2)} km</span>
                                    </span>
                                  </div>
                                  <span className={`flex items-start gap-1 text-[10px] leading-snug ${muted}`}>
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                                         stroke="currentColor" strokeWidth="2" className="mt-px h-3 w-3 flex-shrink-0" aria-hidden>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                                    </svg>
                                    <span>{addr ?? "Resolving address…"}</span>
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Editor modal */}
      {editorOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="saved-place-editor-title"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 outline-none"
          onClick={(e) => { if (e.target === e.currentTarget) setEditorOpen(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") setEditorOpen(false); }}
          ref={(el) => { if (el) el.focus(); }}
        >
          <div className={`w-full max-w-md rounded-3xl border p-6 shadow-xl ${cardBg}`}>
            <h3 id="saved-place-editor-title" className={`text-base font-semibold ${body}`}>
              {editing ? "Edit saved place" : "Add saved place"}
            </h3>
            <p className={`mt-1 text-xs ${muted}`}>
              We&apos;ll count sensors within your radius and update the badge live.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className={`text-xs font-semibold ${sub}`}>Label</span>
                <input
                  type="text"
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  placeholder="e.g. HQ, Pitas SOP zone, Mum's house"
                  className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm ${
                    isDark ? "border-dark-border bg-dark-bg text-dark-text" : "border-light-grey bg-pure-white text-dark-charcoal"
                  }`}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={`text-xs font-semibold ${sub}`}>Latitude</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draftLat}
                    onChange={(e) => setDraftLat(e.target.value)}
                    className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm ${
                      isDark ? "border-dark-border bg-dark-bg text-dark-text" : "border-light-grey bg-pure-white text-dark-charcoal"
                    }`}
                  />
                </label>
                <label className="block">
                  <span className={`text-xs font-semibold ${sub}`}>Longitude</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draftLng}
                    onChange={(e) => setDraftLng(e.target.value)}
                    className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm ${
                      isDark ? "border-dark-border bg-dark-bg text-dark-text" : "border-light-grey bg-pure-white text-dark-charcoal"
                    }`}
                  />
                </label>
              </div>
              <label className="block">
                <span className={`text-xs font-semibold ${sub}`}>Radius (km)</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {RADIUS_OPTIONS_KM.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setDraftRadius(r)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        draftRadius === r
                          ? "border-primary-blue bg-primary-blue text-pure-white"
                          : isDark
                            ? "border-dark-border bg-dark-bg text-dark-text-secondary hover:border-primary-blue"
                            : "border-light-grey bg-pure-white text-dark-charcoal/70 hover:border-primary-blue"
                      }`}
                    >
                      {r} km
                    </button>
                  ))}
                </div>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold ${sub}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!draftLabel.trim()}
                className="rounded-full bg-primary-blue px-4 py-1.5 text-xs font-semibold text-pure-white disabled:opacity-50"
              >
                {editing ? "Save changes" : "Add place"}
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
