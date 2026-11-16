#!/usr/bin/env bash
# Instala Atalaya Bot en un servidor Ubuntu (Oracle Cloud, otro VPS, Raspberry Pi...).
#   curl -O https://raw.githubusercontent.com/Inautoit/game/claude/cool-ramanujan-5tjkw7/trading-bot/deploy/install.sh
#   sudo bash install.sh
set -euo pipefail
BRANCH="${BRANCH:-claude/cool-ramanujan-5tjkw7}"
REPO="${REPO:-https://github.com/Inautoit/game.git}"

echo "==> Paquetes del sistema"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y git python3-venv python3-pip iptables-persistent

echo "==> Memoria de intercambio (por si el servidor tiene poca RAM)"
if [ "$(free -m | awk '/Mem:/{print $2}')" -lt 6000 ] && [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Código"
id atalaya >/dev/null 2>&1 || useradd -r -m -d /opt/atalaya -s /usr/sbin/nologin atalaya
git config --global --add safe.directory /opt/atalaya/repo
if [ -d /opt/atalaya/repo/.git ]; then
  # actualizar: el estado del bot (posiciones, modelo, investigación) no está en git y se conserva
  git -C /opt/atalaya/repo fetch -q origin "$BRANCH" && git -C /opt/atalaya/repo reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" /opt/atalaya/repo
fi
ln -sfn /opt/atalaya/repo/trading-bot /opt/atalaya/trading-bot

echo "==> Entorno Python (tarda unos minutos)"
python3 -m venv /opt/atalaya/venv
/opt/atalaya/venv/bin/pip install -q --upgrade pip
/opt/atalaya/venv/bin/pip install -q -r /opt/atalaya/trading-bot/requirements.txt
chown -R atalaya:atalaya /opt/atalaya

echo "==> Contraseña del panel"
if [ ! -f /etc/atalaya.env ]; then
  PW="${ATALAYA_PASSWORD:-$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14)}"
  printf 'ATALAYA_USER=atalaya\nATALAYA_PASSWORD=%s\n' "$PW" > /etc/atalaya.env
  chmod 640 /etc/atalaya.env && chgrp atalaya /etc/atalaya.env
fi

echo "==> Abrir el puerto 8080 en el cortafuegos interno (Oracle lo trae cerrado)"
iptables -C INPUT -p tcp --dport 8080 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 8080 -j ACCEPT
netfilter-persistent save >/dev/null 2>&1 || true

echo "==> Servicios"
cp /opt/atalaya/trading-bot/deploy/atalaya.service /opt/atalaya/trading-bot/deploy/atalaya-research.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now atalaya atalaya-research
systemctl restart atalaya atalaya-research

IP=$(curl -s -m 5 https://ifconfig.me || hostname -I | awk '{print $1}')
echo
echo "=============================================================="
echo " Atalaya Bot instalado y en marcha."
echo " Panel:      http://$IP:8080"
echo " Usuario:    atalaya"
echo " Contraseña: $(grep ATALAYA_PASSWORD /etc/atalaya.env | cut -d= -f2)"
echo " La primera vez tarda ~5 min en entrenar el modelo."
echo " Ver lo que hace:  sudo journalctl -u atalaya -f"
echo " Laboratorio:      sudo journalctl -u atalaya-research -f"
echo " Actualizar:       sudo bash install.sh   (otra vez)"
echo "=============================================================="
