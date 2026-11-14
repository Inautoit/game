// Comprueba que lib.js produce las mismas señales que la versión Python validada.
import fs from "node:fs";
import { CONFIG, STRATS, score } from "./lib.js";
const cases = JSON.parse(fs.readFileSync(new URL("./parity_cases.json", import.meta.url)),
  (k, v) => (v === null ? NaN : v === "-inf" ? -Infinity : v));
const close = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || (a === -Infinity && b === -Infinity) ||
  Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
let fails = 0;
for (const k of cases) {
  const d = { o: k.o, h: k.h, l: k.l, c: k.c, v: k.v };
  for (const name of ["trend", "breakout"]) {
    const js = STRATS[name](d, CONFIG.strategies[name]), py = k[name];
    for (const f of ["entry", "exit", "stop", "trail", "strength"]) {
      const ok = typeof py[f] === "boolean" ? js[f] === py[f] : close(js[f], py[f] ?? NaN);
      if (!ok) { fails++; if (fails < 10) console.log("DIFERENCIA", k.sym, name, f, js[f], py[f]); }
    }
  }
  const s = score(d), ps = k.score ?? NaN;
  if (!close(s, ps)) { fails++; if (fails < 10) console.log("DIFERENCIA score", k.sym, s, ps); }
}
console.log(`${cases.length} casos, ${fails} diferencias`);
process.exit(fails ? 1 : 0);
