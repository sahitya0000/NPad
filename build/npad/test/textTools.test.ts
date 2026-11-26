/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';
import { base64DecodeInputLimit, base64TextLimit, cleanupText, columnNumbers, convertBase64Text, documentStatistics, formatCustomDate, parseCodePoint, redactText, sortTextLines } from '../../../src/vs/workbench/contrib/npadEditor/common/npadTextTools.ts';
import { createTextPrintHtml } from '../../../src/vs/platform/native/common/textPrint.ts';
import { build } from 'esbuild';

const jsonFormatterModule = build({
	entryPoints: [path.resolve('src/vs/workbench/contrib/npadEditor/common/npadJsonFormatting.ts')],
	bundle: true, platform: 'node', format: 'esm', write: false
}).then(async result => {
	const module: typeof import('../../../src/vs/workbench/contrib/npadEditor/common/npadJsonFormatting.ts') = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
	return module;
});

function applyJsonEdits(text: string, edits: { offset: number; length: number; content: string }[]): string {
	return [...edits].sort((a, b) => b.offset - a.offset).reduce((value, edit) => value.slice(0, edit.offset) + edit.content + value.slice(edit.offset + edit.length), text);
}

test('JSON formatting preserves lexical values, property order, duplicates and escaped strings', async () => {
	const { formatNPadJson } = await jsonFormatterModule;
	const text = '{"z":900719925474099312345,"a":1e+99,"z":-0,"escape":"\\u0061\\n"}';
	const expected = '{\n  "z": 900719925474099312345,\n  "a": 1e+99,\n  "z": -0,\n  "escape": "\\u0061\\n"\n}';
	assert.equal(applyJsonEdits(text, formatNPadJson(text, undefined, { tabSize: 2, insertSpaces: true, eol: '\n' }, false)), expected);
	assert.deepStrictEqual(formatNPadJson(expected, undefined, { tabSize: 2, insertSpaces: true, eol: '\n' }, false), []);
});

test('JSONC formatting preserves comments, trailing commas, BOM, CRLF and tab indentation', async () => {
	const { formatNPadJson } = await jsonFormatterModule;
	const text = '\uFEFF{\r\n// keep\r\n"a":[1,2,],/* note */\r\n}';
	const formatted = applyJsonEdits(text, formatNPadJson(text, undefined, { tabSize: 4, insertSpaces: false, eol: '\r\n' }, true));
	assert.ok(formatted.startsWith('\uFEFF{'));
	assert.ok(formatted.includes('// keep'));
	assert.ok(formatted.includes('/* note */'));
	assert.ok(formatted.includes('\r\n\t"a": [\r\n\t\t1,\r\n\t\t2,\r\n\t],'));
	assert.equal(formatted.replace(/\r\n/g, '').includes('\n'), false);
});

test('JSON selection formatting never changes text outside the selected offsets', async () => {
	const { formatNPadJson } = await jsonFormatterModule;
	const selection = '{"a":1,"b":2}';
	const prefix = '{"before":  1, "selected":';
	const suffix = ', "after":  3}';
	const text = prefix + selection + suffix;
	const range = { offset: prefix.length, length: selection.length };
	const edits = formatNPadJson(text, range, { tabSize: 2, insertSpaces: true, eol: '\n' }, false);
	assert.ok(edits.length);
	assert.ok(edits.every(edit => edit.offset >= range.offset && edit.offset + edit.length <= range.offset + range.length));
	const formatted = applyJsonEdits(text, edits);
	assert.ok(formatted.startsWith(prefix));
	assert.ok(formatted.endsWith(suffix));
	assert.ok(formatted.includes('"a": 1,'));
});

test('JSON formatting rejects invalid documents and strict-JSON comments/trailing commas before editing', async () => {
	const { formatNPadJson, JsonFormattingError } = await jsonFormatterModule;
	for (const text of ['{"x":}', '{"x":1', '{"x":1,}', '{/*comment*/"x":1}', '{"a" 1}', '[1 2]', '{"escape":"\\q"}', '']) {
		assert.throws(() => formatNPadJson(text, undefined, { tabSize: 2, insertSpaces: true }, false), JsonFormattingError, text);
	}
	assert.throws(() => formatNPadJson('{"ok":1,"bad":}', { offset: 1, length: 6 }, { tabSize: 2, insertSpaces: true }, true), /Invalid JSONC/);
});

