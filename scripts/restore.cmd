@echo off
rem Возвращает Windows как было, если Haze убили (Диспетчер задач, сбой): панель задач, иконки, уведомления. Пока Haze работает, ничего не делает.
cd /d "%~dp0.."
start "" "%~dp0..\node_modules\electron\dist\electron.exe" "%~dp0.." --restore
exit
