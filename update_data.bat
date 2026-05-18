@echo off
REM ==========================================================
REM update_data.bat
REM Lance fetch_data.py dans le bon dossier et logue le tout
REM dans update.log (UTF-8 avec BOM pour lisibilité Notepad).
REM Le log est réinitialisé à chaque run (1 run = 1 log).
REM ==========================================================
cd /d "%~dp0"

REM Forcer UTF-8 pour la console et Python
chcp 65001 > nul
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

REM Réinitialiser update.log avec un BOM UTF-8 (3 octets : EF BB BF)
REM pour que Notepad / Bloc-notes détecte l'encodage automatiquement
powershell -NoProfile -Command "[System.IO.File]::WriteAllBytes('update.log', [byte[]](0xEF,0xBB,0xBF))" 2>nul

echo ========== %date% %time% ========== >> update.log

REM Exécution Python en mode UTF-8 (stdout et stderr vers le log)
python -X utf8 fetch_data.py >> update.log 2>&1

REM Code de retour pour Task Scheduler
exit /b %errorlevel%
