"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";

import {
  Autocomplete,
  GoogleMap,
  InfoWindow,
  Marker,
  type Libraries,
  useJsApiLoader,
} from "@react-google-maps/api";

import { NodeData, getStatusLabel, getMarkerColor } from "@/lib/types";

/**
 * Libraries the Google Maps loader needs to bring in eagerly. We use
 * `geometry` for spherical bounds maths (Circle / LatLngBounds.extend
 * paths) and `marker` for the AdvancedMarkerElement used by InfoWindow
 * pointers in the underlying lib. The list MUST be a stable reference
 * — `useJsApiLoader` re-creates the script tag on every render if a
 * new array slot is passed in.
 */
const MAPS_LIBRARIES: Libraries = ["geometry", "marker", "places"];

type NodeMapProps = {
  nodes: NodeData[];
  height?: number;
  zoom?: number;
  /** When set, the map pans to and highlights this node._id */
  focusNodeId?: string | null;
  /** Set of node._id values to render with the "highlighted" ring (used for recently-updated chips) */
  highlightedIds?: Set<string>;
  /** Currently starred node IDs — drives the ★ button inside the InfoWindow */
  favouriteIds?: Set<string>;
  /** Called when the user clicks the star button in the InfoWindow */
  onToggleFavourite?: (nodeId: string) => void;
  /** Per-node circle radius in metres. Defaults to 250 m to match the community site. */
  circleRadiusM?: number;
};

const mapStyles: google.maps.MapTypeStyle[] = [
  {
    featureType: "poi",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#ffffff" }],
  },
  {
    featureType: "road",
    elementType: "labels",
    stylers: [{ visibility: "simplified" }],
  },
];

// Check if we have a valid API key
const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";
const hasValidApiKey = apiKey.length > 10 && !apiKey.includes("Example");

