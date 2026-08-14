@echo off
title Dashboard Demo Day — eCommerce Institute
echo.
echo  ==========================================
echo   Dashboard Demo Day — eCommerce Institute
echo  ==========================================
echo.
echo  Iniciando servidor local en http://localhost:8080
echo  Cerrá esta ventana para detener el servidor.
echo.
start "" http://localhost:8080/
python "%~dp0servidor.py"
pause
