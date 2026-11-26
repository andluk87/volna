param([string]$QtDirectory = $env:QT_ROOT_DIR, [string]$BuildDirectory = 'build-native')
$ErrorActionPreference = 'Stop'
function Run([string]$Program, [string[]]$Arguments) { & $Program @Arguments; if ($LASTEXITCODE -ne 0) { throw "$Program failed ($LASTEXITCODE)" } }
$Root = (Resolve-Path "$PSScriptRoot/../..").Path
Set-Location $Root
if (-not $QtDirectory) { throw 'Set QT_ROOT_DIR to Qt 6.8+ msvc2022_64 with WebEngine and WebChannel installed.' }
$QtDirectory = (Resolve-Path $QtDirectory).Path
$env:PATH = "$QtDirectory/bin;$env:PATH"
Run 'cmake' @('-S', 'desktop-native', '-B', $BuildDirectory, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', "-DCMAKE_PREFIX_PATH=$QtDirectory")
Run 'cmake' @('--build', $BuildDirectory, '--parallel', '3')
$env:QT_QPA_PLATFORM = 'offscreen'
Run 'ctest' @('--test-dir', $BuildDirectory, '--output-on-failure')
Remove-Item Env:QT_QPA_PLATFORM
$Stage = Join-Path $Root "$BuildDirectory/package/VolnaDesktopNative"
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
Run 'cmake' @('--install', $BuildDirectory, '--prefix', $Stage)
Run "$QtDirectory/bin/windeployqt.exe" @('--release', '--compiler-runtime', '--no-translations', '--skip-plugin-types', 'position', "$Stage/VolnaDesktop.exe")
# Install app-local MSVC runtime DLLs so the per-user installer does not need
# administrator rights or a preinstalled Visual C++ redistributable.
$Crt = Get-ChildItem (Join-Path $env:VCToolsRedistDir 'x64') -Directory | Where-Object Name -Like 'Microsoft.VC*.CRT' | Select-Object -First 1
if (-not $Crt) { throw 'Cannot find the x64 MSVC redistributable CRT directory.' }
Copy-Item "$($Crt.FullName)/*.dll" $Stage -Force
Remove-Item "$Stage/vc_redist.x64.exe" -ErrorAction SilentlyContinue
foreach ($RuntimeFile in @('QtWebEngineProcess.exe', 'Qt6WebEngineCore.dll', 'resources/qtwebengine_resources.pak', 'platforms/qwindows.dll', 'tls/qschannelbackend.dll')) {
    if (-not (Test-Path "$Stage/$RuntimeFile")) { throw "Missing deployed runtime: $RuntimeFile" }
}
$SmokeInfo = [System.Diagnostics.ProcessStartInfo]::new()
$SmokeInfo.FileName = "$Stage/VolnaDesktop.exe"
$SmokeInfo.Arguments = '--verify-runtime'
$SmokeInfo.UseShellExecute = $false
$SmokeInfo.Environment['PATH'] = (($env:PATH -split ';') | Where-Object { $_ -and -not $_.StartsWith($QtDirectory, [System.StringComparison]::OrdinalIgnoreCase) }) -join ';'
foreach ($Variable in @('QT_PLUGIN_PATH', 'QML2_IMPORT_PATH', 'QML_IMPORT_PATH')) { $SmokeInfo.Environment.Remove($Variable) | Out-Null }
$Smoke = [System.Diagnostics.Process]::Start($SmokeInfo)
if (-not $Smoke.WaitForExit(20000)) { $Smoke.Kill(); throw 'Packaged client did not start within 20 seconds.' }
if ($Smoke.ExitCode -ne 0) { throw "Packaged client failed to start ($($Smoke.ExitCode))" }
$SmokeInfo.Arguments = "--check-network --network-report `"$Root/$BuildDirectory/network-probe.json`""
$NetworkProbe = [System.Diagnostics.Process]::Start($SmokeInfo)
if (-not $NetworkProbe.WaitForExit(50000)) { $NetworkProbe.Kill(); throw 'Packaged HTTPS probe timed out.' }
Get-Content "$Root/$BuildDirectory/network-probe.json"
if ($NetworkProbe.ExitCode -ne 0) { throw "Packaged HTTPS probe failed ($($NetworkProbe.ExitCode))" }
Copy-Item 'desktop-native/third_party/qt' "$Stage/licenses/qt" -Recurse -Force
Copy-Item 'desktop-native/README.md' "$Stage/README.md"
$Archive = Join-Path $Root "$BuildDirectory/Volna-Native-0.1.2-windows-x64.zip"
Compress-Archive -Path "$Stage/*" -DestinationPath $Archive -Force
$Compiler = "${env:ProgramFiles(x86)}/Inno Setup 6/ISCC.exe"
if (-not (Test-Path $Compiler)) { throw 'Inno Setup 6 not found; portable ZIP has been built.' }
Run $Compiler @("/DStageDir=$Stage", "/DOutputDirectory=$Root/$BuildDirectory", 'desktop-native/scripts/setup.iss')
Get-FileHash -Algorithm SHA256 $Archive, "$Root/$BuildDirectory/Volna-Native-Setup-0.1.2.exe" | Format-Table
