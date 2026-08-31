/**
 * Reacción en cadena — Worker + Durable Object "Sala".
 *
 * El servidor es la única autoridad: valida cada jugada, resuelve la cascada
 * por oleadas y hace broadcast del estado completo. El cliente sólo pinta.
 */

const COLS = 6;
const FILAS = 9;
const COLORES = ["rojo", "azul"];
const MAX_OLEADAS = 200;
const ABIERTO = 1; // WebSocket.READY_STATE_OPEN
const BOT = "azul";  // el bot siempre juega de azul

/* ------------------------------------------------------------------ */
/* Lógica de juego (pura)                                              */
/* ------------------------------------------------------------------ */

const idx = (fila, col) => fila * COLS + col;

function vecinos(fila, col) {
  const v = [];
  if (fila > 0) v.push([fila - 1, col]);
  if (fila < FILAS - 1) v.push([fila + 1, col]);
  if (col > 0) v.push([fila, col - 1]);
  if (col < COLS - 1) v.push([fila, col + 1]);
  return v;
}

/** Masa crítica = número de vecinos ortogonales (esquina 2, borde 3, interior 4). */
function masaCritica(fila, col) {
  return vecinos(fila, col).length;
}

function tableroVacio() {
  const celdas = [];
  for (let i = 0; i < FILAS * COLS; i++) celdas.push({ n: 0, jugador: null });
  return celdas;
}

const clonar = (celdas) => celdas.map((c) => ({ n: c.n, jugador: c.jugador }));

function fichasDe(celdas, color) {
  let total = 0;
  for (const c of celdas) if (c.jugador === color) total += c.n;
  return total;
}

/**
 * Resuelve la cascada por oleadas. Devuelve la lista ordenada de oleadas;
 * cada oleada lleva las casillas que explotan y el tablero resultante,
 * para que el cliente pueda animarlas una detrás de otra sin calcular nada.
 */
function resolverCascada(celdas, color, comprobarVictoria, registrar = true) {
  const oleadas = [];
  for (let n = 0; n < MAX_OLEADAS; n++) {
    const inestables = [];
    for (let fila = 0; fila < FILAS; fila++) {
      for (let col = 0; col < COLS; col++) {
        const c = celdas[idx(fila, col)];
        if (c.n >= masaCritica(fila, col) && c.n > 0) inestables.push([fila, col]);
      }
    }
    if (inestables.length === 0) break;

    // Toda la oleada explota a la vez: primero se vacían, luego reparten.
    for (const [fila, col] of inestables) celdas[idx(fila, col)] = { n: 0, jugador: null };
    for (const [fila, col] of inestables) {
      for (const [vf, vc] of vecinos(fila, col)) {
        const v = celdas[idx(vf, vc)];
        v.n += 1;
        v.jugador = color;
      }
    }

    if (registrar) {
      oleadas.push({
        explotan: inestables.map(([fila, col]) => ({ fila, col })),
        celdas: clonar(celdas),
      });
    }

    // Si el rival ya no tiene fichas la partida está decidida: no seguimos
    // encadenando (evita cascadas eternas sobre un tablero de un solo color).
    if (comprobarVictoria) {
      const rival = color === "rojo" ? "azul" : "rojo";
      if (fichasDe(celdas, rival) === 0) break;
    }
  }
  return oleadas;
}

function nuevaPartida() {
  return {
    celdas: tableroVacio(),
    turno: "rojo",
    ganador: null,
    jugadas: { rojo: 0, azul: 0 },
    bot: false,
  };
}


/* ------------------------------------------------------------------ */
/* Bot (juega de azul, decidido en el servidor)                        */
/* ------------------------------------------------------------------ */

/** Las casillas con menos vecinos son más fuertes: cuestan menos de reventar. */
const posicional = (i) => (4 - masaCritica(Math.floor(i / COLS), i % COLS)) * 0.6;

function movimientosLegales(celdas, color) {
  const movs = [];
  for (let i = 0; i < FILAS * COLS; i++) {
    if (!celdas[i].jugador || celdas[i].jugador === color) movs.push(i);
  }
  return movs;
}

