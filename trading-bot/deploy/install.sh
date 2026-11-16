#!/usr/bin/env bash
# Instala Atalaya Bot en un servidor Ubuntu/Debian (VPS, Raspberry Pi, PC con Linux).
# Uso:  curl -O https://raw.githubusercontent.com/Inautoit/game/<rama>/trading-bot/deploy/install.sh && sudo bash install.sh
set -euo pipefail
BRANCH="${BRANCH:-claude/cool-ramanujan-5tjkw7}"
apt-get update -y && apt-get install -y git python3-venv python3-pip
id atalaya >/dev/null 2>&1 || useradd -r -m -d /opt/atalaya atalaya
if [ ! -d /opt/atalaya/repo ]; then
  git clone --branch "$BRANCH" https://github.com/Inautoit/game.git /opt/atalaya/repo
fi
ln -sfn /opt/atalaya/repo/trading-bot /opt/atalaya/trading-bot
python3 -m venv /opt/atalaya/venv
/opt/atalaya/venv/bin/pip install -q -r /opt/atalaya/trading-bot/requirements.txt
chown -R atalaya:atalaya /opt/atalaya
cp /opt/atalaya/trading-bot/deploy/atalaya.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now atalaya
echo "Listo. Panel en http://$(hostname -I | awk '{print $1}'):8080  ·  logs: journalctl -u atalaya -f"
