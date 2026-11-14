// Prueba del Worker sin red: Binance y KV simulados.
import assert from "node:assert";
import worker from "./worker.js";
import { CONFIG } from "./lib.js";
CONFIG.candidates = ["AAAUSD", "BBBUSD"];

const H4 = 4 * 3600_000;
let now = Math.floor(Date.UTC(2026, 0, 10) / H4) * H4 + 5 * 60_000;
let bidOverride = null;
const series = {}; // símbolo -> precio por vela
function candles(sym) {
  if (!series[sym]) {
    const k = sym === "AAAUSD" ? 1 : 0;
    series[sym] = Array.from({ length: 401 }, (_, i) => 100 * Math.exp((k ? 0.004 : 0.0005) * i + 0.02 * Math.sin(i / 3)));
  }
  const end = Math.floor(now / H4) * H4;
  return series[sym].map((c, i) => {
    const t = end - (400 - i) * H4;
    const vol = i === 399 ? 50000 : 1000;
    return [t, String(c * 0.995), String(c * 1.01), String(c * 0.985), String(c), String(vol), t + H4 - 1];
  });
}
// Kraken simulado: nombres internos distintos del altname, como en la API real
const internal = (alt) => "X" + alt;
globalThis.setTimeout = ((st) => (fn, ms) => st(fn, 0))(globalThis.setTimeout); // sin esperas en el test
globalThis.fetch = async (url) => {
  const u = new URL(url);
  const ok = (result) => new Response(JSON.stringify({ error: [], result }), { status: 200 });
  const pairs = (u.searchParams.get("pair") || "").split(",").filter((p) => ["AAAUSD", "BBBUSD"].includes(p));
  if (u.pathname.endsWith("/AssetPairs")) return ok(Object.fromEntries(pairs.map((p) => [internal(p), { altname: p }])));
  if (u.pathname.endsWith("/Ticker")) return ok(Object.fromEntries(pairs.map((p) => {
    const c = +candles(p).at(-2)[4], b = bidOverride ?? c;
    return [internal(p), { a: [String(b * 1.0002)], b: [String(b)], c: [String(c)], v: ["0", p === "AAAUSD" ? "9e7" : "1e7"] }];
  })));
  if (u.pathname.endsWith("/OHLC")) {
    const rows = candles(u.searchParams.get("pair")).map((k) => [k[0] / 1000, k[1], k[2], k[3], k[4], k[4], k[5], 10]);
    return ok({ [internal(u.searchParams.get("pair"))]: rows, last: 0 });
  }
  return new Response("x", { status: 404 });
};
const kv = new Map();
const env = { STATE: { get: async (k, t) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
const run = () => new Promise((res) => worker.scheduled({ scheduledTime: now }, env, { waitUntil: (p) => p.then(res) }));

await run();
let st = JSON.parse(kv.get("state"));
assert.equal(st.lastError, null, st.lastError);
assert.deepEqual(st.universe, ["AAAUSD", "BBBUSD"]);
console.log("ranking:", st.ranked, "| posiciones:", Object.keys(st.positions), "| log:", st.log.map((l) => l[1]));
const sym = Object.keys(st.positions)[0];
assert.ok(sym, "debería abrir alguna posición");
const stop = st.positions[sym].stop;

now += 5 * 60_000; bidOverride = stop * 0.99;   // el precio cae bajo el stop
await run();
st = JSON.parse(kv.get("state"));
const trades = JSON.parse(kv.get("trades"));
assert.ok(!st.positions[sym] && trades[0].reason === "stop");
console.log("stop OK:", trades[0].reason, trades[0].pnl.toFixed(2), "| caja", st.cash.toFixed(2));

// freno: capital hundido -> apagado
st.cash = 100; kv.set("state", JSON.stringify(st)); now += H4; bidOverride = null;
await run();
st = JSON.parse(kv.get("state"));
assert.ok(st.risk.halted, "debería apagarse");
console.log("freno OK:", st.risk.haltReason);

const page = await worker.fetch(new Request("https://x/"), env);
assert.ok((await page.text()).includes("Máquina Trader"));
const api = await (await worker.fetch(new Request("https://x/api/state"), env)).json();
assert.ok(api.state && api.trades.length === 1);
console.log("panel y API OK");
