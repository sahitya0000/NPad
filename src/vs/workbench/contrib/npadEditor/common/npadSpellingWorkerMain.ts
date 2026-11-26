/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import nspell from 'nspell';
import aff from 'dictionary-en/index.aff';
import dic from 'dictionary-en/index.dic';
import { bootstrapWebWorker } from '../../../../base/common/worker/webWorkerBootstrap.js';
import { IWebWorkerServerRequestHandler } from '../../../../base/common/worker/webWorker.js';
import { checkSpellingText, INPadSpellingWorker, isSpellingWord } from './npadSpelling.js';

class NPadSpellingWorker implements INPadSpellingWorker, IWebWorkerServerRequestHandler {
	_requestHandlerBrand: void = undefined;
	private readonly dictionary = nspell({ aff, dic });
	private readonly suggestions = new Map<string, string[]>();

	$check(text: string, ignored: string[]) {
		return checkSpellingText(text, word => this.dictionary.correct(word), ignored);
	}

	$suggest(word: string): string[] {
		if (!isSpellingWord(word) || word.length > 32) { return []; }
		let suggestions = this.suggestions.get(word);
		if (!suggestions) {
			suggestions = this.dictionary.suggest(word.replaceAll('\u2019', "'")).slice(0, 8);
			if (this.suggestions.size === 128) { this.suggestions.clear(); }
			this.suggestions.set(word, suggestions);
		}
		return suggestions;
	}
}

bootstrapWebWorker(() => new NPadSpellingWorker());
