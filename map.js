// Leaflet map on OneMap tiles (SLA's own basemap). One layer group per section; only the active one is shown.
import { RADAR_BOUNDS } from "./data.js";

const L = window.L;
const SG = [1.3521, 103.8198];
const ISLAND = [[1.24, 103.62], [1.46, 104.03]];
const DARK = matchMedia("(prefers-color-scheme: dark)");
const tileUrl = () => `https://www.onemap.gov.sg/maps/tiles/${DARK.matches ? "Night" : "Default"}_HD/{z}/{x}/{y}.png`;

const div = (cls, html, size, anchor) => L.divIcon({ className: cls, html, iconSize: size, iconAnchor: anchor });

export function createMap(el, { onStop, onCam, onBcrs, onMove }) {
  const map = L.map(el, {
    zoomControl: false, minZoom: 10, maxZoom: 19, zoomSnap: 0.5,
    maxBounds: [[0.75, 103.3], [1.75, 104.5]], maxBoundsViscosity: 0.8,
  }).setView(SG, 12);
  map.attributionControl.setPrefix(false).setPosition("topright");
  const tiles = L.tileLayer(tileUrl(), {
    detectRetina: true, minNativeZoom: 11, maxNativeZoom: 19,
    attribution: '<a href="https://www.onemap.gov.sg" target="_blank" rel="noopener">OneMap</a> © SLA',
  }).addTo(map);
  DARK.addEventListener("change", () => tiles.setUrl(tileUrl()));

  const groups = Object.fromEntries(["bus", "rain", "air", "cams", "bcrs"].map(k => [k, L.layerGroup()]));
  let active = null;
  let sheetPx = 0;
  let me = null, meRing = null;

  // Keeps things centred in the part of the map the sheet isn't covering.
  function show(latlng, zoom = map.getZoom()) {
    const z = zoom;
    const p = map.project(latlng, z).add([0, sheetPx / 2]);
    map.flyTo(map.unproject(p, z), z, { duration: 0.6 });
  }

  // ------------------------------------------------ buses
  let stops = {}, stopMarkers = new Map(), selected = null, busMarkers = L.layerGroup().addTo(groups.bus);
  const stopLayer = L.layerGroup().addTo(groups.bus);
  function drawStops() {
    if (active !== "bus") return;
    const z = map.getZoom();
    const want = new Set();
    if (z >= 15.5) {
      const b = map.getBounds().pad(0.15);
      for (const s of Object.values(stops)) {
        if (b.contains([s.lat, s.lng])) want.add(s.code);
        if (want.size > 260) break;
      }
    }
    if (selected) want.add(selected);
    for (const [code, m] of stopMarkers) if (!want.has(code)) { stopLayer.removeLayer(m); stopMarkers.delete(code); }
    for (const code of want) {
      if (stopMarkers.has(code) || !stops[code]) continue;
      const s = stops[code];
      const m = L.marker([s.lat, s.lng], { icon: stopIcon(code === selected), keyboard: false, riseOnHover: true })
        .on("click", () => onStop(code));
      stopMarkers.set(code, m.addTo(stopLayer));
    }
  }
  const stopIcon = sel => div("pin-stop" + (sel ? " sel" : ""), `<span><svg viewBox="0 0 24 24"><path d="M6 4h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2v2h-2.5v-2h-7v2H6v-2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 3v5h12V7H6Zm1.5 6.5a1.2 1.2 0 1 0 0 .01Zm9 0a1.2 1.2 0 1 0 0 .01Z"/></svg></span>`, sel ? [38, 38] : [26, 26], sel ? [19, 19] : [13, 13]);

  // ------------------------------------------------ rain
  let radar = null, rainDots = L.layerGroup().addTo(groups.rain), areaLabels = L.layerGroup().addTo(groups.rain);

  // ------------------------------------------------ air / cams / bcrs
  const airLayer = L.layerGroup().addTo(groups.air);
  const camLayer = L.layerGroup().addTo(groups.cams);
  const bcrsLayer = L.layerGroup().addTo(groups.bcrs);

  map.on("moveend zoomend", () => { drawStops(); onMove?.(map.getCenter(), map.getZoom()); });

  return {
    map, show,
    setSheet(px) { sheetPx = px; },
    setSection(id) {
      if (active) map.removeLayer(groups[active]);
      active = id;
      map.addLayer(groups[id]);
      drawStops();
    },
    setMe(pos, accuracy) {
      const ll = [pos.lat, pos.lng];
      if (!me) {
        meRing = L.circle(ll, { radius: accuracy, className: "me-ring", interactive: false }).addTo(map);
        me = L.marker(ll, { icon: div("pin-me", "<span></span>", [22, 22], [11, 11]), interactive: false, zIndexOffset: 1000 }).addTo(map);
      } else { me.setLatLng(ll); meRing.setLatLng(ll).setRadius(accuracy); }
    },
    view(pos, zoom) { show([pos.lat, pos.lng], zoom); },
    // Whole-island view for the sections that are about all of Singapore.
    overview(id) {
      if (id === "cams") {
        const b = L.latLngBounds(camLayer.getLayers().map(m => m.getLatLng()));
        if (b.isValid()) return map.flyToBounds(b, { paddingTopLeft: [30, 80], paddingBottomRight: [30, sheetPx + 30], duration: 0.6 });
      }
      if (map.getZoom() > 12 || id === "air") map.flyToBounds(ISLAND, { paddingTopLeft: [8, 70], paddingBottomRight: [8, sheetPx + 8], duration: 0.6 });
    },

    // buses
    setStops(s) { stops = s; drawStops(); },
    selectStop(code, fly = true) {
      const prev = selected;
      selected = code;
      for (const c of [prev, code]) { const m = c && stopMarkers.get(c); if (m) { stopLayer.removeLayer(m); stopMarkers.delete(c); } }
      busMarkers.clearLayers();
      drawStops();
      if (code && fly && stops[code]) show([stops[code].lat, stops[code].lng], Math.max(map.getZoom(), 16.5));
    },
    setBuses(services) {
      busMarkers.clearLayers();
      for (const s of services) {
        const b = s.buses[0];
        if (!b || !b.live || !b.lat) continue;
        L.marker([b.lat, b.lng], { icon: div("pin-bus", `<span>${s.no}</span>`, null, [18, 13]), interactive: false }).addTo(busMarkers);
      }
    },

    // rain
    setRadar(url) {
      if (!url) { radar && groups.rain.removeLayer(radar); radar = null; return; }
      if (!radar) radar = L.imageOverlay(url, RADAR_BOUNDS, { opacity: 0.75, className: "radar", interactive: false }).addTo(groups.rain);
      else radar.setUrl(url);
    },
    setRain(stations, areas) {
      rainDots.clearLayers(); areaLabels.clearLayers();
      for (const s of stations) {
        const wet = s.mm > 0;
        L.circleMarker([s.lat, s.lng], {
          radius: wet ? 6 + Math.min(10, s.mm * 2) : 3, weight: wet ? 2 : 0, color: "#fff",
          fillColor: wet ? rainColor(s.mm) : "#7a8ba3", fillOpacity: wet ? 0.95 : 0.45,
        }).bindTooltip(`${s.name}: ${s.mm} mm`, { direction: "top" }).addTo(rainDots);
      }
      for (const a of areas || []) {
        if (!/shower|rain|thunder/i.test(a.text)) continue;
        L.marker([a.lat, a.lng], { icon: div("pin-area", `<span>${wxEmoji(a.text)}</span>`, [28, 28], [14, 14]), interactive: false }).addTo(areaLabels);
      }
    },

    // air
    setPsi(regions) {
      airLayer.clearLayers();
      for (const r of regions) {
        const band = psiBand(r.psi);
        L.marker([r.lat, r.lng], { icon: div("pin-psi", `<span style="--c:${band.color}"><b>${r.psi}</b><i>${r.name}</i></span>`, [64, 46], [32, 23]) }).addTo(airLayer);
      }
    },

    // cams
    setCams(cams, onTap) {
      camLayer.clearLayers();
      for (const c of cams) {
        L.marker([c.lat, c.lng], { icon: div("pin-cam", `<span><svg viewBox="0 0 24 24"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm8 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/></svg></span>`, [32, 32], [16, 16]) })
          .on("click", () => onCam(c.id)).addTo(camLayer);
      }
    },

    // bottle return
    setBcrs(list) {
      bcrsLayer.clearLayers();
      list.forEach((m, i) => L.marker([m.lat, m.lng], { icon: div("pin-bcrs", "<span>♻</span>", [26, 26], [13, 13]) })
        .on("click", () => onBcrs(i)).addTo(bcrsLayer));
    },
  };
}

