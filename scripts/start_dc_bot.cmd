@echo off
chcp 65001 >nul
rem Start Skybee bot (Discord -> Claude bridge) in a minimized window.
rem Autostart: Win+R -> shell:startup -> put a shortcut to this file there.
rem -I = isolated Python (no PYTHONPATH/sitecustomize).
cd /d "%~dp0.."
start "Skybee bot" /min python -I scripts\dc_bot.py
