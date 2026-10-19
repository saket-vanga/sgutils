// Every feed here is public and allows calls straight from the browser, so the site stays plain static files.
//   buses   — arrivelah (LTA DataMall relay) + busrouter.sg stop list
//   weather — data.gov.sg real-time APIs, rain radar images from weather.gov.sg
//   cams    — data.gov.sg traffic images (the open feed only carries the checkpoint + Sentosa cameras)

const V1 = "https://api.data.gov.sg/v1/environment";
const V2 = "https://api-open.data.gov.sg/v2/real-time/api";  // tight rate limit — only used for the 90-gauge rainfall

// Answers are kept for `ttl` ms so switching sections doesn't refetch. One retry, because data.gov.sg's
// rate limit replies without CORS headers and shows up as a plain network error.
const memo = new Map();
function json(url, ttl = 0) {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const get = () => fetch(url, { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`); return r.json(); });
  const p = get().catch(() => new Promise(res => setTimeout(res, 2500)).then(get));
  memo.set(url, { t: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

// ---------------------------------------------------------------- buses

let stopsPromise;
// { code: { code, lat, lng, name, road } } — ~5,000 stops, cached by the service worker after the first load.
export function busStops() {
  stopsPromise ||= json("https://data.busrouter.sg/v1/stops.min.json").then(raw => {
    const out = {};
    for (const [code, [lng, lat, name, road]] of Object.entries(raw)) out[code] = { code, lat, lng, name, road };
    return out;
  }).catch(e => { stopsPromise = null; throw e; });
  return stopsPromise;
}

// Arrivals for one stop. Each service has up to three buses: { mins, load, type, wheelchair, lat, lng, dest }.
export async function arrivals(code) {
  const d = await json(`https://arrivelah2.busrouter.sg/?id=${encodeURIComponent(code)}`, 10e3);
  const bus = b => b && b.time ? {
    mins: Math.max(0, Math.floor(b.duration_ms / 60000)),
    load: b.load,          // SEA seats · SDA standing · LSD packed
    type: b.type,          // SD single · DD double · BD bendy
    wheelchair: b.feature === "WAB",
    lat: b.lat, lng: b.lng, live: b.monitored === 1,
    dest: b.destination_code,
  } : null;
  return (d.services || [])
    .map(s => ({ no: s.no, operator: s.operator, buses: [s.next, s.next2, s.next3].map(bus).filter(Boolean) }))
    .sort((a, b) => a.no.localeCompare(b.no, undefined, { numeric: true }));
}

// ---------------------------------------------------------------- weather

export async function forecast2h() {
  const d = await json(`${V1}/2-hour-weather-forecast`, 60e3);
  const it = d.items[0];
  const where = Object.fromEntries(d.area_metadata.map(a => [a.name, a.label_location]));
  const t = x => new Date(x).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" }).toLowerCase();
  return {
    period: `${t(it.valid_period.start)} to ${t(it.valid_period.end)}`,
    areas: it.forecasts.map(f => ({ name: f.area, text: f.forecast, lat: where[f.area]?.latitude, lng: where[f.area]?.longitude })),
  };
}

export async function rainfall() {
  try {
    const d = (await json(`${V2}/rainfall`, 60e3)).data;
    const r = d.readings[0];
    const val = Object.fromEntries(r.data.map(x => [x.stationId, x.value]));
    return {
      time: r.timestamp,
      stations: d.stations.map(s => ({ id: s.id, name: s.name, lat: s.location.latitude, lng: s.location.longitude, mm: val[s.id] ?? null }))
        .filter(s => s.mm !== null),
    };
  } catch {
    const d = await json(`${V1}/rainfall`, 60e3);  // fewer gauges, but no rate limit
    const val = Object.fromEntries(d.items[0].readings.map(x => [x.station_id, x.value]));
    return {
      time: d.items[0].timestamp,
      stations: d.metadata.stations.map(s => ({ id: s.id, name: s.name, lat: s.location.latitude, lng: s.location.longitude, mm: val[s.id] ?? null }))
        .filter(s => s.mm !== null),
    };
  }
}

// The radar is a 5-minute PNG covering Singapore and the edges of Johor and Riau.
export const RADAR_BOUNDS = [[1.156, 103.565], [1.475, 104.13]];
const pad = n => String(n).padStart(2, "0");
function sgt(ms) {  // YYYYMMDDHHmm in Singapore time, whatever the phone's timezone
  const d = new Date(ms + 8 * 3600e3);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}
// Newest frames come out a few minutes late, so we try the last ~70 minutes and keep the ones that load.
export function radarFrames(count = 13) {
  const step = 5 * 60e3;
  const latest = Math.floor(Date.now() / step) * step;
  const frames = [];
  for (let i = count; i >= 0; i--) {
    const t = latest - i * step;
    frames.push({ t, url: `https://www.weather.gov.sg/files/rainarea/50km/v2/dpsri_70km_${sgt(t)}0000dBR.dpsri.png` });
  }
  return Promise.all(frames.map(f => new Promise(res => {
    const img = new Image();
    img.onload = () => res(f);
    img.onerror = () => res(null);
    img.src = f.url;
  }))).then(list => list.filter(Boolean).slice(-12));
}

// ---------------------------------------------------------------- air

export const REGIONS = ["north", "west", "central", "east", "south"];

export async function psi() {
  const d = await json(`${V1}/psi`, 60e3);
  const it = d.items[0];
  return {
    time: it.timestamp,
    regions: d.region_metadata.filter(r => r.name !== "national").map(r => ({
      name: r.name, lat: r.label_location.latitude, lng: r.label_location.longitude,
      psi: it.readings.psi_twenty_four_hourly[r.name],
    })),
  };
}

export async function pm25() {
  const it = (await json(`${V1}/pm25`, 60e3)).items[0];
  return { time: it.timestamp, regions: it.readings.pm25_one_hourly };
}

export async function uv() {
  const it = (await json(`${V1}/uv-index`, 60e3)).items[0];
  const hours = it.index.map(h => ({ hour: h.timestamp, value: h.value })).sort((a, b) => a.hour.localeCompare(b.hour));
  return { time: it.timestamp, now: hours[hours.length - 1]?.value ?? null, hours };
}

// ---------------------------------------------------------------- cams

export const CAMS = {
  "2701": { name: "Woodlands Causeway", sub: "Towards Johor", group: "Woodlands" },
  "2702": { name: "Woodlands Checkpoint", sub: "Towards BKE", group: "Woodlands" },
  "2704": { name: "Woodlands Flyover", sub: "Towards Checkpoint", group: "Woodlands" },
  "4703": { name: "Second Link", sub: "Towards Johor", group: "Tuas" },
  "4713": { name: "Tuas Checkpoint", sub: "Arrival lanes", group: "Tuas" },
  "4712": { name: "AYE at Tuas", sub: "Towards Checkpoint", group: "Tuas" },
  "4798": { name: "Sentosa Gateway", sub: "Towards Sentosa", group: "Sentosa" },
  "4799": { name: "Sentosa Gateway", sub: "Towards city", group: "Sentosa" },
};

export async function cameras() {
  const d = await json("https://api.data.gov.sg/v1/transport/traffic-images", 20e3);
  return d.items[0].cameras.map(c => ({
    id: c.camera_id, img: c.image, time: c.timestamp,
    lat: c.location.latitude, lng: c.location.longitude,
    ...(CAMS[c.camera_id] || { name: `Camera ${c.camera_id}`, sub: "", group: "Other" }),
  }));
}

// ---------------------------------------------------------------- bottle return machines

// data/bcrs.json is a snapshot made by ../update-bcrs.py: { updated, machines: [{ name, address, lat, lng, hours, count }] }.
// Return Right's own API doesn't allow calls from other sites, so live fill levels stay on their finder.
export async function bcrs() {
  try {
    const r = await fetch("data/bcrs.json");
    if (!r.ok) return { updated: null, machines: [] };
    const d = await r.json();
    return Array.isArray(d) ? { updated: null, machines: d } : { updated: d.updated, machines: d.machines || [] };
  } catch { return { updated: null, machines: [] }; }
}

// ---------------------------------------------------------------- trains

// data/rail.json: MRT/LRT lines and stations, trimmed from railrouter-sg (OpenStreetMap).
let railPromise;
export function rail() {
  railPromise ||= fetch("data/rail.json").then(r => r.json()).catch(e => { railPromise = null; throw e; });
  return railPromise;
}

const CODE_COLORS = { NS: "#d42e12", EW: "#009645", CG: "#009645", NE: "#9900aa", CC: "#fa9e0d", CE: "#fa9e0d", DT: "#005ec4", TE: "#9d5b25" };
export const codeColor = code => CODE_COLORS[code.replace(/\d.*/, "")] || "#748477";
export const LINE_NAMES = { NS: "North South", EW: "East West", CG: "East West", NE: "North East", CC: "Circle", CE: "Circle", DT: "Downtown", TE: "Thomson-East Coast",
  BP: "Bukit Panjang LRT", SE: "Sengkang LRT", SW: "Sengkang LRT", STC: "Sengkang LRT", PE: "Punggol LRT", PW: "Punggol LRT", PTC: "Punggol LRT" };

// ---------------------------------------------------------------- geo helpers

export const gmaps = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

export function metres(a, b) {
  const R = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearest(list, from, n = 8) {
  return list.map(x => ({ ...x, dist: metres(from, x) })).sort((a, b) => a.dist - b.dist).slice(0, n);
}

export const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
