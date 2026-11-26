/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import packageJson from '../../package.json' with { type: 'json' };
import { buildTarget, distributionDir } from './platform.ts';

/** Registers only text extensions advertised by the editing extensions actually shipped in NPad. */
export async function getFileAssociations(appDir: string): Promise<string[]> {
	const extensionsDir = path.join(appDir, 'resources', 'app', 'extensions');
	const extensions = new Set(['.txt', '.text', '.log']);
	for (const entry of await fs.readdir(extensionsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const manifest: { contributes?: { languages?: { extensions?: string[] }[] } } = JSON.parse(await fs.readFile(path.join(extensionsDir, entry.name, 'package.json'), 'utf8'));
		for (const language of manifest.contributes?.languages ?? []) {
			for (const extension of language.extensions ?? []) {
				// Language matching also accepts filenames/globs and IDE-only document formats.
				if (!extension.startsWith('.') || /[*?]/.test(extension) || ['.code-workspace', '.code-profile', '.ipynb'].includes(extension.toLowerCase())) {
					continue;
				}
				if (!/^\.[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(extension)) {
					throw new Error(`Invalid file association extension: ${extension}`);
				}
				extensions.add(extension.toLowerCase());
			}
		}
	}
	return [...extensions].sort();
}

export async function buildInstaller(): Promise<void> {
	if (buildTarget.platform !== 'win32') {
		throw new Error('Inno Setup requires a Windows build host.');
	}
	const outputDir = path.resolve(import.meta.dirname, '../../.build/npad');
	const extensions = await getFileAssociations(distributionDir);
	const registry = extensions.flatMap(extension => [
		`Root: HKA; Subkey: "Software\\Classes\\${extension}\\OpenWithProgids"; ValueType: string; ValueName: "NPad.Text"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: associatewithfiles`,
		`Root: HKA; Subkey: "Software\\NPad\\Capabilities\\FileAssociations"; ValueType: string; ValueName: "${extension}"; ValueData: "NPad.Text"; Tasks: associatewithfiles`,
		`Root: HKA; Subkey: "Software\\Classes\\Applications\\NPad.exe\\SupportedTypes"; ValueType: string; ValueName: "${extension}"; ValueData: ""; Tasks: associatewithfiles`,
	]);
	const include = path.join(outputDir, 'npad-file-associations.iss');
	await fs.writeFile(include, registry.join('\n') + '\n');
	const require = createRequire(import.meta.url);
	const compiler = path.resolve(path.dirname(require.resolve('innosetup')), '../bin/ISCC.exe');
	try {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(compiler, [
				'/Q', path.join(import.meta.dirname, 'installer.iss'),
				`/DAppVersion=${packageJson.version}`, `/DSourceDir=${distributionDir}`, `/DOutputDir=${outputDir}`,
			], { stdio: 'inherit' });
			child.once('error', reject);
			child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Installer compiler exited with code ${code}`)));
		});
	} finally {
		await fs.rm(include);
	}
	console.log(`Installer: ${path.join(outputDir, `NPadSetup-x64-${packageJson.version}.exe`)}`);
}
