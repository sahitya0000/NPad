/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';
import packageJson from '../../../package.json' with { type: 'json' };

const root = path.resolve(import.meta.dirname, '../../..');

test('project documentation links to existing local files', async () => {
	const documents = [
		'README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md',
		...(await fs.readdir(path.join(root, 'docs'))).filter(file => file.endsWith('.md')).map(file => `docs/${file}`),
	];
	let checked = 0;
	for (const document of documents) {
		const file = path.join(root, document);
		const source = await fs.readFile(file, 'utf8');
		for (const match of source.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
			const target = match[1];
			if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) {
				continue;
			}
			const local = decodeURIComponent(target.split(/[?#]/)[0]);
			await assert.doesNotReject(fs.access(path.resolve(path.dirname(file), local)), `${document}: broken link ${target}`);
			checked++;
		}
	}
	assert.ok(checked > 0, 'Expected local documentation links to be checked.');
});

test('package scripts reference existing local runners', async () => {
	const runners = new Set(Object.values(packageJson.scripts).flatMap(script =>
		[...script.matchAll(/\b(?:build|docs)\/[\w./-]+\.(?:ts|cjs)\b/g)].map(match => match[0])
	));
	assert.ok(runners.size > 0, 'Expected package scripts to reference local runners.');
	for (const runner of runners) {
		await assert.doesNotReject(fs.access(path.join(root, runner)), `Missing package-script runner: ${runner}`);
	}
});
