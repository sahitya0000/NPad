/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference lib="dom" />

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron as electron, type Locator, type Page } from 'playwright-core';
import { getAppDirectory, getExecutablePath } from '../platform.ts';
import { launchNPad } from './app.ts';

const highlightColors = [
	['rgba(230, 184, 0, 0.267)', 'rgb(185, 155, 0)'],
	['rgba(64, 160, 255, 0.267)', 'rgb(64, 143, 224)'],
	['rgba(82, 183, 136, 0.267)', 'rgb(57, 148, 105)'],
	['rgba(215, 120, 232, 0.267)', 'rgb(179, 80, 194)'],
	['rgba(237, 138, 73, 0.267)', 'rgb(200, 106, 40)']
];

function waitForAppExit(child: ReturnType<typeof spawn>): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const timeout = globalThis.setTimeout(() => reject(new Error('NPad did not close gracefully')), 15000);
		child.once('exit', code => {
			clearTimeout(timeout);
			code === 0 ? resolve() : reject(new Error(`NPad exited with code ${code}`));
		});
	});
}

async function readMenu(page: Page, menu: Locator, prefix: string, entries: string[], commandIds?: Set<string>): Promise<void> {
	const items = menu.locator(':scope > .monaco-action-bar > .actions-container > .action-item > .action-menu-item');
	await items.first().waitFor().catch(error => {
		throw new Error(`Menu did not open: ${prefix}`, { cause: error });
	});
	for (const item of await items.all()) {
		if (await item.getAttribute('role') === 'presentation') {
			continue;
		}
		const label = (await item.locator('.action-label').first().innerText()).trim();
		const commandId = await item.getAttribute('data-action-id');
		if (commandId) { commandIds?.add(commandId); }
		const path = `${prefix} > ${label}`;
		entries.push(path);
		const style = /^(?:Style All: |Style Selection \/ Word: |Clear Style )([1-5])$/.exec(label);
		if (style) {
			const command = label.startsWith('Style All:') ? 'highlightAll' : label.startsWith('Style Selection') ? 'highlightOne' : 'clearHighlight';
			assert.equal(await item.getAttribute('data-action-id'), `npad.${command}${style[1]}`);
			await assertStyleSwatch(item.locator('.menu-item-color-swatch'), Number(style[1]));
		}
		if (await item.getAttribute('aria-haspopup') === 'true') {
			await item.press('ArrowRight');
			const submenu = item.locator('..').locator(':scope > .monaco-submenu .monaco-menu').first();
			await submenu.waitFor();
			await readMenu(page, submenu, path, entries, commandIds);
			// A submenu containing only disabled commands cannot receive keyboard focus.
			await submenu.dispatchEvent('keyup', { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, bubbles: true });
			await submenu.waitFor({ state: 'detached' });
		}
	}
}

async function assertStyleSwatch(icon: Locator, style: number): Promise<void> {
	const actual = await icon.evaluate(element => {
		const swatch = getComputedStyle(element, element.classList.contains('menu-item-color-swatch') ? undefined : '::before');
		return [swatch.backgroundColor, swatch.borderTopColor, swatch.width, swatch.height];
	});
	assert.deepStrictEqual(actual, [...highlightColors[style - 1], '12px', '12px'], `Style ${style} color swatch`);
}

async function readMenubar(page: Page): Promise<string[]> {
	const entries: string[] = [];
	await page.getByRole('menuitem', { name: 'Help', exact: true }).waitFor();
	const buttons = page.locator('.menubar > .menubar-menu-button');
	for (const button of await buttons.all()) {
		const title = (await button.innerText()).trim();
		if (!title) {
			continue;
		}
		entries.push(title);
		await button.click();
		await readMenu(page, page.locator('.monaco-menu').first(), title, entries);
		await page.keyboard.press('Escape');
		await page.locator('.monaco-menu').first().waitFor({ state: 'hidden' });
	}
	return entries;
}

async function runCommand(page: Page, title: string): Promise<void> {
	await page.keyboard.press('Control+Shift+P');
	await page.locator('.quick-input-widget input').fill(`>${title}`);
	await page.locator('.quick-input-list .label-name').filter({
		hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
	}).click();
	await page.waitForFunction(query => {
		const widget = document.querySelector<HTMLElement>('.quick-input-widget');
		const input = widget?.querySelector<HTMLInputElement>('input');
		return !widget?.offsetParent || input?.value !== query;
	}, `>${title}`);
}

async function pasteText(page: Page, text: string): Promise<void> {
	await page.evaluate(value => {
		const data = new DataTransfer();
		data.setData('text/plain', value);
		document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
	}, text);
}

async function waitForBuffer(page: Page, text: string): Promise<void> {
	await page.waitForFunction(expected => {
		const editor = [...document.querySelectorAll<HTMLElement>('.monaco-editor')].find(element => element.offsetParent);
		const actual = [...(editor?.querySelectorAll('.view-line') ?? [])].map(line => line.textContent?.replace(/\u00a0/g, ' ').replace(/\u200b/g, '') ?? '').join('\n');
		return actual === expected;
	}, text);
}

async function replaceBuffer(page: Page, text: string): Promise<void> {
	await page.locator('.monaco-editor:visible .view-lines').first().click({ position: { x: 10, y: 5 } });
	await page.keyboard.press('Control+a');
	await page.keyboard.press('Backspace');
	await waitForBuffer(page, '');
	if (text) {
		await pasteText(page, text);
		await waitForBuffer(page, text);
	}
}

async function saveAndAssert(page: Page, file: string, expected: string, message?: string): Promise<void> {
	await waitForBuffer(page, expected);
	await page.keyboard.press('Control+s');
	for (let attempt = 0; attempt < 50 && await fs.readFile(file, 'utf8') !== expected; attempt++) {
		await setTimeout(100);
	}
	assert.equal(await fs.readFile(file, 'utf8'), expected, message);
}

async function pick(page: Page, label: string): Promise<void> {
	await page.locator('.quick-input-list').getByText(label, { exact: true }).waitFor();
	await page.locator('.quick-input-list').getByText(label, { exact: true }).click();
}

async function inputValue(page: Page, value: string): Promise<void> {
	const input = page.locator('.quick-input-widget input');
	await input.waitFor();
	await input.fill(value);
	await page.keyboard.press('Enter');
}

async function openFileWithDialog(page: Page, file: string): Promise<void> {
	await page.keyboard.press('Control+o');
	// Initial directory loading can replace an input filled before the first items arrive.
	await page.locator('.quick-input-list .monaco-list-row').first().waitFor();
	const input = page.locator('.quick-input-widget input');
	await input.fill(file);
	await page.getByRole('button', { name: 'OK', exact: true }).click();
	await input.waitFor({ state: 'hidden' });
}

async function contextAction(page: Page, ...labels: string[]): Promise<void> {
	await page.keyboard.press('ContextMenu');
	for (const label of labels) {
		const item = page.locator('.monaco-menu .action-label').getByText(label, { exact: true });
		await item.waitFor();
		await setTimeout(150);
		await item.click();
	}
	await page.locator('.monaco-menu').first().waitFor({ state: 'hidden' });
}

