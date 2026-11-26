/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as asar from 'asar';
import rceditCallback from 'rcedit';
import { isBuiltin } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getProductionDependencies } from '../lib/dependencies.ts';
import { createNPadProduct } from '../next/npad.ts';
import { buildTarget, distributionDir, getAppDirectory, getElectronExecutable, getExecutablePath, type BuildTarget } from './platform.ts';
import { packageUnixDesktop } from './unix.ts';
import product from '../../product.json' with { type: 'json' };
import packageJson from '../../package.json' with { type: 'json' };

const root = path.resolve(import.meta.dirname, '../..');
const executeFile = promisify(execFile);
const rcedit = promisify(rceditCallback);

interface PackageManifest {
	name: string;
	version: string;
	main?: string;
	browser?: string;
	publisher?: string;
	enabledApiProposals?: string[];
	contributes?: {
		chatOutputRenderers?: object[];
		languageModelTools?: object[];
		notebookRenderer?: object[];
	};
}

// These browser-loaded modules are resolved by URL, not by esbuild imports.
const browserDependencies = ['vscode-textmate', 'vscode-oniguruma', 'jschardet', '@vscode/iconv-lite-umd', '@vscode/tree-sitter-wasm', '@vscode/vscode-languagedetection', '@vscode/diff'];

export function getExternalPackageName(specifier: string): string | undefined {
	if (isBuiltin(specifier) || /^[a-z][a-z\d+.-]*:/i.test(specifier) || specifier === 'electron' || specifier === 'original-fs' || specifier === 'vscode' || specifier.startsWith('.') || path.isAbsolute(specifier)) {
		return undefined;
	}
	return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}

export function isNPadExtension(manifest: PackageManifest): boolean {
	if (manifest.publisher !== 'vscode' || ['ipynb', 'prompt-basics', 'notebook-renderers'].includes(manifest.name)) {
		return false;
	}
	if (!manifest.main && !manifest.browser) {
		return true;
	}
	return ['configuration-editing', 'markdown-language-features', 'markdown-math', 'mermaid-markdown-features'].includes(manifest.name);
}

function readManifest(directory: string): PackageManifest {
	return JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
}

function collectDependencies(externalImports: readonly string[]): string[] {
	const names = externalImports.map(getExternalPackageName).filter(name => name !== undefined).filter(name => {
		if (Object.hasOwn(packageJson.optionalDependencies, name) && !fs.existsSync(path.join(root, 'node_modules', name, 'package.json'))) {
			console.log(`Optional dependency ${name} is not installed for ${buildTarget.platform}-${buildTarget.arch}; omitting it.`);
			return false;
		}
		return true;
	});
	return getProductionDependencies(root, names);
}

export function includePackageFile(source: string, directory: string, packageName?: string, target: BuildTarget = buildTarget): boolean {
	const relative = path.relative(directory, source).replaceAll('\\', '/');
	const platformDirectory = `${target.platform}-${target.arch}`;
	if (packageName === '@vscode/ripgrep-universal' && relative.startsWith('bin/') && relative.split('/')[1] !== platformDirectory) {
		return false;
	}
	if (/^prebuilds\/[^/]+/.test(relative) && relative.split('/')[1] !== platformDirectory) {
		return false;
	}
	return !relative.split('/').includes('node_modules')
		&& !/(?:^|\/)(?:test|tests|\.git|obj)(?:\/|$)/.test(relative)
		&& !/\.(?:pdb|obj|ilk|map|tsbuildinfo|iobj|ipdb|lib|exp|a|o|c|cc|cpp|h|hpp|gyp|gypi|sln|vcxproj|vcxproj\.filters|d\.ts)$/.test(relative);
}