function simular(celdas, color, i, ambosHanJugado) {
  const copia = clonar(celdas);
  copia[i].n += 1;
  copia[i].jugador = color;
  resolverCascada(copia, color, ambosHanJugado, false);
  return copia;
}

const ventaja = (celdas, color) =>
  fichasDe(celdas, color) - fichasDe(celdas, color === "rojo" ? "azul" : "rojo");

/**
 * Elige jugada mirando una respuesta por delante: primero puntúa todas las
 * jugadas por material y posición, y de las mejores comprueba qué es lo peor
 * que puede contestar el rival. Así evita dejar fichas a tiro de una cascada.
 */
function jugadaDelBot(celdas, color, ambosHanJugado) {
  const rival = color === "rojo" ? "azul" : "rojo";
  const legales = movimientosLegales(celdas, color);
  if (legales.length === 0) return null;

  const candidatos = legales.map((i) => {
    const tras = simular(celdas, color, i, ambosHanJugado);
    return {
      i,
      tras,
      gana: ambosHanJugado && fichasDe(tras, rival) === 0,
      nota: ventaja(tras, color) + posicional(i),
    };
  });

  const ganadora = candidatos.find((c) => c.gana);
  if (ganadora) return ganadora.i;

  candidatos.sort((a, b) => b.nota - a.nota);
  let mejor = null;
  for (const cand of candidatos.slice(0, 10)) {
    let peor = Infinity;
    for (const j of movimientosLegales(cand.tras, rival)) {
      const despues = simular(cand.tras, rival, j, true);
      if (fichasDe(despues, color) === 0) { peor = -1000; break; }  // nos barre
      peor = Math.min(peor, ventaja(despues, color));
    }
    const nota = (peor === Infinity ? cand.nota : peor + posicional(cand.i)) + Math.random() * 0.4;
    if (!mejor || nota > mejor.nota) mejor = { i: cand.i, nota };
  }
  return mejor ? mejor.i : legales[0];
}

/* ------------------------------------------------------------------ */
/* Durable Object                                                      */
/* ------------------------------------------------------------------ */

