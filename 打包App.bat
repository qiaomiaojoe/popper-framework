@echo off
chcp 65001 >nul
rem 把这个文件夹做成一个 Windows 独立程序。没在 Windows 上验证过，出问题把窗口里的字发到群里。
rem 第一次要先装打包工具（约 100MB+，只装一次），步骤见 说明.md「做成独立 App」。
cd /d "%~dp0"
if not exist "node_modules\.bin\electron-packager.cmd" goto notools
rem 和 npm install 用同一个镜像：Electron 按下载地址存缓存，地址不同就找不到装好的那份、又去 GitHub 下
if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
for /f "delims=" %%v in ('node -p "require('./node_modules/electron/package.json').version"') do set EV=%%v
for /f "delims=" %%n in ('node -p "require('./package.json').productName"') do set NAME=%%n
for /f "delims=" %%n in ('node -p "require('./app/version.json').version"') do set VER=%%n

rem 1. 只挑要进 App 的文件。开发用的「隔离测试」工作流、测试用假 AI 不带
set STAGE=%TEMP%\popper-framework-stage
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%\app"
for %%f in (main.cjs kernel.cjs preload.cjs version.json) do copy "app\%%f" "%STAGE%\app\" >nul
xcopy content "%STAGE%\content\" /e /i /q >nul
del /q "%STAGE%\content\工作流-隔离测试*.html" "%STAGE%\content\engine-fake.cjs" 2>nul
rem App 里的 package.json：名字、署名、用的框架版本照搬（配置页「版本」和「关于」读它），版本号用外壳的
node -e "const p=require('./package.json');require('fs').writeFileSync(process.argv[1],JSON.stringify({name:p.name,productName:p.productName,version:process.argv[2],main:'app/main.cjs',author:p.author||'',popperFramework:p.popperFramework||''}))" "%STAGE%\package.json" "%VER%"

rem 2. 打包
call "node_modules\.bin\electron-packager.cmd" "%STAGE%" "%NAME%" --platform=win32 --arch=x64 --electron-version=%EV% --app-version=%VER% --out=打包输出 --overwrite --asar --prune=false --icon=构建素材\图标.ico
if errorlevel 1 goto failed
echo.
echo 做好了：打包输出\%NAME%-win32-x64\%NAME%.exe
explorer 打包输出
pause
exit /b 0

:notools
echo 还没装打包工具。在这个文件夹的地址栏里输入 powershell 回车，然后运行这两行：
echo   $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
echo   npm install --registry=https://registry.npmmirror.com
echo 装好后再双击「打包App.bat」。
pause
exit /b 1

:failed
echo 打包没成功，把上面的字发到群里。
pause
exit /b 1
