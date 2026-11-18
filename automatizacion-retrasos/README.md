# Actualizar Retrasos (WFM VAP)

Un botón que:

1. Copia el **Cuadrante ÚNICO del mes actual** de
   `\\fileserver\SSRR_SP\...\Cuadrantes UNICOS\<año>\<MM>_Cuadrante ÚNICO_<Mes>_<año>.xlsm`
2. Descarga **CambiosTurno_Puntualidad 26.xlsx** de SharePoint.
3. Entra en <https://wfmvap.lovable.app/retrasos> y sube cada archivo a su campo
   (**Cuadrante** y **Cambios de turno**).

El archivo del cuadrante se elige solo según el mes: en diciembre buscará `12_Cuadrante*2026.xlsm`, y en enero, la carpeta `2027`.

## Repartirlo al equipo sin que nadie meta datos

1. Crea `config.ini` (copia de `config.example.ini`) con la matrícula y el correo.
   `config.ini` **no se sube a GitHub** (está en `.gitignore`).
2. Deja la carpeta completa, con ese `config.ini`, en una carpeta compartida de red
   o envíala en un ZIP.
3. Cada persona solo hace doble clic en `Actualizar Retrasos.bat`. Las sesiones y
   descargas de cada una se guardan en su PC (`%LOCALAPPDATA%\ActualizarRetrasos`),
   así que pueden usarla a la vez desde la misma carpeta.

Cada persona necesita Python y ejecutar `1_Instalar.bat` una vez en su PC.

## Instalación (una vez, en tu PC con Windows)

1. Instala **Python 3.10 o superior** desde <https://www.python.org/downloads/>
   (marca *"Add Python to PATH"*).
2. Copia esta carpeta a tu PC, por ejemplo a `C:\Automatizaciones\automatizacion-retrasos`.
3. Doble clic en **`1_Instalar.bat`**.
4. Abre **`config.ini`** y rellena `matricula` y `correo` en `[web]`.

## Uso

- Doble clic en **`Actualizar Retrasos.bat`**: se abre una ventana con el botón
  **"Descargar y subir informes"**, que va mostrando lo que hace.
- **La primera vez** se abrirá Edge y puede pedirte iniciar sesión en Microsoft
  (marca *"Mantener la sesión iniciada"*). Tienes 5 minutos. Las siguientes veces
  ya no te lo pedirá.

### Ejecutarlo solo cada día (opcional)

En el *Programador de tareas* de Windows, crea una tarea básica que ejecute
`Actualizar Retrasos (automatico).bat` a la hora que quieras. Lo que pase queda
en `%LOCALAPPDATA%\ActualizarRetrasos\ultima_ejecucion.log`.

## Opciones de `config.ini`

| Opción | Para qué |
|---|---|
| `[cuadrante] ruta_fija` | Forzar un archivo concreto en vez del mes actual |
| `[sharepoint] ruta_local` | Si tienes la biblioteca sincronizada con OneDrive, copia de ahí (más rápido, sin navegador) |
| `[navegador] canal` | `msedge` (por defecto), `chrome` o vacío |
| `[navegador] oculto` | `yes` para no ver el navegador (cuando ya funcione) |

## Problemas típicos

- **No puedo acceder a la carpeta del cuadrante**: no estás en la red o VPN de la empresa.
- **No se pudo descargar de SharePoint**: no se completó el inicio de sesión o no
  tienes acceso al archivo. Ábrelo una vez a mano en el navegador.
- **No encuentro los campos para subir archivos**: tu usuario de la web no es admin
  o la página ha cambiado.
