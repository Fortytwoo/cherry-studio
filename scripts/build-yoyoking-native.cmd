@echo off
setlocal
pushd "%~dp0..\vendor\jy-draftc"
call build.bat
if errorlevel 1 goto failed
call scripts\jianying-window-poc\build.cmd
if errorlevel 1 goto failed
call scripts\jianying-window-poc\build-fixture.cmd
if errorlevel 1 goto failed
popd
exit /b 0
:failed
set "YOYOKING_BUILD_EXIT=%ERRORLEVEL%"
popd
exit /b %YOYOKING_BUILD_EXIT%
