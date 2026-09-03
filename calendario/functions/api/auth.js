// POST /api/auth  { password }  ->  { token }
//
// La contraseña se compara aquí, en el servidor, contra la variable de
// entorno EDIT_PASSWORD (secreto del panel de Cloudflare). Nunca viaja al
// navegador ni aparece en el código de la web.
import { json, error, iguales, crearToken, secretoFirma } from './_shared.js';

export async function onRequestPost({ request, env }) {
  if (!env.EDIT_PASSWORD) return error('Falta configurar EDIT_PASSWORD', 503);

  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch {
    return error('JSON no válido', 400);
  }

  const password = typeof cuerpo?.password === 'string' ? cuerpo.password : '';

  // Pequeña espera: hace inviable probar contraseñas a lo bruto.
  await new Promise((r) => setTimeout(r, 400));

  if (!iguales(password, env.EDIT_PASSWORD)) return error('Contraseña incorrecta', 401);

  return json({ token: await crearToken(secretoFirma(env)) });
}
