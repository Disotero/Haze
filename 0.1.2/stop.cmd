@echo off
rem Просит запущенный Haze аккуратно закрыться (освобождает полосу под верхнюю панель и возвращает панель задач).
cd /d "%~dp0app"
start "" "%~dp0app\node_modules\electron\dist\electron.exe" "%~dp0app" --quit
exit
