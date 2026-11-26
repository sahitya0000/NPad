/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type Cleanup = 'adjacentDuplicates' | 'emptyLines' | 'blankLines' | 'trimLeading' | 'trimBoth' | 'trimAndJoin';
export type LineSort = 'integer' | 'decimalComma' | 'decimalDot' | 'length';

export const base64TextLimit = 1024 * 1024;
export const base64DecodeInputLimit = 2 * base64TextLimit;
export class Base64TextError extends Error { }

export function convertBase64Text(text: string, decode: boolean): string {
	if (!text || text.length > (decode ? base64DecodeInputLimit : base64TextLimit)) {
		throw new Base64TextError(decode ? 'Select at most 2 MiB of Base64 input.' : 'Select text between 1 character and 1 MiB for Base64 encoding.');
	}
	if (decode) {
		const encoded = text.replace(/[ \t\r\n]/g, '');
		if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
			throw new Base64TextError('Select valid standard Base64 with correct padding.');
		}
		const binary = atob(encoded);
		if (binary.length > base64TextLimit) {
			throw new Base64TextError('Decoded UTF-8 text is limited to 1 MiB.');
		}
		if (btoa(binary) !== encoded) {
			throw new Base64TextError('Base64 contains nonzero padding bits.');
		}
		let result: string;
		try {
			result = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
		} catch (error) {
			if (error instanceof TypeError) {
				throw new Base64TextError('Decoded content is not valid UTF-8 text.');
			}
			throw error;
		}
		if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) {
			throw new Base64TextError('Decoded content contains binary control characters. Only UTF-8 text is supported.');
		}
		return result;
	}
	if (!text.isWellFormed()) {
		throw new Base64TextError('The selection contains an unpaired Unicode surrogate.');
	}
	const bytes = new TextEncoder().encode(text);
	if (bytes.length > base64TextLimit) {
		throw new Base64TextError('Base64 encoding is limited to 1 MiB of UTF-8 text.');
	}
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 8192) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
	}
	return btoa(binary);
}

export function cleanupText(text: string, operation: Cleanup, eol: string): string {
	const lines = text.split(/\r\n|\r|\n/);
	const trailingEol = lines.length > 1 && lines[lines.length - 1] === '';
	if (trailingEol) {
		lines.pop();
	}
	let result: string[];
	switch (operation) {
		case 'adjacentDuplicates': result = lines.filter((line, index) => index === 0 || line !== lines[index - 1]); break;
		case 'emptyLines': result = lines.filter(line => line.length > 0); break;
		case 'blankLines': result = lines.filter(line => !/^\s*$/.test(line)); break;
		case 'trimLeading': result = lines.map(line => line.trimStart()); break;
		case 'trimBoth': result = lines.map(line => line.trim()); break;
		case 'trimAndJoin': return lines.map(line => line.trim()).join(' ');
	}
	return result.join(eol) + (trailingEol && result.length ? eol : '');
}

interface Decimal {
	sign: number;
	whole: string;
	fraction: string;
}

function parseDecimal(value: string, mode: Exclude<LineSort, 'length'>): Decimal | undefined {
	const pattern = mode === 'integer' ? /^[+-]?\d+$/ : mode === 'decimalComma' ? /^[+-]?(?:\d+(?:,\d*)?|,\d+)$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
	value = value.trim();
	if (!pattern.test(value)) {
		return undefined;
	}
	const negative = value.startsWith('-');
	const [whole, fraction = ''] = value.replace(/^[+-]/, '').replace(',', '.').split('.');
	const normalizedWhole = whole.replace(/^0+/, '') || '0';
	const normalizedFraction = fraction.replace(/0+$/, '');
	return { sign: normalizedWhole === '0' && !normalizedFraction ? 0 : negative ? -1 : 1, whole: normalizedWhole, fraction: normalizedFraction };
}

function compareDecimal(a: Decimal, b: Decimal): number {
	if (a.sign !== b.sign) {
		return a.sign - b.sign;
	}
	const width = Math.max(a.fraction.length, b.fraction.length);
	const af = a.fraction.padEnd(width, '0');
	const bf = b.fraction.padEnd(width, '0');
	return a.sign * (a.whole.length - b.whole.length || (a.whole < b.whole ? -1 : a.whole > b.whole ? 1 : af < bf ? -1 : af > bf ? 1 : 0));
}

export function sortTextLines(text: string, mode: LineSort, descending: boolean, eol: string): string {
	const lines = text.split(/\r\n|\r|\n/);
	const trailingEol = lines.length > 1 && lines[lines.length - 1] === '';
	if (trailingEol) {
		lines.pop();
	}
	const entries = lines.map((line, index) => ({ line, index, number: mode === 'length' ? undefined : parseDecimal(line, mode), length: Array.from(line).length }));
	entries.sort((a, b) => {
		let order: number;
		if (mode === 'length') {
			order = a.length - b.length;
		} else {
			// Invalid numeric lines stay at the end in their original order, in both directions.
			if (!a.number || !b.number) {
				return a.number ? -1 : b.number ? 1 : a.index - b.index;
			}
			order = compareDecimal(a.number, b.number);
		}
		return (descending ? -order : order) || a.index - b.index;
	});
	return entries.map(entry => entry.line).join(eol) + (trailingEol ? eol : '');
}

export function formatCustomDate(date: Date, format: string): string {
	if (!format || format.length > 200) {
		throw new Error('Use a date/time format between 1 and 200 characters.');
	}
	const pad = (value: number, width = 2) => String(value).padStart(width, '0');
	const tokens: Record<string, string> = {
		YYYY: pad(date.getFullYear(), 4), MM: pad(date.getMonth() + 1), DD: pad(date.getDate()),
		HH: pad(date.getHours()), mm: pad(date.getMinutes()), ss: pad(date.getSeconds()), SSS: pad(date.getMilliseconds(), 3),
	};
	return format.replace(/\[[^\]]*\]|YYYY|SSS|MM|DD|HH|mm|ss/g, token => token.startsWith('[') ? token.slice(1, -1) : tokens[token]);
}

export function columnNumbers(count: number, start: string, step: string): string[] {
	if (!/^[+-]?\d+$/.test(start) || !/^[+-]?\d+$/.test(step)) {
		throw new Error('Start and step must be whole numbers.');
	}
	const first = BigInt(start);
	const increment = BigInt(step);
	return Array.from({ length: count }, (_, index) => String(first + increment * BigInt(index)));
}

export function redactText(text: string, bullet: boolean): string {
	return text.replace(/[^\r\n]/gu, bullet ? '\u25cf' : '\u2588');
}

export function documentStatistics(text: string) {
	const lines = text.split(/\r\n|\r|\n/);
	return {
		characters: Array.from(text).length,
		words: text.match(/\S+/gu)?.length ?? 0,
		lines: lines.length,
		utf8Bytes: new TextEncoder().encode(text).length,
		crlf: (text.match(/\r\n/g) ?? []).length,
		lf: (text.match(/(?<!\r)\n/g) ?? []).length,
		cr: (text.match(/\r(?!\n)/g) ?? []).length,
	};
}

export function parseCodePoint(value: string): string {
	const match = /^(?:U\+|0x)?([0-9a-f]{1,6})$/i.exec(value.trim());
	const code = match ? Number.parseInt(match[1], 16) : -1;
	if (code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
		throw new Error('Enter a Unicode scalar value, for example U+03A9 (not a surrogate).');
	}
	return String.fromCodePoint(code);
}