test('NPad shows its name in both title-bar modes and its logo and name on the landing page', { timeout: 120000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-branding-'));
	const user = path.join(profile, 'user-data', 'User');
	const settingsFile = path.join(user, 'settings.json');
	const file = path.join(profile, 'branding.txt');
	await fs.mkdir(user, { recursive: true });
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	const settings = { 'workbench.startupEditor': 'none', 'window.dialogStyle': 'custom' };
	await fs.writeFile(settingsFile, JSON.stringify(settings));
	await fs.writeFile(file, 'Hello world');
	const { page, errors } = await launchNPad(t, profile, []);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	const heading = page.getByRole('heading', { name: 'NPad', exact: true });
	const title = page.locator('.titlebar .window-title');
	await page.getByRole('tab', { name: /Untitled/ }).waitFor();
	await page.locator('.monaco-workbench[class*="theme-defaults"]').waitFor();
	await page.keyboard.press('Control+w');
	await heading.waitFor();
	await page.waitForFunction(() => document.title.includes('NPad'));
	await page.waitForFunction(() => document.querySelector('.titlebar .window-title')?.textContent?.includes('NPad'));
	assert.equal(await page.locator('.command-center:visible').count(), 1, 'Default searchable title bar remains available');

	for (const [theme, css] of [
		['Dark Modern', 'vs-dark'], ['Light Modern', 'vs'],
		['Default High Contrast', 'hc-black'], ['Default High Contrast Light', 'hc-light'],
	]) {
		await fs.writeFile(settingsFile, JSON.stringify({ ...settings, 'workbench.colorTheme': theme }));
		await page.locator(`.monaco-workbench.${css}`).waitFor();
		await heading.waitFor();
		const logo = page.locator('.editor-group-watermark .letterpress:visible');
		await logo.waitFor();
		const size = await logo.evaluate(async element => {
			const background = getComputedStyle(element).backgroundImage;
			const url = /^url\(["']?(.*?)["']?\)$/.exec(background)?.[1];
			if (!url) { throw new Error(`Missing landing-page logo: ${background}`); }
			const image = new Image();
			image.src = url;
			await image.decode();
			return { width: image.naturalWidth, height: image.naturalHeight };
		});
		assert.deepStrictEqual(size, { width: 1024, height: 1024 }, theme);
		const watermarkStyle = await logo.evaluate(element => {
			const logo = getComputedStyle(element);
			const name = getComputedStyle(element.parentElement!.querySelector('.watermark-product-name')!);
			return {
				filter: logo.filter, opacity: logo.opacity, nameOpacity: name.opacity, nameColor: name.color,
				maskMode: logo.maskMode, sameLogoMask: logo.maskImage === logo.backgroundImage,
			};
		});
		const opacity = css === 'vs-dark' ? '0.35' : css === 'vs' ? '0.1' : '0.65';
		assert.deepStrictEqual(watermarkStyle, {
			filter: css === 'hc-black' ? 'brightness(0) invert(1)' : 'brightness(0)',
			opacity, nameOpacity: opacity,
			nameColor: css === 'hc-black' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)',
			maskMode: 'luminance', sameLogoMask: true,
		}, `${theme}: logo and name use the same monochrome watermark treatment`);
		const detailContrast = await page.evaluate(async screenshot => {
			const image = new Image();
			image.src = `data:image/png;base64,${screenshot}`;
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext('2d')!;
			context.drawImage(image, 0, 0);
			const contrast = (x: number, top: number, bottom: number) => {
				const values: number[] = [];
				for (let y = Math.round(canvas.height * top); y <= Math.round(canvas.height * bottom); y++) {
					values.push(context.getImageData(Math.round(canvas.width * x), y, 1, 1).data[0]);
				}
				return Math.max(...values) - Math.min(...values);
			};
			return {
				paperRule: Math.max(...[0.26, 0.3, 0.34].map(x => contrast(x, 0.4, 0.6))),
				codeSymbol: contrast(0.45, 0.28, 0.42)
			};
		}, (await logo.screenshot()).toString('base64'));
		assert.ok(detailContrast.paperRule >= 1, `${theme}: notebook rules must remain visible, not a flat silhouette: ${JSON.stringify(detailContrast)}`);
		assert.ok(detailContrast.codeSymbol >= 3, `${theme}: code symbol must retain visible internal detail: ${JSON.stringify(detailContrast)}`);
		assert.equal(await page.locator('.window-appicon').evaluate(element => getComputedStyle(element).filter), 'none', 'Title-bar icon keeps its full-color branding');
		assert.match(await title.innerText(), /NPad/);
		await page.screenshot({ path: path.resolve(`.build/npad/test-results/npad-watermark-${css}.png`) });
	}
	await page.screenshot({ path: path.resolve('.build/npad/test-results/npad-landing.png') });

	await fs.writeFile(settingsFile, JSON.stringify({ ...settings, 'window.commandCenter': false, 'workbench.tips.enabled': false }));
	await page.locator('.command-center').waitFor({ state: 'hidden' });
	await heading.waitFor();
	assert.match(await title.innerText(), /NPad/);
	await page.keyboard.press('Control+p');
	await page.locator('.quick-input-widget input').fill(file);
	await page.locator('.quick-input-list').getByText('branding.txt', { exact: true }).waitFor();
	await page.keyboard.press('Enter');
	await waitForBuffer(page, 'Hello world');
	await page.waitForFunction(() => {
		const title = document.querySelector('.titlebar .window-title')?.textContent ?? '';
		return title.includes('branding.txt') && title.includes('NPad');
	});
	await page.waitForFunction(() => document.title.includes('branding.txt') && document.title.includes('NPad'));
	await heading.waitFor({ state: 'hidden' });
	assert.deepStrictEqual(errors, []);
});

test('all 26 approved editor context actions work with selection, read-only guards, UTF-8 conversion and detected links', { timeout: 240000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-context-tools-'));
	const file = path.join(profile, 'context.js');
	const user = path.join(profile, 'user-data', 'User');
	await fs.mkdir(user, { recursive: true });
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	await fs.writeFile(file, 'const alpha = "alpha";\n');
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
		'window.dialogStyle': 'custom', 'window.menuStyle': 'custom', 'editor.autoIndent': 'none',
		'editor.trimAutoWhitespace': false, 'files.trimTrailingWhitespace': false, 'files.insertFinalNewline': false
	}));
	const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
	const app = await electron.launch({
		executablePath: getExecutablePath(process.env.NPAD_TEST_APP),
		args: [`--user-data-dir=${path.join(profile, 'user-data')}`, `--shared-data-dir=${path.join(profile, 'shared-data')}`, `--extensions-dir=${path.join(profile, 'extensions')}`, file],
		env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))
	});
	t.after(async () => {
		const closing = app.close();
		await page.locator('.monaco-dialog-box[role="dialog"]').getByRole('button', { name: "Don't Save", exact: true }).click();
		await closing;
		await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});
	const page = await app.firstWindow();
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.getByText('const', { exact: true }).first().waitFor();
	await page.locator('.monaco-editor:visible .view-lines').first().click({ position: { x: 10, y: 5 } });
	await page.keyboard.press('Control+Home');
	const observed = new Set<string>();
	await page.keyboard.press('ContextMenu');
	const unselected: string[] = [];
	await readMenu(page, page.locator('.monaco-menu').first(), 'Editor', unselected, observed);
	assert.ok(!unselected.includes('Editor > Delete'));
	assert.ok(!unselected.includes('Editor > Convert Case'));
	assert.ok(!unselected.includes('Editor > Base64'));
	assert.ok(!unselected.includes('Editor > Copy Link Address'));
	assert.ok(unselected.includes('Editor > Select All'));
	await page.keyboard.press('Escape');

	await page.keyboard.press('Control+a');
	// A real right-click inside the selection must retain that selection.
	await page.locator('.monaco-editor:visible .view-lines').first().click({ button: 'right', position: { x: 10, y: 5 } });
	const selectedEntries: string[] = [];
	await readMenu(page, page.locator('.monaco-menu').first(), 'Editor', selectedEntries, observed);
	assert.ok(selectedEntries.includes('Editor > Delete'));
	assert.ok(selectedEntries.includes('Editor > Convert Case > UPPERCASE'));
	assert.ok(selectedEntries.includes('Editor > Base64 > Base64 Decode (UTF-8)'));
	await page.keyboard.press('Escape');
	await contextAction(page, 'Convert Case', 'UPPERCASE');
	await saveAndAssert(page, file, 'CONST ALPHA = "ALPHA";\n');
	await page.keyboard.press('Control+z');
	await saveAndAssert(page, file, 'const alpha = "alpha";\n');
	await page.keyboard.press('Control+a');
	await contextAction(page, 'Convert Case', 'lowercase');
	await saveAndAssert(page, file, 'const alpha = "alpha";\n');
	await contextAction(page, 'Delete');
	await saveAndAssert(page, file, '');
	await page.keyboard.press('Control+z');
	await saveAndAssert(page, file, 'const alpha = "alpha";\n');
	await page.keyboard.press('Control+Home');
	await contextAction(page, 'Select All');
	await contextAction(page, 'Copy As', 'Copy with Syntax Highlighting');
	const clipboard = await app.evaluate(({ clipboard }) => ({ text: clipboard.readText(), html: clipboard.readHTML() }));
	assert.equal(clipboard.text.replaceAll('\r\n', '\n'), 'const alpha = "alpha";\n');
	assert.ok(clipboard.html.includes('<span'), 'rich copy includes HTML token spans');

	await replaceBuffer(page, 'let value = 1;');
	await contextAction(page, 'Toggle Line Comment');
	await saveAndAssert(page, file, '// let value = 1;');
	await page.keyboard.press('Control+z');
	await saveAndAssert(page, file, 'let value = 1;');
	await page.keyboard.press('Control+a');
	await contextAction(page, 'Toggle Block Comment');
	await saveAndAssert(page, file, '/* let value = 1; */');
	await contextAction(page, 'Toggle Block Comment');
	await saveAndAssert(page, file, 'let value = 1;');

	for (const text of ['hello', '\u03a9\u{1f600}\ntext']) {
		await replaceBuffer(page, text);
		await page.keyboard.press('Control+a');
		await contextAction(page, 'Base64', 'Base64 Encode (UTF-8)');
		const encoded = Buffer.from(text).toString('base64');
		await saveAndAssert(page, file, encoded);
		await page.keyboard.press('Control+z');
		await saveAndAssert(page, file, text);
		await replaceBuffer(page, encoded);
		await page.keyboard.press('Control+a');
		await contextAction(page, 'Base64', 'Base64 Decode (UTF-8)');
		await waitForBuffer(page, text);
		await page.locator('.monaco-editor:visible .view-lines').first().click({ position: { x: 10, y: 5 } });
		await saveAndAssert(page, file, text);
		await page.keyboard.press('Control+z');
		await saveAndAssert(page, file, encoded);
	}
	await replaceBuffer(page, 'hi hi');
	await page.keyboard.press('Control+Home');
	await page.keyboard.press('Control+d');
	await page.keyboard.press('Control+d');
	await contextAction(page, 'Base64', 'Base64 Encode (UTF-8)');
	await saveAndAssert(page, file, 'aGk= aGk=');
	await page.keyboard.press('Control+z');
	await saveAndAssert(page, file, 'hi hi');
	await replaceBuffer(page, 'aGk=\nbad!');
	await page.keyboard.press('Control+Home');
	await page.keyboard.press('Shift+End');
	await runCommand(page, 'Add Cursor Below');
	await contextAction(page, 'Base64', 'Base64 Decode (UTF-8)');
	await page.getByText('Select valid standard Base64 with correct padding.', { exact: true }).waitFor();
	await saveAndAssert(page, file, 'aGk=\nbad!');
	await page.keyboard.press('Escape');
	await replaceBuffer(page, 'not base64!');
	await page.keyboard.press('Control+a');
	await contextAction(page, 'Base64', 'Base64 Decode (UTF-8)');
	await page.getByText('Select valid standard Base64 with correct padding.', { exact: true }).waitFor();
	await saveAndAssert(page, file, 'not base64!');
	await page.keyboard.press('Escape');

	await replaceBuffer(page, 'alpha beta alpha');
	await page.keyboard.press('Control+Home');
	for (let style = 1; style <= 5; style++) {
		await contextAction(page, 'Highlights', 'Style All Occurrences', `Style All: ${style}`);
		await page.locator(`.npad-highlight-${style}`).first().waitFor();
		assert.equal(await page.locator(`.npad-highlight-${style}`).count(), 2);
		await contextAction(page, 'Highlights', 'Clear Style', `Clear Style ${style}`);
		await page.locator(`.npad-highlight-${style}`).first().waitFor({ state: 'hidden' });
		assert.equal(await page.locator(`.npad-highlight-${style}`).count(), 0);
		await contextAction(page, 'Highlights', 'Style Selection / Word', `Style Selection / Word: ${style}`);
		await page.locator(`.npad-highlight-${style}`).waitFor();
	}
	await contextAction(page, 'Highlights', 'Clear Style', 'Clear All Styles');
	await page.locator('[class*="npad-highlight-"]').first().waitFor({ state: 'hidden' });
	assert.equal(await page.locator('[class*="npad-highlight-"]').count(), 0);

	await page.keyboard.press('Control+s');
	await runCommand(page, 'File: Set Active Editor Read-only in Session');
	await page.locator('.monaco-editor:visible .view-lines').first().click({ position: { x: 10, y: 5 } });
	await page.keyboard.press('Control+a');
	await page.keyboard.press('ContextMenu');
	const readonlyEntries: string[] = [];
	await readMenu(page, page.locator('.monaco-menu').first(), 'Editor', readonlyEntries);
	for (const label of ['Delete', 'Convert Case', 'Base64', 'Toggle Line Comment', 'Toggle Block Comment']) {
		assert.ok(!readonlyEntries.includes(`Editor > ${label}`), `No writable ${label} action in read-only editor`);
	}
	assert.ok(readonlyEntries.includes('Editor > Highlights > Style All Occurrences > Style All: 1'));
	await page.keyboard.press('Escape');
	await runCommand(page, 'File: Set Active Editor Writeable in Session');

	const url = 'https://example.invalid/path?q=npad#fragment';
	await replaceBuffer(page, url);
	await page.keyboard.press('Control+Home');
	await page.keyboard.press('ArrowRight');
	await page.locator('.detected-link').first().waitFor();
	await page.keyboard.press('ContextMenu');
	const linkEntries: string[] = [];
	await readMenu(page, page.locator('.monaco-menu').first(), 'Editor', linkEntries, observed);
	assert.ok(linkEntries.includes('Editor > Copy Link Address'));
	assert.ok(linkEntries.includes('Editor > Copy'), 'detected link does not replace ordinary Copy');
	await page.keyboard.press('Escape');
	await contextAction(page, 'Copy Link Address');
	assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), url);
	assert.equal(app.windows().length, 1, 'copy does not open a browser window');
	await page.keyboard.press('Control+a');
	await page.keyboard.press('ContextMenu');
	assert.equal(await page.locator('[data-action-id="npad.copyLink"]').count(), 0);
	await page.keyboard.press('Escape');
	const source = await fs.readFile(path.resolve('src/vs/workbench/contrib/npadEditor/browser/npadEditorContextMenu.ts'), 'utf8');
	const approved = [...source.matchAll(/contextFeature\('[^']+', '([^']+)'/g)].map(match => match[1]);
	assert.equal(approved.length, 26);
	for (const command of approved) { assert.ok(observed.has(command), `Missing runtime context command ${command}`); }
	assert.deepStrictEqual(errors, []);
});

