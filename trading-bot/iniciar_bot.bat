@echo off
REM ============================================================
REM  Atalaya Bot - doble clic para arrancarlo en Windows
REM  Requisito: Python 3.11 o superior (python.org, marcando "Add python.exe to PATH")
REM ============================================================
cd /d "%~dp0"
title Atalaya Bot
if not exist .venv (
  echo Preparando el entorno por primera vez, tarda unos minutos...
  py -3 -m venv .venv || python -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install -q --upgrade pip
python -m pip install -q -r requirements.txt
echo Arrancando el laboratorio de autoentrenamiento en segundo plano...
start "Atalaya - laboratorio" /min cmd /c ".venv\Scripts\python.exe -W ignore main.py research"
echo Abriendo el panel en el navegador (la primera vez tarda ~5 min en entrenar)...
start "" http://localhost:8080
.venv\Scripts\python.exe -W ignore main.py run --port 8080
pause
