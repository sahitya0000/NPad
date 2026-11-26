# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

param(
	[string] $SetupPath
)

$ErrorActionPreference = 'Stop'
if (-not $SetupPath) {
	$version = (Get-Content -LiteralPath "$PSScriptRoot\..\..\..\package.json" -Raw | ConvertFrom-Json).version
	$SetupPath = "$PSScriptRoot\..\..\..\.build\npad\NPadSetup-x64-$version.exe"
}
$setup = (Resolve-Path -LiteralPath $SetupPath).Path
$uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{B68404B5-799D-44E3-A7A3-7F67CFB75285}_is1'
$ownedKeys = @(
	$uninstallKey,
	'Software\Classes\NPad.Text',
	'Software\Classes\Applications\NPad.exe',
	'Software\Classes\*\shell\NPad',
	'Software\Classes\Directory\shell\NPad',
	'Software\Classes\Directory\Background\shell\NPad',
	'Software\NPad'
)

foreach ($hive in @('HKEY_CURRENT_USER', 'HKEY_LOCAL_MACHINE')) {
	foreach ($key in $ownedKeys) {
		if (Test-Path -LiteralPath "Registry::$hive\$key") {
			throw "Refusing to overwrite an existing NPad installation or shell registration: $hive\$key"
		}
	}
	$registeredApps = "Registry::$hive\Software\RegisteredApplications"
	if ((Test-Path -LiteralPath $registeredApps) -and (Get-Item -LiteralPath $registeredApps).GetValue('NPad')) {
		throw "Existing NPad default-app registration found in $hive."
	}
}

$extensionsJson = node --input-type=module -e "import { getFileAssociations } from './build/npad/installer.ts'; import { distributionDir } from './build/npad/package.ts'; console.log(JSON.stringify(await getFileAssociations(distributionDir)));"
if ($LASTEXITCODE -ne 0) { throw 'Failed to read supported extensions.' }
$extensions = $extensionsJson | ConvertFrom-Json

function Get-DefaultSnapshot {
	$result = @()
	foreach ($extension in $extensions) {
		foreach ($key in @(
			"Registry::HKEY_CURRENT_USER\Software\Classes\$extension",
			"Registry::HKEY_LOCAL_MACHINE\Software\Classes\$extension",
			"Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\UserChoice"
		)) {
			$values = '<unset>|<unset>|<unset>'
			if (Test-Path -LiteralPath $key) {
				$item = Get-Item -LiteralPath $key
				$values = "$($item.GetValue('', '<unset>'))|$($item.GetValue('ProgId', '<unset>'))|$($item.GetValue('Hash', '<unset>'))"
			}
			$result += "$key=$values"
		}
	}
	return $result | ConvertTo-Json -Compress
}

