# Facturas ⚡ — gestión de facturas para autónomos

Web app para llevar las facturas de un negocio de una sola persona (pensada para
una empresa de electricidad, pero sirve para cualquier autónomo):

- **Entras con tu cuenta de correo** (Outlook/Hotmail con el botón de Microsoft, o
  Gmail, Yahoo, iCloud, IONOS… con correo y contraseña).
- **Haces la factura en un formulario**: eliges el cliente, escribes los productos
  (se autocompletan con su precio desde tu catálogo) y se calculan base, IVA,
  retención IRPF y total.
- **Tu plantilla de Excel se rellena sola** con los datos de la factura.
- **La envías por correo desde la web** con un clic: el email del cliente, el
  asunto y el mensaje ya vienen escritos. Se adjunta en PDF y/o Excel.
- **Registro de todas las facturas**: número correlativo por año, estados
  (borrador, emitida, enviada, pagada, anulada), historial de envíos, resumen
  por trimestre para el IVA y exportación del libro de facturas a Excel para tu
  gestor.
- Clientes y productos guardados, copia de seguridad descargable.

Solo tú puedes entrar: la primera cuenta que inicia sesión queda como dueña de la
app (o las que pongas en `ALLOWED_EMAILS`).

---

## 1. Instalar y arrancar

Necesitas:

- **Node.js 22.13 o superior** → <https://nodejs.org> (versión LTS).
- **LibreOffice** (gratis) para convertir la factura a PDF →
  <https://es.libreoffice.org>. Sin LibreOffice la app funciona igual, pero las
  facturas se envían en Excel.

```bash
cd facturas
npm install
cp .env.example .env      # en Windows: copy .env.example .env
npm start
```

Abre <http://localhost:3000> en el navegador.

La primera vez:

1. Inicia sesión con tu correo (ver apartado 2).
2. Ve a **Ajustes** y rellena los datos de tu empresa (nombre, NIF, dirección,
   IBAN…), el IVA y la retención por defecto.
3. Sube tu **plantilla Excel** (apartado 3).
4. Añade tus productos/servicios habituales en **Productos** (o se irán
   guardando solos al hacer facturas).

Tus datos se guardan en la carpeta `facturas/data/` (base de datos SQLite y la
plantilla). Haz copia de esa carpeta o usa *Ajustes → Descargar copia de
seguridad*.

## 2. Conectar tu correo

### Outlook / Hotmail / Live (recomendado: botón de Microsoft)

Microsoft ya no deja enviar correo con usuario y contraseña en las cuentas
personales de Outlook, así que se usa el inicio de sesión oficial de Microsoft.
Hay que registrar la app una sola vez (5 minutos, gratis):

1. Entra en <https://entra.microsoft.com> (o <https://portal.azure.com>) con tu
   cuenta de Outlook.
2. **Aplicaciones → Registros de aplicaciones → Nuevo registro**.
   - Nombre: `Facturas`
   - Tipos de cuenta: **"Cuentas en cualquier directorio organizativo y cuentas
     personales de Microsoft"**.
   - URI de redirección: tipo **Web** →
     `http://localhost:3000/auth/microsoft/callback`
3. Copia el **Id. de aplicación (cliente)** → pégalo en `.env` como `MS_CLIENT_ID`.
4. **Certificados y secretos → Nuevo secreto de cliente** → copia el **Valor**
   → pégalo en `.env` como `MS_CLIENT_SECRET`.
5. **Permisos de API → Agregar un permiso → Microsoft Graph → Permisos
   delegados**: marca `Mail.Send`, `User.Read`, `offline_access`, `openid`,
   `email` y `profile`.
6. Reinicia la app (`npm start`). En la pantalla de entrada aparecerá
   **"Iniciar sesión con Microsoft"**.

Los correos se envían desde tu cuenta y quedan guardados en tu carpeta de
**Enviados** de Outlook.

### Gmail, Yahoo, iCloud y otros (correo + contraseña)

Escribe tu correo y contraseña en la pantalla de entrada. La app comprueba la
contraseña conectándose al servidor de correo y la guarda **cifrada** para
poder enviar las facturas.

- **Gmail**: usa una *contraseña de aplicación* (Cuenta de Google → Seguridad →
  Verificación en dos pasos → Contraseñas de aplicaciones).
- **Yahoo / iCloud**: igual, genera una contraseña de aplicación.
- **Correo de tu dominio** (IONOS, Hostinger, cPanel…): abre *Opciones
  avanzadas* e indica el servidor SMTP que te da tu proveedor (p. ej.
  `smtp.ionos.es`, puerto 587).

Con SMTP, marca *"Enviarme una copia"* al enviar si quieres tener el correo en
tu bandeja.

