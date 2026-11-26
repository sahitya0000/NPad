/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';

export interface BuildTarget {
	readonly platform: 'win32' | 'linux' | 'darwin';
	readonly arch: 'x64' | 'arm64';
}

export function getBuildTarget(platform: string = process.platform, arch: string = process.arch): BuildTarget {
	if ((platform === 'win32' && arch === 'x64') || ((platform === 'linux' || platform === 'darwin') && (arch === 'x64' || arch === 'arm64'))) {
		return { platform, arch };
	}
	throw new Error(`Unsupported NPad build host: ${platform}-${arch}. Use Windows x64, Linux x64/arm64, or macOS x64/arm64 with native dependencies installed on that host.`);
}

export const buildTarget = getBuildTarget();
export const distributionDir = path.resolve(import.meta.dirname, '../../.build/npad', `${buildTarget.platform}-${buildTarget.arch}`);

export function getAppDirectory(directory = distributionDir, target = buildTarget): string {
	return target.platform === 'darwin'
		? path.join(directory, 'NPad.app', 'Contents', 'Resources', 'app')
		: path.join(directory, 'resources', 'app');
}

export function getExecutablePath(directory = distributionDir, target = buildTarget): string {
	switch (target.platform) {
		case 'win32': return path.join(directory, 'NPad.exe');
		case 'linux': return path.join(directory, 'npad');
		case 'darwin': return path.join(directory, 'NPad.app', 'Contents', 'MacOS', 'NPad');
	}
}

export function getElectronExecutable(directory: string, target = buildTarget): string {
	switch (target.platform) {
		case 'win32': return path.join(directory, 'electron.exe');
		case 'linux': return path.join(directory, 'electron');
		case 'darwin': return path.join(directory, 'Electron.app', 'Contents', 'MacOS', 'Electron');
	}
}