export function rainColor(mm) {
  return mm >= 5 ? "#c2185b" : mm >= 2 ? "#e53935" : mm >= 1 ? "#fb8c00" : mm >= 0.4 ? "#1e88e5" : "#4fc3f7";
}

export function psiBand(v) {
  if (v == null) return { name: "No data", color: "#9aa0a6" };
  if (v <= 50) return { name: "Good", color: "#1faa59", tip: "Steady, go outside lah." };
  if (v <= 100) return { name: "Moderate", color: "#2f80ed", tip: "Can still jog, just don't overdo it." };
  if (v <= 200) return { name: "Unhealthy", color: "#f2a20c", tip: "Hazy leh. Cut down outdoor exercise." };
  if (v <= 300) return { name: "Very unhealthy", color: "#e5372f", tip: "Stay indoors, wear an N95 if you go out." };
  return { name: "Hazardous", color: "#8e1b4f", tip: "Don't go out unless you must." };
}

export function uvBand(v) {
  if (v == null) return { name: "No data", color: "#9aa0a6" };
  if (v <= 2) return { name: "Low", color: "#1faa59", tip: "No worries." };
  if (v <= 5) return { name: "Moderate", color: "#e8c60c", tip: "Sunglasses can already." };
  if (v <= 7) return { name: "High", color: "#f2850c", tip: "Sunblock on, find some shade." };
  if (v <= 10) return { name: "Very high", color: "#e5372f", tip: "Walk under the sheltered walkway lah." };
  return { name: "Extreme", color: "#8e44ad", tip: "Hide in the void deck." };
}

export function wxEmoji(t) {
  t = t.toLowerCase();
  if (t.includes("thunder")) return "⛈️";
  if (t.includes("heavy")) return "🌧️";
  if (t.includes("shower") || t.includes("rain") || t.includes("drizzle")) return "🌦️";
  if (t.includes("hazy") || t.includes("haze")) return "😶‍🌫️";
  if (t.includes("windy")) return "🍃";
  if (t.includes("night")) return t.includes("cloudy") ? "☁️" : "🌙";
  if (t.includes("cloudy")) return "⛅";
  if (t.includes("fair") || t.includes("sunny")) return "☀️";
  if (t.includes("mist") || t.includes("fog")) return "🌫️";
  return "🌤️";
}
