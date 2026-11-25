@echo off
rem Haze из исходников. Первый запуск сам поставит зависимости (нужен установленный Node.js).
rem Консоль закроется после старта; выйти из Haze — через трей или stop.cmd.
cd /d "%~dp0"
if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo Устанавливаю зависимости (первый запуск)...
  call npm install || (echo. & echo Не удалось установить зависимости. Проверьте, что установлен Node.js. & pause & exit /b 1)
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
exit
