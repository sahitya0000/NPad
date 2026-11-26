/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { getProductionDependencies } from '../../lib/dependencies.ts';
import { includePackageFile, isNPadExtension } from '../package.ts';
import { buildTarget, distributionDir, getAppDirectory, getBuildTarget } from '../platform.ts';
import config from '../config.json' with { type: 'json' };

const root = path.resolve(import.meta.dirname, '../../..');

test('all NPad entry points and explicitly loaded resources are present locally', async () => {
	for (const file of [
		...config.entryPoints.map(entry => `${entry}.ts`),
		...config.resources,
		'main.ts', 'mainImpl.ts', 'cli.ts', 'bootstrap-fork.ts',
	]) {
		await fs.access(path.join(root, 'src', file));
	}
	assert.ok(!config.resources.some(file => /\/(?:chat|sessions|terminal|debug|welcomeOnboarding)\//.test(file)));
	for (const excluded of ['cli', 'remote', 'test', 'extensions/copilot', 'extensions/git', 'extensions/typescript-language-features', 'src/vs/sessions']) {
		await assert.rejects(fs.access(path.join(root, excluded)), { code: 'ENOENT' });
	}
});

test('production dependency closure preserves nested versions without including build tools', async t => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-dependencies-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	async function manifest(relative: string, value: object) {
		const location = path.join(directory, relative);
		await fs.mkdir(location, { recursive: true });
		await fs.writeFile(path.join(location, 'package.json'), JSON.stringify(value));
		return location;
	}
	const first = await manifest('node_modules/first', { name: 'first', dependencies: { shared: '1' }, optionalDependencies: { unavailable: '1' } });
	const second = await manifest('node_modules/second', { name: 'second', dependencies: { shared: '2' } });
	const shared = await manifest('node_modules/shared', { name: 'shared', version: '1' });
	const nested = await manifest('node_modules/second/node_modules/shared', { name: 'shared', version: '2' });
	await manifest('node_modules/build-only', { name: 'build-only' });
	assert.deepStrictEqual(getProductionDependencies(directory, ['first', 'second']), [first, second, shared, nested].sort());
	assert.throws(() => getProductionDependencies(directory, ['missing']), /Missing dependency missing/);
});

test('bundle inputs resolve inside the standalone repository', async () => {
	const file = path.join(root, 'out-npad', 'npad-build.json');
	// This assertion intentionally requires a real build, not a prebuilt upstream bundle.
	const metadata: { inputs: string[] } = JSON.parse(await fs.readFile(file, 'utf8'));
	for (const input of metadata.inputs.filter(file => !file.startsWith('npad-excluded-contribution:'))) {
		assert.ok(!path.isAbsolute(input), `Absolute build input: ${input}`);
		const resolved = path.resolve(root, input);
		assert.ok(!path.relative(root, resolved).startsWith('..'), `External build input: ${input}`);
		await fs.access(resolved);
	}
});

test('packaging excludes native build intermediates and foreign-platform search binaries', () => {
	const directory = path.join(root, 'node_modules', 'example');
	const included = (file: string, name?: string) => includePackageFile(path.join(directory, file), directory, name, getBuildTarget('win32', 'x64'));
	for (const file of ['build/Release/addon.node', 'lib/index.js', 'LICENSE', 'bin/tool.exe', 'wasm/parser.wasm']) {
		assert.ok(included(file), `Required runtime file excluded: ${file}`);
	}
	for (const file of ['build/Release/addon.iobj', 'build/Release/addon.ipdb', 'build/Release/addon.lib', 'src/addon.cc', 'include/addon.h', 'lib/index.d.ts', 'index.js.map', 'test/index.js']) {
		assert.ok(!included(file), `Build-only file included: ${file}`);
	}
	assert.ok(included('bin/win32-x64/rg.exe', '@vscode/ripgrep-universal'));
	assert.ok(!included('bin/linux-x64/rg', '@vscode/ripgrep-universal'));
	assert.ok(!included('bin/win32-arm64/rg.exe', '@vscode/ripgrep-universal'));
	assert.ok(included('prebuilds/win32-x64/addon.node'));
	assert.ok(!included('prebuilds/darwin-arm64/addon.node'));
	assert.ok(!isNPadExtension({ name: 'notebook-renderers', version: '1.0.0', publisher: 'vscode' }));
});

test('packaged extensions retain their preview resources without notebook/chat renderer contributions', async () => {
	const extensions = path.join(getAppDirectory(), 'extensions');
	for (const name of ['configuration-editing', 'markdown-language-features', 'markdown-math', 'mermaid-markdown-features']) {
		const directory = path.join(extensions, name);
		const manifest: {
			main: string;
			contributes?: {
				'markdown.previewScripts'?: (string | { path: string })[];
				'markdown.previewStyles'?: string[];
				notebookRenderer?: object[];
				chatOutputRenderers?: object[];
			};
		} = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
		await fs.access(path.resolve(directory, manifest.main + (path.extname(manifest.main) ? '' : '.js')));
		for (const key of ['markdown.previewScripts', 'markdown.previewStyles'] as const) {
			for (const resource of manifest.contributes?.[key] ?? []) {
				await fs.access(path.resolve(directory, typeof resource === 'string' ? resource : resource.path));
			}
		}
		assert.equal(manifest.contributes?.notebookRenderer, undefined);
		assert.equal(manifest.contributes?.chatOutputRenderers, undefined);
	}
	await fs.access(path.join(extensions, 'markdown-math', 'preview-styles', 'fonts', 'KaTeX_Main-Regular.woff2'));
	await fs.access(path.join(extensions, 'mermaid-markdown-features', 'chat-webview-out', 'index-editor.js'));
	await assert.rejects(fs.access(path.join(extensions, 'notebook-renderers')), { code: 'ENOENT' });
});

test('native packages retain the host search binary and relocatable macOS framework links', async () => {
	const bin = path.join(getAppDirectory(), 'node_modules', '@vscode', 'ripgrep-universal', 'bin');
	assert.deepStrictEqual(await fs.readdir(bin), [`${buildTarget.platform}-${buildTarget.arch}`]);
	await fs.access(path.join(bin, `${buildTarget.platform}-${buildTarget.arch}`, buildTarget.platform === 'win32' ? 'rg.exe' : 'rg'));
	if (buildTarget.platform === 'darwin') {
		const framework = path.join(distributionDir, 'NPad.app', 'Contents', 'Frameworks', 'Electron Framework.framework');
		const link = path.join(framework, 'Versions', 'Current');
		assert.ok((await fs.lstat(link)).isSymbolicLink());
		assert.ok(!path.isAbsolute(await fs.readlink(link)), 'Framework links must survive moving or archiving the application.');
	}
});