test('JSON multiple selections are formatted together without editing intervening text', async () => {
	const { formatNPadJson } = await jsonFormatterModule;
	const text = '{"a":{"x":1},"b":{"x":1}}';
	const needle = '"x":1';
	const ranges = [text.indexOf(needle), text.lastIndexOf(needle)].map(offset => ({ offset, length: needle.length }));
	assert.equal(applyJsonEdits(text, formatNPadJson(text, ranges, { tabSize: 2, insertSpaces: true }, false)), '{"a":{"x": 1},"b":{"x": 1}}');
});

test('JSON formatting has measurable UTF-8, depth and indentation-expansion limits', async () => {
	const { formatNPadJson, jsonFormattingInputLimit, jsonFormattingDepthLimit } = await jsonFormatterModule;
	assert.doesNotThrow(() => formatNPadJson('"' + 'a'.repeat(jsonFormattingInputLimit - 2) + '"', undefined, { insertSpaces: true, tabSize: 2 }, false));
	assert.throws(() => formatNPadJson('"' + 'a'.repeat(jsonFormattingInputLimit - 1) + '"', undefined, {}, false), /1 MiB/);
	assert.throws(() => formatNPadJson('"' + '\u00e9'.repeat(jsonFormattingInputLimit / 2) + '"', undefined, {}, false), /1 MiB/);
	assert.doesNotThrow(() => formatNPadJson('['.repeat(jsonFormattingDepthLimit) + '0' + ']'.repeat(jsonFormattingDepthLimit), undefined, { tabSize: 2, insertSpaces: true }, false));
	assert.throws(() => formatNPadJson('['.repeat(jsonFormattingDepthLimit + 1) + '0' + ']'.repeat(jsonFormattingDepthLimit + 1), undefined, {}, false), /128 nesting/);
	const wide = '['.repeat(100) + Array(6000).fill('0').join(',') + ']'.repeat(100);
	assert.throws(() => formatNPadJson(wide, undefined, { tabSize: 4, insertSpaces: true }, false), /complexity limit/);
});

test('line cleanup preserves EOL and removes only the requested kind of line', () => {
	assert.equal(cleanupText('a\r\na\r\nb\r\na\r\n', 'adjacentDuplicates', '\r\n'), 'a\r\nb\r\na\r\n');
	assert.equal(cleanupText('a\n\n \t\nb\n', 'emptyLines', '\n'), 'a\n \t\nb\n');
	assert.equal(cleanupText('a\n\n \t\nb\n', 'blankLines', '\n'), 'a\nb\n');
	assert.equal(cleanupText('\n\n', 'emptyLines', '\n'), '');
	assert.equal(cleanupText('', 'adjacentDuplicates', '\n'), '');
	assert.equal(cleanupText(' a \n\tb\t\n', 'trimLeading', '\n'), 'a \nb\t\n');
	assert.equal(cleanupText(' a \n\tb\t\n', 'trimBoth', '\n'), 'a\nb\n');
	assert.equal(cleanupText(' a \r\n b \r\n', 'trimAndJoin', '\r\n'), 'a b');
});

test('integer sorting is stable and exact beyond floating-point precision', () => {
	const text = '9007199254740993\n-2\n9007199254740992\n+0\n-0\nnot a number\n\n';
	assert.equal(sortTextLines(text, 'integer', false, '\n'), '-2\n+0\n-0\n9007199254740992\n9007199254740993\nnot a number\n\n');
	assert.equal(sortTextLines('bad\n1\n3\n-2\nalso bad', 'integer', true, '\n'), '3\n1\n-2\nbad\nalso bad');
	assert.equal(sortTextLines('2\r\n1\r\n', 'integer', false, '\r\n'), '1\r\n2\r\n');
});

