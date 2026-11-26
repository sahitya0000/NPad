/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const spellingInputLimit = 256 * 1024;
export const spellingWordLimit = 20000;
export const spellingMarkerLimit = 200;
export const spellingPersonalWordLimit = 2000;

export class SpellingInputError extends Error { }

export interface SpellingWord {
	word: string;
	offset: number;
	length: number;
}

export interface SpellingResult {
	misspellings: SpellingWord[];
	checkedWords: number;
	limited: boolean;
}

export interface INPadSpellingWorker {
	$check(text: string, ignored: string[]): SpellingResult;
	$suggest(word: string): string[];
}

export function spellingWordKey(word: string): string {
	return word.replaceAll('\u2019', "'").toLowerCase();
}

export function isSpellingWord(word: string): boolean {
	return word.length >= 2 && word.length <= 64 && /^[A-Za-z]+(?:['\u2019][A-Za-z]+)*$/.test(word);
}

export function validateSpellingInput(text: string): void {
	if (text.length > spellingInputLimit || new TextEncoder().encode(text).byteLength > spellingInputLimit) {
		throw new SpellingInputError('Spell checking supports documents up to 256 KiB of UTF-8 text.');
	}
}

function excludedRanges(text: string): { start: number; end: number }[] {
	const ranges: { start: number; end: number }[] = [];
	for (const match of text.matchAll(/(?<![a-z\d+.-])(?:[a-z][a-z\d+.-]*:\/\/|www\.)[^\s<>()]+|(?<![\w.+-])[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)) {
		ranges.push({ start: match.index, end: match.index + match[0].length });
	}
	return ranges;
}

function* spellingParts(word: string, offset: number): Iterable<SpellingWord> {
	let start = 0;
	for (let index = 1; index <= word.length; index++) {
		const previous = word.charCodeAt(index - 1);
		const current = word.charCodeAt(index);
		const next = word.charCodeAt(index + 1);
		const upper = current >= 65 && current <= 90;
		const lowerToUpper = previous >= 97 && previous <= 122 && upper;
		const acronymToTitle = previous >= 65 && previous <= 90 && upper && next >= 97 && next <= 122;
		if (index === word.length || lowerToUpper || acronymToTitle) {
			yield { word: word.slice(start, index), offset: offset + start, length: index - start };
			start = index;
		}
	}
}

export function checkSpellingText(text: string, correct: (word: string) => boolean, ignoredWords: readonly string[]): SpellingResult {
	validateSpellingInput(text);
	const excluded = excludedRanges(text);
	const ignored = new Set(ignoredWords.map(spellingWordKey));
	const cache = new Map<string, boolean>();
	const result: SpellingResult = { misspellings: [], checkedWords: 0, limited: false };
	let excludedIndex = 0;
	for (const match of text.matchAll(/[\p{L}\p{M}]+(?:['\u2019][\p{L}\p{M}]+)*/gu)) {
		const word = match[0];
		const start = match.index;
		const end = start + word.length;
		while (excluded[excludedIndex]?.end <= start) { excludedIndex++; }
		if (excluded[excludedIndex]?.start < end || !/^[A-Za-z]+(?:['\u2019][A-Za-z]+)*$/.test(word)) { continue; }
		const wholeIgnored = ignored.has(spellingWordKey(word));
		for (const part of spellingParts(word, start)) {
			if (!isSpellingWord(part.word)) { continue; }
			if (result.checkedWords === spellingWordLimit) { result.limited = true; return result; }
			result.checkedWords++;
			if (wholeIgnored || ignored.has(spellingWordKey(part.word))) { continue; }
			let valid = cache.get(part.word);
			if (valid === undefined) {
				valid = correct(part.word.replaceAll('\u2019', "'"));
				cache.set(part.word, valid);
			}
			if (!valid) {
				if (result.misspellings.length === spellingMarkerLimit) { result.limited = true; }
				else { result.misspellings.push(part); }
			}
		}
	}
	return result;
}
