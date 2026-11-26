/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import config from '../npad/config.json' with { type: 'json' };
import { copyFile } from './transpile.ts';

export type BuildTarget = 'desktop';

export async function copyResources(srcDir: string, outDir: string, _target: BuildTarget, minify: boolean): Promise<void> {
	for (const resource of config.resources) {
		const source = path.join(srcDir, resource);
		const destination = path.join(outDir, resource);
		if (minify && resource.endsWith('.js')) {
			const contents = await fs.readFile(source, 'utf8');
			const header = contents.match(/^\s*(\/\*[\s\S]*?\*\/)/)?.[1];
			const result = await esbuild.transform(contents, {
				loader: 'js', target: 'es2024', minify: true,
				banner: header && /copyright|license/i.test(header) ? header : undefined,
			});
			await fs.mkdir(path.dirname(destination), { recursive: true });
			await fs.writeFile(destination, result.code);
		} else {
			await copyFile(source, destination);
		}
	}
}
