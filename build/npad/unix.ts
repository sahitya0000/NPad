/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildTarget, getAppDirectory, getExecutablePath } from './platform.ts';
import packageJson from '../../package.json' with { type: 'json' };

const executeFile = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');

export function createUnixLauncher(platform: 'linux' | 'darwin'): string {
	const executable = platform === 'darwin' ? '$ROOT/../../MacOS/NPad' : '$ROOT/npad';
	const cli = platform === 'darwin' ? '$ROOT/out/cli.js' : '$ROOT/resources/app/out/cli.js';
	return `#!/usr/bin/env bash
set -e
SOURCE="\${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
	DIRECTORY="$(cd -P -- "$(dirname -- "$SOURCE")" && pwd)"
	SOURCE="$(readlink "$SOURCE")"
	[[ "$SOURCE" != /* ]] && SOURCE="$DIRECTORY/$SOURCE"
done
ROOT="$(cd -P -- "$(dirname -- "$SOURCE")/.." && pwd)"
export VSCODE_NODE_OPTIONS="\${NODE_OPTIONS-}"
export VSCODE_NODE_REPL_EXTERNAL_MODULE="\${NODE_REPL_EXTERNAL_MODULE-}"
unset NODE_OPTIONS NODE_REPL_EXTERNAL_MODULE
ELECTRON_RUN_AS_NODE=1 exec "${executable}" "${cli}" "$@"
`;
}

export const linuxDesktopEntry = `[Desktop Entry]
Type=Application
Name=NPad
Comment=Local text editor
Exec=npad %F
Icon=npad
Terminal=false
Categories=Utility;TextEditor;Development;
MimeType=text/plain;application/json;text/markdown;
StartupNotify=true
StartupWMClass=NPad
`;

export function getMacMetadata(version: string): Record<string, unknown> {
	return {
		CFBundleName: 'NPad',
		CFBundleDisplayName: 'NPad',
		CFBundleExecutable: 'NPad',
		CFBundleIdentifier: 'org.npad.editor',
		CFBundleIconFile: 'npad.icns',
		CFBundleShortVersionString: version,
		CFBundleVersion: version,
		LSApplicationCategoryType: 'public.app-category.productivity',
		CFBundleDocumentTypes: [{
			CFBundleTypeName: 'Text document',
			CFBundleTypeRole: 'Editor',
			LSHandlerRank: 'Alternate',
			LSItemContentTypes: ['public.text'],
		}],
		CFBundleURLTypes: [{ CFBundleURLName: 'NPad', CFBundleURLSchemes: ['npad'] }],
	};
}

async function updatePlist(file: string, values: Record<string, unknown>): Promise<void> {
	for (const [key, value] of Object.entries(values)) {
		await executeFile('/usr/bin/plutil', ['-replace', key, '-json', JSON.stringify(value), file]);
	}
}

export async function packageUnixDesktop(directory: string): Promise<void> {
	if (buildTarget.platform === 'win32') {
		throw new Error('Unix desktop packaging requires a Linux or macOS build host.');
	}
	const appDir = getAppDirectory(directory);
	const binDir = path.join(buildTarget.platform === 'darwin' ? appDir : directory, 'bin');
	await fs.mkdir(binDir, { recursive: true });
	await fs.writeFile(path.join(binDir, 'npad'), createUnixLauncher(buildTarget.platform), { mode: 0o755 });
	if (buildTarget.platform === 'linux') {
		await fs.rename(path.join(directory, 'electron'), getExecutablePath(directory));
		await fs.chmod(getExecutablePath(directory), 0o755);
		await fs.copyFile(path.join(root, 'resources', 'npad', 'code.png'), path.join(directory, 'npad.png'));
		await fs.writeFile(path.join(directory, 'npad.desktop'), linuxDesktopEntry);
		return;
	}

	const bundle = path.join(directory, 'NPad.app');
	const contents = path.join(bundle, 'Contents');
	await fs.rename(path.join(contents, 'MacOS', 'Electron'), getExecutablePath(directory));
	await updatePlist(path.join(contents, 'Info.plist'), getMacMetadata(packageJson.version));
	const frameworks = path.join(contents, 'Frameworks');
	for (const entry of await fs.readdir(frameworks)) {
		const match = /^Electron Helper(?: \(([^)]+)\))?\.app$/.exec(entry);
		if (!match) {
			continue;
		}
		const name = entry.slice(0, -4).replace('Electron Helper', 'NPad Helper');
		const helperContents = path.join(frameworks, entry, 'Contents');
		await fs.rename(path.join(helperContents, 'MacOS', entry.slice(0, -4)), path.join(helperContents, 'MacOS', name));
		await updatePlist(path.join(helperContents, 'Info.plist'), {
			CFBundleName: name,
			CFBundleDisplayName: name,
			CFBundleExecutable: name,
			CFBundleIdentifier: `org.npad.editor.helper${match[1] ? `.${match[1]}` : ''}`,
		});
		await fs.rename(path.join(frameworks, entry), path.join(frameworks, `${name}.app`));
	}
	for (const notice of ['LICENSE', 'LICENSES.chromium.html']) {
		await fs.copyFile(path.join(directory, notice), path.join(contents, 'Resources', notice));
	}
	const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-icons-'));
	try {
		const iconset = path.join(temporary, 'npad.iconset');
		await fs.mkdir(iconset);
		for (const size of [16, 32, 128, 256, 512]) {
			for (const scale of [1, 2]) {
				await executeFile('/usr/bin/sips', [
					'--resampleHeightWidth', String(size * scale), String(size * scale),
					path.join(root, 'resources', 'npad', 'code.png'),
					'--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
				]);
			}
		}
		await executeFile('/usr/bin/iconutil', ['--convert', 'icns', '--output', path.join(contents, 'Resources', 'npad.icns'), iconset]);
	} finally {
		await fs.rm(temporary, { recursive: true, force: true });
	}
	// Renaming executables and editing plists invalidates Electron's original signatures.
	await executeFile('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle]);
	await executeFile('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
}
