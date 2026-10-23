@echo off
rem Просит запущенный Haze аккуратно закрыться (освобождает полосу под верхнюю панель и возвращает панель задач).
cd /d "%~dp0.."
start "" "%~dp0..\node_modules\electron\dist\electron.exe" "%~dp0.." --quit
exit