test('approved NPad text tools edit real files, preserve undo, and provide clipboard and Unicode actions', { timeout: 180000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-text-tools-'));
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	const file = path.join(profile, 'tools.txt');
	await fs.writeFile(file, 'NPad tools\n');
	const user = path.join(profile, 'user-data', 'User');
	await fs.mkdir(user, { recursive: true });
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
		'editor.autoIndent': 'none', 'editor.trimAutoWhitespace': false, 'window.dialogStyle': 'custom',
		'files.trimTrailingWhitespace': false, 'files.trimFinalNewlines': false, 'files.insertFinalNewline': false
	}));
	const { page, errors } = await launchNPad(t, profile, [file]);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	await page.getByText('NPad tools', { exact: true }).waitFor();
	for (const [command, before, after] of [
		['Remove Consecutive Duplicate Lines', 'a\na\nb\na\n', 'a\nb\na\n'],
		['Remove Empty Lines', 'a\n\n \nb\n', 'a\n \nb\n'],
		['Remove Empty or Whitespace-Only Lines', 'a\n\n \nb\n', 'a\nb\n'],
		['Trim Leading Space', ' a \n b ', 'a \nb '],
		['Trim Leading and Trailing Space', ' a \n b ', 'a\nb'],
		['Trim Both and Join Lines', ' a \n b ', 'a b'],
		['Integers Ascending', '12\n-1\n3\n', '-1\n3\n12\n'],
		['Integers Descending', '12\n-1\n3\n', '12\n3\n-1\n'],
		['Decimals (Comma) Ascending', '1,2\n-1,01\n0,5', '-1,01\n0,5\n1,2'],
		['Decimals (Comma) Descending', '1,2\n-1,01\n0,5', '1,2\n0,5\n-1,01'],
		['Decimals (Dot) Ascending', '1.2\n-1.01\n0.5', '-1.01\n0.5\n1.2'],
		['Decimals (Dot) Descending', '1.2\n-1.01\n0.5', '1.2\n0.5\n-1.01'],
		['Length Ascending', 'aaa\nb\ncc', 'b\ncc\naaa'],
		['Length Descending', 'aaa\nb\ncc', 'aaa\ncc\nb'],
	]) {
		await replaceBuffer(page, before);
		await page.keyboard.press('ArrowLeft');
		await runCommand(page, `NPad: ${command}`);
		await saveAndAssert(page, file, after, `${command}: transformed contents`);
		await page.keyboard.press('Control+z');
		await saveAndAssert(page, file, before, `${command}: undo`);
	}
	const clipboardDirectory = profile.replace(/^[A-Z]:/, drive => drive.toLowerCase());
	for (const [command, expected] of [
		['Copy Current Filename', 'tools.txt'], ['Copy Current Directory Path', clipboardDirectory],
		['Copy All Filenames', 'tools.txt'], ['Copy All File Paths', path.join(clipboardDirectory, 'tools.txt')]
	]) {
		await runCommand(page, `NPad: ${command}`);
		await replaceBuffer(page, '');
		await page.keyboard.press('Control+v');
		await saveAndAssert(page, file, expected);
	}
	for (const variant of ['Short', 'Long']) {
		await replaceBuffer(page, '');
		await runCommand(page, `NPad: Insert Date Time (${variant})`);
		await page.keyboard.press('Control+s');
		await setTimeout(200);
		assert.ok((await fs.readFile(file, 'utf8')).length > 5);
	}
	await replaceBuffer(page, '');
	await runCommand(page, 'NPad: Insert Date Time (Customized)...');
	await inputValue(page, '[NPad] YYYY-MM-DD HH:mm:ss');
	await page.keyboard.press('Control+s');
	await setTimeout(200);
	assert.match(await fs.readFile(file, 'utf8'), /^NPad \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

	await replaceBuffer(page, 'a\nb\nc');
	await page.keyboard.press('Control+a');
	await runCommand(page, 'NPad: Column Editor...');
	await pick(page, 'Insert Numbers');
	await inputValue(page, '1');
	await inputValue(page, '2');
	await saveAndAssert(page, file, '1a\n3b\n5c');
	await replaceBuffer(page, 'a\nb');
	await page.keyboard.press('Control+a');
	await runCommand(page, 'NPad: Column Editor...');
	await pick(page, 'Insert Text');
	await inputValue(page, 'x');
	await saveAndAssert(page, file, 'xa\nxb');
	for (const [label, expected] of [['Replace with Blocks', '\u2588\u2588'], ['Replace with Bullets', '\u25cf\u25cf']]) {
		await replaceBuffer(page, 'ab');
		await page.keyboard.press('Control+a');
		await runCommand(page, 'NPad: Redact Selection...');
		await pick(page, label);
		await saveAndAssert(page, file, expected);
	}
	await replaceBuffer(page, '');
	await runCommand(page, 'NPad: Character / Unicode Picker...');
	await pick(page, 'Enter Unicode Code Point...');
	await inputValue(page, 'U+1F600');
	await saveAndAssert(page, file, '\u{1f600}');
	await runCommand(page, 'NPad: Document Summary...');
	await page.getByRole('dialog').getByText('Document Summary', { exact: true }).waitFor();
	await page.getByText(/UTF-8 buffer bytes \(without BOM\): 4/).waitFor();
	await page.getByRole('button', { name: 'OK', exact: true }).click();
	assert.deepStrictEqual(errors, []);
});

test('NPad bookmarks, all five highlight styles, EOL display and log monitoring work without dirty reloads', { timeout: 180000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-navigation-tools-'));
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	const file = path.join(profile, 'log.txt');
	await fs.writeFile(file, 'alpha\nbeta\nalpha\n');
	const user = path.join(profile, 'user-data', 'User');
	await fs.mkdir(user, { recursive: true });
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({ 'window.dialogStyle': 'custom', 'files.simpleDialog.enable': true }));
	const { page, errors } = await launchNPad(t, profile, [file]);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	await page.getByText('beta', { exact: true }).waitFor();
	for (let style = 1; style <= 5; style++) {
		await page.locator('.monaco-editor:visible').first().click({ position: { x: 120, y: 20 } });
		await page.keyboard.press('Control+Home');
		await page.keyboard.press('Shift+End');
		await runCommand(page, `NPad: Style All: ${style}`);
		await page.locator(`.npad-highlight-${style}`).first().waitFor();
		assert.equal(await page.locator(`.npad-highlight-${style}`).count(), 2);
		assert.deepStrictEqual(await page.locator(`.npad-highlight-${style}`).first().evaluate(element => {
			const color = getComputedStyle(element);
			return [color.backgroundColor, color.borderBottomColor];
		}), highlightColors[style - 1], `Style ${style} editor colors match its swatch`);
		await runCommand(page, `NPad: Clear Style ${style}`);
		await page.locator(`.npad-highlight-${style}`).first().waitFor({ state: 'hidden' });
		await runCommand(page, `NPad: Style Selection / Word: ${style}`);
		await page.locator(`.npad-highlight-${style}`).first().waitFor();
		assert.equal(await page.locator(`.npad-highlight-${style}`).count(), 1);
	}
	await runCommand(page, 'NPad: Clear All Styles');
	assert.equal(await page.locator('[class*="npad-highlight-"]').count(), 0);
	await runCommand(page, 'NPad: Mark Text...');
	await inputValue(page, 'beta');
	for (let style = 1; style <= 5; style++) {
		await assertStyleSwatch(page.locator(`.quick-input-list .codicon-npad-highlight-style-${style}`), style);
	}
	await pick(page, 'Style 3');
	await page.locator('.npad-highlight-3').waitFor();
	await runCommand(page, 'NPad: Show End of Line');
	await page.locator('.npad-eol-marker').first().waitFor();
	assert.match(await page.locator('.npad-eol-marker').first().innerText(), /LF/);
	await runCommand(page, 'NPad: Show End of Line');
	await page.locator('.npad-eol-marker').first().waitFor({ state: 'hidden' });

	const addBookmarks = async () => {
		await runCommand(page, 'NPad: Clear All Bookmarks');
		await page.locator('.monaco-editor:visible').first().click({ position: { x: 120, y: 20 } });
		await page.keyboard.press('Control+Home');
		await runCommand(page, 'NPad: Toggle Bookmark');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await runCommand(page, 'NPad: Toggle Bookmark');
	};
	await addBookmarks();
	await runCommand(page, 'NPad: Next Bookmark');
	await page.getByText(/Ln 1, Col 1/, { exact: false }).waitFor();
	await runCommand(page, 'NPad: Previous Bookmark');
	await page.getByText(/Ln 3, Col 1/, { exact: false }).waitFor();
	await Promise.all([page.waitForEvent('domcontentloaded'), runCommand(page, 'Developer: Reload Window')]);
	await page.getByText('beta', { exact: true }).waitFor();
	await page.locator('.npad-bookmark-line').first().waitFor();
	assert.equal(await page.locator('.npad-bookmark-line').count(), 2);
	await page.locator('.monaco-editor:visible .view-lines').first().click({ position: { x: 10, y: 5 } });
	await runCommand(page, 'NPad: Copy Bookmarked Lines');
	await page.keyboard.press('Control+End');
	await page.keyboard.press('Control+v');
	await saveAndAssert(page, file, 'alpha\nbeta\nalpha\nalpha\nalpha\n');
	await page.keyboard.press('Control+z');
	await saveAndAssert(page, file, 'alpha\nbeta\nalpha\n');
	for (const [command, expected] of [
		['Cut Bookmarked Lines...', 'beta\n'],
		['Remove Bookmarked Lines...', 'beta\n'],
		['Remove Non-Bookmarked Lines...', 'alpha\nalpha']
	]) {
		await addBookmarks();
		await runCommand(page, `NPad: ${command}`);
		await page.getByRole('button', { name: 'Remove Lines', exact: true }).click();
		await saveAndAssert(page, file, expected);
		await page.keyboard.press('Control+z');
		await saveAndAssert(page, file, 'alpha\nbeta\nalpha\n');
	}
	await runCommand(page, 'NPad: Monitoring (tail -f)');
	await page.getByText('Monitoring enabled (read-only, up to 8 MiB). Run Monitoring again to stop.', { exact: true }).waitFor();
	await fs.appendFile(file, 'appended log line\n');
	await page.getByText('appended log line', { exact: true }).waitFor();
	assert.equal(await page.locator('.tab.dirty').count(), 0);
	await fs.writeFile(file, 'truncated log\n');
	await page.getByText('truncated log', { exact: true }).waitFor();
	await fs.rename(file, path.join(profile, 'log.old'));
	await fs.writeFile(file, 'rotated log\n');
	await page.getByText('rotated log', { exact: true }).waitFor();
	await runCommand(page, 'NPad: Monitoring (tail -f)');
	await page.getByText('rotated log', { exact: true }).click();
	await page.keyboard.press('Control+End');
	await pasteText(page, 'editable again');
	await saveAndAssert(page, file, 'rotated log\neditable again');
	assert.deepStrictEqual(errors, []);
});

test('NPad JSON formatting supports documents, exact selections, JSONC, undo and visible validation errors', { timeout: 120000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-json-format-'));
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	const file = path.join(profile, 'format.json');
	const jsonc = path.join(profile, 'comments.jsonc');
	const plain = path.join(profile, 'plain.txt');
	const source = '{"z":900719925474099312345,"a":1e+99,"z":-0}';
	await fs.writeFile(file, source);
	await fs.writeFile(jsonc, '{/*keep*/"a":[1,2,],}');
	await fs.writeFile(plain, 'not a formatting language');
	const user = path.join(profile, 'user-data', 'User');
	await fs.mkdir(user, { recursive: true });
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
		'editor.tabSize': 2, 'editor.insertSpaces': true, 'editor.detectIndentation': false,
		'files.eol': '\n', 'editor.defaultFormatter': 'missing.old.formatter', 'window.dialogStyle': 'custom'
	}));
	const { page, errors } = await launchNPad(t, profile, [file]);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	t.after(() => t.diagnostic(`Formatting renderer errors: ${JSON.stringify(errors)}`));
	await waitForBuffer(page, source);
	await page.locator('[id="status.editor.mode"]').getByText('JSON', { exact: true }).waitFor();
	await page.locator('.monaco-editor:visible .view-lines').first().click();
	await contextAction(page, 'Format Document');
	const formatted = '{\n  "z": 900719925474099312345,\n  "a": 1e+99,\n  "z": -0\n}';
	await waitForBuffer(page, formatted);
	assert.equal(await fs.readFile(file, 'utf8'), source, 'Formatting does not auto-save');
	await page.keyboard.press('Control+z');
	await waitForBuffer(page, source);
	await page.keyboard.press('Shift+Alt+f');
	await waitForBuffer(page, formatted);

	const selected = '{"a":1,"b":2}';
	const prefix = '{"before":  1, "selected":';
	const suffix = ', "after":  3}';
	await replaceBuffer(page, prefix + selected + suffix);
	await page.keyboard.press('Control+f');
	await page.locator('.find-widget').getByRole('textbox', { name: 'Find', exact: true }).fill(selected);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await contextAction(page, 'Format Selection');
	await waitForBuffer(page, prefix + '{\n    "a": 1,\n    "b": 2\n  }' + suffix);
	await page.keyboard.press('Control+z');
	await waitForBuffer(page, prefix + selected + suffix);

	const multiple = '{"a":{"x":1},"b":{"x":1}}';
	await replaceBuffer(page, multiple);
	await page.keyboard.press('Control+f');
	await page.locator('.find-widget').getByRole('textbox', { name: 'Find', exact: true }).fill('"x":1');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await page.keyboard.press('Control+d');
	await page.keyboard.press('Control+k');
	await page.keyboard.press('Control+f');
	await waitForBuffer(page, '{"a":{"x": 1},"b":{"x": 1}}');
	await page.keyboard.press('Control+z');
	await waitForBuffer(page, multiple);

	await replaceBuffer(page, '{"bad":}');
	await runCommand(page, 'Format Document');
	await page.getByText(/Cannot format this document: Invalid JSON/).last().waitFor();
	await waitForBuffer(page, '{"bad":}');
	await page.keyboard.press('Control+s');
	await runCommand(page, 'File: Set Active Editor Read-only in Session');
	await page.locator('.monaco-editor:visible .view-lines').first().click();
	await page.keyboard.press('Control+a');
	await page.keyboard.press('ContextMenu');
	const readonlyMenu = page.locator('.monaco-menu').first();
	await readonlyMenu.waitFor();
	assert.equal(await readonlyMenu.getByText('Format Document', { exact: true }).count(), 0);
	assert.equal(await readonlyMenu.getByText('Format Selection', { exact: true }).count(), 0);
	await page.keyboard.press('Escape');

	for (const [resource, filename] of [[jsonc, 'comments.jsonc'], [plain, 'plain.txt']]) {
		await page.keyboard.press('Control+p');
		await page.locator('.quick-input-widget input').fill(resource);
		await page.locator('.quick-input-list').getByText(filename, { exact: true }).waitFor();
		await page.keyboard.press('Enter');
		await page.getByRole('tab', { name: new RegExp(filename.replace('.', '\\.')) }).waitFor();
		await page.locator('.monaco-editor:visible .view-lines').first().click();
		await runCommand(page, 'Format Document');
		if (resource === jsonc) {
			await waitForBuffer(page, '{ /*keep*/\n  "a": [\n    1,\n    2,\n  ],\n}');
			assert.equal(await fs.readFile(jsonc, 'utf8'), '{/*keep*/"a":[1,2,],}');
		} else {
			await page.getByText(/Formatting is available for JSON and JSON with Comments/).last().waitFor();
			await waitForBuffer(page, 'not a formatting language');
			assert.equal(await page.getByText('Install Formatter...', { exact: true }).count(), 0);
		}
	}
	assert.deepStrictEqual(errors, []);
});

