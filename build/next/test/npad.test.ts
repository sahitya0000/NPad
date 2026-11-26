/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { suite, test } from 'node:test';
import { createNPadProduct, isNPadEntryPoint, isNPadExcludedImport, npadContributionsPlugin } from '../npad.ts';
import { getBundleOptions } from '../bundle.ts';
import { compileStandaloneFiles } from '../standalone.ts';
import { getExternalPackageName, isNPadExtension } from '../../npad/package.ts';
import { isNPadMainThreadCustomer } from '../../../src/vs/workbench/api/common/npadApi.ts';
import { isConfigurationPropertyVisible } from '../../../src/vs/platform/configuration/common/npadConfiguration.ts';
import product from '../../../product.json' with { type: 'json' };

const repoRoot = path.resolve(import.meta.dirname, '../../..');

suite('NPad edition bundle', () => {
	test('hides workspace trust preferences in NPad without changing standard Code settings', () => {
		for (const key of ['security.workspace.trust.enabled', 'security.workspace.trust.startupPrompt', 'security.workspace.trust.untrustedFiles', 'security.workspace.trust.banner']) {
			assert.equal(isConfigurationPropertyVisible(key, true), false, key);
			assert.equal(isConfigurationPropertyVisible(key, false), true, key);
		}
		assert.equal(isConfigurationPropertyVisible('security.allowedUNCHosts', true), true);
	});

	test('provides transparent PNG artwork and multi-resolution Windows icon frames', async () => {
		const png = await fs.promises.readFile(path.join(repoRoot, 'resources', 'npad', 'code.png'));
		const ico = await fs.promises.readFile(path.join(repoRoot, 'resources', 'npad', 'code.ico'));
		const frames = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
			const entry = 6 + index * 16;
			const offset = ico.readUInt32LE(entry + 12);
			const length = ico.readUInt32LE(entry + 8);
			const image = ico.subarray(offset, offset + length);
			assert.deepStrictEqual(image.subarray(0, 8), png.subarray(0, 8));
			return { width: image.readUInt32BE(16), height: image.readUInt32BE(20), depth: ico.readUInt16LE(entry + 6) };
		});
		assert.deepStrictEqual({
			png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20), colorType: png[25] },
			ico: { reserved: ico.readUInt16LE(0), type: ico.readUInt16LE(2), frames },
		}, {
			png: { width: 1024, height: 1024, colorType: 6 },
			ico: { reserved: 0, type: 1, frames: [16, 20, 24, 32, 40, 48, 64, 128, 256].map(size => ({ width: size, height: size, depth: 32 })) },
		});
	});

	test('uses the selected notepad artwork for the title bar and all landing-page themes', async () => {
		const result = await esbuild.build({
			entryPoints: [
				'src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css',
				'src/vs/workbench/browser/parts/editor/media/editorgroupview.css',
			],
			bundle: true,
			write: false,
			outdir: 'out-npad-icon-test',
			loader: { '.svg': 'file', '.png': 'file' },
			plugins: [npadContributionsPlugin(path.join(repoRoot, 'src'))],
			metafile: true,
		});
		const artwork = result.outputFiles!.find(file => file.path.endsWith('.png'));
		assert.ok(artwork, 'The selected PNG artwork must be emitted for the title bar');
		assert.deepStrictEqual(Buffer.from(artwork.contents), await fs.promises.readFile(path.join(repoRoot, 'resources', 'npad', 'code.png')));
		assert.ok(Object.keys(result.metafile!.inputs).some(file => file.endsWith('resources/npad/code.png')));
		assert.ok(!Object.keys(result.metafile!.inputs).some(file => /(?:code-icon|letterpress-[^/]+)\.svg$/.test(file)));
	});

	test('uses NPad application wording and theme labels while preserving extension identity', async () => {
		const directory = path.join(repoRoot, 'extensions', 'theme-modern-icons');
		const manifest: {
			name: string;
			publisher: string;
			engines: { vscode: string };
			contributes: { iconThemes: { id: string; path: string }[] };
		} = JSON.parse(await fs.promises.readFile(path.join(directory, 'package.json'), 'utf8'));
		const labels: Record<string, string> = JSON.parse(await fs.promises.readFile(path.join(directory, 'package.nls.json'), 'utf8'));
		assert.equal(labels.displayName, 'NPad Modern File Icons');
		assert.equal(labels.themeLabel, 'NPad Modern Icons');
		assert.equal(manifest.name, 'vscode-modern-icons');
		assert.equal(manifest.publisher, 'vscode');
		assert.equal(manifest.engines.vscode, '*');
		assert.equal(manifest.contributes.iconThemes[0].id, 'vscode-modern-icons');
		assert.equal(manifest.contributes.iconThemes[0].path, './fileicons/npad-modern-icons-icon-theme.json');
		await fs.promises.access(path.resolve(directory, manifest.contributes.iconThemes[0].path));
		for (const [name, key, expected] of [
			['theme-seti', 'themeLabel', 'Seti (NPad)'],
			['theme-defaults', 'minimalIconThemeLabel', 'Minimal (NPad)'],
		] as const) {
			const strings: Record<string, string> = JSON.parse(await fs.promises.readFile(path.join(repoRoot, 'extensions', name, 'package.nls.json'), 'utf8'));
			assert.equal(strings[key], expected);
		}
		const bootstrap = await fs.promises.readFile(path.join(repoRoot, 'src', 'mainImpl.ts'), 'utf8');
		assert.ok(bootstrap.includes('command line arguments to NPad.'));
		assert.ok(bootstrap.includes('Changing this file requires a restart of NPad.'));
	});

	test('NPad has an independent desktop, storage and installer identity', async () => {
		const npad = createNPadProduct(product);
		assert.deepStrictEqual({
			short: npad.nameShort, long: npad.nameLong, app: npad.applicationName,
			data: npad.dataFolderName, shared: npad.sharedDataFolderName, protocol: npad.urlProtocol,
			mutex: npad.win32MutexName, directory: npad.win32DirName, registry: npad.win32RegValueName,
			taskbar: npad.win32AppUserModelId, shell: npad.win32ShellNameShort,
			mac: npad.darwinBundleIdentifier, linux: npad.linuxDesktopName, icon: npad.linuxIconName,
		}, {
			short: 'NPad', long: 'NPad', app: 'npad',
			data: '.npad', shared: '.npad-shared', protocol: 'npad',
			mutex: 'npad', directory: 'NPad', registry: 'NPad',
			taskbar: 'NPad.Editor', shell: 'N&Pad',
			mac: 'org.npad.editor', linux: 'npad', icon: 'npad',
		});
		const installer = await fs.promises.readFile(path.join(repoRoot, 'build', 'npad', 'installer.iss'), 'utf8');
		assert.ok(installer.includes(`AppId=${npad.win32x64AppId}`));
		assert.equal(installer.split(`AppUserModelID: "${npad.win32AppUserModelId}"`).length - 1, 2);
		assert.ok(installer.includes('AppName=NPad'));
		assert.ok(installer.includes('OutputBaseFilename=NPadSetup-x64-'));
		assert.doesNotMatch(installer, /1B1F4941-C1EC-418D-88B8-C59AE3CBE88A/);
	});

	test('omits the integrated browser preload while retaining application sandbox preloads', async t => {
		const outDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'npad-preloads-'));
		t.after(() => fs.promises.rm(outDir, { recursive: true, force: true }));
		await compileStandaloneFiles(path.join(repoRoot, 'src'), outDir, 'desktop', true, undefined, isNPadEntryPoint);
		const files = await fs.promises.readdir(outDir, { recursive: true });
		assert.deepStrictEqual(files.filter(file => /\.(js|map)$/.test(file)).map(file => file.replaceAll('\\', '/')).sort(), [
			'vs/base/parts/sandbox/electron-browser/preload-aux.js',
			'vs/base/parts/sandbox/electron-browser/preload-aux.js.map',
			'vs/base/parts/sandbox/electron-browser/preload.js',
			'vs/base/parts/sandbox/electron-browser/preload.js.map',
		]);
	});

	test('keeps required product compatibility metadata while declaring an immutable NPad edition', () => {
		const npad = createNPadProduct(product);
		assert.deepStrictEqual({ isNPad: npad.isNPad, accountSchema: npad.defaultChatAgent, reportIssueUrl: npad.reportIssueUrl, originalIssueUrl: product.reportIssueUrl }, {
			isNPad: true,
			accountSchema: product.defaultChatAgent,
			reportIssueUrl: undefined,
			originalIssueUrl: 'https://github.com/microsoft/vscode/issues/new',
		});
	});

	test('matches unsupported bridge module names and protocol actor aliases', () => {
		const excluded = [
			'MainThreadChatCodeMapper', 'MainThreadCodeMapper', 'MainThreadLanguageModelTools',
			'MainThreadChatSkills', 'MainThreadSpeech', 'MainThreadSpeechProvider',
			'MainThreadMcp', 'MainThreadMcpShape', 'MainThreadGitExtensionService',
			'MainThreadGitExtension', 'MainThreadDebugService', 'MainThreadTerminalService',
			'MainThreadBrowsers', 'MainThreadBrowserTunnelProxy',
		];
		const retained = ['MainThreadDocuments', 'MainThreadTextEditors', 'MainThreadWebviews', 'MainThreadCustomEditors', 'MainThreadLanguageFeatures'];
		assert.deepStrictEqual({
			unexpectedBridges: excluded.filter(isNPadMainThreadCustomer),
			missingBridges: retained.filter(identifier => !isNPadMainThreadCustomer(identifier)),
		}, { unexpectedBridges: [], missingBridges: [] });
	});

	test('packages only bundled editing and preview extensions, without semantic language servers', () => {
		const names = [
			['typescript-basics', false], ['theme-defaults', false], ['configuration-editing', true], ['markdown-language-features', true],
			['markdown-math', true], ['mermaid-markdown-features', true], ['simple-browser', true],
			['typescript-language-features', true], ['git', true], ['ipynb', false], ['prompt-basics', false],
		] as const;
		assert.deepStrictEqual(names.filter(([name, code]) => isNPadExtension({ name, version: '1.0.0', publisher: 'vscode', main: code ? './out/extension.js' : undefined })).map(([name]) => name), [
			'typescript-basics', 'theme-defaults', 'configuration-editing', 'markdown-language-features', 'markdown-math', 'mermaid-markdown-features',
		]);
	});

	test('distinguishes shipped npm dependencies from builtins, Electron modules, and embedded resources', () => {
		const specifiers = ['node:fs', 'fs/promises', 'electron', 'original-fs', 'vscode', './relative.js', 'data:image/svg+xml,test', '@vscode/spdlog', '@vscode/spdlog/build/Release/spdlog.node', 'minimist/index.js'];
		assert.deepStrictEqual(specifiers.map(getExternalPackageName), [undefined, undefined, undefined, undefined, undefined, undefined, undefined, '@vscode/spdlog', '@vscode/spdlog', 'minimist']);
	});
	test('excludes editing-unrelated contribution roots', () => {
		const features = [
			'chat', 'inlineChat', 'agentsVoice', 'mcp', 'remote', 'remoteTunnel', 'debug',
			'notebook', 'interactive', 'testing', 'terminal', 'tasks', 'scm', 'git',
			'extensions', 'callHierarchy', 'typeHierarchy', 'codeActions', 'userDataSync',
			'authentication', 'userDataProfile', 'editSessions', 'timeline', 'outline', 'markers', 'output', 'telemetry',
			'surveys', 'welcomeGettingStarted', 'welcomeOnboarding', 'onboarding', 'browserView',
		];
		assert.deepStrictEqual(features.filter(feature => !isNPadExcludedImport(`vs/workbench/contrib/${feature}/browser/example.js`)), []);
	});

	test('preserves previews, custom editors, recovery, accessibility, and shared service registrations', () => {
		const modules = [
			'vs/workbench/contrib/webview/browser/webview.contribution.js',
			'vs/workbench/contrib/webviewPanel/browser/webviewPanel.contribution.js',
			'vs/workbench/contrib/webviewView/browser/webviewView.contribution.js',
			'vs/workbench/contrib/customEditor/browser/customEditor.contribution.js',
			'vs/workbench/contrib/mediaPreview/browser/mediaPreview.contribution.js',
			'vs/workbench/contrib/markdown/browser/markdown.contribution.js',
			'vs/workbench/contrib/localHistory/browser/localHistory.contribution.js',
			'vs/workbench/contrib/accessibility/browser/accessibility.contribution.js',
			'vs/workbench/contrib/scm/browser/scm.service.contribution.js',
			'vs/workbench/contrib/timeline/browser/timeline.service.contribution.js',
			'vs/workbench/contrib/notebook/browser/notebook.service.contribution.js',
			'vs/workbench/contrib/output/browser/output.service.contribution.js',
			'vs/workbench/contrib/search/browser/search.contribution.js',
			'vs/editor/browser/widget/diffEditor/diffEditor.contribution.js',
			'vs/editor/contrib/find/browser/findController.js',
		];
		assert.deepStrictEqual(modules.filter(isNPadExcludedImport), []);
	});

	test('omits dedicated execution workers and the Agents window, but keeps preview and editing workers', () => {
		const entries = [
			'vs/sessions/sessions.desktop.main',
			'vs/platform/agentHost/node/agentHostMain',
			'vs/platform/terminal/node/ptyHostMain',
			'vs/platform/localTranscription/node/localTranscriptionMain',
			'vs/workbench/contrib/notebook/common/services/notebookWebWorkerMain',
			'vs/workbench/contrib/debug/node/telemetryApp',
			'vs/platform/browserView/electron-browser/preload',
			'vs/workbench/workbench.desktop.main',
			'vs/editor/common/services/editorWebWorkerMain',
			'vs/workbench/contrib/mediaPreview/browser/imageEncoderWorkerMain',
			'vs/workbench/api/node/extensionHostProcess',
		];
		assert.deepStrictEqual(entries.filter(isNPadEntryPoint), entries.slice(7));
	});

	test('uses separate data directories and removes cloud product endpoints without mutating the standard product', () => {
		const original = { nameShort: 'Code - OSS', dataFolderName: '.vscode-oss', enableTelemetry: true };
		const npad = createNPadProduct(original);
		assert.deepStrictEqual({
			original,
			name: npad.nameShort,
			data: npad.dataFolderName,
			protocol: npad.urlProtocol,
			telemetry: npad.enableTelemetry,
			levels: npad.enabledTelemetryLevels,
			builtins: npad.builtInExtensions,
			gallery: npad.extensionsGallery,
			chat: npad.defaultChatAgent,
			sync: npad['configurationSync.store'],
		}, {
			original: { nameShort: 'Code - OSS', dataFolderName: '.vscode-oss', enableTelemetry: true },
			name: 'NPad',
			data: '.npad',
			protocol: 'npad',
			telemetry: false,
			levels: { error: false, usage: false },
			builtins: [],
			gallery: undefined,
			chat: undefined,
			sync: undefined,
		});
	});

	test('filters bare imports only, retaining named dependencies and unaudited consumers', async t => {
		// esbuild reports real paths, so resolve symlinked temporary roots such as /var on macOS.
		const srcDir = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'npad-')));
		t.after(() => fs.promises.rm(srcDir, { recursive: true, force: true }));
		const files = {
			'vs/workbench/workbench.common.main.ts': [
				`import './contrib/chat/browser/removed.js';`,
				`import { value } from './contrib/chat/browser/shared.js';`,
				`import './contrib/markdown/browser/preview.js';`,
				`import './contrib/notebook/browser/notebook.contribution.js';`,
				`import './contrib/outline/browser/outline.contribution.js';`,
				`import './contrib/markers/browser/markers.contribution.js';`,
				`import './contrib/output/browser/output.contribution.js';`,
				'export { value };',
			].join('\n'),
			'vs/workbench/contrib/chat/browser/removed.ts': `throw new Error('Removed contribution executed');`,
			'vs/workbench/contrib/chat/browser/shared.ts': 'export const value = 42;',
			'vs/workbench/contrib/markdown/browser/preview.ts': 'globalThis.previewLoaded = true;',
			'vs/workbench/contrib/notebook/browser/notebook.contribution.ts': `throw new Error('Notebook UI contribution executed');`,
			'vs/workbench/contrib/notebook/browser/notebook.service.contribution.ts': 'globalThis.notebookModelsLoaded = true;',
			'vs/workbench/contrib/outline/browser/outline.contribution.ts': `throw new Error('Outline contribution executed');`,
			'vs/workbench/contrib/markers/browser/markers.contribution.ts': `throw new Error('Problems contribution executed');`,
			'vs/workbench/contrib/output/browser/output.contribution.ts': `throw new Error('Output contribution executed');`,
			'vs/workbench/contrib/output/browser/output.service.contribution.ts': 'globalThis.outputModelsLoaded = true;',
		};
		for (const [file, contents] of Object.entries(files)) {
			const target = path.join(srcDir, file);
			await fs.promises.mkdir(path.dirname(target), { recursive: true });
			await fs.promises.writeFile(target, contents);
		}
		const result = await esbuild.build({
			...getBundleOptions(false, 'neutral'),
			entryPoints: [path.join(srcDir, 'vs/workbench/workbench.common.main.ts')],
			outfile: path.join(srcDir, 'bundle.js'),
			plugins: [npadContributionsPlugin(srcDir)],
			metafile: true,
		});
		const inputs = Object.keys(result.metafile!.inputs);
		assert.deepStrictEqual({
			removed: inputs.some(input => input.endsWith('removed.ts')),
			shared: inputs.some(input => input.endsWith('shared.ts')),
			preview: inputs.some(input => input.endsWith('preview.ts')),
			notebookModels: inputs.some(input => input.endsWith('notebook.service.contribution.ts')),
			notebookUI: inputs.some(input => input.endsWith('/notebook.contribution.ts')),
			outline: inputs.some(input => input.endsWith('/outline.contribution.ts')),
			problems: inputs.some(input => input.endsWith('/markers.contribution.ts')),
			outputUI: inputs.some(input => input.endsWith('/output.contribution.ts')),
			outputModels: inputs.some(input => input.endsWith('/output.service.contribution.ts')),
		}, { removed: false, shared: true, preview: true, notebookModels: true, notebookUI: false, outline: false, problems: false, outputUI: false, outputModels: true });

		const unfiltered = await esbuild.build({
			...getBundleOptions(false, 'neutral'),
			entryPoints: [path.join(srcDir, 'vs/workbench/contrib/chat/browser/removed.ts')],
			outfile: path.join(srcDir, 'unfiltered.js'),
			plugins: [npadContributionsPlugin(srcDir)],
		});
		assert.match(unfiltered.outputFiles![0].text, /Removed contribution executed/);
	});

	test('bundles the actual editor core with find, multicursor, diff, and completion but without semantic contribution roots', async () => {
		const result = await esbuild.build({
			...getBundleOptions(false, 'neutral'),
			entryPoints: [path.join(repoRoot, 'src/vs/editor/editor.all.ts')],
			outfile: path.join(repoRoot, 'out-test/npad-editor.js'),
			plugins: [
				npadContributionsPlugin(path.join(repoRoot, 'src')),
				{ name: 'external-editor-assets', setup(build) { build.onResolve({ filter: /\.(?:css|ttf)$/ }, args => ({ path: args.path, external: true })); } },
			],
			metafile: true,
		});
		const inputs = Object.keys(result.metafile!.inputs).map(input => input.replaceAll('\\', '/'));
		const roots = [
			'src/vs/editor/contrib/find/browser/findController.ts',
			'src/vs/editor/contrib/multicursor/browser/multicursor.ts',
			'src/vs/editor/browser/widget/diffEditor/diffEditor.contribution.ts',
			'src/vs/editor/contrib/suggest/browser/suggestController.ts',
			'src/vs/editor/contrib/rename/browser/rename.ts',
			'src/vs/editor/contrib/codeAction/browser/codeActionContributions.ts',
		];
		assert.deepStrictEqual(roots.map(root => inputs.some(input => input.endsWith(root))), [true, true, true, true, false, false]);
	});
});
