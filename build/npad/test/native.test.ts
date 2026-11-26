/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { buildTarget, distributionDir, getAppDirectory, getExecutablePath } from '../platform.ts';
import { launchNPad } from './app.ts';
import packageJson from '../../../package.json' with { type: 'json' };

const executeFile = promisify(execFile);

test('packaged runtime loads native modules and reports the NPad CLI version', { timeout: 60000 }, async () => {
	const executable = getExecutablePath(process.env.NPAD_TEST_APP);
	const app = getAppDirectory(process.env.NPAD_TEST_APP);
	const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
	const { stdout } = await executeFile(executable, [path.join(app, 'out', 'cli.js'), '--version'], { env, timeout: 30000 });
	assert.equal(stdout.trim().split(/\r?\n/)[0], packageJson.version);
	const script = `const load = require('node:module').createRequire(${JSON.stringify(path.join(app, 'package.json'))});
for (const name of ['@vscode/spdlog', '@vscode/sqlite3', '@parcel/watcher', 'native-keymap']) load(name);
console.log('Native modules loaded');`;
	const result = await executeFile(executable, ['--eval', script], { env, timeout: 30000 });
	assert.match(result.stdout, /Native modules loaded/);
	const search = path.join(app, 'node_modules', '@vscode', 'ripgrep-universal', 'bin', `${buildTarget.platform}-${buildTarget.arch}`, buildTarget.platform === 'win32' ? 'rg.exe' : 'rg');
	const searchResult = await executeFile(search, ['--version'], { timeout: 30000 });
	assert.match(searchResult.stdout, /^ripgrep /);
	if (process.platform !== 'win32') {
		assert.ok((await fs.stat(executable)).mode & 0o111, 'Packaged executable must retain execution permissions.');
		const bin = path.join(process.platform === 'darwin' ? app : process.env.NPAD_TEST_APP ?? distributionDir, 'bin', 'npad');
		const result = await executeFile(bin, ['--version'], { timeout: 30000 });
		assert.equal(result.stdout.trim().split(/\r?\n/)[0], packageJson.version);
	}
});

test('native application opens, edits, and saves a local file with the platform shortcut', { timeout: 90000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-native-'));
	const file = path.join(profile, 'native.txt');
	await fs.writeFile(file, 'Native NPad editing');
	let application: Awaited<ReturnType<typeof launchNPad>>;
	try {
		application = await launchNPad(t, profile, [file]);
	} finally {
		t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	}
	const { page, errors } = application;
	await page.getByText('Native NPad editing', { exact: true }).waitFor();
	// The default native macOS title omits the application name.
	await page.waitForFunction(expected => document.title.includes(expected), process.platform === 'darwin' ? 'native.txt' : 'NPad');
	await page.locator('.monaco-editor:visible .view-lines').first().click({ position: { x: 10, y: 5 } });
	const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
	await page.keyboard.press(`${modifier}+a`);
	await page.keyboard.insertText('Saved by native NPad');
	await page.keyboard.press(`${modifier}+s`);
	for (let attempt = 0; attempt < 100 && await fs.readFile(file, 'utf8') !== 'Saved by native NPad'; attempt++) {
		await setTimeout(100);
	}
	assert.equal(await fs.readFile(file, 'utf8'), 'Saved by native NPad');
	assert.deepStrictEqual(errors, []);
});

test('Word Wrap defaults on for new and opened documents and respects an explicit off preference', { timeout: 180000 }, async t => {
	const text = 'A long line of text that should wrap at the editor viewport. '.repeat(100);
	for (const scenario of ['new document', 'opened file', 'explicit off'] as const) {
		await t.test(scenario, async t => {
			const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-word-wrap-'));
			const file = path.join(profile, 'wrap.txt');
			await fs.writeFile(file, text);
			if (scenario === 'explicit off') {
				const user = path.join(profile, 'user-data', 'User');
				await fs.mkdir(user, { recursive: true });
				await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({ 'editor.wordWrap': 'off' }));
			}
			let application: Awaited<ReturnType<typeof launchNPad>>;
			try {
				application = await launchNPad(t, profile, scenario === 'new document' ? [] : [file]);
			} finally {
				t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
			}
			const { page, errors } = application;
			const lines = page.locator('.monaco-editor:visible .view-lines').first();
			await lines.waitFor();
			if (scenario === 'new document') {
				await lines.click({ position: { x: 10, y: 5 } });
				await page.keyboard.insertText(text);
			}
			await page.waitForFunction(wrapped => {
				const editor = [...document.querySelectorAll<HTMLElement>('.monaco-editor')].find(element => element.offsetParent);
				const lines = editor?.querySelectorAll('.view-line');
				return !!lines?.length && (lines[0].textContent?.length ?? 0) > 0 && (wrapped ? lines.length > 1 : lines.length === 1);
			}, scenario !== 'explicit off');
			assert.equal(await fs.readFile(file, 'utf8'), text, 'Wrapping must not change file contents');
			assert.deepStrictEqual(errors, []);
		});
	}
});
