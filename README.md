# Garaje 3D · Tuning Studio 🏎️🔧

Un **configurador 3D de coches tuning** para el navegador (PC y móvil). No es
un juego de conducir: es un **garaje virtual** donde ves el coche en 3D, lo
giras con el ratón/dedo y lo **tuneas por completo** — carrocería, pintura,
llantas, suspensión, camber, kit aerodinámico, estilos JDM y cosas locas.

Los coches son **modelos genéricos parecidos a los reales pero sin logos ni
marcas**, para poder personalizarlos sin problemas de licencias.

Hecho con [Three.js](https://threejs.org/) vendorizado (sin CDN, sin build):
se abre directamente en el navegador y funciona offline.

## Qué puedes tunear

- **Carrocería**: coupé JDM, hatchback, berlina, muscle, superdeportivo, kei/van.
- **Pintura**: paleta rápida + color personalizado, y acabados brillo,
  metalizado, mate, perlado y cromado.
- **Llantas**: 5 radios, malla, split 10, deep dish, acero; color y diámetro
  (15"–20").
- **Suspensión / estilo**: altura (del *slam* al *lift*), **camber** negativo y
  **poke** de vía — la receta del *stance* JDM.
- **Aerodinámica**: alerón (lip, ducktail, ala GT), splitter, taloneras,
  **widebody** (ensanchado), capó con toma de aire o ventilado.
- **Detalles**: tintado de lunas, color de pinzas de freno y **neón inferior**.
- **Escena**: fondos de estudio/atardecer/noche/blanco y giro automático.

## Extras

- **Presets**: De serie, JDM Stance, Widebody GT, Drift Missile, Show Car, Lifted.
- **Aleatorio** 🎲, **captura** 📸 (descarga PNG), **compartir** 🔗 (enlace con
  tu configuración) y **reset**.
- Tu último coche se **guarda solo** en el navegador.

## Controles de cámara

- **PC**: arrastra para girar, rueda del ratón para zoom.
- **Móvil**: arrastra con un dedo para girar, pellizca para zoom. Botón 🔧 para
  abrir/cerrar el panel.

## Ejecutar en local

Los módulos ES necesitan servirse por HTTP (no funcionan con `file://`):

```bash
python3 -m http.server 8000
```

Luego abre <http://localhost:8000>.

## Estructura

```
index.html      Página, cabecera y contenedores
styles.css      Interfaz del panel de tuning
src/
  main.js       Escena, luces, suelo, neón, bucle y acciones
  config.js     Estado, catálogos de opciones y presets
  ui.js         Construye el panel de tuning
  carModel.js   Ensambla el coche y aplica la postura (altura/camber/poke)
  body.js       Carrocería paramétrica por tipo + cristales + kit
  wheels.js     Llantas, neumáticos, disco y pinza de freno
  env.js        Iluminación de estudio (reflejos) y fondos
  orbit.js      Cámara orbital (ratón + táctil)
vendor/         Three.js
```

## Ideas para más adelante

- Más tipos de carrocería y piezas de kit.
- Vinilos/livery y números.
- Girar las ruedas / animación de arranque.
- Modo comparación antes/después.
