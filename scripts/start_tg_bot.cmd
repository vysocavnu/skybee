@echo off
chcp 65001 >nul
rem Start Skybee bot (Telegram -> Claude bridge) in a minimized window.
rem Autostart: Win+R -> shell:startup -> put a shortcut to this file there.
rem -I = isolated Python (no PYTHONPATH/sitecustomize); tg_confirm.py checks the bridge was started exactly like this.
cd /d "%~dp0.."
start "Skybee bot" /min python -I scripts\tg_bot.py
