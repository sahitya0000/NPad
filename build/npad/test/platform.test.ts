/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { getAppDirectory, getBuildTarget, getElectronExecutable, getExecutablePath } from '../platform.ts';
import { includePackageFile } from '../package.ts';
import { createUnixLauncher, getMacMetadata, linuxDesktopEntry } from '../unix.ts';
import packageJson from '../../../package.json' with { type: 'json' };

test('native targets have checked Electron archives and consistent application layouts', async () => {
	const checksums = await fs.readFile(path.join(import.meta.dirname, '../electron-checksums.txt'), 'utf8');
	for (const [platform, arch] of [['win32', 'x64'], ['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64']]) {
		const target = getBuildTarget(platform, arch);
		assert.ok(checksums.includes(`electron-v${packageJson.nativeBuild.target}-${platform}-${arch}.zip`));
		const directory = path.resolve('package');
		const executable = getExecutablePath(directory, target);
		const app = getAppDirectory(directory, target);
		assert.equal(path.basename(executable), platform === 'win32' ? 'NPad.exe' : platform === 'darwin' ? 'NPad' : 'npad');
		assert.equal(app, platform === 'darwin'
			? path.join(directory, 'NPad.app', 'Contents', 'Resources', 'app')
			: path.join(directory, 'resources', 'app'));
		assert.equal(path.basename(getElectronExecutable(directory, target)), platform === 'win32' ? 'electron.exe' : platform === 'darwin' ? 'Electron' : 'electron');
	}
	for (const [platform, arch] of [['win32', 'arm64'], ['linux', 'ia32'], ['freebsd', 'x64']]) {
		assert.throws(() => getBuildTarget(platform, arch), /Unsupported NPad build host/);
	}
});

test('native dependency filtering retains only the selected search binaries and prebuilds', () => {
	const directory = path.resolve('dependency');
	for (const platform of ['win32', 'linux', 'darwin']) {
		for (const arch of platform === 'win32' ? ['x64'] : ['x64', 'arm64']) {
			const target = getBuildTarget(platform, arch);
			for (const candidate of ['win32-x64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']) {
				const expected = candidate === `${platform}-${arch}`;
				assert.equal(includePackageFile(path.join(directory, 'bin', candidate, 'rg'), directory, '@vscode/ripgrep-universal', target), expected);
				assert.equal(includePackageFile(path.join(directory, 'prebuilds', candidate, 'addon.node'), directory, undefined, target), expected);
			}
			assert.ok(includePackageFile(path.join(directory, 'bin'), directory, '@vscode/ripgrep-universal', target));
			assert.ok(includePackageFile(path.join(directory, 'build', 'Release', 'addon.node'), directory, undefined, target));
		}
	}
});

test('Unix launchers preserve arguments and sandboxing and use the correct packaged CLI', () => {
	for (const platform of ['linux', 'darwin'] as const) {
		const launcher = createUnixLauncher(platform);
		assert.match(launcher, /^#!\/usr\/bin\/env bash\nset -e/);
		assert.ok(launcher.includes('ELECTRON_RUN_AS_NODE=1 exec'));
		assert.ok(launcher.includes('"$@"'));
		assert.ok(launcher.includes('while [ -L "$SOURCE" ]'));
		assert.doesNotMatch(launcher, /--no-sandbox|disable-chromium-sandbox/);
		assert.ok(launcher.includes(platform === 'darwin' ? '$ROOT/../../MacOS/NPad' : '$ROOT/npad'));
		assert.ok(launcher.includes(platform === 'darwin' ? '$ROOT/out/cli.js' : '$ROOT/resources/app/out/cli.js'));
	}
	assert.match(linuxDesktopEntry, /Exec=npad %F\n/);
	assert.match(linuxDesktopEntry, /Icon=npad\n/);
});

test('Unix launchers work through symlinks in paths containing spaces', { skip: process.platform === 'win32' }, async t => {
	// Resolve symlinked temporary roots, such as /var on macOS, as esbuild does.
	const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'npad launcher ')));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	for (const platform of ['linux', 'darwin'] as const) {
		const target = getBuildTarget(platform, 'x64');
		const distribution = path.join(directory, platform);
		const executable = getExecutablePath(distribution, target);
		const app = getAppDirectory(distribution, target);
		const bin = path.join(platform === 'darwin' ? app : distribution, 'bin');
		await fs.mkdir(path.dirname(executable), { recursive: true });
		await fs.mkdir(bin, { recursive: true });
		await fs.writeFile(executable, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$ELECTRON_RUN_AS_NODE" "$VSCODE_NODE_OPTIONS" "${NODE_OPTIONS-unset}" "$@"\n', { mode: 0o755 });
		const launcher = path.join(bin, 'npad');
		await fs.writeFile(launcher, createUnixLauncher(platform), { mode: 0o755 });
		const link = path.join(directory, `${platform}-link`);
		await fs.symlink(launcher, link);
		const { stdout } = await promisify(execFile)(link, ['file with spaces.txt', '--flag'], {
			env: { ...process.env, NODE_OPTIONS: '--trace-warnings' },
		});
		const [runAsNode, options, originalOptions, cli, ...args] = stdout.trim().split('\n');
		assert.equal(runAsNode, '1');
		assert.equal(options, '--trace-warnings');
		assert.equal(originalOptions, 'unset');
		assert.equal(path.resolve(cli), path.join(app, 'out', 'cli.js'));
		assert.deepStrictEqual(args, ['file with spaces.txt', '--flag']);
	}
});

test('macOS metadata has independent bundle, document, URL, and icon identities', () => {
	const metadata = getMacMetadata(packageJson.version);
	assert.equal(metadata.CFBundleExecutable, 'NPad');
	assert.equal(metadata.CFBundleIdentifier, 'org.npad.editor');
	assert.equal(metadata.CFBundleIconFile, 'npad.icns');
	assert.equal(metadata.CFBundleVersion, packageJson.version);
	assert.deepStrictEqual(metadata.CFBundleURLTypes, [{ CFBundleURLName: 'NPad', CFBundleURLSchemes: ['npad'] }]);
	assert.deepStrictEqual(metadata.CFBundleDocumentTypes, [{
		CFBundleTypeName: 'Text document', CFBundleTypeRole: 'Editor', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.text'],
	}]);
});
