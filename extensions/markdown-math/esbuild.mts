/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { resolvePackageDirectory } from '../esbuild-common.mts';
import { run } from '../esbuild-extension-common.mts';

const srcDir = path.join(import.meta.dirname, 'src');
const outDir = path.join(import.meta.dirname, 'dist');

run({
	platform: 'node',
	entryPoints: {
		'extension': path.join(srcDir, 'extension.ts'),
	},
	srcDir,
	outdir: outDir,
}, process.argv, async () => {
	const katex = resolvePackageDirectory(import.meta.dirname, 'katex');
	const styles = path.join(import.meta.dirname, 'preview-styles');
	await fs.copyFile(path.join(katex, 'dist', 'katex.min.css'), path.join(styles, 'katex.min.css'));
	await fs.cp(path.join(katex, 'dist', 'fonts'), path.join(styles, 'fonts'), {
		recursive: true,
		filter: file => path.extname(file) === '' || file.endsWith('.woff2'),
	});
});
