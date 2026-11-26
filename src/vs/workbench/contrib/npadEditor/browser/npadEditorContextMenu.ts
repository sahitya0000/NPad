/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { LinkDetector } from '../../../../editor/contrib/links/browser/links.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ContextKeyExpr, ContextKeyExpression, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Base64TextError, base64DecodeInputLimit, base64TextLimit, convertBase64Text } from '../common/npadTextTools.js';
import { highlightCommandSwatch } from './npadEditorStyles.js';

const detectedLink = new RawContextKey<boolean>('npad.detectedLink', false);
const selected = EditorContextKeys.hasNonEmptySelection;
const selectedWritable = ContextKeyExpr.and(selected, EditorContextKeys.writable);

function activeEditor(accessor: ServicesAccessor): ICodeEditor {
	const editor = accessor.get(ICodeEditorService).getActiveCodeEditor();
	if (!editor?.hasModel()) {
		throw new Error(localize('npadContextNeedEditor', "Open a text document first."));
	}
	return editor;
}

function linkAtCursor(editor: ICodeEditor) {
	return editor.getSelections()?.every(selection => selection.isEmpty()) ? LinkDetector.get(editor)?.getLinkOccurrence(editor.getPosition())?.link : undefined;
}

class NPadLinkContext extends Disposable implements IEditorContribution {
	static readonly ID = 'npad.linkContext';
	constructor(
		editor: ICodeEditor,
		@IContextKeyService contextKeys: IContextKeyService
	) {
		super();
		const key = detectedLink.bindTo(contextKeys);
		const update = () => key.set(!!linkAtCursor(editor)?.url);
		this._register(editor.onDidChangeCursorSelection(update));
		this._register(editor.onDidChangeModel(update));
		this._register(editor.onDidChangeModelContent(update));
		this._register(editor.onDidChangeModelDecorations(update));
		this._register({ dispose: () => key.reset() });
		update();
	}
}

function base64(accessor: ServicesAccessor, decode: boolean): void {
	const editor = activeEditor(accessor);
	if (editor.getOption(EditorOption.readOnly)) {
		throw new Base64TextError(localize('npadBase64Readonly', "This document is read-only."));
	}
	const model = editor.getModel()!;
	const selections = editor.getSelections()!;
	const lengths = selections.map(selection => model.getValueLengthInRange(selection));
	if (lengths.some(length => !length) || lengths.reduce((sum, length) => sum + length, 0) > (decode ? base64DecodeInputLimit : base64TextLimit)) {
		throw new Base64TextError(localize('npadBase64SelectionLimit', "Select nonempty text totaling at most {0} MiB for Base64 input.", decode ? 2 : 1));
	}
	const edits = selections.map(range => ({ range, text: convertBase64Text(model.getValueInRange(range), decode) }));
	if (!decode && edits.reduce((sum, edit) => sum + edit.text.length, 0) > Math.ceil(base64TextLimit / 3) * 4) {
		throw new Base64TextError(localize('npadBase64OutputLimit', "The combined UTF-8 selections exceed the 1 MiB encoding limit."));
	}
	if (decode && edits.reduce((sum, edit) => sum + new TextEncoder().encode(edit.text).length, 0) > base64TextLimit) {
		throw new Base64TextError(localize('npadBase64DecodedLimit', "The combined decoded UTF-8 text exceeds the 1 MiB limit."));
	}
	editor.pushUndoStop();
	editor.executeEdits('npad.base64', edits);
	editor.pushUndoStop();
	editor.focus();
}