test('decimal sorting supports comma/dot, signed fractions and arbitrary precision', () => {
	assert.equal(sortTextLines('1.00000000000000002\n1.00000000000000001\n-.5\n0\ninvalid', 'decimalDot', false, '\n'), '-.5\n0\n1.00000000000000001\n1.00000000000000002\ninvalid');
	assert.equal(sortTextLines('1,2\n-1,01\n-1,1\n,5\nbad', 'decimalComma', true, '\n'), '1,2\n,5\n-1,01\n-1,1\nbad');
	assert.equal(sortTextLines('01.0\n1\n+1.00', 'decimalDot', true, '\n'), '01.0\n1\n+1.00');
	assert.equal(sortTextLines('', 'decimalDot', false, '\n'), '');
});

test('length sorting counts Unicode code points and keeps equal lengths stable', () => {
	assert.equal(sortTextLines('aa\n\u{1f600}\nb\n', 'length', false, '\n'), '\u{1f600}\nb\naa\n');
	assert.equal(sortTextLines('a\nbbb\ncc', 'length', true, '\n'), 'bbb\ncc\na');
});

test('custom date formatting has explicit tokens and literal escaping', () => {
	const date = new Date(2026, 0, 2, 3, 4, 5, 6);
	assert.equal(formatCustomDate(date, 'YYYY-MM-DD [at] HH:mm:ss.SSS'), '2026-01-02 at 03:04:05.006');
	assert.equal(formatCustomDate(date, '[YYYY] YYYY'), 'YYYY 2026');
	assert.throws(() => formatCustomDate(date, ''));
	assert.throws(() => formatCustomDate(date, 'x'.repeat(201)));
});

test('column numbering supports negative steps and large exact integers', () => {
	assert.deepEqual(columnNumbers(3, '9007199254740993', '-2'), ['9007199254740993', '9007199254740991', '9007199254740989']);
	assert.deepEqual(columnNumbers(2, '-1', '0'), ['-1', '-1']);
	assert.throws(() => columnNumbers(1, '1.2', '1'));
	assert.throws(() => columnNumbers(1, '1', 'NaN'));
});

test('redaction preserves line endings and handles astral characters', () => {
	assert.equal(redactText('a\u{1f600}\r\nb', false), '\u2588\u2588\r\n\u2588');
	assert.equal(redactText('ab\n', true), '\u25cf\u25cf\n');
});

test('Unicode picker rejects invalid scalars and accepts full Unicode range', () => {
	assert.equal(parseCodePoint('U+03A9'), '\u03a9');
	assert.equal(parseCodePoint('0x1f600'), '\u{1f600}');
	assert.equal(parseCodePoint('10ffff'), '\u{10ffff}');
	for (const value of ['D800', 'DFFF', '110000', '-1', '', 'xyz', 'U+1234567']) {
		assert.throws(() => parseCodePoint(value), value);
	}
});

test('Base64 text conversion is UTF-8, strict, bounded and preserves a BOM', () => {
	for (const text of ['hello', 'a', 'ab', 'abc', '\u03a9\u{1f600}\r\ntext\t', '\ufefftext']) {
		const expected = Buffer.from(text, 'utf8').toString('base64');
		assert.equal(convertBase64Text(text, false), expected);
		assert.equal(convertBase64Text(expected, true), text);
	}
	assert.equal(convertBase64Text(' aGVs\r\nbG8=\t', true), 'hello');
	for (const encoded of ['', ' ', 'a', 'abc', 'a===', '=abc', 'a=b=', '!!!!', 'abcd====', 'Zh==', 'Zm9=', '_w==', '/w==', 'AA==', 'AQ==']) {
		assert.throws(() => convertBase64Text(encoded, true), encoded);
	}
	assert.throws(() => convertBase64Text('\ud800', false));
	assert.throws(() => convertBase64Text('x'.repeat(base64TextLimit + 1), false));
	assert.throws(() => convertBase64Text('\u03a9'.repeat(base64TextLimit / 2 + 1), false));
	assert.throws(() => convertBase64Text(' '.repeat(base64DecodeInputLimit + 1), true));
	const largest = 'x'.repeat(base64TextLimit);
	const largestEncoded = convertBase64Text(largest, false);
	assert.equal(largestEncoded.length, Math.ceil(base64TextLimit / 3) * 4);
	assert.equal(convertBase64Text(largestEncoded, true), largest);
	assert.throws(() => convertBase64Text(Buffer.from(largest + 'x').toString('base64'), true));
	const encoded = 'eHh4'.repeat(base64TextLimit / 4);
	assert.equal(convertBase64Text(encoded, true).length, base64TextLimit * 3 / 4);
	assert.throws(() => convertBase64Text(encoded.slice(0, -1) + '!', true));
});

