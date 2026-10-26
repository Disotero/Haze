@echo off
rem Haze из исходников (один раз нужен npm install в папке app). Консоль сразу закроется; выйти — через трей или stop.cmd.
cd /d "%~dp0app"
start "" "%~dp0app\node_modules\electron\dist\electron.exe" "%~dp0app"
exit
