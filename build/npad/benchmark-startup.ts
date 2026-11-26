/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { _electron as electron } from 'playwright-core';
import { getExecutablePath } from './platform.ts';

const runs = Number(process.argv[2] ?? 5);
if (!Number.isInteger(runs) || runs < 1 || runs > 20) {
	throw new Error('Usage: node build/npad/benchmark-startup.ts [runs: 1-20] [output.json]');
}
const output = path.resolve(process.argv[3] ?? '.build/npad/startup-benchmark.json');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-startup-'));
const samples = [];
try {
	for (let index = 0; index < runs; index++) {
		const profile = path.join(directory, String(index));
		await fs.mkdir(profile, { recursive: true });
		const file = path.join(profile, 'startup.txt');
		await fs.writeFile(file, 'NPad first-file startup benchmark');
		const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
		const start = performance.now();
		const app = await electron.launch({
			executablePath: getExecutablePath(process.env.NPAD_TEST_APP),
			args: [
				`--user-data-dir=${path.join(profile, 'user-data')}`,
				`--shared-data-dir=${path.join(profile, 'shared-data')}`,
				`--extensions-dir=${path.join(profile, 'extensions')}`,
				file,
			],
			env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
			timeout: 30000,
		});
		try {
			const page = await app.firstWindow();
			await page.getByText('NPad first-file startup benchmark', { exact: true }).waitFor();
			const elapsedMs = Math.round(performance.now() - start);
			const marks = await page.evaluate(() => performance.getEntriesByType('mark').map(mark => ({ name: mark.name, startTime: mark.startTime })));
			samples.push({ elapsedMs, marks });
			console.log(`Fresh-profile file opening ${index + 1}/${runs}: ${elapsedMs} ms`);
		} finally {
			await app.close();
		}
	}
	const sorted = samples.map(sample => sample.elapsedMs).sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	const medianMs = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
	await fs.mkdir(path.dirname(output), { recursive: true });
	await fs.writeFile(output, JSON.stringify({
		description: 'Process-cold, fresh-profile launch to visible file text; OS disk cache is not flushed. Includes Playwright attachment overhead.',
		date: new Date().toISOString(), medianMs, samples,
	}, null, '\t'));
	console.log(`Median: ${medianMs} ms. Results: ${output}`);
} finally {
	await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
