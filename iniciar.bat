@echo off
setlocal
cd /d "%~dp0"
title Deteccion de barcos - Proyecto 2 IA

where python >nul 2>nul
if errorlevel 1 (
  echo No se encontro Python. Instala Python 3.10, 3.11 o 3.12 de 64 bits desde python.org
  echo y marca la opcion "Add python.exe to PATH" durante la instalacion.
  goto :fin
)

if not exist ".venv\Scripts\python.exe" (
  echo Creando entorno virtual en .venv ...
  python -m venv .venv
  if errorlevel 1 goto :error
)

".venv\Scripts\python.exe" -c "import tensorflow, flask, cv2" >nul 2>nul
if errorlevel 1 (
  echo.
  echo Instalando dependencias. La primera vez tarda varios minutos ^(TensorFlow pesa unos 400 MB^)...
  echo.
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 goto :error
)

echo.
".venv\Scripts\python.exe" app.py
goto :fin

:error
echo.
echo Hubo un error durante la instalacion. Copia el mensaje de arriba para revisarlo.
echo Verifica que tu Python sea de 64 bits y version 3.10, 3.11 o 3.12:
python --version

:fin
echo.
pause
