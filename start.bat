@echo off
setlocal
 title WEAVE Agent Workflow
pushd "%~dp0"
if errorlevel 1 goto directory_error

where node >nul 2>&1
if errorlevel 1 goto node_error
where npm >nul 2>&1
if errorlevel 1 goto node_error

node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)"
if errorlevel 1 goto node_error

if not exist "node_modules\tsx\package.json" (
    echo Installing project dependencies...
    call npm install
    if errorlevel 1 goto install_error
)

if not exist ".env" (
    echo Note: Configure DEEPSEEK_API_KEY in the project .env file to use AI generation.
)
echo Starting WEAVE. Open the URL printed by the server.
echo Keep this window open. Press Ctrl+C to stop.
call npm run dev
if errorlevel 1 goto start_error
popd
endlocal
exit /b 0

:node_error
echo Node.js 22.13 or newer and npm are required. Node.js 24 is recommended.
echo Install Node.js, then reopen this script.
goto failure

:install_error
echo Dependency installation failed. Check the error above and your network connection.
goto failure

:start_error
echo The server stopped with an error. Check the message above.
goto failure

:directory_error
echo Could not open the project directory.
pause
endlocal
exit /b 1

:failure
popd
pause
endlocal
exit /b 1