test('NPad compares two local files from different folders and an unsaved buffer with its saved file', { timeout: 120000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-compare-'));
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	const first = path.join(profile, 'first', 'original.txt');
	const second = path.join(profile, 'second', 'modified.txt');
	const left = 'alpha\nsame\nremoved';
	const right = 'beta\nsame\nadded';
	await fs.mkdir(path.dirname(first), { recursive: true });
	await fs.mkdir(path.dirname(second), { recursive: true });
	await fs.writeFile(first, left);
	await fs.writeFile(second, right);
	const user = path.join(profile, 'user-data', 'User');
	await fs.mkdir(user, { recursive: true });
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
		'window.dialogStyle': 'custom', 'files.simpleDialog.enable': true, 'diffEditor.renderSideBySide': true
	}));
	const { page, errors } = await launchNPad(t, profile, [first]);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	t.after(() => t.diagnostic(`Comparison renderer errors: ${JSON.stringify(errors)}`));
	await waitForBuffer(page, left);
	await runCommand(page, 'NPad: Compare Two Files...');
	const picker = page.locator('.quick-input-widget input');
	await picker.fill(first);
	await page.getByRole('button', { name: 'OK', exact: true }).click();
	await picker.waitFor();
	await picker.fill(second);
	await page.getByRole('button', { name: 'OK', exact: true }).click();
	const diff = page.locator('.monaco-diff-editor:visible');
	await diff.waitFor();
	await diff.locator('.original .view-lines').getByText('alpha', { exact: true }).waitFor();
	await diff.locator('.modified .view-lines').getByText('beta', { exact: true }).waitFor();
	await diff.locator('.line-delete, .char-delete').first().waitFor();
	await diff.locator('.line-insert, .char-insert').first().waitFor();
	assert.equal(await fs.readFile(first, 'utf8'), left);
	assert.equal(await fs.readFile(second, 'utf8'), right);
	await page.keyboard.press('Control+w');
	await page.getByRole('tab', { name: /original\.txt/ }).click();
	await replaceBuffer(page, 'unsaved\nsame\nremoved');
	await page.keyboard.press('Control+p');
	await picker.fill(second);
	await page.locator('.quick-input-list').getByText('modified.txt', { exact: true }).waitFor();
	await page.keyboard.press('Enter');
	const originalTab = page.getByRole('tab', { name: /original\.txt/ });
	const modifiedTab = page.getByRole('tab', { name: /modified\.txt/ });
	await modifiedTab.waitFor();
	assert.equal(await modifiedTab.getAttribute('aria-selected'), 'true');
	await originalTab.click({ button: 'right' });
	const compareTab = page.locator('.monaco-menu .action-label').getByText('Compare with File...', { exact: true });
	await compareTab.waitFor();
	await setTimeout(150);
	await compareTab.click();
	await picker.fill(second);
	await page.locator('.quick-input-list').getByText('modified.txt', { exact: true }).waitFor();
	await page.keyboard.press('Enter');
	await diff.waitFor();
	await diff.locator('.original .view-lines').getByText('unsaved', { exact: true }).waitFor();
	await diff.locator('.modified .view-lines').getByText('beta', { exact: true }).waitFor();
	assert.equal(await fs.readFile(first, 'utf8'), left, 'Tab comparison does not save the dirty original');
	assert.equal(await fs.readFile(second, 'utf8'), right);
	await page.keyboard.press('Control+w');
	await originalTab.click();
	await originalTab.click({ button: 'right' });
	await compareTab.waitFor();
	await setTimeout(150);
	await compareTab.click();
	await picker.waitFor();
	await page.keyboard.press('Escape');
	assert.equal(await diff.count(), 0, 'Cancelling tab comparison opens no diff');
	await runCommand(page, 'File: Compare Active File with Saved');
	await diff.waitFor();
	await diff.locator('.original .view-lines').getByText('alpha', { exact: true }).waitFor();
	await diff.locator('.modified .view-lines').getByText('unsaved', { exact: true }).waitFor();
	assert.equal(await fs.readFile(first, 'utf8'), left);
	await page.keyboard.press('Control+w');
	await page.getByRole('tab', { name: /original\.txt/ }).click();
	await replaceBuffer(page, left);
	await runCommand(page, 'NPad: Compare Two Files...');
	await picker.fill(first);
	await page.getByRole('button', { name: 'OK', exact: true }).click();
	await picker.waitFor();
	await picker.fill(first);
	await page.getByRole('button', { name: 'OK', exact: true }).click();
	await page.getByText('Select two different files to compare.', { exact: true }).waitFor();
	assert.equal(await diff.count(), 0);
	await runCommand(page, 'NPad: Compare Two Files...');
	await page.keyboard.press('Escape');
	assert.equal(await diff.count(), 0, 'Cancellation opens no diff');
	assert.deepStrictEqual(errors, []);
});

test('NPad Save Copy As preserves the active file and print preview treats text as inert content', { timeout: 90000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-file-tools-'));
	const file = path.join(profile, 'original.txt');
	const content = '<script>throw new Error("never execute")</script>\nPlain text print preview';
	await fs.writeFile(file, content);
	const user = path.join(profile, 'user-data', 'User');
	await fs.mkdir(user, { recursive: true });
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({ 'window.dialogStyle': 'custom', 'files.simpleDialog.enable': true }));
	const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
	const app = await electron.launch({
		executablePath: getExecutablePath(process.env.NPAD_TEST_APP),
		args: [`--user-data-dir=${path.join(profile, 'user-data')}`, `--shared-data-dir=${path.join(profile, 'shared-data')}`, `--extensions-dir=${path.join(profile, 'extensions')}`, file],
		env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
	});
	t.after(async () => { await app.close(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });
	const page = await app.firstWindow();
	await page.getByText('Plain text print preview', { exact: true }).waitFor();
	await runCommand(page, 'NPad: Save a Copy As...');
	const pathInput = page.locator('.quick-input-widget input');
	await pathInput.waitFor();
	await pathInput.fill(path.join(profile, 'copy.txt'));
	await page.keyboard.press('Enter');
	const copy = path.join(profile, 'copy.txt');
	for (let attempt = 0; attempt < 50 && !(await fs.stat(copy).catch(error => { if (error.code === 'ENOENT') { return undefined; } throw error; })); attempt++) {
		await setTimeout(100);
	}
	assert.equal(await fs.readFile(copy, 'utf8'), content);
	assert.equal(await fs.readFile(file, 'utf8'), content);
	await page.getByRole('tab', { name: /original\.txt/ }).waitFor();
	assert.equal(await page.getByRole('tab', { name: /copy\.txt/ }).count(), 0);
	const previewPromise = app.waitForEvent('window');
	await runCommand(page, 'NPad: Print...');
	const preview = await previewPromise;
	await preview.locator('pre').waitFor();
	assert.equal(await preview.locator('pre').innerText(), content);
	assert.equal(await preview.locator('script').count(), 0);
	const result = await app.evaluate(async ({ BrowserWindow }) => {
		let window;
		for (const candidate of BrowserWindow.getAllWindows()) {
			if (candidate.webContents.getURL().startsWith('data:text/html')) { window = candidate; break; }
		}
		if (!window) { throw new Error('Missing print preview window'); }
		const preferences = window.webContents.getLastWebPreferences();
		const pdf = await window.webContents.printToPDF({});
		return { sandbox: preferences.sandbox, node: preferences.nodeIntegration, javascript: preferences.javascript, pdf: pdf.subarray(0, 4).toString() };
	});
	assert.deepStrictEqual(result, { sandbox: true, node: false, javascript: false, pdf: '%PDF' });
	await preview.close();
});

test('NPad opens files from unfamiliar folders without Restricted Mode even when trust settings request it', { timeout: 90000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-trust-'));
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	const user = path.join(profile, 'user-data', 'User');
	await fs.mkdir(user, { recursive: true });
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
		'security.workspace.trust.enabled': true,
		'security.workspace.trust.startupPrompt': 'always',
		'security.workspace.trust.banner': 'always',
		'security.workspace.trust.emptyWindow': false,
		'security.workspace.trust.untrustedFiles': 'prompt',
	}));
	const files = [path.join(profile, 'first-folder', 'first.txt'), path.join(profile, 'second-folder', 'second.txt')];
	for (const file of files) {
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, `Unfamiliar file ${path.basename(file)}`);
	}
	const { page, errors } = await launchNPad(t, profile, [files[0]]);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	for (const [index, file] of files.entries()) {
		if (index > 0) {
			await page.keyboard.press('Control+p');
			await page.locator('.quick-input-widget input').fill(file);
			await page.locator('.quick-input-list').getByText(path.basename(file), { exact: true }).waitFor();
			await page.keyboard.press('Enter');
		}
		const text = page.getByText(`Unfamiliar file ${path.basename(file)}`, { exact: true });
		await text.waitFor();
		assert.equal(await page.getByText('Restricted Mode', { exact: true }).count(), 0);
		assert.equal(await page.getByRole('dialog').count(), 0);
		await text.click();
		await page.keyboard.press('Control+End');
		await page.keyboard.type(' edited');
		await page.keyboard.press('Control+s');
		for (let attempt = 0; attempt < 30 && !(await fs.readFile(file, 'utf8')).endsWith(' edited'); attempt++) {
			await setTimeout(100);
		}
		assert.equal(await fs.readFile(file, 'utf8'), `Unfamiliar file ${path.basename(file)} edited`);
	}
	await page.keyboard.press('Control+Shift+P');
	await page.locator('.quick-input-widget input').fill('>Workspace Trust');
	await setTimeout(300);
	const commands = await page.locator('.quick-input-list .label-name').allTextContents();
	assert.deepStrictEqual(commands.filter(command => /Workspace Trust/.test(command)), []);
	assert.deepStrictEqual(errors, []);
});