export function registerNPadEditorContextMenus(): void {
	const highlights = new MenuId('NPadContextHighlights');
	const all = new MenuId('NPadContextHighlightAll');
	const one = new MenuId('NPadContextHighlightOne');
	const clear = new MenuId('NPadContextClearHighlight');
	const convertCase = new MenuId('NPadContextConvertCase');
	const convertBase64 = new MenuId('NPadContextBase64');
	registerEditorContribution(NPadLinkContext.ID, NPadLinkContext, EditorContributionInstantiation.BeforeFirstInteraction);
	for (const [id, title, decode] of [
		['npad.base64Encode', localize2('npadBase64Encode', "Base64 Encode (UTF-8)"), false],
		['npad.base64Decode', localize2('npadBase64Decode', "Base64 Decode (UTF-8)"), true]
	] as const) {
		registerAction2(class extends Action2 {
			constructor() {
				super({ id, title, category: localize2('npadContextCategory', "NPad"), f1: true, precondition: selectedWritable });
			}
			override run(accessor: ServicesAccessor): void {
				try {
					base64(accessor, decode);
				} catch (error) {
					if (!(error instanceof Base64TextError)) { throw error; }
					accessor.get(INotificationService).error(error);
				}
			}
		});
	}
	registerAction2(class extends Action2 {
		constructor() {
			super({ id: 'npad.copyLink', title: localize2('npadCopyDetectedLink', "Copy Link Address"), category: localize2('npadContextCategory', "NPad"), f1: true, precondition: detectedLink });
		}
		override async run(accessor: ServicesAccessor): Promise<void> {
			const link = linkAtCursor(activeEditor(accessor));
			if (!link?.url) {
				throw new Error(localize('npadNoDetectedLink', "Place the cursor on a detected link with no text selected."));
			}
			await accessor.get(IClipboardService).writeText(typeof link.url === 'string' ? link.url : link.url.toString());
		}
	});

	for (const [submenu, title, group, order, when] of [
		[highlights, localize('npadContextHighlights', "Highlights"), '8_npad', 1, undefined],
		[convertCase, localize('npadContextCase', "Convert Case"), '8_npad', 2, selectedWritable],
		[convertBase64, localize('npadContextBase64', "Base64"), '8_npad', 3, selectedWritable]
	] as const) {
		MenuRegistry.appendMenuItem(MenuId.EditorContext, { submenu, title, group, order, when });
	}
	for (const [submenu, title, order] of [
		[all, localize('npadContextAll', "Style All Occurrences"), 1],
		[one, localize('npadContextOne', "Style Selection / Word"), 2],
		[clear, localize('npadContextClear', "Clear Style"), 3]
	] as const) {
		MenuRegistry.appendMenuItem(highlights, { submenu, title, group: '1_styles', order });
	}

	const contextFeature = (nppId: string, id: string, title: string, menu: MenuId, group: string, order: number, when?: ContextKeyExpression, precondition?: ContextKeyExpression) => {
		MenuRegistry.appendMenuItem(menu, { command: { id, title, precondition, colorSwatch: highlightCommandSwatch(id), metadata: { description: nppId } }, group, order, when });
	};
	contextFeature('IDM_EDIT_DELETE', 'deleteRight', localize('npadContextDelete', "Delete"), MenuId.EditorContext, '9_cutcopypaste', 5, selectedWritable, selectedWritable);
	contextFeature('IDM_EDIT_SELECTALL', 'selectAll', localize('npadContextSelectAll', "Select All"), MenuId.EditorContext, '9_cutcopypaste', 6);
	contextFeature('IDM_EDIT_UPPERCASE', 'editor.action.transformToUppercase', localize('npadContextUpper', "UPPERCASE"), convertCase, '1_case', 1, selectedWritable, selectedWritable);
	contextFeature('IDM_EDIT_LOWERCASE', 'editor.action.transformToLowercase', localize('npadContextLower', "lowercase"), convertCase, '1_case', 2, selectedWritable, selectedWritable);
	contextFeature('IDM_EDIT_BLOCK_COMMENT', 'editor.action.commentLine', localize('npadContextLineComment', "Toggle Line Comment"), MenuId.EditorContext, '8_npad_comments', 1, EditorContextKeys.writable, EditorContextKeys.writable);
	contextFeature('IDM_EDIT_STREAM_COMMENT', 'editor.action.blockComment', localize('npadContextBlockComment', "Toggle Block Comment"), MenuId.EditorContext, '8_npad_comments', 2, EditorContextKeys.writable, EditorContextKeys.writable);
	contextFeature('IDM_SEARCH_MARKALLEXT1', 'npad.highlightAll1', localize('npadContextAll1', "Style All: 1"), all, '1_styles', 1);
	contextFeature('IDM_SEARCH_MARKALLEXT2', 'npad.highlightAll2', localize('npadContextAll2', "Style All: 2"), all, '1_styles', 2);
	contextFeature('IDM_SEARCH_MARKALLEXT3', 'npad.highlightAll3', localize('npadContextAll3', "Style All: 3"), all, '1_styles', 3);
	contextFeature('IDM_SEARCH_MARKALLEXT4', 'npad.highlightAll4', localize('npadContextAll4', "Style All: 4"), all, '1_styles', 4);
	contextFeature('IDM_SEARCH_MARKALLEXT5', 'npad.highlightAll5', localize('npadContextAll5', "Style All: 5"), all, '1_styles', 5);
	contextFeature('IDM_SEARCH_MARKONEEXT1', 'npad.highlightOne1', localize('npadContextOne1', "Style Selection / Word: 1"), one, '1_styles', 1);
	contextFeature('IDM_SEARCH_MARKONEEXT2', 'npad.highlightOne2', localize('npadContextOne2', "Style Selection / Word: 2"), one, '1_styles', 2);
	contextFeature('IDM_SEARCH_MARKONEEXT3', 'npad.highlightOne3', localize('npadContextOne3', "Style Selection / Word: 3"), one, '1_styles', 3);
	contextFeature('IDM_SEARCH_MARKONEEXT4', 'npad.highlightOne4', localize('npadContextOne4', "Style Selection / Word: 4"), one, '1_styles', 4);
	contextFeature('IDM_SEARCH_MARKONEEXT5', 'npad.highlightOne5', localize('npadContextOne5', "Style Selection / Word: 5"), one, '1_styles', 5);
	contextFeature('IDM_SEARCH_UNMARKALLEXT1', 'npad.clearHighlight1', localize('npadContextClear1', "Clear Style 1"), clear, '1_styles', 1);
	contextFeature('IDM_SEARCH_UNMARKALLEXT2', 'npad.clearHighlight2', localize('npadContextClear2', "Clear Style 2"), clear, '1_styles', 2);
	contextFeature('IDM_SEARCH_UNMARKALLEXT3', 'npad.clearHighlight3', localize('npadContextClear3', "Clear Style 3"), clear, '1_styles', 3);
	contextFeature('IDM_SEARCH_UNMARKALLEXT4', 'npad.clearHighlight4', localize('npadContextClear4', "Clear Style 4"), clear, '1_styles', 4);
	contextFeature('IDM_SEARCH_UNMARKALLEXT5', 'npad.clearHighlight5', localize('npadContextClear5', "Clear Style 5"), clear, '1_styles', 5);
	contextFeature('IDM_SEARCH_CLEARALLMARKS', 'npad.clearHighlights', localize('npadContextClearAll', "Clear All Styles"), clear, '1_styles', 6);
	contextFeature('plugin:MIME Tools:Base64 Encode', 'npad.base64Encode', localize('npadContextEncode', "Base64 Encode (UTF-8)"), convertBase64, '1_base64', 1, selectedWritable, selectedWritable);
	contextFeature('plugin:MIME Tools:Base64 Decode', 'npad.base64Decode', localize('npadContextDecode', "Base64 Decode (UTF-8)"), convertBase64, '1_base64', 2, selectedWritable, selectedWritable);
	contextFeature('plugin:NppExport:Copy all formats to clipboard', 'editor.action.clipboardCopyWithSyntaxHighlightingAction', localize('npadContextRichCopy', "Copy with Syntax Highlighting"), MenuId.EditorContextCopy, '1_copy', 1);
	contextFeature('IDM_EDIT_COPY_LINK', 'npad.copyLink', localize('npadContextCopyLink', "Copy Link Address"), MenuId.EditorContext, '9_cutcopypaste', 3.5, detectedLink, detectedLink);
}
