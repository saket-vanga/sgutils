import { html, render, useState, useEffect, useRef, useMemo, useCallback } from "./vendor/preact-htm.js";
import * as api from "./data.js";
import { createMap, psiBand, uvBand, wxEmoji, rainColor } from "./map.js";

// ---------------------------------------------------------------- bits

const SECTIONS = [
  { id: "bus", code: "BS1", name: "Buses", color: "#009645" },
  { id: "mrt", code: "MR2", name: "Trains", color: "#d42e12" },
  { id: "rain", code: "WX3", name: "Rain", color: "#005ec4" },
  { id: "air", code: "HZ4", name: "Haze", color: "#f99d1c" },
  { id: "cams", code: "CM5", name: "Traffic", color: "#9d5b25" },
  { id: "bcrs", code: "RR6", name: "Bottles", color: "#9900aa" },
];
const SEC = Object.fromEntries(SECTIONS.map(s => [s.id, s]));

const store = {
  get(k, d) { try { const v = localStorage.getItem("sgutils." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("sgutils." + k, JSON.stringify(v)); } catch {} },
};

const ICONS = {
  locate: "M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z",
  star: "M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.5Z",
  close: "M6 6l12 12M18 6L6 18",
  back: "M15 5l-7 7 7 7",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM20 20l-4.8-4.8",
  play: "M8 5.5v13l10-6.5-10-6.5Z",
  pause: "M8 5v14M16 5v14",
  refresh: "M20 11a8 8 0 0 0-14.7-4.3M4 5v4h4M4 13a8 8 0 0 0 14.7 4.3M20 19v-4h-4",
  go: "M5 12h14M13 6l6 6-6 6",
  share: "M12 3v12M7.5 7.5L12 3l4.5 4.5M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1",
  addSquare: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM12 8v8M8 12h8",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  wheelchair: "M10 4.5a1.5 1.5 0 1 0 0 .01ZM10 8v6h6l2 5M14 11h-4M8 11.5a5 5 0 1 0 6.5 6.5",
};
function Icon({ name, size = 20, stroke = 2, fill = false }) {
  return html`<svg class="ic" width=${size} height=${size} viewBox="0 0 24 24" fill=${fill ? "currentColor" : "none"} stroke="currentColor"
    stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round"><path d=${ICONS[name]} /></svg>`;
}

const GMaps = ({ lat, lng }) => html`<a class="chip gmaps" target="_blank" rel="noopener" href=${api.gmaps(lat, lng)}>
  <${Icon} name="pin" size=${16} /> Open in Google Maps</a>`;

const sgTime = t => new Date(t).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" }).replace(" ", "").toLowerCase();
function ago(t) {
  const s = Math.max(0, (Date.now() - new Date(t)) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : `at ${sgTime(t)}`;
}
const title = s => s.replace(/\b\w/g, c => c.toUpperCase());

// Fetches now and every `ms`, and again whenever the app comes back to the foreground.
function usePoll(fn, ms, deps = []) {
  const [st, set] = useState({ data: null, error: null, loading: true });
  const tick = useRef(0);
  const load = useCallback(() => {
    const me = ++tick.current;
    set(s => ({ ...s, loading: true }));
    Promise.resolve().then(fn).then(
      data => me === tick.current && set({ data, error: null, loading: false }),
      error => me === tick.current && set(s => ({ data: s.data, error, loading: false })));
  }, deps);
  useEffect(() => {
    load();
    const id = ms ? setInterval(() => document.visibilityState === "visible" && load(), ms) : null;
    const vis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [load]);
  return { ...st, reload: load };
}

function Oops({ error, retry }) {
  return html`<div class="oops"><b>Alamak, cannot load.</b><span>${String(error?.message || error)}</span>
    <button class="chip" onClick=${retry}><${Icon} name="refresh" size=${16} /> Try again</button></div>`;
}
const Loading = ({ text = "Loading… wait ah" }) => html`<div class="loading"><span class="dots"><i/><i/><i/></span>${text}</div>`;

// ---------------------------------------------------------------- the line strip (section menu)

function LineStrip({ section, onPick }) {
  return html`<nav class="strip" aria-label="Sections">
    <div class="strip-line">${SECTIONS.slice(0, -1).map((s, i) => html`<span key=${s.id} style=${{ background: `linear-gradient(90deg, ${s.color}, ${SECTIONS[i + 1].color})` }} />`)}</div>
    ${SECTIONS.map(s => html`<button key=${s.id} class=${"stn" + (s.id === section ? " on" : "")} style=${{ "--c": s.color }}
        onClick=${() => onPick(s.id)} aria-current=${s.id === section}>
      <span class="stn-dot" />
      <span class="code">${s.code}</span>
      <span class="stn-name">${s.name}</span>
    </button>`)}
  </nav>`;
}

// ---------------------------------------------------------------- sheet

function safeBottom() {
  const p = document.createElement("div");
  p.style.cssText = "position:fixed;padding-bottom:env(safe-area-inset-bottom);visibility:hidden";
  document.body.append(p);
  const v = parseFloat(getComputedStyle(p).paddingBottom) || 0;
  p.remove();
  return v;
}

function Sheet({ snap, setSnap, onHeight, header, children, page }) {
  const body = useRef();
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [page]);
  const [vh, setVh] = useState(innerHeight);
  const sb = useMemo(safeBottom, []);
  useEffect(() => { const r = () => setVh(innerHeight); addEventListener("resize", r); return () => removeEventListener("resize", r); }, []);
  const H = { peek: 150 + sb, half: Math.round(vh * 0.5), full: vh - 64 - (sb ? 40 : 10) };
  const [drag, setDrag] = useState(null);
  const g = useRef(null);
  const h = drag ?? H[snap];
  useEffect(() => { onHeight(h); }, [h]);

  const down = e => {
    if (e.button) return;
    g.current = { y: e.clientY, h: H[snap], t: e.timeStamp, moved: false, id: e.pointerId, el: e.currentTarget, v: 0, ly: e.clientY, lt: e.timeStamp };
  };
  const move = e => {
    const s = g.current; if (!s) return;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.abs(dy) < 7) return;
    if (!s.moved) { s.moved = true; try { s.el.setPointerCapture(s.id); } catch {} }
    s.v = (e.clientY - s.ly) / Math.max(1, e.timeStamp - s.lt); s.ly = e.clientY; s.lt = e.timeStamp;
    setDrag(Math.max(H.peek - 40, Math.min(H.full + 20, s.h - dy)));
  };
  const up = () => {
    const s = g.current; g.current = null;
    if (!s?.moved) return;
    const cur = drag ?? H[snap];
    const order = ["peek", "half", "full"];
    let next = order.reduce((a, b) => Math.abs(H[b] - cur) < Math.abs(H[a] - cur) ? b : a);
    if (Math.abs(s.v) > 0.5) {
      const i = order.indexOf(snap) + (s.v < 0 ? 1 : -1);
      next = order[Math.max(0, Math.min(2, i))];
    }
    setDrag(null); setSnap(next);
    s.el.addEventListener("click", ev => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
  };

  return html`<section class=${"sheet" + (drag != null ? " dragging" : "")} style=${{ height: h + "px" }}>
    <div class="sheet-head" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
      <button class="grab" aria-label="Resize panel" onClick=${() => setSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "half")}><span /></button>
      ${header}
    </div>
    <div class="sheet-body" ref=${body}>${children}</div>
  </section>`;
}

// ---------------------------------------------------------------- buses

const LOAD = { SEA: ["seats", "Seats available"], SDA: ["stand", "Standing only"], LSD: ["full", "Packed"] };

function BusTime({ b }) {
  return html`<span class=${"t " + (LOAD[b.load]?.[0] || "")} title=${LOAD[b.load]?.[1] || ""}>
    <b>${b.mins <= 1 ? "Arr" : b.mins}</b>
    ${b.type === "DD" && html`<i class="tag">DD</i>`}${b.type === "BD" && html`<i class="tag">BD</i>`}
  </span>`;
}

function Board({ code, stops, mapApi, active }) {
  const { data, error, loading, reload } = usePoll(() => api.arrivals(code), 15000, [code]);
  useEffect(() => { if (active && data) mapApi.current?.setBuses(data); }, [data, active]);
  useEffect(() => () => mapApi.current?.setBuses([]), [code]);
  if (error && !data) return html`<${Oops} error=${error} retry=${reload} />`;
  if (!data) return html`<div class="led"><${Loading} text="Asking the buses…" /></div>`;
  if (!data.length) return html`<div class="led empty">No buses now. Last bus gone liao? 😴</div>`;
  return html`<div class=${"led" + (loading ? " busy" : "")}>
    ${data.map(s => {
      const dest = stops[s.buses[0]?.dest];
      return html`<div class="led-row" key=${s.no}>
        <span class="svc">${s.no}</span>
        <span class="dest">${dest ? `to ${dest.name}` : ""}${s.buses[0]?.wheelchair ? html` <${Icon} name="wheelchair" size=${12} />` : ""}</span>
        <span class="times">${s.buses.length ? s.buses.map((b, i) => html`<${BusTime} key=${i} b=${b} />`) : html`<span class="t none">—</span>`}</span>
      </div>`;
    })}
    <div class="led-legend"><span class="seats">Seats</span><span class="stand">Standing</span><span class="full">Packed</span></div>
  </div>`;
}

function MiniArrivals({ code }) {
  const { data } = usePoll(() => api.arrivals(code), 30000, [code]);
  if (!data) return html`<span class="mini muted">…</span>`;
  const soon = data.flatMap(s => s.buses[0] ? [{ no: s.no, m: s.buses[0].mins }] : []).sort((a, b) => a.m - b.m).slice(0, 4);
  if (!soon.length) return html`<span class="mini muted">No buses now</span>`;
  return html`<span class="mini">${soon.map(x => html`<span key=${x.no}><b>${x.no}</b> ${x.m <= 1 ? "Arr" : x.m + "m"}</span>`)}</span>`;
}

function StopRow({ s, onOpen, live, fav }) {
  return html`<button class="row" onClick=${() => onOpen(s.code)}>
    <span class="code bus">${s.code}</span>
    <span class="grow"><span class="row-t">${fav ? "★ " : ""}${s.name}</span>
      <span class="row-d">${s.road}${s.dist != null ? ` · ${api.fmtDist(s.dist)}` : ""}</span>
      ${live && html`<${MiniArrivals} code=${s.code} />`}</span>
    <${Icon} name="go" size=${18} />
  </button>`;
}

function BusPanel({ stops, pos, stop, setStop, mapApi, active }) {
  const [q, setQ] = useState("");
  const [favs, setFavs] = useState(() => store.get("favs", []));
  const toggleFav = c => { const f = favs.includes(c) ? favs.filter(x => x !== c) : [c, ...favs]; setFavs(f); store.set("favs", f); };
  const all = useMemo(() => stops ? Object.values(stops) : [], [stops]);
  const near = useMemo(() => pos && all.length ? api.nearest(all, pos, 10) : [], [pos?.lat, pos?.lng, all]);
  const found = useMemo(() => {
    const t = q.trim().toLowerCase(); if (!t || !all.length) return [];
    return all.filter(s => s.code.startsWith(t) || s.name.toLowerCase().includes(t) || s.road.toLowerCase().includes(t)).slice(0, 40)
      .map(s => pos ? { ...s, dist: api.metres(pos, s) } : s);
  }, [q, all]);

  if (!stops) return html`<${Loading} text="Loading bus stops…" />`;
  if (stop && stops[stop]) {
    const s = stops[stop];
    return html`<div class="pad">
      <div class="stop-head">
        <button class="icon-btn" onClick=${() => setStop(null)} aria-label="Back"><${Icon} name="back" /></button>
        <div class="grow"><div class="stop-name">${s.name}</div><div class="row-d"><span class="code bus sm">${s.code}</span> ${s.road}${pos ? ` · ${api.fmtDist(api.metres(pos, s))}` : ""}</div></div>
        <button class=${"icon-btn star" + (favs.includes(stop) ? " on" : "")} onClick=${() => toggleFav(stop)} aria-label="Favourite"><${Icon} name="star" fill=${favs.includes(stop)} /></button>
      </div>
      <${Board} code=${stop} stops=${stops} mapApi=${mapApi} active=${active} />
      <div class="actions"><${GMaps} lat=${s.lat} lng=${s.lng} /></div>
    </div>`;
  }
  return html`<div class="pad">
    <label class="search"><${Icon} name="search" size=${18} /><input placeholder="Stop number, name or road" value=${q} onInput=${e => setQ(e.target.value)} inputmode="search" enterkeyhint="search" />
      ${q && html`<button onClick=${() => setQ("")} aria-label="Clear"><${Icon} name="close" size=${16} /></button>`}</label>
    ${q ? html`<div class="list">${found.length ? found.map(s => html`<${StopRow} key=${s.code} s=${s} onOpen=${setStop} />`) : html`<p class="empty-note">No stop like that leh.</p>`}</div>`
    : html`
      ${favs.length > 0 && html`<h4 class="sub">Your stops</h4><div class="list">${favs.filter(c => stops[c]).map(c => html`<${StopRow} key=${c} s=${pos ? { ...stops[c], dist: api.metres(pos, stops[c]) } : stops[c]} onOpen=${setStop} live fav />`)}</div>`}
      <h4 class="sub">Near you</h4>
      ${pos ? html`<div class="list">${near.map((s, i) => html`<${StopRow} key=${s.code} s=${s} onOpen=${setStop} live=${i < 4} />`)}</div>`
        : html`<p class="empty-note">Turn on location to see stops near you — or zoom in on the map and tap a stop.</p>`}`}
  </div>`;
}

// ---------------------------------------------------------------- trains

const Codes = ({ codes, sm }) => html`<span class="codes">${codes.map(c => html`<span key=${c} class=${"code" + (sm ? " sm" : "")} style=${{ "--c": api.codeColor(c) }}>${c}</span>`)}</span>`;

function TrainsPanel({ rail, pos, station, setStation, stops, setStop, mapApi }) {
  const [q, setQ] = useState("");
  const list = rail?.stations || [];
  const withIdx = useMemo(() => list.map((st, i) => ({ ...st, i })), [list]);
  const near = useMemo(() => pos ? api.nearest(withIdx, pos, 6) : [], [withIdx, pos?.lat, pos?.lng]);
  const found = useMemo(() => {
    const t = q.trim().toLowerCase(); if (!t) return [];
    return withIdx.filter(st => st.name.toLowerCase().includes(t) || st.codes.some(c => c.toLowerCase() === t)).slice(0, 30);
  }, [q, withIdx]);
  const sel = station != null ? list[station] : null;
  const busNear = useMemo(() => sel && stops ? api.nearest(Object.values(stops), sel, 4) : [], [sel, stops]);
  useEffect(() => { mapApi.current?.pickStation(sel); }, [sel]);
  if (!rail) return html`<div class="pad"><${Loading} text="Drawing the MRT map…" /></div>`;

  const row = st => html`<button class="row" key=${st.i} onClick=${() => setStation(st.i)}>
    <${Codes} codes=${st.codes} sm />
    <span class="grow"><span class="row-t">${st.name}</span>${st.dist != null && html`<span class="row-d">${api.fmtDist(st.dist)}</span>`}</span>
    <${Icon} name="go" size=${18} /></button>`;

  if (sel) {
    const lines = [...new Set(sel.codes.map(c => api.LINE_NAMES[c.replace(/\d.*/, "")] || "LRT"))];
    return html`<div class="pad">
      <div class="stop-head">
        <button class="icon-btn" onClick=${() => setStation(null)} aria-label="Back"><${Icon} name="back" /></button>
        <div class="grow"><div class="stop-name">${sel.name}</div>
          <div class="row-d">${lines.map(l => /LRT/.test(l) ? l : `${l} Line`).join(" · ")}${pos ? ` · ${api.fmtDist(api.metres(pos, sel))}` : ""}</div></div>
      </div>
      <div class="stn-codes"><${Codes} codes=${sel.codes} />${sel.codes.length > 1 && html`<span class="row-d">Interchange</span>`}</div>
      <div class="actions"><${GMaps} lat=${sel.lat} lng=${sel.lng} /></div>
      ${busNear.length > 0 && html`<h4 class="sub">Buses outside</h4>
        <div class="list">${busNear.map(b => html`<${StopRow} key=${b.code} s=${b} onOpen=${setStop} live />`)}</div>`}
    </div>`;
  }
  const lineChips = [["NS", "#d42e12"], ["EW", "#009645"], ["NE", "#9900aa"], ["CC", "#fa9e0d"], ["DT", "#005ec4"], ["TE", "#9d5b25"], ["LRT", "#748477"]];
  return html`<div class="pad">
    <label class="search"><${Icon} name="search" size=${18} /><input placeholder="Station name or code, e.g. NE6" value=${q} onInput=${e => setQ(e.target.value)} inputmode="search" enterkeyhint="search" />
      ${q && html`<button onClick=${() => setQ("")} aria-label="Clear"><${Icon} name="close" size=${16} /></button>`}</label>
    ${q ? html`<div class="list" style=${{ marginTop: "12px" }}>${found.length ? found.map(row) : html`<p class="empty-note">No station like that leh.</p>`}</div>`
    : html`
      <div class="line-chips">${lineChips.map(([c, col]) => html`<button key=${c} class="code" style=${{ "--c": col }} onClick=${() => mapApi.current?.fitLine(c)}>${c === "LRT" ? "LRT" : api.LINE_NAMES[c]}</button>`)}</div>
      <h4 class="sub">Nearest stations</h4>
      ${pos ? html`<div class="list">${near.map(row)}</div>`
        : html`<p class="empty-note">Turn on location to see stations near you — or tap a station on the map.</p>`}
      <p class="fine">Tap a line to see the whole thing. Map from OpenStreetMap via railrouter-sg.</p>`}
  </div>`;
}

// ---------------------------------------------------------------- rain

function RainPanel({ pos, mapApi, active }) {
  const fc = usePoll(api.forecast2h, 5 * 60e3);
  const rf = usePoll(api.rainfall, 2 * 60e3);
  const rd = usePoll(() => api.radarFrames(), 5 * 60e3);
  const frames = rd.data || [];
  const [i, setI] = useState(-1);
  const [playing, setPlaying] = useState(true);
  const idx = i < 0 || i >= frames.length ? frames.length - 1 : i;

  useEffect(() => { setI(-1); }, [frames.length && frames[frames.length - 1].t]);
  useEffect(() => {
    if (!playing || frames.length < 2 || !active) return;
    const id = setTimeout(() => setI((idx + 1) % frames.length), idx === frames.length - 1 ? 1600 : 450);
    return () => clearTimeout(id);
  }, [playing, idx, frames.length, active]);
  useEffect(() => { if (active) mapApi.current?.setRadar(frames[idx]?.url); }, [idx, frames, active]);
  useEffect(() => { if (rf.data) mapApi.current?.setRain(rf.data.stations, fc.data?.areas); }, [rf.data, fc.data]);

  const here = useMemo(() => fc.data && pos ? api.nearest(fc.data.areas.filter(a => a.lat), pos, 1)[0] : null, [fc.data, pos?.lat]);
  const wet = (rf.data?.stations || []).filter(s => s.mm > 0).sort((a, b) => b.mm - a.mm);
  const rainyAreas = (fc.data?.areas || []).filter(a => /shower|rain|thunder/i.test(a.text));

  return html`<div class="pad">
    ${fc.error && !fc.data ? html`<${Oops} error=${fc.error} retry=${fc.reload} />`
      : !fc.data ? html`<${Loading} />`
      : html`<div class="card wx" style=${{ "--c": SEC.rain.color }}>
          <span class="wx-emoji">${wxEmoji(here?.text || rainyAreas[0]?.text || "Fair")}</span>
          <div class="grow">
            <div class="eyebrow">Next 2 hours${here ? ` · ${here.name}` : ""}</div>
            <div class="wx-text">${here ? here.text : rainyAreas.length ? `${rainyAreas.length} areas getting rain` : "Dry all over. Shiok."}</div>
            <div class="row-d">${fc.data.period}${here && rainyAreas.length ? ` · rain in ${rainyAreas.length} of ${fc.data.areas.length} areas` : ""}</div>
          </div></div>`}

    <div class="card radar">
      <div class="radar-top"><div><div class="eyebrow">Rain radar</div>
        <div class="radar-time">${frames[idx] ? sgTime(frames[idx].t) : "—"}${idx === frames.length - 1 && frames.length ? html` <span class="live">LIVE</span>` : ""}</div></div>
        <button class="play" onClick=${() => setPlaying(!playing)} aria-label=${playing ? "Pause" : "Play"}><${Icon} name=${playing ? "pause" : "play"} fill=${!playing} stroke=${playing ? 3 : 2} /></button></div>
      ${frames.length ? html`<input type="range" class="scrub" min="0" max=${frames.length - 1} value=${idx}
          onInput=${e => { setPlaying(false); setI(+e.target.value); }} />
        <div class="scrub-ends"><span>${sgTime(frames[0].t)}</span><span>now</span></div>`
        : html`<p class="row-d">${rd.loading ? "Loading radar…" : "Radar not available right now."}</p>`}
      <div class="legend"><span style="--c:#4fc3f7">Light</span><span style="--c:#1e88e5">Moderate</span><span style="--c:#fb8c00">Heavy</span><span style="--c:#c2185b">Very heavy</span></div>
    </div>

    <h4 class="sub">Raining now ${rf.data && html`<span class="muted">· ${ago(rf.data.time)}</span>`}</h4>
    ${rf.error && !rf.data ? html`<${Oops} error=${rf.error} retry=${rf.reload} />`
      : !rf.data ? html`<${Loading} />`
      : wet.length ? html`<div class="list">${wet.slice(0, 12).map(s => html`<button class="row" key=${s.id} onClick=${() => mapApi.current?.show([s.lat, s.lng], 14)}>
          <span class="drop" style=${{ background: rainColor(s.mm) }} />
          <span class="grow"><span class="row-t">${s.name}</span>
          <span class="row-d">${pos ? api.fmtDist(api.metres(pos, s)) + " away" : ""}</span></span>
          <b class="mm">${s.mm} mm</b></button>`)}</div>`
      : html`<p class="empty-note big">☀️ Not a drop at any of ${rf.data.stations.length} rain gauges. Go out lah.</p>`}
  </div>`;
}

// ---------------------------------------------------------------- air

function AirPanel({ pos, mapApi, active }) {
  const p = usePoll(api.psi, 10 * 60e3);
  const pm = usePoll(api.pm25, 10 * 60e3);
  const u = usePoll(api.uv, 10 * 60e3);
  useEffect(() => { if (p.data) mapApi.current?.setPsi(p.data.regions); }, [p.data]);

  const mine = useMemo(() => p.data && pos ? api.nearest(p.data.regions, pos, 1)[0] : null, [p.data, pos?.lat]);
  const worst = p.data ? p.data.regions.reduce((a, b) => (b.psi > a.psi ? b : a)) : null;
  const focus = mine || worst;
  const band = psiBand(focus?.psi);
  const ub = uvBand(u.data?.now);
  const hours = (u.data?.hours || []).filter(h => { const hr = new Date(h.hour).getUTCHours() + 8; return hr >= 7 && hr <= 19; });

  return html`<div class="pad">
    ${p.error && !p.data ? html`<${Oops} error=${p.error} retry=${p.reload} />` : !p.data ? html`<${Loading} />` : html`
      <div class="card gauge" style=${{ "--c": band.color }}>
        <div class="gauge-num"><b>${focus.psi}</b><span>PSI</span></div>
        <div class="grow">
          <div class="eyebrow">${mine ? `${title(mine.name)} · where you are` : `${title(worst.name)} · worst now`}</div>
          <div class="band">${band.name}</div>
          <div class="row-d">${band.tip}</div>
        </div>
      </div>
      <div class="regions">${api.REGIONS.map(n => { const r = p.data.regions.find(x => x.name === n); const b = psiBand(r?.psi);
        return html`<button key=${n} class="region" style=${{ "--c": b.color }} onClick=${() => r && mapApi.current?.show([r.lat, r.lng], 12)}>
          <b>${r?.psi ?? "–"}</b><span>${title(n)}</span>${pm.data && html`<i>PM2.5 ${pm.data.regions[n] ?? "–"}</i>`}</button>`; })}</div>
      <p class="fine">24-hour PSI, updated ${ago(p.data.time)}. PM2.5 is the last hour, in µg/m³.</p>`}

    <h4 class="sub">UV index</h4>
    ${u.error && !u.data ? html`<${Oops} error=${u.error} retry=${u.reload} />` : !u.data ? html`<${Loading} />` : html`
      <div class="card gauge uv" style=${{ "--c": ub.color }}>
        <div class="gauge-num"><b>${u.data.now ?? "–"}</b><span>UV</span></div>
        <div class="grow"><div class="band">${ub.name}</div><div class="row-d">${ub.tip}</div>
          <div class="bars">${hours.map(h => html`<span key=${h.hour} style=${{ "--h": Math.min(1, h.value / 12), "--c": uvBand(h.value).color }} title=${`${sgTime(h.hour)}: ${h.value}`}><i /><em>${new Date(h.hour).getUTCHours() + 8 > 12 ? new Date(h.hour).getUTCHours() + 8 - 12 : new Date(h.hour).getUTCHours() + 8}</em></span>`)}</div>
        </div>
      </div>`}
  </div>`;
}

// ---------------------------------------------------------------- checkpoint cams

function CamsPanel({ cam, setCam, mapApi, cams }) {
  const { data, error, reload } = cams;
  if (error && !data) return html`<div class="pad"><${Oops} error=${error} retry=${reload} /></div>`;
  if (!data) return html`<div class="pad"><${Loading} text="Peeking at the Causeway…" /></div>`;
  const open = data.find(c => c.id === cam);
  if (open) return html`<div class="pad">
    <div class="stop-head">
      <button class="icon-btn" onClick=${() => setCam(null)} aria-label="Back"><${Icon} name="back" /></button>
      <div class="grow"><div class="stop-name">${open.name}</div><div class="row-d">${open.sub} · ${ago(open.time)}</div></div>
      <button class="icon-btn" onClick=${reload} aria-label="Refresh"><${Icon} name="refresh" /></button>
    </div>
    <img class="cam-big" src=${open.img} alt=${open.name} />
    <div class="actions"><${GMaps} lat=${open.lat} lng=${open.lng} /></div>
    <div class="cam-strip">${data.filter(c => c.group === open.group && c.id !== open.id).map(c => html`<button key=${c.id} class="cam-thumb" onClick=${() => setCam(c.id)}><img src=${c.img} alt="" loading="lazy" /><span>${c.name}</span></button>`)}</div>
  </div>`;
  const groups = ["Woodlands", "Tuas", "Sentosa", "Other"].filter(g => data.some(c => c.group === g));
  return html`<div class="pad">
    ${groups.map(g => html`<h4 class="sub" key=${g}>${g === "Woodlands" ? "Woodlands · Causeway" : g === "Tuas" ? "Tuas · Second Link" : g}</h4>
      <div class="cams">${data.filter(c => c.group === g).map(c => html`<button key=${c.id} class="cam" onClick=${() => { setCam(c.id); mapApi.current?.show([c.lat, c.lng], 15); }}>
        <img src=${c.img} alt=${c.name} loading="lazy" /><span class="cam-t">${c.name}</span><span class="cam-d">${c.sub}</span></button>`)}</div>`)}
    <p class="fine">Live from LTA via data.gov.sg · updated ${ago(data[0].time)}. The open feed only shares the checkpoint and Sentosa cameras.</p>
  </div>`;
}

// ---------------------------------------------------------------- bottle return

function BcrsPanel({ pos, data, pick, setPick, mapApi }) {
  const list = data?.machines || [];
  const near = useMemo(() => pos ? api.nearest(list.map((m, i) => ({ ...m, i })), pos, 15) : [], [list, pos?.lat, pos?.lng]);
  const sel = pick != null ? list[pick] : null;
  useEffect(() => { mapApi.current?.pickBcrs(sel); }, [sel]);
  const open = (m, i) => { setPick(i); mapApi.current?.show([m.lat, m.lng], 17); };
  if (!data) return html`<div class="pad"><${Loading} /></div>`;
  const finder = html`<a class="chip" target="_blank" rel="noopener" href="https://returnright.sg/p/find-my-nearest-rvm">Is it full? Check on Return Right <${Icon} name="go" size=${16} /></a>`;
  return html`<div class="pad">
    ${sel ? html`<div class="card picked">
        <div class="stop-head">
          <button class="icon-btn" onClick=${() => setPick(null)} aria-label="Back"><${Icon} name="back" /></button>
          <div class="grow"><div class="stop-name">${sel.name}</div>
            <div class="row-d">${sel.count > 1 ? `${sel.count} machines` : "1 machine"}${pos ? ` · ${api.fmtDist(api.metres(pos, sel))} away` : ""}</div></div>
        </div>
        <div class="row-d">${sel.address}</div>
        ${sel.hours && html`<div class="row-d">🕑 ${sel.hours}</div>`}
        <a class="chip solid" style=${{ "--c": SEC.bcrs.color }} target="_blank" rel="noopener" href=${`https://www.google.com/maps/dir/?api=1&destination=${sel.lat},${sel.lng}`}>Directions <${Icon} name="go" size=${16} /></a>
        <${GMaps} lat=${sel.lat} lng=${sel.lng} />
        ${finder}
      </div>`
    : html`<div class="card bcrs-hero" style=${{ "--c": SEC.bcrs.color }}>
        <span class="wx-emoji">🥤</span>
        <div class="grow"><div class="eyebrow">Return Right</div>
          <div class="wx-text">10¢ back for every can and bottle</div>
          <div class="row-d">Look for the deposit mark. Empty it, don't crush it.</div></div>
      </div>`}
    ${!list.length ? html`<div class="card soon">
        <div class="row-t">No machine list yet</div>
        <p class="row-d">Return Right's own finder shows the nearest one, plus whether it's full.</p>${finder}</div>`
    : html`<h4 class="sub">${pos ? "Nearest machines" : `${list.length.toLocaleString()} machine spots`}</h4>
      ${pos ? html`<div class="list">${near.map(m => html`<button class="row" key=${m.i} onClick=${() => open(m, m.i)}>
          <span class="drop recycle">${m.count > 1 ? m.count : "♻"}</span><span class="grow"><span class="row-t">${m.name}</span>
          <span class="row-d">${api.fmtDist(m.dist)}${m.hours ? ` · ${m.hours}` : ""}</span></span><${Icon} name="go" size=${18} /></button>`)}</div>`
        : html`<p class="empty-note">Turn on location to see the ones near you — or tap a purple dot on the map.</p>`}
      <p class="fine">Locations from Return Right${data.updated ? `, as of ${new Date(data.updated).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })}` : ""}. Machines can be full or down for maintenance — check their finder before a big haul.</p>`}
  </div>`;
}

// ---------------------------------------------------------------- main screen

function Main() {
  const mapEl = useRef();
  const mapApi = useRef();
  const [section, setSectionRaw] = useState(() => SEC[store.get("section")] ? store.get("section") : "bus");
  const [snap, setSnap] = useState("half");
  const [sheetH, setSheetH] = useState(0);
  const [pos, setPos] = useState(null);
  const [locating, setLocating] = useState(false);
  const [stops, setStops] = useState(null);
  const [stop, setStopRaw] = useState(null);
  const [cam, setCam] = useState(null);
  const [bcrsData, setBcrsData] = useState(null);
  const [pick, setPick] = useState(null);
  const [rail, setRail] = useState(null);
  const [station, setStation] = useState(null);
  const [toast, setToast] = useState(null);
  const watch = useRef(null);
  const cams = usePoll(api.cameras, 60e3);

  const say = t => { setToast(t); clearTimeout(say.t); say.t = setTimeout(() => setToast(null), 2600); };
  const setSection = id => {
    setSectionRaw(id); store.set("section", id);
    if (snap === "peek") setSnap("half");
    if (id === "mrt") setTimeout(() => pos ? mapApi.current?.view(pos, 14) : mapApi.current?.overview("air"), 60);
    else if (id !== "bus" && !(id === "bcrs" && pos)) setTimeout(() => mapApi.current?.overview(id === "bcrs" ? "air" : id), 60);
  };
  const setStop = (code, fly = true) => { setStopRaw(code); mapApi.current?.selectStop(code, fly); if (code && snap === "peek") setSnap("half"); };

  useEffect(() => {
    const m = createMap(mapEl.current, {
      onStop: code => { setSectionRaw("bus"); setStop(code); },
      onCam: id => { setCam(id); setSnap(s => s === "peek" ? "half" : s); },
      onBcrs: i => { setPick(i); setSnap(s => s === "peek" ? "half" : s); },
      onStation: i => { setStation(i); setSnap(s => s === "peek" ? "half" : s); },
    });
    mapApi.current = m;
    m.setSection(section);
    api.busStops().then(s => { setStops(s); m.setStops(s); }).catch(() => say("Bus stops cannot load — check your connection"));
    api.bcrs().then(d => { setBcrsData(d); m.setBcrs(d.machines); });
    api.rail().then(r => { setRail(r); m.setRail(r); }).catch(() => {});
    setTimeout(() => m.overview(section === "cams" || section === "rain" ? section : "air"), 150);  // trains/bus/bottles: whole island until we know where you are
    locate(true);
    return () => watch.current != null && navigator.geolocation.clearWatch(watch.current);
  }, []);

  useEffect(() => { mapApi.current?.setSection(section); }, [section]);
  useEffect(() => { if (cams.data) mapApi.current?.setCams(cams.data); }, [cams.data]);
  useEffect(() => {
    mapApi.current?.setSheet(innerWidth >= 760 ? 0 : sheetH);
    document.documentElement.style.setProperty("--sheet", sheetH + "px");
  }, [sheetH]);

  function locate(first) {
    if (!navigator.geolocation) return;
    setLocating(true);
    let flown = false;
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = navigator.geolocation.watchPosition(p => {
      const here = { lat: p.coords.latitude, lng: p.coords.longitude };
      const inSG = here.lat > 1.1 && here.lat < 1.5 && here.lng > 103.55 && here.lng < 104.15;
      setLocating(false);
      setPos(here);
      mapApi.current?.setMe(here, p.coords.accuracy);
      if (!flown) { flown = true; if (inSG) mapApi.current?.view(here, 16.5); else if (!first) say("You're not in Singapore leh — showing the whole island"); }
    }, err => {
      setLocating(false);
      if (!first) say(err.code === 1 ? "Location is off — allow it in Settings to see what's near you" : "Cannot find you right now");
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  }

  const s = SEC[section];
  const panel = section === "bus" ? html`<${BusPanel} stops=${stops} pos=${pos} stop=${stop} setStop=${setStop} mapApi=${mapApi} active=${section === "bus"} />`
    : section === "mrt" ? html`<${TrainsPanel} rail=${rail} pos=${pos} station=${station} setStation=${setStation} stops=${stops}
        setStop=${code => { setSectionRaw("bus"); store.set("section", "bus"); setStop(code); }} mapApi=${mapApi} />`
    : section === "rain" ? html`<${RainPanel} pos=${pos} mapApi=${mapApi} active />`
    : section === "air" ? html`<${AirPanel} pos=${pos} mapApi=${mapApi} active />`
    : section === "cams" ? html`<${CamsPanel} cam=${cam} setCam=${setCam} mapApi=${mapApi} cams=${cams} />`
    : html`<${BcrsPanel} pos=${pos} data=${bcrsData} pick=${pick} setPick=${setPick} mapApi=${mapApi} />`;

  return html`<div class="main" style=${{ "--accent": s.color }}>
    <div class="map" ref=${mapEl} />
    <header class="topbar">
      <div class="brand"><${Wordmark} /></div>
    </header>
    <div class="fabs">
      <button class=${"fab" + (locating ? " busy" : "") + (pos ? " has" : "")} onClick=${() => pos ? mapApi.current?.view(pos, Math.max(16, mapApi.current.map.getZoom())) : locate(false)} aria-label="Show my location">
        <${Icon} name="locate" size=${22} stroke=${2.2} /></button>
    </div>
    <${Sheet} snap=${snap} setSnap=${setSnap} onHeight=${setSheetH} page=${section + (stop || "") + (cam || "") + (pick ?? "") + (station ?? "")}
      header=${html`<${LineStrip} section=${section} onPick=${setSection} />`}>
      ${panel}
    <//>
    ${toast && html`<div class="toast">${toast}</div>`}
  </div>`;
}

function Wordmark({ big }) {
  return html`<span class=${"wordmark" + (big ? " big" : "")}><span class="sg">SG</span><span class="u">utils</span></span>`;
}

// ---------------------------------------------------------------- install notice

const UA = navigator.userAgent;
const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_IPAD = /iPad/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IN_APP = /FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|GSA\/|Messenger|Telegram/.test(UA);
const BROWSER = /CriOS/.test(UA) ? "Chrome" : /FxiOS/.test(UA) ? "Firefox" : /EdgiOS/.test(UA) ? "Edge" : "Safari";
const STANDALONE = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

function QR({ text }) {
  const ref = useRef();
  useEffect(() => {
    const s = document.createElement("script");
    s.src = "vendor/qrcode.js";
    s.onload = () => {
      const q = window.qrcode(0, "M"); q.addData(text); q.make();
      if (ref.current) ref.current.innerHTML = q.createSvgTag({ cellSize: 5, margin: 0, scalable: true });
    };
    document.head.append(s);
  }, []);
  return html`<div class="qr" ref=${ref}></div>`;
}

const Glyph = ({ name }) => html`<span class="glyph"><${Icon} name=${name} size=${17} stroke=${2.2} /></span>`;

function InstallHero() {
  return html`<div class="install-hero">
    <img class="app-icon" src="icons/apple-touch-icon.png" alt="" />
    <${Wordmark} big />
    <p>Buses, trains, rain, haze, checkpoint jams and bottle machines.<br />All on one map — no need to open six apps.</p>
    <div class="hero-strip">${SECTIONS.map((s, i) => html`<span key=${s.id} style=${{ "--c": s.color, "--d": `${i * 80}ms` }}><i>${s.code}</i>${s.name}</span>`)}</div>
  </div>`;
}

function Install({ onSkip }) {
  const url = location.href.split("#")[0].replace(/[?&]browser\b/, "");
  if (!IS_IOS) {
    return html`<div class="install">
      <${InstallHero} />
      <div class="install-card">
        <h2>Best on your phone</h2>
        <p class="muted">Scan with your iPhone camera, then add it to your Home Screen.</p>
        <${QR} text=${url} />
        <div class="url">${url.replace(/^https?:\/\//, "")}</div>
        <button class="btn wide" onClick=${onSkip}>Just use it here</button>
      </div></div>`;
  }
  let steps, arrow = null;
  if (IN_APP) {
    steps = [[html`Tap ${Glyph({ name: "more" })} or the menu`, "It's at the top or bottom of this app."],
      [html`Choose <b>Open in Safari</b>`, "Installing only works from Safari."],
      [html`Follow the steps there`, "Ten seconds only."]];
  } else if (BROWSER !== "Safari") {
    steps = [[html`Tap ${Glyph({ name: "share" })} <b>Share</b>`, `In ${BROWSER}'s address bar, top right.`],
      [html`Tap ${Glyph({ name: "addSquare" })} <b>Add to Home Screen</b>`, "Scroll down a bit if you don't see it."],
      [html`Tap <b>Add</b>`, "Then open SG Utils from your Home Screen. Done!"]];
    arrow = "top";
  } else {
    steps = [[html`Tap ${Glyph({ name: "share" })} <b>Share</b>`, IS_IPAD ? "Top right, beside the address bar."
        : html`In Safari's toolbar. Don't see it? Tap ${Glyph({ name: "more" })} first.`],
      [html`Tap ${Glyph({ name: "addSquare" })} <b>Add to Home Screen</b>`, "Scroll down — or tap View More if it's hiding."],
      [html`Keep <b>Open as Web App</b> on, tap <b>Add</b>`, "Then open SG Utils from your Home Screen. Done!"]];
    arrow = IS_IPAD ? "top" : "bottom";
  }
  return html`<div class="install">
    <${InstallHero} />
    <div class="install-card">
      <h2>Put it on your Home Screen lah</h2>
      <p class="muted">Works like a real app — full screen, no App Store, free.</p>
      <ol class="steps">${steps.map(([t, d], i) => html`<li key=${i}><span class="num">${i + 1}</span><div><div class="step-t">${t}</div><div class="step-d">${d}</div></div></li>`)}</ol>
      <button class="link-btn" onClick=${onSkip}>Nah, just use it in the browser</button>
    </div>
    ${arrow && html`<div class=${"pointer " + arrow}><span>${arrow === "top" ? "Share here" : "Share is down here"}</span>
      <${Icon} name=${arrow === "top" ? "up" : "down"} size=${22} stroke=${3.2} /></div>`}
  </div>`;
}

// ---------------------------------------------------------------- root

function App() {
  const [skip, setSkip] = useState(() => STANDALONE || /[?&]browser\b/.test(location.search) || sessionStorage.getItem("sgutils.browser") === "1");
  if (!skip) return html`<${Install} onSkip=${() => { sessionStorage.setItem("sgutils.browser", "1"); setSkip(true); }} />`;
  return html`<${Main} />`;
}

render(html`<${App} />`, document.getElementById("root"));

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");
