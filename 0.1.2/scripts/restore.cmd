@echo off
rem Возвращает Windows как было, если Haze убили (Диспетчер задач, сбой): панель задач, иконки, уведомления. Пока Haze работает, ничего не делает.
cd /d "%~dp0..\app"
start "" "%~dp0..\app\node_modules\electron\dist\electron.exe" "%~dp0..\app" --restore
exit