## 3. Tu plantilla de Excel

Abre tu factura de Excel y escribe **marcadores** en las celdas donde van los
datos. La app los sustituye al generar cada factura:

| Qué | Marcadores |
|-----|-----------|
| Tu empresa | `{{empresa.nombre}}` `{{empresa.nif}}` `{{empresa.direccion}}` `{{empresa.cp}}` `{{empresa.ciudad}}` `{{empresa.provincia}}` `{{empresa.telefono}}` `{{empresa.email}}` `{{empresa.iban}}` |
| Factura | `{{numero}}` `{{fecha}}` `{{vencimiento}}` `{{forma_pago}}` `{{notas}}` |
| Cliente | `{{cliente.nombre}}` `{{cliente.nif}}` `{{cliente.direccion}}` `{{cliente.cp}}` `{{cliente.ciudad}}` `{{cliente.provincia}}` `{{cliente.email}}` `{{cliente.telefono}}` |
| Líneas | `{{linea.num}}` `{{linea.descripcion}}` `{{linea.cantidad}}` `{{linea.unidad}}` `{{linea.precio}}` `{{linea.descuento}}` `{{linea.importe}}` |
| Totales | `{{base}}` `{{iva_pct}}` `{{iva}}` `{{irpf_pct}}` `{{irpf}}` `{{total}}` |

Reglas:

- Puedes mezclar texto y marcadores: `NIF: {{cliente.nif}}`,
  `IVA ({{iva_pct}}%)`.
- Si una celda contiene **solo** un marcador de número (`{{total}}`,
  `{{linea.precio}}`…), se escribe como número, así que el formato de moneda de
  tu plantilla se respeta y tus fórmulas funcionan.
- **Tabla de productos**: pon los marcadores `{{linea.…}}` solo en la **primera
  fila** de la tabla. Se usarán las filas de la tabla que haya debajo y, si hay
  más productos que filas, se insertan filas nuevas (copiando el formato y las
  fórmulas de la fila, y ajustando las sumas como `=SUMA(F15:F30)`).
- Puedes dejar tus propias fórmulas (p. ej. importe `=C15*E15` o total
  `=F32+F33`) en lugar de usar `{{linea.importe}}` / `{{total}}`: se recalculan.
- Guarda como **.xlsx** (si es `.xls`, ábrela y usa *Guardar como → .xlsx*).

En **Ajustes → Plantilla** puedes subirla, ver qué marcadores se han
reconocido, descargar la **plantilla de ejemplo** y ver una **vista previa**
con datos de prueba antes de usarla.

## 4. Uso diario

1. **+ Nueva factura** → elige cliente (o escríbelo y se guarda) → añade
   productos (empieza a escribir y elige; el precio se rellena) → **Guardar y
   enviar por correo**.
2. Revisa el correo (destinatario, asunto, mensaje, adjunto PDF/Excel) y pulsa
   **Enviar**. La factura pasa a estado *enviada* y queda en el historial.
3. Cuando te paguen, cambia el estado a **pagada**.
4. En **Facturas** tienes el registro con filtros, lo facturado en el año, el
   IVA del trimestre y lo pendiente de cobro. **Exportar libro Excel** genera el
   listado del año para tu gestor.

Las facturas emitidas no se borran (para no romper la numeración): si hay un
error, **anúlala** y haz una nueva. Los borradores sí se pueden borrar.

## 5. Tenerla en internet (opcional)

Para usarla desde el móvil fuera de casa, publícala en un servidor (VPS, Render,
Railway, etc.) con HTTPS. Hay un `Dockerfile` que incluye LibreOffice:

```bash
docker build -t facturas .
docker run -d -p 3000:3000 -v facturas-data:/data --env-file .env facturas
```

Con HTTPS delante (nginx, Caddy…) añade en `.env`: `TRUST_PROXY=1`,
`COOKIE_SECURE=1`, `MS_REDIRECT_URI=https://tu-dominio/auth/microsoft/callback`
(y añade esa misma URI en el registro de la app de Microsoft). Pon tu correo en
`ALLOWED_EMAILS`.

## Desarrollo

```bash
npm run dev   # reinicia al cambiar archivos
npm test      # pruebas (cálculos, plantilla Excel, numeración)
```

```
server.js              Servidor web y API
lib/db.js              Base de datos SQLite (node:sqlite)
lib/excel.js           Relleno de la plantilla Excel
lib/defaultTemplate.js Plantilla de ejemplo
lib/pdf.js             Conversión a PDF con LibreOffice
lib/mail.js            Login con correo (Microsoft / SMTP) y envío
lib/crypto.js          Cifrado de la contraseña / token guardados
public/                Interfaz web
```