test('NPad automatically checks only txt and md filenames, while manual identifier checks remain available in every text-file type', { timeout: 180000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-identifier-spelling-'));
	const original = [
		'CaseExample', 'caseExample', 'case_example', 'CASE_EXAMPLE',
		'CaseExampel', 'caseExampel', 'case_exampel', 'CASE_EXAMPEL',
		'HTTPExampel', 'case2Exampel', 'case-exampel'
	].join('\n');
	const files = ['js', 'ts', 'json', 'html', 'xml', 'css', 'md', 'log', 'unknown', 'txt', 'TXT', 'MD', 'markdown', 'text', 'md.bak']
		.map((extension, index) => path.join(profile, `identifiers-${index}.${extension}`));
	const user = path.join(profile, 'user-data', 'User');
	await fs.mkdir(user, { recursive: true });
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	for (const file of files) { await fs.writeFile(file, original); }
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
		'window.menuStyle': 'custom', 'editor.renderValidationDecorations': 'on'
	}));
	const { page, errors } = await launchNPad(t, profile, [files[0]]);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	const underlines = (count: number) => page.waitForFunction(expected => document.querySelectorAll('.squiggly-info').length === expected, count);
	await waitForBuffer(page, original);
	await page.locator('[id="status.editor.mode"]').click();
	await page.locator('.quick-input-widget input').fill('Plain Text');
	await page.locator('.quick-input-list .label-name').filter({ hasText: /^Plain Text$/ }).click();
	await page.locator('[id="status.editor.mode"]').getByText('Plain Text', { exact: true }).waitFor();
	await setTimeout(800);
	assert.equal(await page.locator('.squiggly-info').count(), 0, 'Plain Text language mode must not enable automatic checks in a JavaScript file');
	for (const worker of page.workers()) { assert.notEqual(await worker.evaluate(() => self.name), 'NPad English Spelling'); }
	await runCommand(page, 'NPad: Check Spelling (English)');
	await underlines(7);
	await page.locator('.monaco-editor:visible .view-lines').first().click();
	await page.keyboard.press('ContextMenu');
	await page.locator('.monaco-menu .action-label').getByText('Spelling Suggestions...', { exact: true }).waitFor();
	await page.keyboard.press('Escape');
	for (const [line, suggestion, corrected] of [
		[5, 'Example', 'CaseExample'], [6, 'Example', 'caseExample'],
		[7, 'example', 'case_example'], [8, 'EXAMPLE', 'CASE_EXAMPLE']
	] as const) {
		await page.locator('.monaco-editor:visible .view-lines').first().click();
		await page.keyboard.press('Control+Home');
		for (let index = 1; index < line; index++) { await page.keyboard.press('ArrowDown'); }
		for (let index = 0; index < 6; index++) { await page.keyboard.press('ArrowRight'); }
		await page.keyboard.press('Control+.');
		await pick(page, suggestion);
		const expected = original.split('\n');
		expected[line - 1] = corrected;
		await waitForBuffer(page, expected.join('\n'));
		await underlines(0);
		await setTimeout(800);
		assert.equal(await page.locator('.squiggly-info').count(), 0, 'Manual corrections in other file types must not start automatic rechecking');
		await runCommand(page, 'NPad: Check Spelling (English)');
		await underlines(6);
		assert.equal(await fs.readFile(files[0], 'utf8'), original, 'Identifier corrections must not save or rename other references');
		await page.keyboard.press('Control+z');
		await waitForBuffer(page, original);
		await underlines(0);
		await runCommand(page, 'NPad: Check Spelling (English)');
		await underlines(7);
	}
	await runCommand(page, 'NPad: Clear Spelling Highlights');
	for (const file of files.slice(1)) {
		await page.keyboard.press('Control+p');
		await page.locator('.quick-input-widget input').fill(file);
		await page.locator('.quick-input-list').getByText(path.basename(file), { exact: true }).waitFor();
		await page.keyboard.press('Enter');
		await page.getByRole('tab', { name: new RegExp(path.basename(file).replaceAll('.', '\\.')) }).waitFor();
		await waitForBuffer(page, original);
		const automatic = /\.(txt|md)$/i.test(file);
		if (!automatic) {
			await setTimeout(800);
			assert.equal(await page.locator('.squiggly-info').count(), 0, `${path.basename(file)} must not be checked automatically`);
			for (const worker of page.workers()) { assert.notEqual(await worker.evaluate(() => self.name), 'NPad English Spelling'); }
			await runCommand(page, 'NPad: Check Spelling (English)');
		}
		await underlines(7);
		if (file.endsWith('.txt')) {
			await page.locator('[id="status.editor.mode"]').click();
			await page.locator('.quick-input-widget input').fill('JSON');
			await page.locator('.quick-input-list .label-name').filter({ hasText: /^JSON$/ }).click();
			await page.locator('[id="status.editor.mode"]').getByText('JSON', { exact: true }).waitFor();
			await underlines(7);
			await page.locator('.monaco-editor:visible .view-lines').first().click();
			await page.keyboard.press('Control+Home');
			await page.keyboard.insertText('Exampel_');
			await underlines(8);
			await page.keyboard.press('Control+z');
			await waitForBuffer(page, original);
			await underlines(7);
		}
		await runCommand(page, 'NPad: Clear Spelling Highlights');
	}
	await page.keyboard.press('Control+n');
	await page.getByRole('tab', { name: /Untitled/ }).waitFor();
	await page.locator('.monaco-editor:visible .view-lines').first().click();
	await pasteText(page, 'helo');
	await waitForBuffer(page, 'helo');
	await setTimeout(800);
	assert.equal(await page.locator('.squiggly-info').count(), 0, 'Untitled documents must not be checked automatically');
	for (const worker of page.workers()) { assert.notEqual(await worker.evaluate(() => self.name), 'NPad English Spelling'); }
	assert.deepStrictEqual(errors, []);
});

test('NPad automatic spelling can be stopped and resumed in settings, including across restarts and oversized files', { timeout: 120000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-auto-spelling-'));
	const file = path.join(profile, 'automatic.txt');
	const markdown = path.join(profile, 'automatic.md');
	const large = path.join(profile, 'oversized.txt');
	const skipped = path.join(profile, 'excluded.json');
	const user = path.join(profile, 'user-data', 'User');
	await fs.mkdir(user, { recursive: true });
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	await fs.writeFile(file, 'Hello helo');
	await fs.writeFile(markdown, 'helo\n`mispeling`');
	await fs.writeFile(large, 'word '.repeat(55000));
	await fs.writeFile(skipped, '{"helo":"wrld"}');
	const settingsFile = path.join(user, 'settings.json');
	const baseSettings = { 'window.menuStyle': 'custom', 'window.dialogStyle': 'custom', 'editor.renderValidationDecorations': 'on' };
	await fs.writeFile(settingsFile, JSON.stringify(baseSettings));
	const first = await launchNPad(t, profile, [file]);
	const page = first.page;
	const underlines = (count: number) => page.waitForFunction(expected => document.querySelectorAll('.squiggly-info').length === expected, count);
	const open = async (target: string, mode: string) => {
		await page.keyboard.press('Control+p');
		await page.locator('.quick-input-widget input').fill(target);
		await page.locator('.quick-input-list').getByText(path.basename(target), { exact: true }).waitFor();
		await page.keyboard.press('Enter');
		await page.locator('[id="status.editor.mode"]').getByText(mode, { exact: true }).waitFor();
	};
	await waitForBuffer(page, 'Hello helo');
	await underlines(1);
	await replaceBuffer(page, 'Hello wrld');
	await underlines(1);
	const worker = (await Promise.all(page.workers().map(async worker => ({ worker, name: await worker.evaluate(() => self.name) }))))
		.find(item => item.name === 'NPad English Spelling')?.worker;
	assert.ok(worker);
	await fs.writeFile(settingsFile, JSON.stringify({ ...baseSettings, 'npad.spelling.enabled': false }));
	await underlines(0);
	for (let attempt = 0; attempt < 30 && page.workers().includes(worker); attempt++) { await setTimeout(100); }
	assert.ok(!page.workers().includes(worker), 'Disabling clears all documents and releases the worker');
	await runCommand(page, 'NPad: Check Spelling (English)');
	await page.getByText('Spell checking is disabled. Enable npad.spelling.enabled in Settings to resume.', { exact: true }).waitFor();
	await open(markdown, 'Markdown');
	await setTimeout(800);
	assert.equal(await page.locator('.squiggly-info').count(), 0);
	for (const worker of page.workers()) { assert.notEqual(await worker.evaluate(() => self.name), 'NPad English Spelling'); }
	await open(skipped, 'JSON');
	await fs.writeFile(settingsFile, JSON.stringify({ ...baseSettings, 'npad.spelling.enabled': true }));
	await setTimeout(800);
	assert.equal(await page.locator('.squiggly-info').count(), 0, 'Re-enabling spelling must not automatically check existing JSON files');
	await open(markdown, 'Markdown');
	await underlines(2);
	await open(large, 'Plain Text');
	await page.getByText('Spell checking skipped this document: Spell checking supports documents up to 256 KiB of UTF-8 text.', { exact: true }).waitFor();
	await page.getByRole('tab', { name: /automatic\.md/ }).click();
	await underlines(2);
	await fs.writeFile(settingsFile, JSON.stringify({ ...baseSettings, 'npad.spelling.enabled': false }));
	await underlines(0);
	assert.equal(await fs.readFile(file, 'utf8'), 'Hello helo', 'Automatic checking never saves edits');
	assert.deepStrictEqual(first.errors, []);
	const exited = new Promise<void>(resolve => first.child.once('exit', () => resolve()));
	first.child.kill();
	await exited;
	await first.browser.close();
	const second = await launchNPad(t, profile, [markdown]);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	await waitForBuffer(second.page, 'helo\n`mispeling`');
	await setTimeout(800);
	assert.equal(await second.page.locator('.squiggly-info').count(), 0);
	for (const worker of second.page.workers()) { assert.notEqual(await worker.evaluate(() => self.name), 'NPad English Spelling'); }
	assert.deepStrictEqual(second.errors, []);
});

test('NPad offline spelling runs automatically in txt and md with manual checks elsewhere, undo and persistence; removed window actions stay absent', { timeout: 180000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-spelling-'));
	const file = path.join(profile, 'spelling.txt');
	const markdown = path.join(profile, 'spelling.md');
	const json = path.join(profile, 'spelling.json');
	const user = path.join(profile, 'user-data', 'User');
	await fs.mkdir(user, { recursive: true });
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	const original = 'Hello helo wrld.';
	await fs.writeFile(file, original);
	await fs.writeFile(markdown, 'helo\n```text\nmispeling\n```\n`mispeling`');
	await fs.writeFile(json, '{"helo":"wrld"}');
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
		'window.menuStyle': 'custom', 'window.dialogStyle': 'custom', 'editor.renderValidationDecorations': 'on'
	}));
	const first = await launchNPad(t, profile, [file]);
	const external: string[] = [];
	first.page.on('request', request => { if (/^https?:/i.test(request.url())) { external.push(request.url()); } });
	const page = first.page;
	const waitForUnderlines = (count: number) => page.waitForFunction(expected => document.querySelectorAll('.squiggly-info').length === expected, count);
	const atWord = async (target: Page, offset: number) => {
		await target.locator('.monaco-editor:visible .view-lines').first().click();
		await target.keyboard.press('Control+Home');
		for (let index = 0; index < offset; index++) { await target.keyboard.press('ArrowRight'); }
	};
	await waitForBuffer(page, original);
	await page.locator('[id="status.editor.mode"]').getByText('Plain Text', { exact: true }).waitFor();
	await waitForUnderlines(2);
	await page.getByRole('tab', { name: /spelling\.txt/ }).click({ button: 'right' });
	const tabActions = await page.locator('.monaco-menu .action-label').allTextContents();
	assert.ok(!tabActions.includes('Move into New Window'));
	assert.ok(!tabActions.includes('Copy into New Window'));
	assert.ok(tabActions.includes('Compare with File...'));
	await page.keyboard.press('Escape');
	for (const title of ['Move Editor into New Window', 'Copy Editor into New Window']) {
		await page.keyboard.press('Control+Shift+P');
		await page.locator('.quick-input-widget input').fill(`>${title}`);
		await setTimeout(300);
		assert.equal(await page.locator('.quick-input-list .label-name').filter({ hasText: new RegExp(`^(?:View: )?${title}$`) }).count(), 0);
		await page.keyboard.press('Escape');
	}
	const windows = first.browser.contexts()[0].pages().length;
	await page.locator('.monaco-editor:visible .view-lines').first().click();
	await page.keyboard.press('Control+k');
	await page.keyboard.press('Control+o');
	await setTimeout(200);
	assert.equal(first.browser.contexts()[0].pages().length, windows);
	await runCommand(page, 'NPad: Check Spelling (English)');
	await waitForUnderlines(2);
	const spellingWorker = (await Promise.all(page.workers().map(async worker => ({ worker, name: await worker.evaluate(() => self.name) }))))
		.find(item => item.name === 'NPad English Spelling')?.worker;
	assert.ok(spellingWorker, 'Dictionary must run in an on-demand worker');
	await atWord(page, 7);
	await runCommand(page, 'NPad: Spelling Suggestions...');
	await pick(page, 'hello');
	await waitForBuffer(page, 'Hello hello wrld.');
	await waitForUnderlines(1);
	assert.equal(await fs.readFile(file, 'utf8'), original, 'Correction must not save automatically');
	await page.keyboard.press('Control+z');
	await waitForBuffer(page, original);
	await waitForUnderlines(2);
	await atWord(page, 7);
	await runCommand(page, 'NPad: Spelling Suggestions...');
	await page.keyboard.press('Escape');
	await waitForBuffer(page, original);
	await runCommand(page, 'File: Set Active Editor Read-only in Session');
	await page.locator('.monaco-editor:visible .view-lines').first().click();
	await page.keyboard.press('ContextMenu');
	const suggestionItem = page.locator('.monaco-menu .action-label').getByText('Spelling Suggestions...', { exact: true }).locator('..');
	assert.equal(await suggestionItem.getAttribute('aria-disabled'), 'true');
	await page.keyboard.press('Escape');
	await runCommand(page, 'File: Set Active Editor Writeable in Session');
	await atWord(page, 7);
	await runCommand(page, 'NPad: Spelling Suggestions...');
	await pick(page, "Ignore 'helo' (This Session)");
	await waitForUnderlines(1);
	await atWord(page, 12);
	await page.keyboard.press('Control+.');
	await page.getByText("Add 'wrld' to Personal Dictionary", { exact: true }).click();
	await waitForUnderlines(0);
	for (let attempt = 0; attempt < 30 && !(await fs.readFile(path.join(user, 'settings.json'), 'utf8')).includes('"wrld"'); attempt++) { await setTimeout(100); }
	const settings = JSON.parse(await fs.readFile(path.join(user, 'settings.json'), 'utf8'));
	assert.deepStrictEqual(settings['npad.spelling.userWords'], ['wrld']);
	await runCommand(page, 'NPad: Clear Spelling Highlights');
	for (let attempt = 0; attempt < 30 && page.workers().includes(spellingWorker); attempt++) { await setTimeout(100); }
	assert.ok(!page.workers().includes(spellingWorker), 'Last clear releases the spelling worker');
	assert.equal(await fs.readFile(file, 'utf8'), original);
	assert.deepStrictEqual(external, [], 'Spell checking must not make network requests');
	assert.deepStrictEqual(first.errors, []);
	const exited = new Promise<void>(resolve => first.child.once('exit', () => resolve()));
	first.child.kill();
	await exited;
	await first.browser.close();
	const second = await launchNPad(t, profile, [file]);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	await waitForBuffer(second.page, original);
	await runCommand(second.page, 'NPad: Check Spelling (English)');
	await second.page.waitForFunction(() => document.querySelectorAll('.squiggly-info').length === 1);
	await atWord(second.page, 7);
	await second.page.keyboard.press('Control+.');
	await second.page.getByText("Ignore 'helo' (This Session)", { exact: true }).waitFor();
	await second.page.keyboard.press('Escape');
	await runCommand(second.page, 'NPad: Clear Spelling Highlights');
	for (const [pathToOpen, mode] of [[markdown, 'Markdown'], [json, 'JSON']]) {
		await second.page.keyboard.press('Control+p');
		await second.page.locator('.quick-input-widget input').fill(pathToOpen);
		await second.page.locator('.quick-input-list').getByText(path.basename(pathToOpen), { exact: true }).waitFor();
		await second.page.keyboard.press('Enter');
		await second.page.locator('[id="status.editor.mode"]').getByText(mode, { exact: true }).waitFor();
		await runCommand(second.page, 'NPad: Check Spelling (English)');
		await second.page.waitForFunction(expected => document.querySelectorAll('.squiggly-info').length === expected, mode === 'Markdown' ? 3 : 1);
		await atWord(second.page, mode === 'Markdown' ? 1 : 3);
		await second.page.keyboard.press('Control+.');
		await second.page.getByText("Ignore 'helo' (This Session)", { exact: true }).waitFor();
		await second.page.keyboard.press('Escape');
		await runCommand(second.page, 'NPad: Clear Spelling Highlights');
	}
	assert.deepStrictEqual(second.errors, []);
});

