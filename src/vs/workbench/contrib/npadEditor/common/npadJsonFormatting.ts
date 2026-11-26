/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createScanner, SyntaxKind, visit } from '../../../../base/common/json.js';
import { format, type Edit, type FormattingOptions, type Range } from '../../../../base/common/jsonFormatter.js';

export const jsonFormattingInputLimit = 1024 * 1024;
export const jsonFormattingOutputLimit = 4 * 1024 * 1024;
export const jsonFormattingDepthLimit = 128;

export class JsonFormattingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'JsonFormattingError';
	}
}

export function formatNPadJson(text: string, range: Range | Range[] | undefined, options: FormattingOptions, comments: boolean): Edit[] {
	if (new TextEncoder().encode(text).length > jsonFormattingInputLimit) {
		throw new JsonFormattingError('JSON formatting accepts up to 1 MiB of UTF-8 text.');
	}
	const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	const content = text.slice(bom);
	const scanner = createScanner(content);
	let depth = 0;
	let budget = 0;
	const indent = options.insertSpaces ? options.tabSize || 4 : 1;
	for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
		if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) { depth++; }
		if (depth > jsonFormattingDepthLimit) {
			throw new JsonFormattingError('JSON formatting supports up to 128 nesting levels.');
		}
		// Bound potential indentation expansion before the formatter allocates edits.
		budget += scanner.getTokenLength() + (Math.max(0, depth) + 1) * indent + 2;
		if (budget > jsonFormattingOutputLimit) {
			throw new JsonFormattingError('This JSON would exceed the formatting complexity limit (4 MiB output budget).');
		}
		if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) { depth--; }
	}
	let invalidOffset: number | undefined;
	visit(content, { onError: (_error, offset) => { invalidOffset ??= offset; } }, {
		disallowComments: !comments,
		allowTrailingComma: comments,
		allowEmptyContent: false
	});
	if (invalidOffset !== undefined) {
		const before = content.slice(0, invalidOffset);
		const lines = before.split(/\r\n|\r|\n/);
		throw new JsonFormattingError(`Invalid ${comments ? 'JSONC' : 'JSON'} at line ${lines.length}, column ${lines[lines.length - 1].length + 1}. No formatting edits were applied.`);
	}
	const edits = format(content, undefined, options).map(edit => ({ ...edit, offset: edit.offset + bom }));
	// The generic formatter treats ranges as hints. NPad keeps unselected text untouched.
	if (!range) { return edits; }
	const selections = (Array.isArray(range) ? [...range] : [range]).sort((a, b) => a.offset - b.offset);
	let index = 0;
	return edits.filter(edit => {
		while (index < selections.length && selections[index].offset + selections[index].length < edit.offset) { index++; }
		const selection = selections[index];
		return selection && edit.offset >= selection.offset && edit.offset + edit.length <= selection.offset + selection.length
			&& (edit.length > 0 || (edit.offset > selection.offset && edit.offset < selection.offset + selection.length));
	});
}
