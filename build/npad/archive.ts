/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildTarget, distributionDir } from './platform.ts';
import packageJson from '../../package.json' with { type: 'json' };

const executeFile = promisify(execFile);

export async function buildArchive(): Promise<void> {
	if (buildTarget.platform === 'win32') {
		throw new Error('Windows distributions use the Inno Setup installer.');
	}
	const outputDir = path.dirname(distributionDir);
	const extension = buildTarget.platform === 'darwin' ? 'zip' : 'tar.gz';
	const name = `NPad-${buildTarget.platform}-${buildTarget.arch}-${packageJson.version}.${extension}`;
	const output = path.join(outputDir, name);
	await fs.rm(output, { force: true });
	if (buildTarget.platform === 'darwin') {
		await executeFile('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path.join(distributionDir, 'NPad.app'), output]);
	} else {
		await executeFile('tar', ['-czf', output, '-C', outputDir, path.basename(distributionDir)]);
	}
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(output)) {
		hash.update(chunk);
	}
	await fs.writeFile(`${output}.sha256`, `${hash.digest('hex')}  ${name}\n`);
	console.log(`Archive: ${output}`);
}