test('packaged NPad has focused editing menus and working visibility and issue-report actions', { timeout: 180000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-menus-'));
	const workspace = path.join(profile, 'workspace');
	const text = path.join(workspace, 'editing.txt');
	const markdown = path.join(workspace, 'preview.md');
	const resultsDir = path.resolve('.build/npad/test-results');
	await fs.mkdir(resultsDir, { recursive: true });
	await fs.mkdir(workspace, { recursive: true });
	await fs.writeFile(text, 'NPad menu check\n');
	await fs.writeFile(markdown, '# NPad menu check\n');
	await fs.mkdir(path.join(profile, 'user-data', 'User'), { recursive: true });
	await fs.writeFile(path.join(profile, 'user-data', 'User', 'settings.json'), JSON.stringify({ 'window.dialogStyle': 'custom', 'workbench.colorTheme': 'Default Light Modern' }));
	const { page, errors } = await launchNPad(t, profile, [workspace, text]);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	await page.getByText('NPad menu check', { exact: true }).waitFor();
	await page.screenshot({ path: path.join(resultsDir, 'menu-startup.png') });
	const icon = await page.locator('.window-appicon').evaluate(async element => {
		const background = getComputedStyle(element).backgroundImage;
		const match = /^url\("?(?<url>[^")]+)"?\)$/.exec(background);
		if (!match?.groups?.url) {
			throw new Error(`Missing application icon: ${background}`);
		}
		const image = new Image();
		image.src = match.groups.url;
		await image.decode();
		return { png: image.src.endsWith('.png'), width: image.naturalWidth, height: image.naturalHeight };
	});
	assert.deepStrictEqual(icon, { png: true, width: 1024, height: 1024 });

	const expected = JSON.parse(await fs.readFile(path.join(import.meta.dirname, 'menubar.json'), 'utf8')) as string[];
	for (const context of ['text', 'markdown', 'empty']) {
		if (context === 'markdown') {
			await page.keyboard.press('Control+p');
			await page.locator('.quick-input-widget input').fill(markdown);
			await page.locator('.quick-input-list').getByText('preview.md', { exact: true }).waitFor();
			await page.keyboard.press('Enter');
		} else if (context === 'empty') {
			await Promise.all([page.waitForEvent('domcontentloaded'), runCommand(page, 'File: Close Folder')]);
			await page.locator('.monaco-workbench').waitFor();
			await page.keyboard.press('Control+Shift+e');
			await page.getByRole('button', { name: 'Open Folder', exact: true }).waitFor();
			await page.getByRole('tab', { name: /Untitled/ }).waitFor();
			await page.locator('.monaco-editor:visible .view-lines').first().click({ position: { x: 10, y: 5 } });
			await page.locator('.monaco-editor:focus-within').waitFor();
		}
		const actual = await readMenubar(page);
		await fs.writeFile(path.join(resultsDir, `menus-${context}.json`), JSON.stringify(actual, null, '\t'));
		// Recent entries are dynamic; the retained history controls are part of the exact snapshot.
		const stable = actual.filter(entry => !entry.startsWith('File > Open Recent > ') || / > (Reopen Closed Editor|More\.\.\.|Clear Recently Opened\.\.\.)$/.test(entry));
		assert.deepStrictEqual(stable.sort(), expected.filter(entry => context !== 'empty' || entry !== 'File > Close Folder').sort(), context);
	}

	await page.keyboard.press('Control+p');
	await page.locator('.quick-input-widget input').fill(text);
	await page.locator('.quick-input-list').getByText('editing.txt', { exact: true }).waitFor();
	await page.keyboard.press('Enter');
	await page.getByRole('tab', { name: /editing\.txt/ }).waitFor();
	for (const label of ['Activity Bar', 'Tab Bar']) {
		const states: (string | null)[] = [];
		for (let count = 0; count < 3; count++) {
			await page.getByRole('menuitem', { name: 'View', exact: true }).click();
			await setTimeout(150);
			await page.getByRole('menuitem', { name: 'Appearance', exact: true }).click();
			const toggle = page.locator('.action-menu-item[role="menuitemcheckbox"]').filter({ hasText: new RegExp(`^${label}$`) });
			await toggle.waitFor();
			states.push(await toggle.getAttribute('aria-checked'));
			if (count < 2) {
				if (count === 0) {
					// Menu items intentionally delay mouse-up handlers by 100 ms.
					await setTimeout(150);
					await toggle.click();
				} else {
					await toggle.hover();
					await page.keyboard.press('Enter');
				}
				if (label === 'Activity Bar') {
					await page.locator('.part.activitybar').waitFor({ state: count === 0 ? 'hidden' : 'visible' });
				} else {
					await page.getByRole('tab', { name: /editing\.txt/ }).waitFor({ state: count === 0 ? 'hidden' : 'visible' });
				}
			} else {
				await page.keyboard.press('Escape');
				await page.keyboard.press('Escape');
			}
		}
		assert.deepStrictEqual(states, ['true', 'false', 'true'], label);
	}
	for (const command of ['View: Toggle Minimap', 'View: Toggle Editor Sticky Scroll', 'Preferences: File Icon Theme', 'Developer: Toggle Developer Tools', 'Emmet: Expand Abbreviation']) {
		await page.keyboard.press('Control+Shift+P');
		await page.locator('.quick-input-widget input').fill(`>${command}`);
		await page.locator('.quick-input-list').getByText(command, { exact: true }).waitFor();
		await page.keyboard.press('Escape');
	}
	await page.locator('.monaco-editor .minimap:visible').waitFor({ state: 'hidden' });
	await runCommand(page, 'View: Toggle Minimap');
	await page.locator('.monaco-editor .minimap:visible').first().waitFor();
	await runCommand(page, 'View: Toggle Minimap');
	await page.locator('.monaco-editor .minimap:visible').waitFor({ state: 'hidden' });
	await runCommand(page, 'Help: Report Issue');
	await page.getByText('This is a local issue draft. No report has been sent.', { exact: true }).waitFor();
	await page.screenshot({ path: path.join(resultsDir, 'local-issue-draft.png') });
	assert.deepStrictEqual(errors, []);
});

test('NPad settings and layout show editing features while essential save errors remain visible', { timeout: 120000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-settings-'));
	const workspace = path.join(profile, 'workspace');
	const file = path.join(workspace, 'editing.txt');
	const resultsDir = path.resolve('.build/npad/test-results');
	await fs.mkdir(resultsDir, { recursive: true });
	await fs.mkdir(workspace, { recursive: true });
	await fs.writeFile(file, 'Original saved content\n');
	await fs.mkdir(path.join(profile, 'user-data', 'User'), { recursive: true });
	await fs.writeFile(path.join(profile, 'user-data', 'User', 'settings.json'), JSON.stringify({ 'window.dialogStyle': 'custom' }));
	const { page, errors } = await launchNPad(t, profile, [workspace, file]);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	await page.getByText('Original saved content', { exact: true }).waitFor();
	await page.screenshot({ path: path.join(resultsDir, 'simplified-startup.png') });
	await page.locator('[id="status.notifications"]').waitFor({ state: 'hidden' });
	assert.equal(await page.locator('.titlebar [aria-label*="Toggle Panel"], .titlebar [aria-label*="Toggle Secondary Side Bar"]').count(), 0);

	await runCommand(page, 'Customize Layout...');
	const layout = await page.locator('.quick-input-list .monaco-list-row').allTextContents();
	assert.deepStrictEqual({
		unused: layout.filter(label => /Secondary Side Bar|Panel|Panel Alignment/.test(label)),
		hasPrimarySideBar: layout.some(label => /Primary Side Bar/.test(label)),
		hasActivityBar: layout.some(label => /Activity Bar/.test(label)),
	}, { unused: [], hasPrimarySideBar: true, hasActivityBar: true });
	await page.screenshot({ path: path.join(resultsDir, 'simplified-customize-layout.png') });
	await page.keyboard.press('Escape');

	await page.keyboard.press('Control+,');
	const settingsSearch = page.locator('.settings-editor .suggest-input-container');
	await settingsSearch.waitFor();
	for (const [retained, removed] of [
		['editor.fontSize', 'debug.openDebug'],
		['files.autoSave', 'terminal.integrated.fontSize'],
		['search.exclude', 'workbench.panel.defaultLocation'],
		['editor.wordWrap', 'editor.inlineSuggest.enabled'],
		['markdown.preview.fontSize', 'workbench.browser.openLocalhostLinks'],
		['workbench.colorTheme', 'workbench.commandPalette.showAskInChat'],
		['files.encoding', 'security.workspace.trust.enabled'],
	]) {
		await settingsSearch.click();
		await page.keyboard.press('Control+a');
		await pasteText(page, `@id:${retained}`);
		const setting = page.locator(`.settings-editor [data-key="${retained}"]`).first();
		await setting.waitFor();
		await settingsSearch.click();
		await page.keyboard.press('Control+a');
		await pasteText(page, `@id:${removed}`);
		await setting.waitFor({ state: 'hidden' });
		await page.getByText('No Settings Found', { exact: true }).first().waitFor();
	}
	await page.screenshot({ path: path.join(resultsDir, 'unsupported-settings-removed.png') });
	await page.keyboard.press('Escape');
	await settingsSearch.waitFor({ state: 'hidden' });
	await page.getByRole('tab', { name: /editing\.txt/ }).click();
	await page.locator('.monaco-editor:visible .view-lines').getByText('Original saved content', { exact: true }).click();
	assert.deepStrictEqual(errors, []);

	await page.keyboard.press('Control+End');
	await pasteText(page, 'Unsaved local edit');
	await page.locator('.tab.dirty').waitFor();
	const externalContent = 'Newer external content that must not be overwritten\n';
	await fs.writeFile(file, externalContent);
	await page.keyboard.press('Control+s');
	await page.getByText(/Failed to save 'editing.txt'/).first().waitFor();
	await page.locator('[id="status.notifications"]').waitFor();
	assert.equal(await fs.readFile(file, 'utf8'), externalContent);
	await page.screenshot({ path: path.join(resultsDir, 'essential-save-error.png') });
	await runCommand(page, 'Notifications: Clear All Notifications');
	await runCommand(page, 'Notifications: Show Notifications');
	await runCommand(page, 'Notifications: Hide Notifications');
	await page.locator('[id="status.notifications"]').waitFor({ state: 'hidden' });
});

