# Turbo Slot para iPhone y iPad

La app es el mismo juego web metido en una app nativa con [Capacitor](https://capacitorjs.com) 7. Lleva el juego
completo dentro (coches, texturas, sonidos: ~17 MB), así que arranca rápido y funciona sin conexión. Lo online
(salas, ranking, comunidad, cuentas) usa el servidor de siempre: `https://turbo-slot.inautoit.workers.dev`.

```
app/
  package.json            Capacitor 7 + plugins (vibración, barra de estado, actualizaciones)
  capacitor.config.json   identificador de la app, ajustes de iOS y del actualizador
  build-www.sh            copia el juego a app/www (lo que va dentro de la app)
  build-bundle.sh         publica una actualización al momento (zip + versión en el servidor)
  ios/                    proyecto de Xcode (Swift Package Manager, sin CocoaPods)
```

## Lo que necesitas

1. **Cuenta de Apple Developer** (99 €/año) en developer.apple.com, a tu nombre o al de tu empresa.
2. **Un Mac con Xcode 16 o posterior** (gratis en la Mac App Store). Si no tienes Mac, se puede compilar en la nube
   con un servicio de compilación para iOS (Codemagic, Bitrise o GitHub Actions con macOS): mismos pasos, sin Mac.
3. **Node.js 20 o posterior** en ese Mac.

## Hacerlo todo desde un iPad (sin Mac)

Xcode no existe para iPad, así que la app se compila **en la nube con Codemagic** (codemagic.io), que tiene sus
propios Mac. Todo lo demás se hace en Safari y con apps de Apple. La configuración ya está en el repositorio
(`codemagic.yaml`, en la raíz).

1. **Apple Developer** — app *Apple Developer* en el iPad → *Cuenta* → *Inscribirse* (99 €/año). Espera la
   confirmación por correo (1–2 días).
2. **Registrar el identificador de la app** — Safari → developer.apple.com → *Certificates, IDs & Profiles* →
   *Identifiers* → **+** → *App IDs* → *App* → descripción «Turbo Slot», *Bundle ID explícito*:
   `com.turboslot.juego` (si está cogido, usa otro y dímelo para cambiarlo en el proyecto).
3. **Crear la app en App Store Connect** — app *App Store Connect* (o appstoreconnect.apple.com) → *Apps* → **+** →
   *Nueva app* → iOS, nombre «Turbo Slot», idioma español, el Bundle ID del paso 2, SKU `turboslot`.
   Apunta el **Apple ID** numérico que aparece en *Información de la app* (algo como 6740000000).
4. **Clave de API para Codemagic** — App Store Connect → *Usuarios y acceso* → *Integraciones* → *App Store Connect
   API* → *Generar clave*, rol **App Manager**. Descarga el archivo `.p8` (solo se puede una vez; guárdalo en
   Archivos) y apunta el *Issuer ID* y el *Key ID*. **No se lo pases a nadie**: va solo a Codemagic.
5. **Codemagic** — Safari → codemagic.io → entra con GitHub → *Add application* → el repositorio `inautoit/game` →
   tipo *codemagic.yaml*. En *Team settings → Team integrations → Developer Portal → Manage keys* añade la clave
   del paso 4 con el nombre **`Turbo Slot ASC`** (Issuer ID, Key ID y el archivo .p8).
6. **Poner el Apple ID** — en el repositorio, en `codemagic.yaml`, cambia `APP_STORE_APPLE_ID: 0` por el número
   del paso 3 (o pídemelo y lo cambio yo).
7. **Compilar** — en Codemagic, *Start new build* → rama `claude/cool-curie-smt2sl` → flujo *Turbo Slot → TestFlight*.
   Tarda 10–15 min; si sale bien, la app aparece en TestFlight en unos minutos más. Si falla, mándame la captura
   del paso que sale en rojo.
8. **Probar** — app *TestFlight* en el iPad (y en el iPhone) → instala Turbo Slot. Invita a amigos desde App Store
   Connect → *TestFlight* → *Pruebas externas*.
9. **Ficha y envío** — en App Store Connect rellena la ficha (texto, capturas, privacidad, edades: ver más abajo),
   elige la compilación de TestFlight y pulsa *Enviar a revisión*.

Las capturas se pueden hacer en el propio iPad (botón superior + subir volumen) y en un iPhone; Apple pide las de
iPad de 13" y de iPhone de 6,9" o 6,7".

## Compilar la app (en el Mac)

```bash
cd slot/app
npm install
npm run sync          # copia el juego a www/ y lo pasa al proyecto de iOS
npx cap open ios      # abre Xcode
```

En Xcode:

1. Selecciona el proyecto **App** → pestaña **Signing & Capabilities** → **Team**: tu cuenta de Apple Developer.
2. **Bundle Identifier**: está puesto `com.turboslot.juego`. Si Apple dice que ya existe, cámbialo por otro tuyo
   (por ejemplo `es.tunombre.turboslot`) aquí y en `capacitor.config.json` (`appId`).
3. Prueba en un iPhone o iPad conectado por cable (botón ▶). La primera vez, en el iPhone: Ajustes → General →
   VPN y gestión de dispositivos → confiar en tu cuenta de desarrollador.
4. Para subirla: menú **Product → Archive** → **Distribute App** → **App Store Connect** → **Upload**.

## Publicar en la App Store

En [App Store Connect](https://appstoreconnect.apple.com) → **Apps → +**: nombre «Turbo Slot» (si está cogido,
«Turbo Slot: carreras de slot»), idioma principal español, el Bundle ID de arriba.

- **TestFlight primero**: la versión subida aparece en la pestaña TestFlight. Invita a amigos (pruebas externas)
  y juega una semana en aparatos distintos antes de mandarla a revisión.
- **Ficha**: descripción, palabras clave, capturas (iPhone de 6,9" o 6,7" y iPad de 13"; hazlas en la propia app
  o en el simulador de Xcode), icono (ya va en la app), categoría **Juegos → Carreras**.
- **URL de la política de privacidad**: `https://turbo-slot.inautoit.workers.dev/privacidad.html`
- **URL de soporte**: `https://turbo-slot.inautoit.workers.dev/soporte.html` (correo soporte.turbosloot@outlook.es y preguntas frecuentes).
- **Privacidad de la app** (las «etiquetas»): marca que recoges, *sin rastreo*:
  - *Identificadores → ID de usuario* (la cuenta) — vinculado a la identidad, para funcionalidad de la app.
  - *Contenido del usuario → Contenido de juego y Otro contenido* (récords, circuitos publicados) — vinculado, funcionalidad.
  - *Contenido del usuario → Atención al cliente* (mensajes de Contacto) — vinculado, funcionalidad.
  - Nada de ubicación, contactos, correo, compras ni datos de uso para anuncios.
- **Clasificación por edades**: todo «Ninguno»; responde **Sí** a «contenido generado por usuarios» y a «chat o
  interacción entre usuarios» (no hay chat, pero sí nombres y circuitos de otros jugadores). Saldrá 9+ o 12+.
- **Cifrado (exportación)**: ya está declarado en la app que solo usa el cifrado estándar (`ITSAppUsesNonExemptEncryption = NO`).
- **Notas para el revisor**: «Juego completo sin compras. Cuenta opcional (Tu cuenta → Crear cuenta) y borrado de
  cuenta en Tu cuenta → Borrar mi cuenta. Contenido de usuarios: Circuitos → Comunidad, con Denunciar / Ocultar en
  cada circuito y Ocultar piloto en el ranking; normas en Ajustes → Normas».

Lo que Apple pide a los juegos con cuentas y contenido de usuarios ya está hecho: borrar la cuenta desde la app,
denunciar y ocultar contenido y pilotos, normas de la comunidad aceptadas al crear cuenta y al publicar, contacto
desde la app y política de privacidad.

## Actualizaciones

**Al momento (sin pasar por Apple)** — para arreglos, circuitos, coches, ajustes, mejoras:

1. Haz los cambios en el juego y sube la versión en `src/version.js` (`GAME_VERSION`, por ejemplo `3.2.1`).
2. Publica la web como siempre (`bash deploy.sh`) y luego la actualización de la app:
   ```bash
   cd slot/app
   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… bash build-bundle.sh
   ```
3. Las apps la descargan solas al abrirse (comprobando la huella sha256) y la ponen la siguiente vez que se abren.
   Si una versión nueva fallase al arrancar, la app vuelve sola a la anterior.

El actualizador es [capacitor-updater](https://github.com/Cap-go/capacitor-updater) (código abierto, MPL-2.0) en
modo manual: habla solo con nuestro servidor (`/api/app`) y no manda estadísticas a nadie (`statsUrl` vacío).

**Por la App Store** — cuando cambie la parte nativa (plugins nuevos, permisos, iconos) o cada cierto tiempo: sube
`MARKETING_VERSION` en Xcode, `npm run sync`, Archive y Upload. Si la actualización al momento necesita la app
nueva, publícala con la versión mínima: `bash build-bundle.sh 1.1.0` (las apps más antiguas no la descargan).

**Temporadas Premium** — sin tocar la app: sube al almacén KV la clave `config/premium.json` con
`{ "season": "Temporada 2", "tracks": [ …circuitos con el formato de PREMIUM en src/tracks.js… ] }`. El juego la
descarga, comprueba cada circuito (que cierre y no se cruce) y la usa; el ranking del servidor también.
