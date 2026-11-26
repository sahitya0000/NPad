/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import nspell from 'nspell';
import { checkSpellingText, spellingInputLimit, spellingMarkerLimit, spellingWordLimit, validateSpellingInput } from '../../../src/vs/workbench/contrib/npadEditor/common/npadSpelling.ts';

const dictionary = Promise.all(['index.aff', 'index.dic'].map(file => fs.readFile(path.resolve('node_modules/dictionary-en', file), 'utf8')))
	.then(([aff, dic]) => nspell({ aff, dic }));

test('offline English dictionary checks real words, inflections and contractions and suggests corrections', async () => {
	const spelling = await dictionary;
	const text = "Hello, this is a helo message. Don't forget the cats.";
	const result = checkSpellingText(text, word => spelling.correct(word), []);
	assert.deepStrictEqual(result.misspellings.map(item => item.word), ['helo']);
	assert.ok(spelling.suggest('helo').includes('hello'));
	assert.ok(spelling.correct('cats'));
	assert.ok(spelling.correct("don't"));
});

test('spelling offsets preserve Unicode UTF-16 positions, repeated occurrences, CRLF and apostrophes', () => {
	const text = "\u{1F600} helo\r\nhelo don\u2019t \u00ef\u00f1\u00e7";
	const seen: string[] = [];
	const result = checkSpellingText(text, word => { seen.push(word); return word === "don't"; }, []);
	assert.deepStrictEqual(result.misspellings.map(item => [item.offset, item.length]), [[3, 4], [9, 4]]);
	for (const item of result.misspellings) { assert.equal(text.slice(item.offset, item.offset + item.length), item.word); }
	assert.deepStrictEqual(seen, ['helo', "don't"]);
});

test('spelling skips URLs, email, numbers and non-ASCII tokens without checking partial Unicode words', () => {
	const text = 'helo https://misspelt.example/mispelt www.misspelt.test x@y.misspelt 42 \u00efword word\u00ef na\u0308ve';
	assert.deepStrictEqual(checkSpellingText(text, () => false, []).misspellings.map(item => item.word), ['helo']);
});

test('Markdown code, comments, markup and link destinations are checked like other file content', () => {
	const text = 'helo\n```text\nCaseExampel\n```\n`case_exampel`\n<!-- CASE_EXAMPEL -->\n<case attr="caseExampel">word</case>\n[label](case_exampel)';
	const correct = new Set(['text', 'case', 'attr', 'word', 'label']);
	assert.deepStrictEqual(checkSpellingText(text, word => correct.has(word.toLowerCase()), []).misspellings.map(item => item.word),
		['helo', 'Exampel', 'exampel', 'EXAMPEL', 'Exampel', 'exampel']);
});

test('real dictionary checks Pascal, camel, snake, uppercase, acronym and numeric identifier components', async () => {
	const spelling = await dictionary;
	const text = 'CaseExample caseExample case_example CASE_EXAMPLE HTTPExample example42Value\nCaseExampel caseExampel case_exampel CASE_EXAMPEL HTTPExampel exampel42Value';
	const result = checkSpellingText(text, word => spelling.correct(word), []);
	assert.deepStrictEqual(result.misspellings.map(item => item.word), ['Exampel', 'Exampel', 'exampel', 'EXAMPEL', 'Exampel', 'exampel']);
	for (const item of result.misspellings) { assert.equal(text.slice(item.offset, item.offset + item.length), item.word); }
	assert.ok(spelling.suggest('Exampel').includes('Example'));
	assert.ok(spelling.suggest('EXAMPEL').includes('EXAMPLE'));
});

test('split identifier ranges and counts are exact across delimiters, acronyms, digits and contractions', () => {
	const text = "\u{1F600} XMLParser userID case2Exampel x_bad Don't can'tParse";
	const expected = ['XML', 'Parser', 'user', 'ID', 'case', 'Exampel', 'bad', "Don't", "can't", 'Parse'];
	const result = checkSpellingText(text, () => false, []);
	assert.deepStrictEqual(result.misspellings.map(item => item.word), expected);
	for (const item of result.misspellings) { assert.equal(text.slice(item.offset, item.offset + item.length), item.word); }
	assert.equal(result.checkedWords, expected.length);
});

test('personal/session words are case-insensitive and canonicalize apostrophes without editing source', () => {
	const result = checkSpellingText("Helo helo don\u2019t wrld", () => false, ['helo', "DON'T"]);
	assert.deepStrictEqual(result.misspellings.map(item => item.word), ['wrld']);
	assert.deepStrictEqual(checkSpellingText('customExampel', () => false, ['CUSTOMEXAMPEL']).misspellings, []);
	assert.deepStrictEqual(checkSpellingText('CaseExampel case_exampel CASE_EXAMPEL', word => word.toLowerCase() === 'case', ['exampel']).misspellings, []);
});

test('spelling enforces exact UTF-8, word and underline limits', () => {
	assert.doesNotThrow(() => validateSpellingInput('x'.repeat(spellingInputLimit)));
	assert.throws(() => validateSpellingInput('x'.repeat(spellingInputLimit + 1)), /256 KiB/);
	assert.doesNotThrow(() => validateSpellingInput('\u00e9'.repeat(spellingInputLimit / 2)));
	assert.throws(() => validateSpellingInput('\u00e9'.repeat(spellingInputLimit / 2 + 1)), /256 KiB/);
	let result = checkSpellingText('wrong '.repeat(spellingMarkerLimit), () => false, []);
	assert.equal(result.misspellings.length, spellingMarkerLimit);
	assert.equal(result.limited, false);
	result = checkSpellingText('wrong '.repeat(spellingMarkerLimit + 1), () => false, []);
	assert.equal(result.misspellings.length, spellingMarkerLimit);
	assert.equal(result.limited, true);
	result = checkSpellingText('word '.repeat(spellingWordLimit + 1), () => true, []);
	assert.equal(result.checkedWords, spellingWordLimit);
	assert.equal(result.limited, true);
	assert.equal(checkSpellingText('word '.repeat(spellingWordLimit), () => true, []).limited, false);
	const started = performance.now();
	result = checkSpellingText('Word'.repeat(spellingWordLimit + 1), () => true, []);
	assert.equal(result.checkedWords, spellingWordLimit);
	assert.equal(result.limited, true);
	assert.ok(performance.now() - started < 2000, 'Long identifiers must not trigger quadratic URL/email scanning');
	const dotted = performance.now();
	checkSpellingText('ab.'.repeat(spellingWordLimit), () => true, []);
	assert.ok(performance.now() - dotted < 2000, 'Dotted identifiers must not trigger quadratic URL/email scanning');
});
