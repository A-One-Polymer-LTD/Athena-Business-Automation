@echo off
rem Deletes the local database so that the sample data is loaded again on the next start.
rem Stop Athena OS first (Ctrl+C in its window).
cd /d "%~dp0backend"
del /q athena.db athena.db-wal athena.db-shm 2>nul
echo Sample data will be reloaded the next time Athena OS starts.
pause
