// Empaqueta dashboard.html como módulo JS para el Worker.
import fs from "node:fs";
const html = fs.readFileSync(new URL("./dashboard.html", import.meta.url), "utf8");
fs.writeFileSync(new URL("./dashboard.js", import.meta.url), "export const DASHBOARD = " + JSON.stringify(html) + ";\n");
console.log("dashboard.js generado");
