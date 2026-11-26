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
Run "$QtDirectory/bin/windeployqt.exe" @('--release', '--compiler-runtime', '--no-translations', "$Stage/VolnaDesktop.exe")
Copy-Item 'desktop-native/third_party/qt' "$Stage/licenses/qt" -Recurse -Force
Copy-Item 'desktop-native/README.md' "$Stage/README.md"
$Archive = Join-Path $Root "$BuildDirectory/Volna-Native-0.1.0-windows-x64.zip"
Compress-Archive -Path "$Stage/*" -DestinationPath $Archive -Force
$Compiler = "${env:ProgramFiles(x86)}/Inno Setup 6/ISCC.exe"
if (-not (Test-Path $Compiler)) { throw 'Inno Setup 6 not found; portable ZIP has been built.' }
Run $Compiler @("/DStageDir=$Stage", "/DOutputDirectory=$Root/$BuildDirectory", 'desktop-native/scripts/setup.iss')
Get-FileHash -Algorithm SHA256 $Archive, "$Root/$BuildDirectory/Volna-Native-Setup-0.1.0.exe" | Format-Table