test('statistics distinguish Unicode characters, UTF-8 bytes and line endings', () => {
	assert.deepEqual(documentStatistics('a \u{1f600}\r\nb\nc\rd'), { characters: 10, words: 5, lines: 4, utf8Bytes: 13, crlf: 1, lf: 1, cr: 1 });
	assert.deepEqual(documentStatistics(''), { characters: 0, words: 0, lines: 1, utf8Bytes: 0, crlf: 0, lf: 0, cr: 0 });
});

test('print preview escapes all source text and cannot load active content', () => {
	const html = createTextPrintHtml('"><img src=x>', '</pre><script>alert(1)</script>&\nsecond line');
	assert.ok(html.includes('&lt;/pre&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;\nsecond line'));
	assert.ok(html.includes("default-src 'none'"));
	assert.ok(!html.includes('<script>'));
	assert.ok(!html.includes('<img'));
});

const highlightRegistrations: [string, string][] = [];
for (const style of [1, 2, 3, 4, 5]) {
	highlightRegistrations.push(
		[`IDM_SEARCH_MARKALLEXT${style}`, `highlightAll${style}`],
		[`IDM_SEARCH_MARKONEEXT${style}`, `highlightOne${style}`],
		[`IDM_SEARCH_UNMARKALLEXT${style}`, `clearHighlight${style}`],
	);
}

