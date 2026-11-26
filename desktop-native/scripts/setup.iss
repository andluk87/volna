#ifndef StageDir
#error StageDir is required
#endif
#ifndef OutputDirectory
#error OutputDirectory is required
#endif
[Setup]
AppId={{D2ED77EF-5BE0-463F-80BD-B712F00CE013}
AppName=Volna Desktop Native
AppVersion=0.1.2
AppPublisher=Volna
AppPublisherURL=https://github.com/andluk87/volna
DefaultDirName={localappdata}\Programs\Volna Desktop Native
DefaultGroupName=Volna Desktop Native
UninstallDisplayIcon={app}\VolnaDesktop.exe
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDirectory}
OutputBaseFilename=Volna-Native-Setup-0.1.2
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
LicenseFile=..\third_party\telegramdesktop\LICENSE
[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Volna Desktop Native"; Filename: "{app}\VolnaDesktop.exe"
Name: "{autodesktop}\Volna Desktop Native"; Filename: "{app}\VolnaDesktop.exe"; Tasks: desktopicon
[Tasks]
Name: desktopicon; Description: "Создать ярлык на рабочем столе"; Flags: unchecked
[Run]
Filename: "{app}\VolnaDesktop.exe"; Description: "Открыть Volna Desktop Native"; Flags: nowait postinstall skipifsilent
