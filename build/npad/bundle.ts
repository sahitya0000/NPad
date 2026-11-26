/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import { getBundleOptions } from '../next/bundle.ts';
import { createNLSCollector, finalizeNLS, nlsPlugin, postProcessNLS } from '../next/nls-plugin.ts';
import { adjustSourceMap } from '../next/private-to-property.ts';
import { createNPadProduct, npadContributionsPlugin } from '../next/npad.ts';
import { compileStandaloneFiles } from '../next/standalone.ts';
import { optimizeSvgFiles } from '../next/svg.ts';
import { copyResources } from '../next/resources.ts';
import config from './config.json' with { type: 'json' };
import product from '../../product.json' with { type: 'json' };
import packageJson from '../../package.json' with { type: 'json' };

const root = path.resolve(import.meta.dirname, '../..');
const srcDir = path.join(root, 'src');
const outDir = path.join(root, 'out-npad');
const cssEntries = new Set(['vs/workbench/workbench.desktop.main', 'vs/code/electron-browser/workbench/workbench']);

export async function bundleNPad(): Promise<void> {
	await fs.rm(outDir, { recursive: true, force: true });
	await fs.mkdir(outDir, { recursive: true });
	const date = new Date().toISOString();
	await fs.writeFile(path.join(outDir, 'date'), date);
	const collector = createNLSCollector();
	const productConfiguration = JSON.stringify({
		...createNPadProduct(product), version: packageJson.version, commit: config.sourceCommit, date,
	}).slice(1, -1);
	const contentMapper: esbuild.Plugin = {
		name: 'npad-product',
		setup(build) {
			build.onLoad({ filter: /\.ts$/ }, async args => {
				const source = await fs.readFile(args.path, 'utf8');
				if (!source.includes('/*BUILD->INSERT_')) {
					return undefined;
				}
				return {
					contents: source
						.replace('/*BUILD->INSERT_PRODUCT_CONFIGURATION*/', () => productConfiguration)
						.replace('/*BUILD->INSERT_BUILTIN_EXTENSIONS*/', ''),
					loader: 'ts',
				};
			});
		},
	};
	const bootstrapEntries = ['main', 'mainImpl', 'cli', 'bootstrap-fork'];
	const results = await Promise.all([...config.entryPoints, ...bootstrapEntries].map(async entry => {
		const bootstrap = bootstrapEntries.includes(entry);
		const plugins: esbuild.Plugin[] = [
			nlsPlugin({ baseDir: srcDir, collector }), contentMapper, npadContributionsPlugin(srcDir),
		];
		if (!cssEntries.has(entry)) {
			plugins.push({
				name: 'external-css',
				setup(build) {
					build.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, external: true }));
				},
			});
		}
		if (bootstrap) {
			plugins.push({
				name: 'bootstrap',
				setup(build) {
					build.onResolve({ filter: /^minimist$/ }, () => ({
						path: path.join(root, 'node_modules', 'minimist', 'index.js'), external: false,
					}));
					if (entry === 'main') {
						build.onResolve({ filter: /^\.\/mainImpl\.js$/ }, args => ({ path: args.path, external: true }));
					}
				},
			});
		}
		return esbuild.build({
			...getBundleOptions(true, bootstrap ? 'node' : 'neutral'),
			...(entry.endsWith('/npadSpellingWorkerMain') ? {
				packages: 'bundle' as const,
				mainFields: ['browser', 'module', 'main'],
				alias: {
					'dictionary-en/index.aff': path.join(root, 'node_modules', 'dictionary-en', 'index.aff'),
					'dictionary-en/index.dic': path.join(root, 'node_modules', 'dictionary-en', 'index.dic'),
				},
			} : {}),
			absWorkingDir: root,
			entryPoints: [{ in: path.join(srcDir, `${entry}.ts`), out: entry }],
			outdir: outDir,
			loader: { '.ttf': 'file', '.svg': 'file', '.png': 'file', '.sh': 'file', '.aff': 'text', '.dic': 'text' },
			assetNames: 'media/[name]', metafile: true, plugins,
		});
	}));
	const { indexMap } = await finalizeNLS(collector, outDir);
	const inputs = new Set<string>();
	const externalImports = new Set<string>();
	for (const result of results) {
		for (const input of Object.keys(result.metafile!.inputs)) {
			inputs.add(input);
		}
		for (const output of Object.values(result.metafile!.outputs)) {
			for (const dependency of output.imports) {
				if (dependency.external) {
					externalImports.add(dependency.path);
				}
			}
		}
		const sourceMaps = new Map<string, string>();
		for (const file of result.outputFiles!) {
			if (file.path.endsWith('.js')) {
				const processed = postProcessNLS(file.text, indexMap, false);
				await esbuild.transform(processed.code, { loader: 'js', format: 'esm' });
				await fs.mkdir(path.dirname(file.path), { recursive: true });
				await fs.writeFile(file.path, processed.code);
				if (processed.edits.length) {
					const map = result.outputFiles!.find(output => output.path === `${file.path}.map`);
					if (map) {
						sourceMaps.set(map.path, JSON.stringify(adjustSourceMap(JSON.parse(map.text), file.text, processed.edits)));
					}
				}
			}
		}
		for (const file of result.outputFiles!.filter(file => !file.path.endsWith('.js'))) {
			await fs.mkdir(path.dirname(file.path), { recursive: true });
			await fs.writeFile(file.path, sourceMaps.get(file.path) ?? file.contents);
		}
	}
	await copyResources(srcDir, outDir, 'desktop', true);
	await compileStandaloneFiles(srcDir, outDir, 'desktop', true);
	await optimizeSvgFiles(outDir, true);
	await fs.writeFile(path.join(outDir, 'npad-build.json'), JSON.stringify({
		inputs: [...inputs].sort(), externalImports: [...externalImports].sort(),
	}, null, '\t'));
	console.log(`Bundled NPad: ${results.length} entry points, ${inputs.size} inputs.`);
}

if (import.meta.main) {
	bundleNPad().catch(error => {
		console.error(error);
		process.exitCode = 1;
	});
}
