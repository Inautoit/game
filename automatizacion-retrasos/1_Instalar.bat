@echo off
cd /d "%~dp0"
echo Instalando dependencias...
python -m pip install --upgrade -r requirements.txt
if not exist config.ini copy config.example.ini config.ini
echo.
echo Listo. Abre config.ini y pon tu matricula y correo.
pause
