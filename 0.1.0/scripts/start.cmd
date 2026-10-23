@echo off
rem Haze из исходников (нужен npm install). Консоль сразу закроется; выйти — через трей или stop.cmd.
cd /d "%~dp0.."
start "" "%~dp0..\node_modules\electron\dist\electron.exe" "%~dp0.."
exit