test('NPad rejects VSIX installation through its command-line interface', { timeout: 45000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-cli-'));
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	const vsix = path.join(profile, 'unsupported.vsix');
	await fs.writeFile(vsix, '');
	await assert.rejects(promisify(execFile)(getExecutablePath(process.env.NPAD_TEST_APP), [
		path.join(getAppDirectory(process.env.NPAD_TEST_APP), 'out', 'cli.js'),
		`--user-data-dir=${path.join(profile, 'user-data')}`,
		`--extensions-dir=${path.join(profile, 'extensions')}`,
		'--install-extension', vsix,
	], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30000 }), /NPad only supports its bundled editing and preview extensions/);
});

test('packaged NPad edits and searches files, renders previews, and omits IDE commands without errors', { timeout: 180000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-smoke-'));
	const workspace = path.join(profile, 'workspace');
	const file = path.join(workspace, 'editing.txt');
	const markdown = path.join(workspace, 'preview.md');
	const searchFile = path.join(workspace, 'nested', 'search-fixture.txt');
	const secondSearchFile = path.join(workspace, 'search-second.txt');
	const resultsDir = path.resolve(import.meta.dirname, '../../..', '.build/npad/test-results');
	await fs.mkdir(resultsDir, { recursive: true });
	await fs.mkdir(path.dirname(searchFile), { recursive: true });
	await fs.writeFile(file, 'NPad editing check\n');
	await fs.writeFile(markdown, '# NPad Markdown Preview\n\n**Rich previews remain available.**\n\n$$x^2 + y^2 = z^2$$\n\n```mermaid\ngraph TD\nA[NPad] --> B[Preview]\n```\n');
	await fs.writeFile(searchFile, 'NPad search needle\n');
	await fs.writeFile(secondSearchFile, 'NPad search needle\n');
	await fs.mkdir(path.join(profile, 'user-data', 'User'), { recursive: true });
	await fs.writeFile(path.join(profile, 'user-data', 'User', 'settings.json'), JSON.stringify({ 'window.dialogStyle': 'custom' }));
	const { page, errors, output } = await launchNPad(t, profile, [workspace, file]);
	t.after(async () => {
		await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});
	t.after(async () => {
		await fs.writeFile(path.join(resultsDir, 'diagnostics.json'), JSON.stringify({ errors, output: output() }, null, '\t'));
	});
	await page.screenshot({ path: path.join(resultsDir, 'startup.png') });
	await page.getByText('NPad editing check', { exact: true }).waitFor();
	await page.keyboard.press('Control+End');
	await pasteText(page, 'Saved from the lightweight editor.');
	await page.locator('.tab.dirty').waitFor();
	await page.keyboard.press('Control+s');
	const expected = 'NPad editing check\nSaved from the lightweight editor.';
	for (let attempt = 0; attempt < 50 && await fs.readFile(file, 'utf8') !== expected; attempt++) {
		await setTimeout(100);
	}
	assert.equal(await fs.readFile(file, 'utf8'), expected);
	await page.locator('.tab.dirty').waitFor({ state: 'hidden' });
	await page.screenshot({ path: path.join(resultsDir, 'after-save.png') });

	await page.keyboard.press('Control+Shift+f');
	const searchInput = page.getByRole('textbox', { name: /^Search: Type Search Term/ });
	await searchInput.fill('NPad search needle');
	await searchInput.press('Enter');
	await page.locator('.search-view .filematch .label-name').filter({ hasText: 'search-fixture.txt' }).waitFor();
	await page.locator('.search-view .filematch .label-name').filter({ hasText: 'search-second.txt' }).waitFor();
	await page.screenshot({ path: path.join(resultsDir, 'search-results.png') });
	await page.keyboard.press('Control+Shift+h');
	await page.getByRole('textbox', { name: /^Replace: Type replace term/ }).fill('NPad replacement verified');
	await page.getByRole('button', { name: /^Replace All/ }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Replace', exact: true }).click();
	for (let attempt = 0; attempt < 50 && await fs.readFile(searchFile, 'utf8') !== 'NPad replacement verified\n'; attempt++) {
		await setTimeout(100);
	}
	assert.deepStrictEqual(await Promise.all([searchFile, secondSearchFile].map(file => fs.readFile(file, 'utf8'))), [
		'NPad replacement verified\n',
		'NPad replacement verified\n',
	]);
	await page.screenshot({ path: path.join(resultsDir, 'replace-results.png') });
	await page.keyboard.press('Control+Shift+e');
	await page.locator('.explorer-viewlet').waitFor();
	assert.equal(await page.locator('.pane-header').filter({ hasText: /^Outline$/ }).count(), 0);
	await page.screenshot({ path: path.join(resultsDir, 'explorer-without-outline.png') });

	await page.keyboard.press('Control+p');
	await page.screenshot({ path: path.join(resultsDir, 'quick-open.png') });
	await page.locator('.quick-input-widget input').fill(markdown);
	await page.locator('.quick-input-list .label-name').filter({ hasText: 'preview.md' }).waitFor();
	await page.keyboard.press('Enter');
	await page.getByText('NPad Markdown Preview', { exact: false }).first().waitFor();
	await page.keyboard.press('Control+Shift+v');
	const preview = page.frameLocator('iframe.webview').frameLocator('#active-frame');
	await preview.getByRole('heading', { name: 'NPad Markdown Preview', exact: true }).waitFor();
	const math = preview.locator('.katex').first();
	await math.waitFor();
	assert.match(await math.evaluate(element => getComputedStyle(element).fontFamily), /KaTeX/);
	await preview.locator('svg').filter({ hasText: 'NPad' }).first().waitFor();
	await page.screenshot({ path: path.join(resultsDir, 'markdown-preview.png'), animations: 'disabled' });
	await page.getByRole('tab', { name: /editing\.txt/ }).click();

	const unexpectedCommands: string[] = [];
	for (const command of [
		'Chat: Open Chat',
		'Debug: Start Debugging',
		'Terminal: Create New Terminal',
		'Tasks: Run Task',
		'Workspaces: Add Folder to Workspace',
		'Profiles: New Profile',
		'Extensions: Install Extensions',
		'Settings Sync: Turn On',
		'View: Toggle Problems',
		'View: Toggle Output',
		'Browser: Open Integrated Browser',
		'Simple Browser: Show',
		'View: Toggle Panel Visibility',
		'View: Toggle Secondary Side Bar Visibility',
	]) {
		await page.keyboard.press('Control+Shift+P');
		await page.locator('.quick-input-widget input').fill(`>${command}`);
		// Additional command-palette picks have a 200 ms debounce and can include unrelated similar commands.
		await setTimeout(300);
		const labels = await page.locator('.quick-input-list .label-name').allTextContents();
		if (labels.includes(command)) {
			unexpectedCommands.push(command);
		}
		await page.keyboard.press('Escape');
	}
	assert.deepStrictEqual(unexpectedCommands, []);
	await page.getByRole('menuitem', { name: 'View', exact: true }).click();
	assert.deepStrictEqual(await page.getByRole('menuitem').filter({ hasText: /^(Problems|Output)(\s|$)/ }).allTextContents(), []);
	await page.keyboard.press('Escape');

	await page.keyboard.press('Control+Shift+e');
	await page.getByRole('menuitem', { name: 'File', exact: true }).click();
	await page.getByRole('menuitem', { name: /^Close Folder/ }).waitFor();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Control+Shift+P');
	await page.locator('.quick-input-widget input').fill('>File: Close Folder');
	await page.locator('.quick-input-list .label-name').filter({ hasText: 'Close Folder' }).waitFor();
	await Promise.all([
		page.waitForEvent('domcontentloaded'),
		page.keyboard.press('Enter'),
	]);
	await page.locator('.monaco-workbench').waitFor();
	await page.keyboard.press('Control+Shift+e');
	await page.getByRole('button', { name: 'Open Folder', exact: true }).waitFor();
	assert.equal(await page.locator('.explorer-folders-view').count(), 0);
	await page.screenshot({ path: path.join(resultsDir, 'folder-closed.png') });
	assert.deepStrictEqual(errors, []);
});

test('NPad startup tab is ready for typing, closes only the untouched starter when a file opens, and stays closed afterwards', { timeout: 90000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-startup-tab-'));
	const user = path.join(profile, 'user-data', 'User');
	const file = path.join(profile, 'opened.txt');
	await fs.mkdir(user, { recursive: true });
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	await fs.writeFile(file, 'Opened existing file');
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({ 'files.simpleDialog.enable': true, 'window.dialogStyle': 'custom' }));
	const { page, errors } = await launchNPad(t, profile, []);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	const starter = page.getByRole('tab', { name: /Untitled-1/ });
	await starter.waitFor();
	await waitForBuffer(page, '');
	assert.equal(await page.locator('.tabs-container .tab').count(), 1);
	await page.waitForFunction(() => document.activeElement?.closest('.monaco-editor') !== null);
	await page.keyboard.press('Control+o');
	await page.locator('.quick-input-widget input').waitFor();
	await page.keyboard.press('Escape');
	await starter.waitFor();
	assert.equal(await page.locator('.tabs-container .tab').count(), 1, 'Canceling Open must preserve the starter');

	await page.keyboard.press('Control+n');
	const manual = page.getByRole('tab', { name: /Untitled-2/ });
	await manual.waitFor();
	await openFileWithDialog(page, file);
	await waitForBuffer(page, 'Opened existing file');
	await starter.waitFor({ state: 'detached' });
	await manual.waitFor();
	assert.equal(await page.locator('.tabs-container .tab').count(), 2, 'Other new untitled tabs must not be closed');
	await page.keyboard.press('Control+w');
	await manual.click();
	await page.keyboard.press('Control+w');
	await page.getByRole('heading', { name: 'NPad', exact: true }).waitFor();
	await setTimeout(800);
	assert.equal(await page.locator('.tabs-container .tab').count(), 0, 'Closing all tabs must not recreate the starter');
	assert.deepStrictEqual(errors, []);
});

test('NPad startup tab preserves edits, including edits undone to an empty buffer, when a file opens', { timeout: 120000 }, async t => {
	for (const undo of [false, true]) {
		await t.test(undo ? 'edited then undone' : 'modified', async t => {
			const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-startup-edited-'));
			const user = path.join(profile, 'user-data', 'User');
			const file = path.join(profile, 'opened.txt');
			await fs.mkdir(user, { recursive: true });
			await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
			await fs.writeFile(file, 'Existing content');
			// NPad must also track its starter when this upstream preference was selected.
			await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
				'files.simpleDialog.enable': true, 'window.dialogStyle': 'custom', 'workbench.startupEditor': 'newUntitledFile'
			}));
			const { page, errors } = await launchNPad(t, profile, []);
			t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
			const starter = page.getByRole('tab', { name: /Untitled/ });
			await starter.waitFor();
			assert.equal(await page.locator('.tabs-container .tab').count(), 1);
			await pasteText(page, 'My new draft');
			await waitForBuffer(page, 'My new draft');
			if (undo) {
				await page.keyboard.press('Control+z');
				await waitForBuffer(page, '');
				await page.waitForFunction(() => document.querySelectorAll('.tab.dirty').length === 0);
			}
			await openFileWithDialog(page, file);
			await waitForBuffer(page, 'Existing content');
			await setTimeout(800);
			await starter.waitFor();
			assert.equal(await page.locator('.tabs-container .tab').count(), 2);
			await starter.click();
			await waitForBuffer(page, undo ? '' : 'My new draft');
			assert.deepStrictEqual(errors, []);
		});
	}
});

test('NPad reload preserves unsaved recovery without a close prompt or extra starter', { timeout: 90000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-startup-reload-'));
	const user = path.join(profile, 'user-data', 'User');
	const file = path.join(profile, 'opened.txt');
	await fs.mkdir(user, { recursive: true });
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	await fs.writeFile(file, 'Existing file after reload');
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
		'window.dialogStyle': 'custom', 'files.hotExit': 'onExit', 'files.simpleDialog.enable': true
	}));
	const { page, errors } = await launchNPad(t, profile, []);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	await page.getByRole('tab', { name: /Untitled/ }).waitFor();
	await pasteText(page, 'Draft recovered after reload');
	await waitForBuffer(page, 'Draft recovered after reload');
	const reloaded = page.waitForEvent('domcontentloaded');
	await runCommand(page, 'Developer: Reload Window');
	await reloaded;
	await waitForBuffer(page, 'Draft recovered after reload');
	assert.equal(await page.getByRole('dialog').count(), 0, 'Reload should preserve hot exit instead of asking to discard');
	assert.equal(await page.locator('.tabs-container .tab').count(), 1, 'Restored drafts must not get an extra starter');
	await openFileWithDialog(page, file);
	await waitForBuffer(page, 'Existing file after reload');
	await page.getByRole('tab', { name: /Untitled/ }).click();
	await waitForBuffer(page, 'Draft recovered after reload');
	assert.equal(await page.locator('.tabs-container .tab').count(), 2, 'Opening a file must not retire a restored draft');
	assert.deepStrictEqual(errors, []);
});

