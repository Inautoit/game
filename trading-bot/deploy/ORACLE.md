# Montar Atalaya Bot en Oracle Cloud (gratis)

Tiempo: unos 20 minutos. Coste: 0 € con la capa "Always Free".

## 1. Crear la cuenta

1. Entra en <https://signup.cloud.oracle.com> y regístrate.
2. Pide una tarjeta para verificar tu identidad. **No cobra** mientras uses recursos "Always Free".
3. **Región de origen**: elige una cercana, por ejemplo *Spain Central (Madrid)* o *Germany Central (Frankfurt)*. No se puede cambiar después.

## 2. Crear el servidor

1. En la consola: menú ☰ → **Compute** → **Instances** → **Create instance**.
2. **Name**: `atalaya`.
3. **Image and shape** → *Edit*:
   - **Image** → *Change image* → **Canonical Ubuntu 24.04**.
   - **Shape** → *Change shape* → **Ampere** → **VM.Standard.A1.Flex**, con **4 OCPU** y **24 GB** de memoria. Entra en lo gratuito.
4. **Networking**: deja la red por defecto y marca *Assign a public IPv4 address*.
5. **Add SSH keys** → **Generate a key pair for me** → pulsa **Save private key**. Guarda el archivo `.key`: es tu llave para entrar.
6. **Create**. En 1-2 minutos aparece en verde (*Running*). Apunta la **Public IP address**.

> Si sale **"Out of capacity"** con Ampere: prueba otro *Availability domain* en el paso 4, o reinténtalo más tarde (suele haber hueco de madrugada). Como alternativa vale **VM.Standard.E2.1.Micro**, también gratis. Es lenta y tiene 1 GB de RAM: el instalador añade memoria de intercambio, pero el laboratorio irá despacio.

## 3. Abrir el puerto del panel

1. En la página de la instancia: **Primary VNIC** → enlace de la **Subnet** → **Security Lists** → *Default Security List*.
2. **Add Ingress Rules**:
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: `TCP`
   - Destination Port Range: `8080`
3. **Add Ingress Rules** para guardar.

## 4. Entrar al servidor e instalar

Desde tu ordenador (en Windows usa **PowerShell**; en Mac o Linux, la **Terminal**), en la carpeta donde guardaste la llave. En Mac o Linux, protege antes la llave:

```bash
chmod 600 ssh-key-*.key
```

Entra al servidor (cambia `IP` por la IP pública que apuntaste):

```bash
ssh -i ssh-key-2026-11-16.key ubuntu@IP
```

Ya dentro del servidor, descarga el instalador:

```bash
curl -O https://raw.githubusercontent.com/Inautoit/game/claude/cool-ramanujan-5tjkw7/trading-bot/deploy/install.sh
```

Y ejecútalo:

```bash
sudo bash install.sh
```

Al terminar muestra la **dirección del panel**, el **usuario** y la **contraseña**. Guárdalos.

## 5. Ver el bot

Abre `http://IP:8080` en el navegador o en el móvil, con el usuario `atalaya` y la contraseña generada.

- La primera vez tarda **unos 5 minutos** en descargar el histórico y entrenar el modelo.
- El **laboratorio** hace su primer ciclo de investigación al arrancar (30-60 minutos) y luego repite cada 12 horas.

## Comandos útiles (dentro del servidor)

Ver lo que hace el bot en directo:

```bash
sudo journalctl -u atalaya -f
```

Ver lo que investiga el laboratorio:

```bash
sudo journalctl -u atalaya-research -f
```

Reiniciar el bot:

```bash
sudo systemctl restart atalaya
```

Actualizar a la última versión del código (conserva posiciones, modelo e historial):

```bash
sudo bash install.sh
```

Consultar la contraseña del panel:

```bash
sudo cat /etc/atalaya.env
```
