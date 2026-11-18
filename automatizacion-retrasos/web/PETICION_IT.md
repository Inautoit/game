# Petición a IT (copiar y enviar)

**Asunto:** Registro de aplicación en Entra ID para leer un Excel de SharePoint desde la web WFM VAP

Hola,

Necesitamos que la web interna **WFM VAP** (https://wfmvap.lovable.app) pueda
descargar, **con la cuenta de cada usuario**, el archivo
`CambiosTurno_Puntualidad 26.xlsx` del sitio `https://verisure.sharepoint.com/sites/filerEs`.

¿Podéis registrar una aplicación en Entra ID con esta configuración?

- **Tipo de plataforma:** Single-page application (SPA)
- **Redirect URI:** `https://wfmvap.lovable.app`
- **Permisos (delegados) de Microsoft Graph:** `Files.Read.All`
  (solo lectura; cada usuario accede únicamente a lo que ya puede ver en SharePoint)
- **Admin consent** para la organización, si la política no permite el consentimiento de usuario
- **Cuentas admitidas:** solo este directorio (single tenant)

Necesitaríamos que nos paséis el **Application (client) ID** y el **Directory (tenant) ID**.

No se usa ningún secreto ni contraseña: el acceso es siempre con el usuario que
inicia sesión.

Gracias.