export async function packageNPad(packageDir = distributionDir): Promise<void> {
	const bundleDir = path.join(root, 'out-npad');
	const metadata: { externalImports: string[] } = JSON.parse(await fs.promises.readFile(path.join(bundleDir, 'npad-build.json'), 'utf8'));
	const dependencies = collectDependencies([...metadata.externalImports, ...browserDependencies]);
	const electronDir = path.join(root, '.build', 'electron');
	await fs.promises.access(getElectronExecutable(electronDir));
	if (fs.existsSync(packageDir)) {
		const previousDir = await fs.promises.mkdtemp(`${packageDir}-previous-`);
		try {
			const previousApp = path.join(previousDir, 'app');
			await fs.promises.rename(packageDir, previousApp);
			await fs.promises.rm(previousApp, { recursive: true, force: true });
		} finally {
			await fs.promises.rmdir(previousDir);
		}
	}
	await fs.promises.cp(electronDir, packageDir, {
		recursive: true,
		verbatimSymlinks: true,
		filter: source => path.basename(source) !== 'default_app.asar',
	});
	if (buildTarget.platform === 'darwin') {
		await fs.promises.rename(path.join(packageDir, 'Electron.app'), path.join(packageDir, 'NPad.app'));
	}
	const appDir = getAppDirectory(packageDir);
	await fs.promises.mkdir(appDir, { recursive: true });
	await fs.promises.cp(path.join(root, 'resources', 'npad'), path.join(appDir, 'resources', 'npad'), { recursive: true });
	await fs.promises.cp(bundleDir, path.join(appDir, 'out'), {
		recursive: true,
		filter: file => !file.endsWith('.map') && path.basename(file) !== 'npad-build.json',
	});
	const npadProduct = { ...createNPadProduct(product), version: packageJson.version, date: new Date().toISOString() };
	await fs.promises.writeFile(path.join(appDir, 'product.json'), JSON.stringify(npadProduct, null, '\t'));
	await fs.promises.writeFile(path.join(appDir, 'package.json'), JSON.stringify({
		name: 'npad',
		version: packageJson.version,
		main: './out/main.js',
		type: 'module',
		license: packageJson.license,
	}, null, '\t'));
	for (const file of ['LICENSE', 'LICENSE.txt', 'ThirdPartyNotices.txt']) {
		await fs.promises.copyFile(path.join(root, file), path.join(appDir, file));
	}
	for (const [name, license] of [['nspell', 'license'], ['dictionary-en', 'license'], ['is-buffer', 'LICENSE']] as const) {
		const notice = await fs.promises.readFile(path.join(root, 'node_modules', name, license), 'utf8');
		await fs.promises.appendFile(path.join(appDir, 'ThirdPartyNotices.txt'), `\n\nOffline English spell checking: ${name}\n\n${notice}\n`);
	}
	for (const directory of dependencies) {
		const name = readManifest(directory).name;
		await fs.promises.cp(directory, path.join(appDir, path.relative(root, directory)), {
			recursive: true,
			verbatimSymlinks: true,
			filter: source => includePackageFile(source, directory, name),
		});
	}
	const browserModules = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'npad-amd-'));
	try {
		for (const name of browserDependencies) {
			const source = path.join(root, 'node_modules', name);
			await fs.promises.cp(source, path.join(browserModules, name), {
				recursive: true,
				filter: file => includePackageFile(file, source),
			});
		}
		await asar.createPackageWithOptions(browserModules, path.join(appDir, 'node_modules.asar'), { unpack: '**/*.wasm' });
	} finally {
		await fs.promises.rm(browserModules, { recursive: true, force: true });
	}
	const extensions = path.join(root, 'extensions');
	for (const entry of await fs.promises.readdir(extensions, { withFileTypes: true })) {
		if (!entry.isDirectory() || !fs.existsSync(path.join(extensions, entry.name, 'package.json'))) {
			continue;
		}
		const source = path.join(extensions, entry.name);
		const manifest = readManifest(source);
		if (!isNPadExtension(manifest)) {
			continue;
		}
		manifest.enabledApiProposals = manifest.enabledApiProposals?.filter(proposal => !/^(?:chat|languageModel|mcp)/i.test(proposal) && proposal !== 'profileContentHandlers');
		if (manifest.contributes) {
			delete manifest.contributes.chatOutputRenderers;
			delete manifest.contributes.languageModelTools;
			delete manifest.contributes.notebookRenderer;
		}
		if (manifest.main) {
			const scripts = ['esbuild.mts', 'esbuild.webview.mts', 'esbuild.markdownEditor.mts'];
			for (const script of scripts) {
				const scriptPath = path.join(source, script);
				if (fs.existsSync(scriptPath)) {
					const { stdout, stderr } = await executeFile(process.execPath, [scriptPath], { cwd: source });
					process.stdout.write(stdout);
					process.stderr.write(stderr);
				}
			}
			manifest.main = manifest.main.replace('/out/', '/dist/');
			await fs.promises.access(path.resolve(source, manifest.main + (path.extname(manifest.main) ? '' : '.js')));
		}
		const destination = path.join(appDir, 'extensions', entry.name);
		await fs.promises.cp(source, destination, {
			recursive: true,
			filter: file => {
				const relative = path.relative(source, file);
				return includePackageFile(file, source)
					&& !relative.split(path.sep).some(segment => segment === 'src' || segment.endsWith('-src') || ['scripts', 'notebook', 'notebook-out'].includes(segment))
					&& relative.replaceAll('\\', '/') !== 'chat-webview-out/index.js'
					&& !/\.(?:ts|mts)$/.test(relative)
					&& !path.basename(file).startsWith('tsconfig');
			},
		});
		await fs.promises.writeFile(path.join(destination, 'package.json'), JSON.stringify(manifest, null, '\t'));
	}
	const executable = getExecutablePath(packageDir);
	if (buildTarget.platform === 'win32') {
		await fs.promises.rename(path.join(packageDir, 'electron.exe'), executable);
		await rcedit(executable, {
			icon: path.join(root, 'resources', 'npad', 'code.ico'),
			'version-string': {
				ProductName: 'NPad',
				FileDescription: 'NPad',
				InternalName: 'npad',
				OriginalFilename: 'NPad.exe',
			},
		});
	} else {
		await packageUnixDesktop(packageDir);
	}
	console.log(`NPad executable: ${executable}`);
}

if (import.meta.main) {
	packageNPad().catch(error => {
		console.error(error);
		process.exitCode = 1;
	});
}