export default function NodeMap({
  nodes,
  height = 420,
  zoom = 12,
  focusNodeId = null,
  highlightedIds,
  favouriteIds,
  onToggleFavourite,
  circleRadiusM = 250,
}: NodeMapProps) {
  // hoveredNodeId  — transient, cleared when mouse leaves
  // clickedNodeId  — persistent, survives mouse-leave so user can interact with InfoWindow
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [clickedNodeId, setClickedNodeId] = useState<string | null>(null);
  // Derived: clicked takes priority over hovered
  const activeNodeId = clickedNodeId ?? hoveredNodeId;
  const [mapError, setMapError] = useState(false);
  const [lastFocusedNodeId, setLastFocusedNodeId] = useState<string | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);

  // ── Places Autocomplete search box (ported from community) ───────────────
  // Mounts a Google Places Autocomplete on the map header. When the admin
  // picks a suggestion, we pan the camera, drop a teardrop pin at the
  // chosen coords, and surface its name + reverse-geocoded address +
  // count of nearby flood sensors. Keeps the operator console at parity
  // with the public site's place-search affordance.
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchedPlace, setSearchedPlace] = useState<
    | { lat: number; lng: number; name: string; address: string | null }
    | null
  >(null);
  const [searchedPlaceClicked, setSearchedPlaceClicked] = useState(false);

  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: apiKey,
    libraries: MAPS_LIBRARIES,
  });

  // Track if map fails to load properly
  useEffect(() => {
    if (loadError) {
      setMapError(true);
    }
  }, [loadError]);

  // Find the most recently updated node
  const latestUpdatedNode = useMemo(() => {
    if (!nodes.length) return null;
    return nodes.reduce((latest, node) => {
      const latestTime = new Date(latest.last_updated).getTime();
      const nodeTime = new Date(node.last_updated).getTime();
      return nodeTime > latestTime ? node : latest;
    });
  }, [nodes]);

  // Track the latest node ID so the gold ring re-renders on data refresh,
  // but do NOT auto-pan — let the user navigate freely.
  useEffect(() => {
    if (latestUpdatedNode && latestUpdatedNode._id !== lastFocusedNodeId) {
      setLastFocusedNodeId(latestUpdatedNode._id);
    }
  }, [latestUpdatedNode, lastFocusedNodeId]);

  // Pan to externally requested node (favourite click) and lock InfoWindow open
  useEffect(() => {
    if (!focusNodeId || !mapRef.current) return;
    const target = nodes.find(n => n._id === focusNodeId);
    if (!target) return;
    mapRef.current.panTo({ lat: target.latitude, lng: target.longitude });
    mapRef.current.setZoom(15);
    setClickedNodeId(focusNodeId);
  }, [focusNodeId, nodes]);

  // Initial map center — average of all nodes (computed once; does not re-center on refresh)
  const mapCenter = useMemo(() => {
    if (!nodes.length) return { lat: 1.553, lng: 110.344 }; // Default: Sarawak
    const avgLat = nodes.reduce((sum, n) => sum + n.latitude, 0) / nodes.length;
    const avgLng = nodes.reduce((sum, n) => sum + n.longitude, 0) / nodes.length;
    return { lat: avgLat, lng: avgLng };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally computed only on mount — we do NOT want re-centering on data refresh

  const activeNode = nodes.find(n => n._id === activeNodeId);

  // Fired when the admin picks a Google Places suggestion from the
  // Autocomplete dropdown. Pans the camera, drops a teardrop marker
  // at the chosen coords, and opens its InfoWindow.
  const handlePlaceChanged = useCallback(() => {
    const ac = autocompleteRef.current;
    if (!ac) return;
    const place = ac.getPlace();
    if (!place.geometry?.location) return;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    const name =
      place.name ?? place.formatted_address ?? "Selected location";
    const address = place.formatted_address ?? null;
    if (mapRef.current) {
      mapRef.current.panTo({ lat, lng });
      mapRef.current.setZoom(14);
    }
    setSearchInput(name);
    setSearchedPlace({ lat, lng, name, address });
    setSearchedPlaceClicked(true);
  }, []);

  // ── Reverse-geocoded street address for the currently-open popup ─────────
  // The Google Maps Geocoder uses the same JS API key already loaded for the
  // map, so no extra env var is needed. We cache results in a Map keyed on
  // the rounded lat/lng so opening the same pin twice doesn't burn a quota
  // hit. Falls back silently to "—" when geocoding fails (no result, quota,
  // network blip) — the operator still sees raw lat/lng in the popup.
  const geocodeCache = useRef<Map<string, string>>(new Map());
  const [activeAddress, setActiveAddress] = useState<string | null>(null);
  useEffect(() => {
    if (!activeNode || !isLoaded) { setActiveAddress(null); return; }
    const key = `${activeNode.latitude.toFixed(5)},${activeNode.longitude.toFixed(5)}`;
    const hit = geocodeCache.current.get(key);
    if (hit) { setActiveAddress(hit); return; }
    setActiveAddress(null);
    let cancelled = false;
    try {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode(
        { location: { lat: activeNode.latitude, lng: activeNode.longitude } },
        (results, status) => {
          if (cancelled) return;
          if (status === "OK" && results && results[0]) {
            const addr = results[0].formatted_address;
            geocodeCache.current.set(key, addr);
            setActiveAddress(addr);
          } else {
            setActiveAddress("—");
          }
        },
      );
    } catch {
      setActiveAddress("—");
    }
    return () => { cancelled = true; };
  }, [activeNode, isLoaded]);

  // Callback to store map reference + flip the readiness flag so the
  // first-load auto-fit effect re-runs once the camera is controllable.
  const [mapReady, setMapReady] = useState(false);
  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    setMapError(false);
    setMapReady(true);
  }, []);

  // First-load auto-fit: when nodes load *after* the GoogleMap mounts
  // (the normal case), the mount-only `mapCenter` memo is stuck on
  // whichever subset arrived in time. Without this effect a CRM
  // operator opening /map sees Sarawak rather than the live Pitas
  // cluster ~600 km NE. We fit the camera to the nodes' bounding box
  // once — `didAutoFit` ensures we don't fight the user's subsequent
  // pan/zoom or an externally-driven `focusNodeId`.
  const didAutoFit = useRef(false);
  useEffect(() => {
    if (didAutoFit.current) return;
    if (!mapReady || !mapRef.current || nodes.length === 0) return;
    // Defer if a deep-link focus is already requested.
    if (focusNodeId) {
      didAutoFit.current = true;
      return;
    }
    if (typeof google === "undefined") return;
    const bounds = new google.maps.LatLngBounds();
    for (const n of nodes) {
      if (Number.isFinite(n.latitude) && Number.isFinite(n.longitude)) {
        bounds.extend({ lat: n.latitude, lng: n.longitude });
      }
    }
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
      mapRef.current.panTo(bounds.getCenter());
      mapRef.current.setZoom(15);
    } else {
      mapRef.current.fitBounds(bounds, 64);
    }
    didAutoFit.current = true;
  }, [nodes, mapReady, focusNodeId]);

  // Show placeholder if no valid API key or if there's an error
  if (!hasValidApiKey || mapError || loadError) {
    return (
      <div
        className="relative flex w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-light-grey bg-gradient-to-br from-very-light-grey to-light-grey/30 dark:border-dark-border dark:from-dark-bg dark:to-dark-card"
        style={{ height }}
      >
        {/* Decorative map pattern */}
        <div className="absolute inset-0 opacity-10">
          <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#4E4B4B" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100" height="100" fill="url(#grid)" />
          </svg>
        </div>

        {/* Map pin icons representing nodes */}
        <div className="relative mb-4 flex items-center justify-center gap-2">
          {nodes.slice(0, 6).map((node, index) => (
            <div
              key={node._id}
              className="flex h-8 w-8 items-center justify-center rounded-full shadow-md"
              style={{
                backgroundColor: getMarkerColor(node),
                transform: `translateY(${index % 2 === 0 ? -4 : 4}px)`,
              }}
            >
              <svg
                className="h-4 w-4 text-white"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
              </svg>
            </div>
          ))}
        </div>

        <div className="relative z-10 text-center">
          <p className="text-sm font-semibold text-dark-charcoal dark:text-dark-text">
            Interactive Map Preview
          </p>
          <p className="mt-1 text-xs text-dark-charcoal/60 dark:text-dark-text-muted">
            {nodes.length} sensor{nodes.length !== 1 ? "s" : ""} online
          </p>
        </div>

        {/* Node summary cards */}
        <div className="relative z-10 mt-4 flex flex-wrap justify-center gap-2 px-4">
          {nodes.slice(0, 4).map((node) => (
            <div
              key={node._id}
              className="flex items-center gap-2 rounded-lg bg-pure-white/80 dark:bg-dark-card/80 px-2 py-1 text-xs shadow-sm backdrop-blur"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: getMarkerColor(node) }}
              />
              <span className="font-medium text-dark-charcoal dark:text-dark-text">
                {node.node_id}
              </span>
              <span className="text-dark-charcoal/60 dark:text-dark-text-muted">{node.current_level}ft</span>
            </div>
          ))}
          {nodes.length > 4 && (
            <div className="flex items-center rounded-lg bg-light-blue/50 dark:bg-primary-blue/20 px-2 py-1 text-xs font-medium text-primary-blue">
              +{nodes.length - 4} more
            </div>
          )}
        </div>

        {/* Configuration hint */}
        <p className="absolute bottom-3 text-[10px] text-dark-charcoal/40 dark:text-dark-text-muted">
          Configure NEXT_PUBLIC_GOOGLE_MAPS_KEY for live map
        </p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div
        className="flex w-full items-center justify-center rounded-2xl border border-light-grey dark:border-dark-border bg-very-light-grey dark:bg-dark-bg"
        style={{ height }}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-3 border-light-grey dark:border-dark-border border-t-primary-blue" />
          <p className="text-sm font-semibold text-dark-charcoal/70 dark:text-dark-text-secondary">
            Loading Flood Map...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      {/* ── Places Autocomplete search box (top-left overlay) ─────────────
          Mirrors the community map's place-search UX so admins can jump
          to any address. The Autocomplete is restricted to Malaysia +
          biased to the current map centre so suggestions stay relevant.
      */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 10,
          maxWidth: "calc(100% - 24px)",
          width: 320,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            pointerEvents: "auto",
            background: "#fff",
            borderRadius: 999,
            boxShadow: "0 4px 12px -2px rgba(0,0,0,0.18)",
            display: "flex",
            alignItems: "center",
            paddingRight: 4,
          }}
        >
          <Autocomplete
            onLoad={(ac) => {
              autocompleteRef.current = ac;
              // Bias suggestions to the map's current viewport so a
              // "Jalan Song" near Kuching outranks the same name across MY.
              if (mapRef.current && typeof google !== "undefined") {
                const c = mapRef.current.getCenter();
                if (c) {
                  const bounds = new google.maps.LatLngBounds(c, c);
                  ac.setBounds(bounds);
                }
              }
            }}
            onPlaceChanged={handlePlaceChanged}
            options={{
              componentRestrictions: { country: ["my"] },
              fields: ["geometry", "name", "formatted_address"],
            }}
          >
            <input
              type="text"
              value={searchInput}
              onChange={(e) => {
                const v = e.target.value;
                setSearchInput(v);
                if (v.trim() === "") setSearchedPlace(null);
              }}
              placeholder="Search a place…"
              aria-label="Search for a place"
              style={{
                width: "100%",
                padding: "10px 16px",
                fontSize: 14,
                color: "#0f172a",
                background: "transparent",
                border: "none",
                outline: "none",
                borderRadius: 999,
              }}
            />
          </Autocomplete>
          {(searchInput.length > 0 || searchedPlace) && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                setSearchedPlace(null);
                setSearchedPlaceClicked(false);
              }}
              aria-label="Clear search"
              style={{
                marginLeft: 4,
                width: 28,
                height: 28,
                borderRadius: 999,
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
                   style={{ width: 14, height: 14 }}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <GoogleMap
        mapContainerStyle={{ width: "100%", height, borderRadius: "16px" }}
        center={mapCenter}
        zoom={zoom}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          styles: mapStyles,
          gestureHandling: "greedy",
        }}
        onLoad={onMapLoad}
      >
      {nodes.map((node) => {
        const isHighlighted = highlightedIds?.has(node._id) || latestUpdatedNode?._id === node._id;
        const color = getMarkerColor(node);
        // Classic teardrop pin SVG path. Origin (0,0) sits at the tip
        // so the marker anchor lines up exactly with the sensor coord.
        // Scaled to ~32 px on screen; highlighted pins get a thicker
        // gold stroke + larger scale to pop above the rest.
        const pinIcon: google.maps.Symbol = {
          path: "M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z",
          fillColor: color,
          fillOpacity: 1,
          strokeColor: isHighlighted ? "#FFB800" : "#1a1a1a",
          strokeWeight: isHighlighted ? 2.5 : 1.25,
          scale: isHighlighted ? 1.25 : 1,
          anchor: new google.maps.Point(0, 0),
          labelOrigin: new google.maps.Point(0, -22),
        };
        return (
          <Marker
            key={node._id}
            position={{ lat: node.latitude, lng: node.longitude }}
            icon={pinIcon}
            zIndex={isHighlighted ? 10 : 1}
            onMouseOver={() => setHoveredNodeId(node._id)}
            onMouseOut={() => setHoveredNodeId(null)}
            onClick={() =>
              setClickedNodeId((prev) => (prev === node._id ? null : node._id))
            }
          />
        );
      })}
      {activeNode && (
        <InfoWindow
          position={{ lat: activeNode.latitude, lng: activeNode.longitude }}
          onCloseClick={() => { setClickedNodeId(null); setHoveredNodeId(null); }}
          options={{
            // Anchor the InfoWindow above the pin's head (~30 px up from
            // the tip, which is at the node lat/lng). Was -34 for the
            // legacy Circle centre; the new pin sits with its tip at the
            // coord so we shift up by the pin's own height plus a small
            // gap so the speech-bubble tail clears the marker outline.
            pixelOffset: new google.maps.Size(0, -34),
            disableAutoPan: false,
          }}
        >
          <div style={{ minWidth: 220, fontFamily: "inherit", padding: "2px 2px 4px" }}>
            {/* ── Header ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <p style={{ fontWeight: 700, fontSize: 13, color: "#1a1a1a", margin: 0, flex: 1 }}>
                {activeNode.node_id}
              </p>
              {latestUpdatedNode?._id === activeNode._id && (
                <span style={{
                  background: "#fef3c7", color: "#92400e",
                  fontSize: 9, fontWeight: 700, padding: "2px 6px",
                  borderRadius: 999, letterSpacing: "0.05em",
                }}>
                  LATEST
                </span>
              )}
            </div>

            {/* ── Location ── */}
            {(activeNode.location || activeNode.area) && (
              <div style={{
                display: "flex", alignItems: "center", gap: 4,
                marginBottom: 8, padding: "4px 8px",
                background: "#f3f4f6", borderRadius: 8,
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#6b7280" style={{ width: 12, height: 12, flexShrink: 0 }}>
                  <path fillRule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-2.079 3.953-5.442 3.953-9.827a8.25 8.25 0 00-16.5 0c0 4.385 2.009 7.748 3.953 9.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
                <span style={{ fontSize: 11, color: "#6b7280" }}>
                  {[activeNode.location, activeNode.area].filter(Boolean).join(" · ")}
                </span>
              </div>
            )}

            {/* ── Stats ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#374151" }}>
                <span style={{
                  display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                  background: getMarkerColor(activeNode), flexShrink: 0,
                }} />
                <span>Water Status: <strong>{getStatusLabel(activeNode.current_level)}</strong></span>
              </div>
              <div style={{ fontSize: 12, color: "#374151", paddingLeft: 14 }}>
                Water Level: <strong style={{ color: "#d7263d" }}>{activeNode.current_level} ft</strong>
              </div>
              <div style={{ fontSize: 12, color: "#374151", paddingLeft: 14 }}>
                Node Status:{" "}
                <strong style={{ color: activeNode.is_dead ? "#d7263d" : "#16a34a" }}>
                  {activeNode.is_dead ? "Offline" : "Online"}
                </strong>
              </div>
              {typeof activeNode.battery_voltage === "number" && (
                <div style={{ fontSize: 12, color: "#374151", paddingLeft: 14 }}>
                  Battery:{" "}
                  <strong style={{
                    color:
                      activeNode.battery_voltage <= 0.5
                        ? "#d7263d"        // dead/disconnected
                        : activeNode.battery_voltage < 3.3
                          ? "#ea580c"      // critical low
                          : activeNode.battery_voltage < 3.6
                            ? "#f59e0b"    // low
                            : "#16a34a",   // healthy
                  }}>
                    {activeNode.battery_voltage.toFixed(2)} V
                  </strong>
                  {activeNode.battery_voltage <= 0.5
                    ? " (replace)"
                    : activeNode.battery_voltage < 3.3
                      ? " (critical)"
                      : activeNode.battery_voltage < 3.6
                        ? " (low)"
                        : null}
                </div>
              )}
              {activeNode.village_id && (
                <div style={{ fontSize: 12, color: "#374151", paddingLeft: 14 }}>
                  Village: <strong>{activeNode.village_id}</strong>
                </div>
              )}
              {(typeof activeNode.rssi === "number" || typeof activeNode.snr === "number") && (
                <div style={{ fontSize: 12, color: "#374151", paddingLeft: 14 }}>
                  Signal:{" "}
                  <strong>
                    {typeof activeNode.rssi === "number" ? `${activeNode.rssi} dBm` : "—"}
                    {typeof activeNode.snr === "number" ? ` · SNR ${activeNode.snr.toFixed(1)} dB` : ""}
                  </strong>
                </div>
              )}
              {activeNode.parent_id && (
                <div style={{ fontSize: 12, color: "#374151", paddingLeft: 14 }}>
                  Parent: <strong>{activeNode.parent_id}</strong>
                </div>
              )}
              <div style={{ fontSize: 12, color: "#374151", paddingLeft: 14 }}>
                Last Updated:{" "}
                <span style={{ fontWeight: 500 }}>
                  {new Date(activeNode.last_updated).toLocaleString("en-GB", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "Asia/Kuala_Lumpur",
                    hour12: false,
                  })}{" "}
                  MYT
                </span>
              </div>
            </div>

            {/* ── Address (reverse-geocoded) + raw coords ── */}
            <div style={{
              margin: "0 0 10px",
              paddingTop: 6, borderTop: "1px solid #e5e7eb",
            }}>
              <p style={{ fontSize: 11, color: "#374151", margin: "0 0 4px", lineHeight: 1.35 }}>
                <span style={{ color: "#6b7280" }}>Address: </span>
                <span>
                  {activeAddress === null
                    ? "Resolving…"
                    : activeAddress === "—"
                      ? "Address unavailable"
                      : activeAddress}
                </span>
              </p>
              <p style={{ fontSize: 10, color: "#9ca3af", margin: 0 }}>
                {activeNode.latitude.toFixed(6)}°N, {activeNode.longitude.toFixed(6)}°E
                {activeNode.gps_fix === false ? " · estimated (no GPS fix)" : ""}
              </p>
            </div>

            {/* ── Favourite toggle button ── */}
            {onToggleFavourite && (() => {
              const isFav = favouriteIds?.has(activeNode._id) ?? false;
              return (
                <button
                  type="button"
                  onClick={() => onToggleFavourite(activeNode._id)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 6, width: "100%",
                    padding: "7px 12px",
                    borderRadius: 10,
                    border: isFav ? "1.5px solid #f59e0b" : "1.5px solid #d1d5db",
                    background: isFav ? "#fffbeb" : "#f9fafb",
                    color: isFav ? "#b45309" : "#374151",
                    fontSize: 12, fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = isFav ? "#fef3c7" : "#f3f4f6";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = isFav ? "#fffbeb" : "#f9fafb";
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                    fill={isFav ? "#f59e0b" : "none"}
                    stroke={isFav ? "#f59e0b" : "#6b7280"}
                    strokeWidth="1.8"
                    style={{ width: 14, height: 14, flexShrink: 0 }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                  {isFav ? "Remove from Favourites" : "Add to Favourites"}
                </button>
              );
            })()}
          </div>
        </InfoWindow>
      )}
      {/* ── Searched place: pin + InfoWindow ───────────────────────────── */}
      {searchedPlace && (
        <>
          <Marker
            position={{ lat: searchedPlace.lat, lng: searchedPlace.lng }}
            icon={{
              // Blue teardrop to distinguish a searched address from a sensor pin.
              path: "M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z",
              fillColor: "#2563eb",
              fillOpacity: 1,
              strokeColor: "#1e3a8a",
              strokeWeight: 1.5,
              scale: 1.1,
              anchor: new google.maps.Point(0, 0),
            }}
            zIndex={20}
            onClick={() => setSearchedPlaceClicked((p) => !p)}
          />
          {searchedPlaceClicked && (() => {
            // Count sensors within a default radius so the admin sees
            // immediately how many flood pins surround the chosen address.
            // Same haversine formula the saved-places panel uses.
            const R_M = 6371_000;
            const toRad = (d: number) => (d * Math.PI) / 180;
            const radiusKm = 3;
            const counts = nodes.reduce(
              (acc, n) => {
                const dLat = toRad(n.latitude - searchedPlace.lat);
                const dLng = toRad(n.longitude - searchedPlace.lng);
                const a =
                  Math.sin(dLat / 2) ** 2 +
                  Math.cos(toRad(searchedPlace.lat)) *
                    Math.cos(toRad(n.latitude)) *
                    Math.sin(dLng / 2) ** 2;
                const dM = 2 * R_M * Math.asin(Math.sqrt(a));
                if (dM > radiusKm * 1000) return acc;
                acc.total++;
                if (n.is_dead) acc.offline++;
                else if (n.current_level >= 3) acc.critical++;
                else if (n.current_level === 2) acc.warning++;
                else if (n.current_level === 1) acc.alert++;
                else acc.normal++;
                return acc;
              },
              { total: 0, normal: 0, alert: 0, warning: 0, critical: 0, offline: 0 },
            );
            return (
              <InfoWindow
                position={{ lat: searchedPlace.lat, lng: searchedPlace.lng }}
                onCloseClick={() => setSearchedPlaceClicked(false)}
                options={{
                  pixelOffset: new google.maps.Size(0, -34),
                  disableAutoPan: false,
                }}
              >
                <div style={{ minWidth: 240, padding: "2px 2px 4px", fontFamily: "inherit" }}>
                  <p style={{
                    fontWeight: 700, fontSize: 13, color: "#1a1a1a",
                    margin: 0, marginBottom: 4,
                  }}>
                    {searchedPlace.name}
                  </p>
                  {searchedPlace.address && (
                    <p style={{ fontSize: 11, color: "#6b7280", margin: 0, marginBottom: 8, lineHeight: 1.4 }}>
                      {searchedPlace.address}
                    </p>
                  )}
                  <div style={{
                    background: "#f3f4f6", borderRadius: 8,
                    padding: "6px 8px", marginBottom: 6, fontSize: 11, color: "#374151",
                  }}>
                    <strong>{counts.total}</strong> sensor{counts.total === 1 ? "" : "s"} within {radiusKm} km
                    {counts.total > 0 && (
                      <>
                        {" · "}
                        <span style={{ color: "#16a34a" }}>{counts.normal} normal</span>
                        {counts.alert > 0 && <>{" · "}<span style={{ color: "#f59e0b" }}>{counts.alert} alert</span></>}
                        {counts.warning > 0 && <>{" · "}<span style={{ color: "#f97316" }}>{counts.warning} warning</span></>}
                        {counts.critical > 0 && <>{" · "}<span style={{ color: "#dc2626" }}>{counts.critical} critical</span></>}
                        {counts.offline > 0 && <>{" · "}<span style={{ color: "#94a3b8" }}>{counts.offline} offline</span></>}
                      </>
                    )}
                  </div>
                  <p style={{ fontSize: 10, color: "#9ca3af", margin: 0 }}>
                    {searchedPlace.lat.toFixed(6)}°N, {searchedPlace.lng.toFixed(6)}°E
                  </p>
                </div>
              </InfoWindow>
            );
          })()}
        </>
      )}
    </GoogleMap>
    </div>
  );
}
