#!/usr/bin/env bash
# Atalaya Bot - arranque en Mac o Linux:  bash iniciar_bot.sh
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
nohup nice -n 15 .venv/bin/python -W ignore main.py research > research.log 2>&1 &
echo "Laboratorio en marcha (research.log). Panel: http://localhost:8080"
( sleep 3; (open http://localhost:8080 || xdg-open http://localhost:8080) >/dev/null 2>&1 ) &
.venv/bin/python -W ignore main.py run --port 8080
