// El juego vivía en urus-traffic.inautoit.workers.dev y ahora está en
// urustraffic. Este Worker ocupa el nombre viejo y manda todo al nuevo.
//
// Importante que redirija en vez de servir el juego también: las salas se
// direccionan por Durable Object dentro de cada Worker, así que dos personas
// entrando por enlaces distintos no se verían aunque usaran el mismo código.
//
// Sigue exportando Room porque el Worker antiguo tiene esa clase declarada;
// quitarla exigiría una migración de borrado y no aporta nada.
export { Room } from './room.js';

const DESTINO = 'urustraffic.inautoit.workers.dev';

export default {
  fetch(request) {
    const url = new URL(request.url);
    url.hostname = DESTINO;
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  },
};
