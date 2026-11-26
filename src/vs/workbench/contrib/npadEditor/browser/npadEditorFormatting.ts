/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import type { CancellationToken } from '../../../../base/common/cancellation.js';
import { Range } from '../../../../editor/common/core/range.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import type { DocumentFormattingEditProvider, DocumentRangeFormattingEditProvider, FormattingOptions, TextEdit } from '../../../../editor/common/languages.js';
import type { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { localize } from '../../../../nls.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';

export class NPadJsonFormatting extends Disposable {
	constructor(
		@ILanguageFeaturesService languageFeatures: ILanguageFeaturesService,
		@INotificationService private readonly notifications: INotificationService
	) {
		super();
		const selector = [{ language: 'json' }, { language: 'jsonc' }];
		const displayName = localize('npadJsonFormatterName', "NPad JSON / JSONC");
		const provider: DocumentFormattingEditProvider & DocumentRangeFormattingEditProvider = {
			displayName,
			provideDocumentFormattingEdits: (model, options, token) => this.provide(model, undefined, options, token),
			provideDocumentRangeFormattingEdits: (model, range, options, token) => this.provide(model, range, options, token),
			provideDocumentRangesFormattingEdits: (model, ranges, options, token) => this.provide(model, ranges, options, token)
		};
		this._register(languageFeatures.documentFormattingEditProvider.register(selector, provider));
		this._register(languageFeatures.documentRangeFormattingEditProvider.register(selector, provider));
	}

	private async provide(model: ITextModel, ranges: Range | Range[] | undefined, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[]> {
		if (token.isCancellationRequested) { return []; }
		const version = model.getVersionId();
		const text = model.getValue();
		const language = model.getLanguageId();
		const eol = model.getEOL();
		const { formatNPadJson, JsonFormattingError } = await import('../common/npadJsonFormatting.js');
		if (token.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version || model.getLanguageId() !== language) { return []; }
		try {
			const selections = ranges ? (Array.isArray(ranges) ? ranges : [ranges]) : undefined;
			const edits = formatNPadJson(text, selections?.map(range => ({
				offset: model.getOffsetAt(range.getStartPosition()),
				length: model.getOffsetAt(range.getEndPosition()) - model.getOffsetAt(range.getStartPosition())
			})), { ...options, eol }, language === 'jsonc');
			if (token.isCancellationRequested || model.getVersionId() !== version) { return []; }
			return edits.map(edit => ({
				range: Range.fromPositions(model.getPositionAt(edit.offset), model.getPositionAt(edit.offset + edit.length)),
				text: edit.content
			}));
		} catch (error) {
			if (!(error instanceof JsonFormattingError)) { throw error; }
			this.notifications.warn(localize('npadJsonFormattingFailure', "Cannot format this document: {0}", error.message));
			return [];
		}
	}
}

export function registerNPadFormattingMenus(): void {
	for (const [id, title, precondition, order] of [
		['editor.action.formatDocument', localize('npadFormatDocument', "Format Document"), EditorContextKeys.hasDocumentFormattingProvider, 1],
		['editor.action.formatSelection', localize('npadFormatSelection', "Format Selection"), ContextKeyExpr.and(EditorContextKeys.hasDocumentSelectionFormattingProvider, EditorContextKeys.hasNonEmptySelection), 2]
	] as const) {
		MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
			command: { id, title, precondition: ContextKeyExpr.and(EditorContextKeys.writable, precondition) },
			group: '7_npad_format', order
		});
	}
}