test('all 54 editing tools retain their unique source identities and command IDs', async () => {
	const root = path.resolve(import.meta.dirname, '../../..');
	const source = await fs.readFile(path.join(root, 'src/vs/workbench/contrib/npadEditor/browser/npadEditor.contribution.ts'), 'utf8');
	const features = [...source.matchAll(/feature\('([^']+)', '([^']+)'/g)];
	assert.equal(features.length, 54);
	assert.equal(new Set(features.map(match => match[1])).size, 54);
	assert.equal(new Set(features.map(match => match[2])).size, 54);
	assert.deepStrictEqual(Object.fromEntries(features.map(match => [match[1], match[2]])), {
		IDM_FILE_SAVECOPYAS: 'saveCopyAs',
		IDM_FILE_PRINT: 'print',
		IDM_EDIT_INSERT_DATETIME_SHORT: 'dateTimeShort',
		IDM_EDIT_INSERT_DATETIME_LONG: 'dateTimeLong',
		IDM_EDIT_INSERT_DATETIME_CUSTOMIZED: 'dateTimeCustom',
		IDM_EDIT_FILENAMETOCLIP: 'copyFilename',
		IDM_EDIT_CURRENTDIRTOCLIP: 'copyDirectory',
		IDM_EDIT_COPY_ALL_NAMES: 'copyAllFilenames',
		IDM_EDIT_COPY_ALL_PATHS: 'copyAllPaths',
		IDM_EDIT_REMOVE_CONSECUTIVE_DUP_LINES: 'removeAdjacentDuplicates',
		IDM_EDIT_REMOVEEMPTYLINES: 'removeEmptyLines',
		IDM_EDIT_REMOVEEMPTYLINESWITHBLANK: 'removeBlankLines',
		IDM_EDIT_SORTLINES_INTEGER_ASCENDING: 'sortIntegerAscending',
		IDM_EDIT_SORTLINES_INTEGER_DESCENDING: 'sortIntegerDescending',
		IDM_EDIT_SORTLINES_DECIMALCOMMA_ASCENDING: 'sortDecimalCommaAscending',
		IDM_EDIT_SORTLINES_DECIMALCOMMA_DESCENDING: 'sortDecimalCommaDescending',
		IDM_EDIT_SORTLINES_DECIMALDOT_ASCENDING: 'sortDecimalDotAscending',
		IDM_EDIT_SORTLINES_DECIMALDOT_DESCENDING: 'sortDecimalDotDescending',
		IDM_EDIT_SORTLINES_LENGTH_ASCENDING: 'sortLengthAscending',
		IDM_EDIT_SORTLINES_LENGTH_DESCENDING: 'sortLengthDescending',
		IDM_EDIT_TRIMLINEHEAD: 'trimLeading',
		IDM_EDIT_TRIM_BOTH: 'trimBoth',
		IDM_EDIT_TRIMALL: 'trimAndJoin',
		IDM_EDIT_REDACT_SELECTION: 'redactSelection',
		IDM_EDIT_COLUMNMODE: 'columnEditor',
		IDM_EDIT_CHAR_PANEL: 'characterPicker',
		IDM_SEARCH_MARK: 'mark',
		...Object.fromEntries(highlightRegistrations),
		IDM_SEARCH_CLEARALLMARKS: 'clearHighlights',
		IDM_SEARCH_TOGGLE_BOOKMARK: 'toggleBookmark',
		IDM_SEARCH_NEXT_BOOKMARK: 'nextBookmark',
		IDM_SEARCH_PREV_BOOKMARK: 'previousBookmark',
		IDM_SEARCH_CLEAR_BOOKMARKS: 'clearBookmarks',
		IDM_SEARCH_CUTMARKEDLINES: 'cutBookmarkedLines',
		IDM_SEARCH_COPYMARKEDLINES: 'copyBookmarkedLines',
		IDM_SEARCH_DELETEMARKEDLINES: 'removeBookmarkedLines',
		IDM_SEARCH_DELETEUNMARKEDLINES: 'removeNonBookmarkedLines',
		IDM_VIEW_EOL: 'showEndOfLine',
		IDM_VIEW_SUMMARY: 'summary',
		IDM_VIEW_MONITORING: 'monitoring',
	});
});

test('all 26 context actions retain their unique source identities and command IDs', async () => {
	const root = path.resolve(import.meta.dirname, '../../..');
	const source = await fs.readFile(path.join(root, 'src/vs/workbench/contrib/npadEditor/browser/npadEditorContextMenu.ts'), 'utf8');
	const features = [...source.matchAll(/contextFeature\('([^']+)', '([^']+)'/g)];
	assert.equal(features.length, 26);
	assert.equal(new Set(features.map(feature => feature[1])).size, 26);
	assert.equal(new Set(features.map(feature => feature[2])).size, 26);
	assert.deepStrictEqual(Object.fromEntries(features.map(match => [match[1], match[2]])), {
		IDM_EDIT_DELETE: 'deleteRight',
		IDM_EDIT_SELECTALL: 'selectAll',
		IDM_EDIT_UPPERCASE: 'editor.action.transformToUppercase',
		IDM_EDIT_LOWERCASE: 'editor.action.transformToLowercase',
		IDM_EDIT_BLOCK_COMMENT: 'editor.action.commentLine',
		IDM_EDIT_STREAM_COMMENT: 'editor.action.blockComment',
		...Object.fromEntries(highlightRegistrations.map(([source, command]) => [source, `npad.${command}`])),
		IDM_SEARCH_CLEARALLMARKS: 'npad.clearHighlights',
		'plugin:MIME Tools:Base64 Encode': 'npad.base64Encode',
		'plugin:MIME Tools:Base64 Decode': 'npad.base64Decode',
		'plugin:NppExport:Copy all formats to clipboard': 'editor.action.clipboardCopyWithSyntaxHighlightingAction',
		IDM_EDIT_COPY_LINK: 'npad.copyLink',
	});
});
