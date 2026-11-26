/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { downloadArtifact } from '@electron/get';
import extract from 'extract-zip';
import { buildTarget } from './platform.ts';
import packageJson from '../../package.json' with { type: 'json' };

const root = path.resolve(import.meta.dirname, '../..');
export const electronDir = path.join(root, '.build', 'electron');

export async function prepareElectron(): Promise<void> {
	const version = packageJson.nativeBuild.target;
	const checksumLines = await fs.readFile(path.join(import.meta.dirname, 'electron-checksums.txt'), 'utf8');
	const checksums = Object.fromEntries(checksumLines.trim().split(/\r?\n/).map(line => {
		const match = /^([a-f\d]{64})\s+\*?(.+)$/.exec(line);
		if (!match) {
			throw new Error(`Invalid Electron checksum entry: ${line}`);
		}
		return [match[2], match[1]];
	}));
	const zip = await downloadArtifact({
		version, platform: buildTarget.platform, arch: buildTarget.arch, artifactName: 'electron', checksums,
	});
	// Always extract the pinned archive, never reuse an unchecked or different runtime.
	await fs.rm(electronDir, { recursive: true, force: true });
	await fs.mkdir(electronDir, { recursive: true });
	await extract(zip, { dir: electronDir });
	console.log(`Prepared Electron ${version}.`);
}

if (import.meta.main) {
	prepareElectron().catch(error => {
		console.error(error);
		process.exitCode = 1;
	});
}
