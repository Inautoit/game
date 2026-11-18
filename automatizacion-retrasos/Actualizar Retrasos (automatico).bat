@echo off
rem Para el Programador de tareas de Windows (sin ventana)
cd /d "%~dp0"
python actualizar_retrasos.py --sin-ventana
