/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';

export const npadHighlightStyles = [
	{ backgroundColor: '#e6b80044', borderColor: '#b99b00' },
	{ backgroundColor: '#40a0ff44', borderColor: '#408fe0' },
	{ backgroundColor: '#52b78844', borderColor: '#399469' },
	{ backgroundColor: '#d778e844', borderColor: '#b350c2' },
	{ backgroundColor: '#ed8a4944', borderColor: '#c86a28' }
] as const;

export function highlightCommandSwatch(command: string) {
	const match = /^npad\.(?:highlightAll|highlightOne|clearHighlight)([1-5])$/.exec(command);
	return match ? npadHighlightStyles[Number(match[1]) - 1] : undefined;
}

export function registerNPadHighlightStyles(): void {
	createStyleSheet(undefined, style => {
		style.textContent = npadHighlightStyles.map((color, index) =>
			`.monaco-editor .npad-highlight-${index + 1}, .codicon-npad-highlight-style-${index + 1} { --npad-highlight-background: ${color.backgroundColor}; --npad-highlight-border: ${color.borderColor}; }`
		).join('\n');
	});
}
