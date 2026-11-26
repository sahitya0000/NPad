/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { type TestContext } from 'node:test';
import { chromium } from 'playwright-core';
import { getExecutablePath } from '../platform.ts';

export async function launchNPad(t: TestContext, profile: string, pathsToOpen: string[]) {
	const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
	const child = spawn(getExecutablePath(process.env.NPAD_TEST_APP), [
		'--remote-debugging-port=0',
		'--disable-renderer-backgrounding',
		'--disable-backgrounding-occluded-windows',
		`--user-data-dir=${path.join(profile, 'user-data')}`,
		`--shared-data-dir=${path.join(profile, 'shared-data')}`,
		`--extensions-dir=${path.join(profile, 'extensions')}`,
		'--skip-welcome',
		'--skip-release-notes',
		...pathsToOpen,
	], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	let cleanup = async () => { child.kill('SIGKILL'); };
	t.after(() => cleanup());
	let output = '';
	child.stdout.on('data', data => output += data.toString());
	const endpoint = await new Promise<string>((resolve, reject) => {
		const timeout = globalThis.setTimeout(() => reject(new Error(`NPad did not expose a renderer endpoint: ${output}`)), 30000);
		child.once('error', error => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once('exit', code => {
			clearTimeout(timeout);
			reject(new Error(`NPad exited with code ${code}: ${output}`));
		});
		child.stderr.on('data', data => {
			output += data.toString();
			const match = /DevTools listening on (?<endpoint>ws:\/\/[^\s]+)/.exec(output);
			if (match?.groups?.endpoint) {
				clearTimeout(timeout);
				resolve(match.groups.endpoint);
			}
		});
	});
	const browser = await chromium.connectOverCDP(endpoint).catch(error => {
		throw new Error(`Could not connect to NPad's renderer endpoint: ${output}`, { cause: error });
	});
	cleanup = async () => {
		child.kill('SIGKILL');
		await browser.close();
	};
	const context = browser.contexts()[0];
	const page = context.pages()[0] ?? await context.waitForEvent('page').catch(error => {
		throw new Error(`NPad did not create an editor page: ${output}`, { cause: error });
	});
	cleanup = async () => {
		try {
			if (!page.isClosed()) {
				const screenshots = path.resolve('.build/npad/test-results');
				await fs.mkdir(screenshots, { recursive: true });
				await page.screenshot({ path: path.join(screenshots, `${path.basename(profile)}.png`) });
			}
		} finally {
			// Dirty-file confirmations must not block cleanup of this owned test process.
			child.kill('SIGKILL');
			await browser.close();
		}
	};
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	page.on('console', message => {
		if (message.type() === 'error') {
			errors.push(message.text());
		}
	});
	await page.locator('.monaco-workbench').waitFor();
	return { browser, page, errors, child, output: () => output };
}