test('NPad startup restores a crashed untitled draft without adding or retiring it as an empty starter', { timeout: 90000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-startup-recovery-'));
	const user = path.join(profile, 'user-data', 'User');
	const file = path.join(profile, 'opened.txt');
	await fs.mkdir(user, { recursive: true });
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	await fs.writeFile(file, 'Existing content after recovery');
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({ 'files.simpleDialog.enable': true, 'window.dialogStyle': 'custom' }));
	const first = await launchNPad(t, profile, []);
	await first.page.getByRole('tab', { name: /Untitled/ }).waitFor();
	await pasteText(first.page, 'Draft recovered after an unexpected exit');
	await waitForBuffer(first.page, 'Draft recovered after an unexpected exit');
	const backups = path.join(profile, 'user-data', 'Backups');
	let backedUp = false;
	for (let attempt = 0; attempt < 50 && !backedUp; attempt++) {
		const entries = await fs.readdir(backups, { recursive: true });
		for (const entry of entries.filter(entry => path.dirname(entry).endsWith('untitled'))) {
			const target = path.join(backups, entry);
			if ((await fs.stat(target)).isFile() && (await fs.readFile(target, 'utf8')).includes('Draft recovered after an unexpected exit')) {
				backedUp = true;
			}
		}
		if (!backedUp) { await setTimeout(100); }
	}
	assert.ok(backedUp, 'The draft must be backed up before simulating unexpected termination');
	const killed = new Promise<void>(resolve => first.child.once('exit', () => resolve()));
	first.child.kill();
	await killed;
	await first.browser.close();
	const second = await launchNPad(t, profile, []);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	await waitForBuffer(second.page, 'Draft recovered after an unexpected exit');
	assert.equal(await second.page.locator('.tabs-container .tab').count(), 1);
	await openFileWithDialog(second.page, file);
	await waitForBuffer(second.page, 'Existing content after recovery');
	await second.page.getByRole('tab', { name: /Untitled/ }).click();
	await waitForBuffer(second.page, 'Draft recovered after an unexpected exit');
	assert.equal(await second.page.locator('.tabs-container .tab').count(), 2);
	assert.deepStrictEqual([...first.errors, ...second.errors], []);
});

test('NPad confirms unsaved new and modified files on Close Window and Exit, and discards changes only after consent', { timeout: 120000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-close-confirm-'));
	const file = path.join(profile, 'modified.txt');
	const user = path.join(profile, 'user-data', 'User');
	const original = 'Original saved content';
	const modified = 'Modified but not saved';
	const untitled = 'Unsaved new document';
	await fs.mkdir(user, { recursive: true });
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	await fs.writeFile(file, original);
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
		'window.dialogStyle': 'custom', 'window.confirmBeforeClose': 'never',
		'files.hotExit': 'onExitAndWindowClose', 'files.autoSave': 'off'
	}));
	const first = await launchNPad(t, profile, [file]);
	let restarted: Awaited<ReturnType<typeof launchNPad>> | undefined;
	t.after(async () => {
		if (restarted) {
			await restarted.browser.close();
			restarted.child.kill();
		}
		await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});
	const page = first.page;
	await waitForBuffer(page, original);
	assert.equal(await page.locator('.tabs-container .tab').count(), 1, 'Explicit file launches must not get an empty starter');
	await replaceBuffer(page, modified);
	await page.keyboard.press('Control+n');
	await page.getByRole('tab', { name: /Untitled/ }).waitFor();
	await page.locator('.monaco-editor:visible .view-lines').first().click();
	await pasteText(page, untitled);
	await waitForBuffer(page, untitled);
	await page.waitForFunction(() => document.querySelectorAll('.tab.dirty').length === 2);
	await page.keyboard.press('Control+Shift+w');
	const confirmation = page.locator('.monaco-dialog-box[role="dialog"]');
	await confirmation.waitFor();
	assert.match(await confirmation.innerText(), /changes to the following 2 files/);
	assert.match(await confirmation.innerText(), /modified\.txt/);
	assert.ok((await confirmation.innerText()).includes(untitled));
	assert.match(await confirmation.innerText(), /Your changes will be lost if you don't save them/);
	await confirmation.getByRole('button', { name: 'Save All', exact: true }).waitFor();
	await confirmation.getByRole('button', { name: "Don't Save", exact: true }).waitFor();
	await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
	await confirmation.waitFor({ state: 'hidden' });
	assert.equal(first.child.exitCode, null, 'Cancel must keep the app open');
	await waitForBuffer(page, untitled);
	await page.getByRole('tab', { name: /modified\.txt/ }).click();
	await waitForBuffer(page, modified);
	assert.equal(await fs.readFile(file, 'utf8'), original);

	await page.getByRole('menuitem', { name: 'File', exact: true }).click();
	// Menu items intentionally ignore mouse-up for their first 100 ms.
	await setTimeout(150);
	await page.getByRole('menuitem', { name: 'Exit', exact: true }).click();
	await confirmation.waitFor();
	assert.match(await confirmation.innerText(), /changes to the following 2 files/);
	await page.screenshot({ path: path.resolve('.build/npad/test-results/npad-unsaved-exit-confirmation.png') });
	const exited = waitForAppExit(first.child);
	await confirmation.getByRole('button', { name: "Don't Save", exact: true }).click();
	await exited;
	assert.equal(await fs.readFile(file, 'utf8'), original, "Don't Save must not overwrite the saved file");
	assert.deepStrictEqual(first.errors, []);
	await first.browser.close();

	const second = restarted = await launchNPad(t, profile, [file]);
	await waitForBuffer(second.page, original);
	await second.page.locator('.monaco-workbench[class*="theme-defaults"]').waitFor();
	await setTimeout(1500);
	assert.equal(await second.page.locator('.tab.dirty').count(), 0);
	assert.equal(await second.page.getByRole('tab', { name: /Untitled/ }).count(), 0, 'Explicitly discarded untitled content must not return from backups');
	assert.deepStrictEqual(second.errors, []);
	const cleanExit = waitForAppExit(second.child);
	await Promise.all([
		cleanExit,
		second.page.keyboard.press('Control+Shift+w').catch(error => { if (!second.page.isClosed()) { throw error; } })
	]);
});

test('NPad Save on exit saves modified and untitled files, while canceling Save As keeps the app open', { timeout: 120000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-close-save-'));
	const file = path.join(profile, 'modified.txt');
	const savedUntitled = path.join(profile, 'saved-new.txt');
	const user = path.join(profile, 'user-data', 'User');
	await fs.mkdir(user, { recursive: true });
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	await fs.writeFile(file, 'Original');
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
		'window.dialogStyle': 'custom', 'files.simpleDialog.enable': true,
		'files.hotExit': 'onExit', 'files.autoSave': 'off'
	}));
	const { page, child, errors } = await launchNPad(t, profile, [file]);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	await waitForBuffer(page, 'Original');
	await replaceBuffer(page, 'Saved modified file');
	await page.keyboard.press('Control+n');
	await page.getByRole('tab', { name: /Untitled/ }).waitFor();
	await page.locator('.monaco-editor:visible .view-lines').first().click();
	await pasteText(page, 'Saved new file');
	await waitForBuffer(page, 'Saved new file');
	await page.keyboard.press('Control+Shift+w');
	const confirmation = page.locator('.monaco-dialog-box[role="dialog"]');
	await confirmation.getByRole('button', { name: 'Save All', exact: true }).click();
	const picker = page.locator('.quick-input-widget input');
	await picker.waitFor();
	await page.keyboard.press('Escape');
	await picker.waitFor({ state: 'hidden' });
	await page.locator('.tab.dirty').waitFor();
	assert.equal(child.exitCode, null, 'Canceling Save As must veto shutdown');
	await waitForBuffer(page, 'Saved new file');
	await assert.rejects(fs.access(savedUntitled), { code: 'ENOENT' });

	await page.keyboard.press('Control+Shift+w');
	await confirmation.getByRole('button', { name: /^Save(?: All)?$/ }).click();
	await picker.fill(savedUntitled);
	const exited = waitForAppExit(child);
	await page.getByRole('button', { name: 'OK', exact: true }).click();
	await exited;
	assert.equal(await fs.readFile(file, 'utf8'), 'Saved modified file');
	assert.equal(await fs.readFile(savedUntitled, 'utf8'), 'Saved new file');
	assert.deepStrictEqual(errors, []);
});

test('NPad asks before shutdown auto-save and keeps modified content open if saving fails', { timeout: 90000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-close-save-error-'));
	const file = path.join(profile, 'conflict.txt');
	const user = path.join(profile, 'user-data', 'User');
	await fs.mkdir(user, { recursive: true });
	await fs.mkdir(path.resolve('.build/npad/test-results'), { recursive: true });
	await fs.writeFile(file, 'Original content');
	await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
		'window.dialogStyle': 'custom', 'files.hotExit': 'onExitAndWindowClose',
		'files.autoSave': 'onWindowChange'
	}));
	const { page, child, errors } = await launchNPad(t, profile, [file]);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	await waitForBuffer(page, 'Original content');
	await replaceBuffer(page, 'Unsaved local changes');
	const external = 'Newer external content that must not be overwritten';
	await fs.writeFile(file, external);
	await page.keyboard.press('Control+Shift+w');
	const confirmation = page.locator('.monaco-dialog-box[role="dialog"]');
	await confirmation.getByRole('button', { name: 'Save', exact: true }).click();
	await page.getByText(/Failed to save 'conflict.txt'/).first().waitFor();
	assert.equal(child.exitCode, null, 'A failed save must veto closing');
	await page.locator('.tab.dirty').waitFor();
	await waitForBuffer(page, 'Unsaved local changes');
	assert.equal(await fs.readFile(file, 'utf8'), external);
	await page.keyboard.press('Control+Shift+w');
	await confirmation.waitFor();
	const exited = waitForAppExit(child);
	await confirmation.getByRole('button', { name: "Don't Save", exact: true }).click();
	await exited;
	assert.equal(await fs.readFile(file, 'utf8'), external);
	const loggedFailure = /\[text file model\] handleSaveError.*File Modified Since/;
	const shownFailure = /Failed to save 'conflict\.txt'.*content of the file is newer/;
	assert.ok(errors.some(error => loggedFailure.test(error)), 'The intentionally failed save must be logged');
	assert.ok(errors.some(error => shownFailure.test(error)), 'The intentionally failed save must be shown');
	assert.deepStrictEqual(errors.filter(error => !loggedFailure.test(error) && !shownFailure.test(error)), []);
});

test('NPad starts without the previous folder but still opens explicitly requested folders', { timeout: 90000 }, async t => {
	const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-restart-'));
	const workspace = path.join(profile, 'previous-folder');
	await fs.mkdir(workspace, { recursive: true });
	await fs.writeFile(path.join(workspace, 'restart-fixture.txt'), 'Explicit folder opening works.\n');
	await fs.mkdir(path.join(profile, 'user-data', 'User'), { recursive: true });
	await fs.writeFile(path.join(profile, 'user-data', 'User', 'settings.json'), JSON.stringify({ 'window.restoreWindows': 'all' }));
	const first = await launchNPad(t, profile, [workspace]);
	await first.page.keyboard.press('Control+Shift+e');
	await first.page.locator('.explorer-folders-view').waitFor();
	await first.page.getByText('restart-fixture.txt', { exact: true }).waitFor();
	// Closing before the contributed theme finishes loading cancels its startup read.
	await first.page.locator('.monaco-workbench[class*="theme-defaults"]').waitFor();
	const exited = waitForAppExit(first.child);
	await Promise.all([
		exited,
		first.page.keyboard.press('Control+Shift+w').catch(error => { if (!first.page.isClosed()) { throw error; } })
	]);
	const second = await launchNPad(t, profile, []);
	t.after(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
	await second.page.keyboard.press('Control+Shift+e');
	await second.page.getByRole('button', { name: 'Open Folder', exact: true }).waitFor();
	assert.deepStrictEqual({
		folders: await second.page.locator('.explorer-folders-view').count(),
		errors: [...first.errors, ...second.errors],
	}, { folders: 0, errors: [] });
	await second.page.screenshot({ path: path.resolve('.build/npad/test-results/empty-startup.png') });
});