export class Sala {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.partida = nuevaPartida();
    state.blockConcurrencyWhile(async () => {
      const guardada = await state.storage.get("partida");
      if (guardada) this.partida = guardada;
    });
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Se esperaba una conexión WebSocket", { status: 426 });
    }

    const par = new WebSocketPair();
    const cliente = par[0];
    const servidor = par[1];
    const color = this.colorLibre();

    if (!color) {
      // Tercera conexión: la rechazamos con un mensaje de error.
      servidor.accept();
      servidor.send(
        JSON.stringify({ tipo: "error", mensaje: "La sala ya tiene dos jugadores" }),
      );
      servidor.close(4001, "sala llena");
      return new Response(null, { status: 101, webSocket: cliente });
    }

    // WebSockets hibernables: el color va como tag, sobrevive a la hibernación.
    this.state.acceptWebSocket(servidor, [color]);
    this.difundirEstado();
    return new Response(null, { status: 101, webSocket: cliente });
  }

  /** Sockets vivos: ignora los que ya se están cerrando (p. ej. al recargar la pestaña). */
  activos(tag) {
    const sockets = tag ? this.state.getWebSockets(tag) : this.state.getWebSockets();
    return sockets.filter((ws) => ws.readyState === ABIERTO);
  }

  colorLibre() {
    if (this.partida.bot) return this.activos("rojo").length === 0 ? "rojo" : null;
    for (const color of COLORES) {
      if (this.activos(color).length === 0) return color;
    }
    return null;
  }

  colorDe(ws) {
    const tags = this.state.getTags(ws);
    return tags.find((t) => COLORES.includes(t)) || null;
  }

  async webSocketMessage(ws, mensaje) {
    let datos;
    try {
      datos = JSON.parse(typeof mensaje === "string" ? mensaje : new TextDecoder().decode(mensaje));
    } catch {
      return this.error(ws, "Mensaje ilegible");
    }

    if (datos.tipo === "jugar") return this.jugar(ws, datos);
    if (datos.tipo === "bot") return this.activarBot(ws);
    if (datos.tipo === "revancha") return this.revancha();
    return this.error(ws, "Tipo de mensaje desconocido");
  }

  async jugar(ws, { fila, col }) {
    const color = this.colorDe(ws);
    const p = this.partida;

    if (!p.bot && this.activos().length < 2) return this.error(ws, "Falta el rival");
    if (p.ganador) return this.error(ws, "La partida ha terminado");
    if (color !== p.turno) return this.error(ws, "No es tu turno");
    if (!Number.isInteger(fila) || !Number.isInteger(col) ||
        fila < 0 || fila >= FILAS || col < 0 || col >= COLS) {
      return this.error(ws, "Casilla fuera del tablero");
    }

    const celda = p.celdas[idx(fila, col)];
    if (celda.jugador && celda.jugador !== color) return this.error(ws, "Esa casilla es del rival");

    const oleadas = this.aplicarJugada(color, idx(fila, col));
    await this.state.storage.put("partida", p);
    this.difundirEstado(oleadas);

    if (p.bot && !p.ganador && p.turno === BOT) await this.turnoDelBot();
  }

  /** Coloca la ficha, resuelve la cascada y actualiza turno y ganador. */
  aplicarJugada(color, i) {
    const p = this.partida;
    p.celdas[i].n += 1;
    p.celdas[i].jugador = color;
    p.jugadas[color] += 1;

    const ambosHanJugado = p.jugadas.rojo > 0 && p.jugadas.azul > 0;
    const oleadas = resolverCascada(p.celdas, color, ambosHanJugado);

    if (ambosHanJugado) {
      const rival = color === "rojo" ? "azul" : "rojo";
      if (fichasDe(p.celdas, rival) === 0) p.ganador = color;
    }
    p.turno = p.ganador ? null : color === "rojo" ? "azul" : "rojo";
    return oleadas;
  }

  async activarBot(ws) {
    const p = this.partida;
    if (this.activos().length > 1) return this.error(ws, "Ya hay dos jugadores en la sala");
    if (this.colorDe(ws) !== "rojo") return this.error(ws, "El bot juega de azul");
    p.bot = true;
    await this.state.storage.put("partida", p);
    this.difundirEstado();
    if (!p.ganador && p.turno === BOT) await this.turnoDelBot();
  }

  async turnoDelBot() {
    const p = this.partida;
    const i = jugadaDelBot(p.celdas, BOT, p.jugadas.rojo > 0 && p.jugadas.azul > 0);
    if (i === null) return;
    // Una pausa corta: da sensación de que piensa y deja ver la cascada anterior.
    await new Promise((listo) => setTimeout(listo, 450));
    const oleadas = this.aplicarJugada(BOT, i);
    await this.state.storage.put("partida", p);
    this.difundirEstado(oleadas);
  }

  async revancha() {
    const conBot = this.partida.bot;
    this.partida = nuevaPartida();
    this.partida.bot = conBot;
    await this.state.storage.put("partida", this.partida);
    this.difundirEstado();
  }

  error(ws, mensaje) {
    try {
      ws.send(JSON.stringify({ tipo: "error", mensaje }));
    } catch {
      /* socket ya cerrado */
    }
  }

  difundirEstado(oleadas = [], excluir = null) {
    const sockets = this.activos().filter((ws) => ws !== excluir);
    const p = this.partida;
    for (const ws of sockets) {
      const estado = {
        tipo: "estado",
        celdas: p.celdas,
        turno: p.turno,
        tuColor: this.colorDe(ws),
        ganador: p.ganador,
        jugadores: sockets.length + (p.bot ? 1 : 0),
        bot: p.bot,
        explosiones: oleadas,
      };
      try {
        ws.send(JSON.stringify(estado));
      } catch {
        /* socket ya cerrado */
      }
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try {
      ws.close(code === 1006 ? 1000 : code, reason);
    } catch {
      /* ya cerrado */
    }
    this.difundirEstado([], ws);
  }

  async webSocketError(ws) {
    this.difundirEstado([], ws);
  }
}

/* ------------------------------------------------------------------ */
/* Worker                                                              */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const codigo = (url.searchParams.get("sala") || "").toUpperCase();
      if (!/^[A-Z]{4}$/.test(codigo)) {
        return new Response("Código de sala inválido", { status: 400 });
      }
      const id = env.SALA.idFromName(codigo);
      return env.SALA.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
