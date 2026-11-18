# Texto para pegar en Lovable

Antes, sube a Lovable el archivo `autoCargaRetrasos.ts` (o pega su contenido
cuando te lo pida) y rellena `msClientId` y `msTenantId` con los datos de IT.

---

> En la página **/retrasos**, en la tarjeta de arriba donde están los campos
> "Cuadrante" y "Cambios de turno", añade un botón principal
> **"Actualizar automáticamente"** (icono de refrescar) y, al lado, un enlace
> pequeño **"Cambiar carpeta"**.
>
> 1. Crea el archivo `src/lib/autoCargaRetrasos.ts` con el contenido que te paso
>    y añade la dependencia `@azure/msal-browser`.
> 2. Al pulsar **"Actualizar automáticamente"**:
>    - Muestra un estado de carga en el botón.
>    - Llama a `getCuadrante()` y pasa el `File` devuelto **a la misma función que
>      ya se usa cuando el usuario sube el Cuadrante con "Sustituir"**.
>    - Después llama a `getCambiosTurno()` y pasa el `File` **a la misma función
>      que ya se usa al subir "Cambios de turno"**.
>    - Al terminar, muestra un toast "Cuadrante y cambios de turno actualizados"
>      con los nombres de los archivos. Si falla, muestra un toast de error con
>      el mensaje de la excepción.
>    - Importante: `getCuadrante()` tiene que llamarse directamente dentro del
>      onClick (sin `await` previos), porque el navegador exige un clic para
>      pedir permiso a la carpeta.
> 3. **"Cambiar carpeta"** llama a `getCuadrante(new Date(), true)` y procesa el
>    archivo igual que arriba.
> 4. Si `soportaCarpetas()` es false, deshabilita el botón y muestra un tooltip:
>    "Usa Microsoft Edge o Google Chrome".
> 5. No cambies la lógica actual de cálculo de retrasos ni los botones
>    "Sustituir": tienen que seguir funcionando a mano.
