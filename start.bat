@echo off
rem Athena OS - one-click start. Builds the web app if needed and serves everything at http://localhost:8000
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo Creating the Python environment...
  python -m venv backend\.venv || goto :error
  backend\.venv\Scripts\python -m pip install -r backend\requirements.txt || goto :error
)

if not exist "frontend\node_modules" (
  echo Installing web app packages...
  pushd frontend
  call npm install || goto :error
  popd
)

if not exist "frontend\dist\index.html" (
  echo Building the web app...
  pushd frontend
  call npm run build || goto :error
  popd
)

echo.
echo  Athena OS is starting at http://localhost:8000
echo  Demo password for every account: Athena@123
echo  Press Ctrl+C to stop.
echo.
cd backend
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
goto :eof

:error
echo.
echo Start-up failed. Please check the message above.
pause