$defaults = Get-DefaultSnapshot
foreach ($enableTasks in @($true, $false)) {
	$testDir = Join-Path ([System.IO.Path]::GetTempPath()) ('NPad Install Test ' + [guid]::NewGuid().ToString('N'))
	$registration = "Registry::HKEY_CURRENT_USER\$uninstallKey"
	try {
		$tasks = '/TASKS=""'
		if ($enableTasks) { $tasks = '/TASKS="addcontextmenufiles,addcontextmenufolders,associatewithfiles"' }
		$install = Start-Process -FilePath $setup -ArgumentList @('/CURRENTUSER', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS', "/DIR=`"$testDir`"", $tasks) -PassThru -Wait
		if ($install.ExitCode -ne 0) { throw "Installer failed: $($install.ExitCode)" }
		if ((Get-ItemProperty -LiteralPath $registration).InstallLocation.TrimEnd('\') -ne $testDir) {
			throw 'Installed directory does not match the isolated test directory.'
		}
		$command = "`"$testDir\NPad.exe`" `"%1`""
		if ($enableTasks) {
			foreach ($key in @(
				'Software\Classes\*\shell\NPad\command',
				'Software\Classes\Directory\shell\NPad\command',
				'Software\Classes\NPad.Text\shell\open\command',
				'Software\Classes\Applications\NPad.exe\shell\open\command'
			)) {
				if ((Get-Item -LiteralPath "Registry::HKEY_CURRENT_USER\$key").GetValue('') -ne $command) {
					throw "Incorrect executable or file argument quoting: $key"
				}
			}
			$background = Get-Item -LiteralPath 'Registry::HKEY_CURRENT_USER\Software\Classes\Directory\Background\shell\NPad\command'
			if ($background.GetValue('') -ne "`"$testDir\NPad.exe`" `"%V`"") { throw 'Incorrect directory background command.' }
			if ((Get-Item -LiteralPath 'Registry::HKEY_CURRENT_USER\Software\RegisteredApplications').GetValue('NPad') -ne 'Software\NPad\Capabilities') {
				throw 'NPad is not registered for Windows Default Apps.'
			}
			$capabilities = Get-Item -LiteralPath 'Registry::HKEY_CURRENT_USER\Software\NPad\Capabilities\FileAssociations'
			foreach ($extension in $extensions) {
				$openWith = Get-Item -LiteralPath "Registry::HKEY_CURRENT_USER\Software\Classes\$extension\OpenWithProgids"
				if ($openWith.GetValueNames() -notcontains 'NPad.Text' -or $capabilities.GetValue($extension) -ne 'NPad.Text') {
					throw "Missing supported file association: $extension"
				}
			}
			$env:NPAD_TEST_APP = $testDir
			try {
				node --test build\npad\test\smoke.test.ts
				if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke tests failed.' }
			} finally {
				Remove-Item Env:\NPAD_TEST_APP
			}
		} else {
			foreach ($key in $ownedKeys | Select-Object -Skip 1) {
				if (Test-Path -LiteralPath "Registry::HKEY_CURRENT_USER\$key") { throw "Deselected task wrote registration: $key" }
			}
		}
		if ((Get-DefaultSnapshot) -ne $defaults) { throw 'Existing file defaults or protected UserChoice entries changed.' }
		"Verified installation with optional tasks enabled: $enableTasks"
	} finally {
		if (Test-Path -LiteralPath $registration) {
			if ((Get-ItemProperty -LiteralPath $registration).InstallLocation.TrimEnd('\') -ne $testDir) { throw 'Refusing to uninstall an unexpected registration.' }
			$uninstall = Start-Process -FilePath (Join-Path $testDir 'unins000.exe') -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -PassThru -Wait
			if ($uninstall.ExitCode -ne 0) { throw "Uninstall failed: $($uninstall.ExitCode)" }
		}
		for ($attempt = 0; $attempt -lt 30 -and (Test-Path -LiteralPath $testDir); $attempt++) { Start-Sleep -Seconds 1 }
		if (Test-Path -LiteralPath $testDir) { Remove-Item -LiteralPath $testDir -Recurse -Force }
	}
	foreach ($key in $ownedKeys) {
		if (Test-Path -LiteralPath "Registry::HKEY_CURRENT_USER\$key") { throw "Uninstall left a registration: $key" }
	}
	if ((Get-Item -LiteralPath 'Registry::HKEY_CURRENT_USER\Software\RegisteredApplications').GetValueNames() -contains 'NPad') { throw 'Uninstall left a Default Apps registration.' }
	foreach ($extension in $extensions) {
		$key = "Registry::HKEY_CURRENT_USER\Software\Classes\$extension\OpenWithProgids"
		if ((Test-Path -LiteralPath $key) -and (Get-Item -LiteralPath $key).GetValueNames() -contains 'NPad.Text') {
			throw "Uninstall left an Open With entry: $extension"
		}
	}
	if ((Get-DefaultSnapshot) -ne $defaults) { throw 'Uninstall changed existing file defaults.' }
}
'Installer task opt-in/opt-out, quoted shell commands, supported associations, default preservation, and uninstall cleanup passed.'
