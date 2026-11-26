; Copyright (c) Microsoft Corporation. All rights reserved.
; Licensed under the MIT License. See License.txt in the project root for license information.

[Setup]
AppId={{B68404B5-799D-44E3-A7A3-7F67CFB75285}
AppName=NPad
AppVersion={#AppVersion}
DefaultDirName={autopf}\NPad
DefaultGroupName=NPad
UninstallDisplayIcon={app}\NPad.exe
SetupIconFile={#SourceDir}\resources\app\resources\npad\code.ico
OutputDir={#OutputDir}
OutputBaseFilename=NPadSetup-x64-{#AppVersion}
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog commandline
ChangesAssociations=yes
MinVersion=10.0
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
LicenseFile={#SourceDir}\resources\app\LICENSE.txt
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked
Name: "addcontextmenufiles"; Description: "Add ""Open with NPad"" to the Windows Explorer file context menu"; GroupDescription: "Other:"
Name: "addcontextmenufolders"; Description: "Add ""Open with NPad"" to the Windows Explorer directory context menu"; GroupDescription: "Other:"; Flags: unchecked
Name: "associatewithfiles"; Description: "Register NPad as an editor for supported text and source-code file types"; GroupDescription: "Other:"

[Registry]
Root: HKA; Subkey: "Software\Classes\*\shell\NPad"; ValueType: string; ValueName: ""; ValueData: "Open with NPad"; Flags: uninsdeletekey; Tasks: addcontextmenufiles
Root: HKA; Subkey: "Software\Classes\*\shell\NPad"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\NPad.exe"""; Tasks: addcontextmenufiles
Root: HKA; Subkey: "Software\Classes\*\shell\NPad\command"; ValueType: string; ValueName: ""; ValueData: """{app}\NPad.exe"" ""%1"""; Tasks: addcontextmenufiles
Root: HKA; Subkey: "Software\Classes\Directory\shell\NPad"; ValueType: string; ValueName: ""; ValueData: "Open with NPad"; Flags: uninsdeletekey; Tasks: addcontextmenufolders
Root: HKA; Subkey: "Software\Classes\Directory\shell\NPad"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\NPad.exe"""; Tasks: addcontextmenufolders
Root: HKA; Subkey: "Software\Classes\Directory\shell\NPad\command"; ValueType: string; ValueName: ""; ValueData: """{app}\NPad.exe"" ""%1"""; Tasks: addcontextmenufolders
Root: HKA; Subkey: "Software\Classes\Directory\Background\shell\NPad"; ValueType: string; ValueName: ""; ValueData: "Open with NPad"; Flags: uninsdeletekey; Tasks: addcontextmenufolders
Root: HKA; Subkey: "Software\Classes\Directory\Background\shell\NPad"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\NPad.exe"""; Tasks: addcontextmenufolders
Root: HKA; Subkey: "Software\Classes\Directory\Background\shell\NPad\command"; ValueType: string; ValueName: ""; ValueData: """{app}\NPad.exe"" ""%V"""; Tasks: addcontextmenufolders
Root: HKA; Subkey: "Software\Classes\NPad.Text"; ValueType: string; ValueName: ""; ValueData: "NPad Text Document"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: HKA; Subkey: "Software\Classes\NPad.Text\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\NPad.exe"",0"; Tasks: associatewithfiles
Root: HKA; Subkey: "Software\Classes\NPad.Text\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\NPad.exe"" ""%1"""; Tasks: associatewithfiles
Root: HKA; Subkey: "Software\Classes\Applications\NPad.exe"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "NPad"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: HKA; Subkey: "Software\Classes\Applications\NPad.exe\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\NPad.exe"",0"; Tasks: associatewithfiles
Root: HKA; Subkey: "Software\Classes\Applications\NPad.exe\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\NPad.exe"" ""%1"""; Tasks: associatewithfiles
Root: HKA; Subkey: "Software\NPad"; Flags: uninsdeletekeyifempty; Tasks: associatewithfiles
Root: HKA; Subkey: "Software\NPad\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "NPad"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: HKA; Subkey: "Software\NPad\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Lightweight text and source-code editor"; Tasks: associatewithfiles
Root: HKA; Subkey: "Software\NPad\Capabilities"; ValueType: string; ValueName: "ApplicationIcon"; ValueData: """{app}\NPad.exe"",0"; Tasks: associatewithfiles
Root: HKA; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "NPad"; ValueData: "Software\NPad\Capabilities"; Flags: uninsdeletevalue; Tasks: associatewithfiles
#include OutputDir + "\npad-file-associations.iss"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\NPad"; Filename: "{app}\NPad.exe"; AppUserModelID: "NPad.Editor"
Name: "{autodesktop}\NPad"; Filename: "{app}\NPad.exe"; AppUserModelID: "NPad.Editor"; Tasks: desktopicon

[Run]
Filename: "{app}\NPad.exe"; Description: "Launch NPad"; Flags: nowait postinstall skipifsilent
Filename: "ms-settings:defaultapps"; Description: "Choose default file associations in Windows Settings"; Flags: shellexec nowait postinstall skipifsilent unchecked; Tasks: associatewithfiles
