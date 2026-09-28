# Facturas ⚡ — C&M Instalaciones Eléctricas

Web app para crear, registrar y enviar por correo (en **PDF**) las facturas.
Funciona en **Cloudflare Workers** (plan gratuito) con base de datos **D1**.

**Dirección:** <https://facturas.inautoit.workers.dev>

## Qué hace

- **Inicio**: menú con iconos (nueva factura, nuevo presupuesto, facturas,
  presupuestos, clientes y ajustes).
- **Facturas** y **Presupuestos**: registro de todos (guardados y enviados),
  con filtros. Un presupuesto se convierte en factura con un botón.
- **Corregir y reenviar**: cualquier factura, aunque ya esté enviada, se puede
  editar y volver a enviar (queda el historial de envíos).

- **Factura con el diseño de tu plantilla** (`plantilla_en_blanco`): logo C&M,
  datos de la empresa, cliente, nº de factura, fecha, tabla Cantidad /
  Descripción / Precio unitario / TOTAL, subtotal, IVA y total. El PDF se genera
  al momento en el navegador.
- **Sello y firma** en el recuadro de abajo a la izquierda. Se sube como imagen
  en *Ajustes*; si es una captura, se quitan solos el fondo blanco y las líneas
  negras de los bordes.
- **Bancos**: en *Ajustes → Bancos* guardas tus cuentas (nombre + IBAN). En cada
  factura eliges el banco en un desplegable y su número de cuenta se escribe
  solo en la factura, **a la derecha del sello**.
- Clientes, numeración automática por
  año, IVA e IRPF, estados (borrador, enviada, pagada, anulada), historial de
  envíos, resumen por trimestre y libro de facturas en CSV (para abrir en Excel).
- **Borradores**: pulsa *Guardar* y la factura queda como borrador. Puedes verla
  en PDF, editarla, borrarla o enviarla cuando quieras.
- **Envío por correo** con la factura en PDF adjunta desde tu **Gmail**
  (*Ajustes → Correo → Conectar Gmail*, con una contraseña de aplicación de
  Google), desde Outlook (con Microsoft) o con Brevo.

## Presupuestos por WhatsApp

En *+ Nuevo presupuesto* rellenas cliente, teléfono, (dirección), conceptos y
descuento, y pulsas **WhatsApp** (se abre el menú de compartir con el PDF adjunto:
eliges WhatsApp y el contacto) o **Correo** (se envía por email con el PDF
adjunto). El PDF lleva el logo y no lleva firma. Los presupuestos van **sin IVA** ("IVA no incluido") y
son **válidos 30 días**. Al convertirlos en factura se añade el IVA.

## Primer acceso

1. Abre <https://facturas.inautoit.workers.dev>.
2. Escribe tu correo, una contraseña (mínimo 8 caracteres) y el **código de
   activación** que te dieron al instalar la app. Solo se usa una vez: después
   solo puede entrar esa cuenta.
3. En **Ajustes**: revisa los datos de la empresa, añade tus **bancos** y sube la
   imagen del **sello/firma**.

## Enviar desde tu Outlook (opcional, recomendado)

Microsoft pide registrar la app una sola vez:

1. Entra en <https://entra.microsoft.com> → **Registros de aplicaciones → Nuevo registro**.
   - Tipos de cuenta: **cuentas de cualquier organización y cuentas personales de Microsoft**.
   - URI de redirección (Web): `https://facturas.inautoit.workers.dev/auth/microsoft/callback`
2. **Certificados y secretos → Nuevo secreto de cliente**: copia el *Valor*.
3. **Permisos de API → Microsoft Graph → Delegados**: `Mail.Send`, `User.Read`,
   `offline_access`, `openid`, `email`, `profile`.
4. Guarda el Id. de la aplicación y el secreto en Cloudflare:
   ```bash
   npx wrangler secret put MS_CLIENT_ID
   npx wrangler secret put MS_CLIENT_SECRET
   ```
   (o en el panel de Cloudflare: Workers → facturas → Configuración → Variables y secretos).
5. En la app: **Ajustes → Correo → Conectar Outlook**.

**Alternativa sin Microsoft:** crea una cuenta gratis en <https://www.brevo.com>,
verifica tu correo como remitente, crea una clave API y pégala en
*Ajustes → Correo → Alternativa: enviar con Brevo*.

## Desarrollo y despliegue

```bash
npm install
npm run db:migrate:local   # base de datos local
npm run dev                # http://localhost:8787 (crea .dev.vars con ENC_KEY y SETUP_CODE)
npm test
npm run deploy             # publica en Cloudflare
npm run db:migrate         # aplica migraciones en la base de datos de Cloudflare
```

Secretos del Worker: `ENC_KEY` (cifrado de tokens), `SETUP_CODE` (alta inicial),
`MS_CLIENT_ID` / `MS_CLIENT_SECRET` (Outlook, opcional), `OWNER_EMAIL` (opcional).

```
src/worker.js        API (facturas, clientes, productos, bancos, correo)
src/crypto.js        Contraseñas, sesiones y cifrado (WebCrypto)
migrations/          Esquema de la base de datos D1
public/static/pdf.js Diseño del PDF de la factura (plantilla C&M)
public/static/app.js Interfaz
```
