/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './npadEditor.css';
import { Codicon } from '../../../../base/common/codicons.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { basename, dirname, isEqual, joinPath } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { Range } from '../../../../editor/common/core/range.js';
import { InjectedTextCursorStops } from '../../../../editor/common/model.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService, IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import product from '../../../../platform/product/common/product.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorResourceAccessor, SideBySideEditor } from '../../../common/editor.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IWorkingCopyBackupService } from '../../../services/workingCopy/common/workingCopyBackup.js';
import { cleanupText, columnNumbers, documentStatistics, formatCustomDate, parseCodePoint, redactText, sortTextLines, type Cleanup, type LineSort } from '../common/npadTextTools.js';
import { INPadEditorState, NPadEditorState } from './npadEditorState.js';
import { registerNPadEditorContextMenus } from './npadEditorContextMenu.js';
import { highlightCommandSwatch, registerNPadHighlightStyles } from './npadEditorStyles.js';
import { NPadJsonFormatting, registerNPadFormattingMenus } from './npadEditorFormatting.js';
import { registerNPadCompareMenus } from './npadEditorCompare.js';
import { registerNPadSpelling } from './npadEditorSpelling.js';

const hasEditor = ContextKeyExpr.has('activeEditor');
const writable = ContextKeyExpr.and(hasEditor, EditorContextKeys.writable);
const insertMenu = new MenuId('NPadInsertMenu');
const textMenu = new MenuId('NPadTextOperationsMenu');
const sortMenu = new MenuId('NPadSortLinesMenu');
const clipboardMenu = new MenuId('NPadCopyMenu');
const bookmarkMenu = new MenuId('NPadBookmarksMenu');
const highlightMenu = new MenuId('NPadHighlightsMenu');
const highlightAllMenu = new MenuId('NPadHighlightAllMenu');
const highlightOneMenu = new MenuId('NPadHighlightOneMenu');
const clearHighlightMenu = new MenuId('NPadClearHighlightsMenu');
const highlightStyleIcons = [1, 2, 3, 4, 5].map(style => registerIcon(`npad-highlight-style-${style}`, Codicon.primitiveSquare, localize('npadHighlightStyleIcon', "Color swatch for highlight style {0}.", style)));

function activeEditor(accessor: ServicesAccessor, write = false): ICodeEditor {
	const editor = accessor.get(ICodeEditorService).getActiveCodeEditor();
	if (!editor?.hasModel()) {
		throw new Error(localize('npadNeedTextEditor', "Open a text document first."));
	}
	if (write && editor.getOption(EditorOption.readOnly)) {
		throw new Error(localize('npadReadonlyEditor', "This document is read-only."));
	}
	return editor;
}

function ensureUnchanged(editor: ICodeEditor, uri: URI, version: number): void {
	if (!editor.hasModel() || !isEqual(editor.getModel().uri, uri) || editor.getModel().getVersionId() !== version || editor.getOption(EditorOption.readOnly)) {
		throw new Error(localize('npadDocumentChanged', "The document changed or became read-only. Run the command again."));
	}
}

function insert(editor: ICodeEditor, text: string | string[]): void {
	const selections = editor.getSelections()!;
	editor.pushUndoStop();
	editor.executeEdits('npad.insert', selections.map((range, index) => ({ range, text: Array.isArray(text) ? text[index] : text })));
	editor.pushUndoStop();
	editor.focus();
}

function transformLines(editor: ICodeEditor, transform: (text: string, eol: string) => string): void {
	const model = editor.getModel()!;
	const selections = editor.getSelections()!;
	const ranges = selections.every(selection => selection.isEmpty()) ? [model.getFullModelRange()] : selections.map(selection => {
		const last = selection.endLineNumber > selection.startLineNumber && selection.endColumn === 1 ? selection.endLineNumber - 1 : selection.endLineNumber;
		return new Range(selection.startLineNumber, 1, last, model.getLineMaxColumn(last));
	}).sort(Range.compareRangesUsingStarts);
	const merged: Range[] = [];
	for (const range of ranges) {
		const previous = merged[merged.length - 1];
		if (previous && range.startLineNumber <= previous.endLineNumber) {
			merged[merged.length - 1] = previous.plusRange(range);
		} else {
			merged.push(range);
		}
	}
	editor.pushUndoStop();
	editor.executeEdits('npad.textOperation', merged.map(range => ({ range, text: transform(model.getValueInRange(range), model.getEOL()) })));
	editor.pushUndoStop();
	editor.focus();
}

function cleanup(operation: Cleanup) {
	return (accessor: ServicesAccessor) => transformLines(activeEditor(accessor, true), (text, eol) => cleanupText(text, operation, eol));
}

function sort(mode: LineSort, descending: boolean) {
	return (accessor: ServicesAccessor) => transformLines(activeEditor(accessor, true), (text, eol) => sortTextLines(text, mode, descending, eol));
}

async function insertDate(accessor: ServicesAccessor, mode: 'short' | 'long' | 'custom'): Promise<void> {
	const editor = activeEditor(accessor, true);
	const model = editor.getModel()!;
	const version = model.getVersionId();
	let text: string;
	if (mode === 'custom') {
		const format = await accessor.get(IQuickInputService).input({
			title: localize('npadCustomDate', "Insert Customized Date/Time"),
			prompt: localize('npadDateTokens', "Tokens: YYYY MM DD HH mm ss SSS. Put literal text in [brackets]."),
			value: 'YYYY-MM-DD HH:mm:ss',
			validateInput: async value => !value || value.length > 200 ? localize('npadDateFormatLength', "Use 1 to 200 characters.") : undefined
		});
		if (format === undefined) {
			return;
		}
		text = formatCustomDate(new Date(), format);
	} else {
		text = new Intl.DateTimeFormat(undefined, { dateStyle: mode === 'short' ? 'short' : 'full', timeStyle: mode === 'short' ? 'short' : 'long' }).format(new Date());
	}
	ensureUnchanged(editor, model.uri, version);
	insert(editor, text);
}

async function copyPaths(accessor: ServicesAccessor, operation: 'name' | 'directory' | 'names' | 'paths'): Promise<void> {
	const editors = accessor.get(IEditorService);
	const resources = operation === 'names' || operation === 'paths' ? editors.editors.map(editor => EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY }))
		: [EditorResourceAccessor.getOriginalUri(editors.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY })];
	const files = [...new Map(resources.filter((uri): uri is URI => uri?.scheme === 'file').map(uri => [uri.toString(), uri])).values()];
	if (!files.length) {
		throw new Error(localize('npadCopySavedPath', "Open a saved local file to copy its path or name."));
	}
	await accessor.get(IClipboardService).writeText(files.map(uri => operation === 'directory' ? dirname(uri).fsPath : operation === 'paths' ? uri.fsPath : basename(uri)).join('\r\n'));
}

async function saveCopy(accessor: ServicesAccessor): Promise<void> {
	const editor = activeEditor(accessor);
	const model = editor.getModel()!;
	const dialogs = accessor.get(IFileDialogService);
	const files = accessor.get(IFileService);
	const textFiles = accessor.get(ITextFileService);
	const confirmations = accessor.get(IDialogService);
	const notifications = accessor.get(INotificationService);
	const target = await dialogs.showSaveDialog({
		title: localize('npadSaveCopy', "Save a Copy As"),
		defaultUri: model.uri.scheme === 'file' ? joinPath(dirname(model.uri), `copy-${basename(model.uri)}`) : joinPath(await dialogs.defaultFilePath(), 'copy.txt'),
		saveLabel: localize('npadSaveCopyButton', "Save Copy")
	});
	if (!target) {
		return;
	}
	if (model.isDisposed() || isEqual(target, model.uri) || textFiles.isDirty(target)) {
		throw new Error(localize('npadCopyTarget', "Choose a different destination without unsaved changes. The original document is not saved or renamed."));
	}
	if (await files.exists(target)) {
		const { confirmed } = await confirmations.confirm({
			message: localize('npadOverwriteCopy', "Replace {0} with a copy?", basename(target)),
			primaryButton: localize('npadOverwriteButton', "&&Replace")
		});
		if (!confirmed) {
			return;
		}
	}
	if (model.isDisposed() || textFiles.isDirty(target)) {
		throw new Error(localize('npadCopyChangedTarget', "The document closed or the destination acquired unsaved changes. Try again."));
	}
	await textFiles.write(target, model.createSnapshot(), { encoding: textFiles.files.get(model.uri)?.getEncoding() ?? textFiles.untitled.get(model.uri)?.getEncoding() ?? 'utf8' });
	notifications.info(localize('npadCopySaved', "Saved a copy to {0}. The active document is unchanged.", target.fsPath));
}

async function columnEditor(accessor: ServicesAccessor): Promise<void> {
	const editor = activeEditor(accessor, true);
	const model = editor.getModel()!;
	const version = model.getVersionId();
	const selections = editor.getSelections()!.slice().sort(Range.compareRangesUsingStarts);
	const quick = accessor.get(IQuickInputService);
	const mode = await quick.pick([
		{ label: localize('npadColumnText', "Insert Text"), mode: 'text' },
		{ label: localize('npadColumnNumbers', "Insert Numbers"), mode: 'numbers' }
	], { title: localize('npadColumnEditor', "Column Editor"), placeHolder: localize('npadColumnScope', "Use rectangular/multiple selections, or insert at the start column on each selected line.") });
	if (!mode) {
		return;
	}
	let ranges: Range[];
	if (selections.length > 1 || selections[0].isSingleLine()) {
		ranges = selections;
	} else {
		const selection = selections[0];
		const last = selection.endColumn === 1 ? selection.endLineNumber - 1 : selection.endLineNumber;
		ranges = Array.from({ length: last - selection.startLineNumber + 1 }, (_, index) => new Range(selection.startLineNumber + index, selection.startColumn, selection.startLineNumber + index, selection.startColumn));
	}
	if (ranges.length > 10000) {
		throw new Error(localize('npadColumnLimit', "Column editing is limited to 10,000 rows per operation."));
	}
	let values: string[];
	if (mode.mode === 'text') {
		const value = await quick.input({ title: localize('npadColumnTextTitle', "Column Text"), prompt: localize('npadColumnTextPrompt', "Text to insert in every selected row"), validateInput: async value => value ? undefined : localize('npadEnterText', "Enter some text.") });
		if (value === undefined) {
			return;
		}
		values = ranges.map(() => value);
	} else {
		const validateInput = async (value: string) => /^[+-]?\d{1,64}$/.test(value) ? undefined : localize('npadWholeNumber', "Enter a whole number (up to 64 digits).");
		const start = await quick.input({ title: localize('npadColumnStart', "Column Numbers: Start"), value: '1', validateInput });
		if (start === undefined) { return; }
		const step = await quick.input({ title: localize('npadColumnStep', "Column Numbers: Step"), value: '1', validateInput });
		if (step === undefined) { return; }
		values = columnNumbers(ranges.length, start, step);
	}
	ensureUnchanged(editor, model.uri, version);
	const edits = ranges.map((range, index) => {
		const maxColumn = model.getLineMaxColumn(range.startLineNumber);
		const padding = Math.max(0, range.startColumn - maxColumn);
		return { range: model.validateRange(range), text: ' '.repeat(padding) + values[index] };
	});
	editor.pushUndoStop();
	editor.executeEdits('npad.columnEditor', edits);
	editor.pushUndoStop();
	editor.focus();
}

async function redact(accessor: ServicesAccessor): Promise<void> {
	const editor = activeEditor(accessor, true);
	const model = editor.getModel()!;
	const selections = editor.getSelections()!;
	if (selections.some(selection => selection.isEmpty())) {
		throw new Error(localize('npadRedactSelection', "Select the text to redact first."));
	}
	const version = model.getVersionId();
	const quick = accessor.get(IQuickInputService);
	const mode = await quick.pick([
		{ label: localize('npadRedactBlocks', "Replace with Blocks"), bullet: false },
		{ label: localize('npadRedactBullets', "Replace with Bullets"), bullet: true }
	], { title: localize('npadRedactTitle', "Redact Selection"), placeHolder: localize('npadRedactWarning', "Visible redaction only: undo, local history and backups may retain the original text.") });
	if (!mode) { return; }
	ensureUnchanged(editor, model.uri, version);
	insert(editor, selections.map(selection => redactText(model.getValueInRange(selection), mode.bullet)));
}

async function characterPicker(accessor: ServicesAccessor): Promise<void> {
	const editor = activeEditor(accessor, true);
	const model = editor.getModel()!;
	const version = model.getVersionId();
	const quick = accessor.get(IQuickInputService);
	const picked = await quick.pick([
		{ label: localize('npadUnicodeCodePoint', "Enter Unicode Code Point..."), value: '' },
		{ label: '\u00a0  U+00A0', description: localize('npadNbsp', "Non-breaking space"), value: '\u00a0' },
		{ label: '\u2014  U+2014', description: localize('npadEmDash', "Em dash"), value: '\u2014' },
		{ label: '\u2022  U+2022', description: localize('npadBullet', "Bullet"), value: '\u2022' },
		{ label: '\u00a9  U+00A9', description: localize('npadCopyright', "Copyright"), value: '\u00a9' },
		{ label: '\u2192  U+2192', description: localize('npadArrow', "Right arrow"), value: '\u2192' },
		{ label: '\u03a9  U+03A9', description: localize('npadOmega', "Greek capital omega"), value: '\u03a9' },
		{ label: '\u2713  U+2713', description: localize('npadCheckmark', "Check mark"), value: '\u2713' }
	], { title: localize('npadCharacterPicker', "Character / Unicode Picker"), matchOnDescription: true });
	if (!picked) { return; }
	let value = picked.value;
	if (!value) {
		const code = await quick.input({
			title: localize('npadUnicodeTitle', "Insert Unicode Character"), placeHolder: 'U+03A9',
			validateInput: async input => {
				try { parseCodePoint(input); return undefined; }
				catch { return localize('npadInvalidCodePoint', "Enter a valid Unicode scalar, for example U+03A9 or U+1F600 (not a surrogate)."); }
			}
		});
		if (code === undefined) { return; }
		value = parseCodePoint(code);
	}
	ensureUnchanged(editor, model.uri, version);
	insert(editor, value);
}

async function mark(accessor: ServicesAccessor): Promise<void> {
	const editor = activeEditor(accessor);
	const model = editor.getModel()!;
	const version = model.getVersionId();
	const quick = accessor.get(IQuickInputService);
	const state = accessor.get(INPadEditorState);
	const text = await quick.input({
		title: localize('npadMarkText', "Mark Text"),
		value: model.getValueInRange(editor.getSelection()!),
		prompt: localize('npadMarkPrompt', "Highlight all literal, case-sensitive occurrences in this document."),
		validateInput: async value => value ? undefined : localize('npadEnterText', "Enter some text.")
	});
	if (text === undefined) { return; }
	const style = await quick.pick(highlightStyleIcons.map((icon, index) => ({ label: localize('npadStyleNumber', "Style {0}", index + 1), iconClasses: ThemeIcon.asClassNameArray(icon), index })), { title: localize('npadMarkStyle', "Highlight Style") });
	if (!style) { return; }
	if (model.isDisposed() || editor.getModel() !== model || model.getVersionId() !== version) {
		throw new Error(localize('npadHighlightChanged', "The document changed. Run Mark Text again."));
	}
	state.highlight(editor, style.index, true, text);
	editor.focus();
}

async function summary(accessor: ServicesAccessor): Promise<void> {
	const model = activeEditor(accessor).getModel()!;
	const stats = documentStatistics(model.getValue());
	const textFiles = accessor.get(ITextFileService);
	const textFile = textFiles.files.get(model.uri);
	const files = accessor.get(IFileService);
	const dialogs = accessor.get(IDialogService);
	const dirty = textFiles.isDirty(model.uri);
	const stat = model.uri.scheme === 'file' ? await files.stat(model.uri) : undefined;
	await dialogs.info(
		localize('npadStatistics', "Document Summary"),
		localize('npadStatisticsDetails', "File: {0}\nCharacters (Unicode code points): {1}\nWords (whitespace-delimited): {2}\nLines: {3}\nUTF-8 buffer bytes (without BOM): {4}\nDisk bytes: {5}\nEncoding: {6}\nLine endings: {7} CRLF, {8} LF, {9} CR\nUnsaved changes: {10}",
			model.uri.scheme === 'file' ? model.uri.fsPath : model.uri.toString(), stats.characters, stats.words, stats.lines, stats.utf8Bytes,
			stat?.size ?? localize('npadNotSaved', "Not saved"), textFile?.getEncoding() ?? 'UTF-8', stats.crlf, stats.lf, stats.cr, dirty)
	);
}

class NPadEndOfLine extends Disposable implements IEditorContribution {
	static readonly ID = 'npad.endOfLine';
	private readonly decorations;
	constructor(
		private readonly editor: ICodeEditor,
		@IConfigurationService private readonly configuration: IConfigurationService
	) {
		super();
		this.decorations = editor.createDecorationsCollection();
		this._register(editor.onDidScrollChange(() => this.update()));
		this._register(editor.onDidLayoutChange(() => this.update()));
		this._register(editor.onDidChangeModel(() => this.update()));
		this._register(editor.onDidChangeModelContent(() => this.update()));
		this._register(configuration.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('npad.showEndOfLine')) { this.update(); }
		}));
		this.update();
	}
	private update(): void {
		const model = this.editor.getModel();
		if (!model || !this.configuration.getValue<boolean>('npad.showEndOfLine', { resource: model.uri })) {
			this.decorations.clear();
			return;
		}
		const lines = new Set<number>();
		for (const range of this.editor.getVisibleRanges()) {
			for (let line = range.startLineNumber; line <= range.endLineNumber; line++) {
				if (line < model.getLineCount()) { lines.add(line); }
			}
		}
		this.decorations.set([...lines].map(line => ({
			range: new Range(line, model.getLineMaxColumn(line), line, model.getLineMaxColumn(line)),
			options: { description: 'npad-eol', showIfCollapsed: true, after: { content: model.getEOL() === '\r\n' ? ' CRLF \u21b5' : ' LF \u21b5', inlineClassName: 'npad-eol-marker', cursorStops: InjectedTextCursorStops.None } }
		})));
	}
	override dispose(): void {
		this.decorations.clear();
		super.dispose();
	}
}

class NPadEditorStateRestorer {
	constructor(@INPadEditorState _state: NPadEditorState) { }
}

class NPadStartupEditor extends Disposable {
	private readonly tracking = this._register(new DisposableStore());

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IWorkingCopyBackupService private readonly backupService: IWorkingCopyBackupService
	) {
		super();
		this.openStartupEditor().catch(onUnexpectedError);
	}

	private async openStartupEditor(): Promise<void> {
		await this.editorGroupsService.whenRestored;
		if (this.editorService.count > 0) {
			return;
		}
		const backups = await this.backupService.getBackups();
		if (this.editorService.count > 0 || backups.length > 0 || this.tracking.isDisposed) {
			return;
		}

		const model = this.textFileService.untitled.create();
		// Stop tracking on the first edit, even if undo later makes the buffer empty.
		this.tracking.add(model.onDidChangeContent(() => this.tracking.dispose()));
		this.tracking.add(model.onWillDispose(() => this.tracking.dispose()));
		const pane = await this.editorService.openEditor({ resource: model.resource, forceUntitled: true, options: { pinned: true } });
		const editor = pane?.input;
		if (!editor || this.tracking.isDisposed) {
			this.tracking.dispose();
			return;
		}

		const closeStartupEditor = () => {
			if (editor.isDisposed() || editor.isModified() || !this.editorService.editors.includes(editor)) {
				this.tracking.dispose();
				return;
			}
			if (!this.editorService.editors.some(input => EditorResourceAccessor.getOriginalUri(input, { supportSideBySide: SideBySideEditor.PRIMARY })?.scheme === Schemas.file)) {
				return;
			}
			this.tracking.dispose();
			const editors = this.editorService.findEditors(model.resource).filter(identifier => identifier.editor === editor);
			this.editorService.closeEditors(editors).catch(onUnexpectedError);
		};
		this.tracking.add(this.editorService.onDidEditorsChange(closeStartupEditor));
		closeStartupEditor();
	}
}

if (product.isNPad) {
	registerNPadHighlightStyles();
	registerNPadEditorContextMenus();
	registerNPadFormattingMenus();
	registerNPadCompareMenus();
	registerNPadSpelling();
	registerWorkbenchContribution2('workbench.contrib.npadJsonFormatting', NPadJsonFormatting, WorkbenchPhase.BlockRestore);
	registerSingleton(INPadEditorState, NPadEditorState, InstantiationType.Delayed);
	registerWorkbenchContribution2('workbench.contrib.npadEditorState', NPadEditorStateRestorer, WorkbenchPhase.AfterRestored);
	registerWorkbenchContribution2('workbench.contrib.npadStartupEditor', NPadStartupEditor, WorkbenchPhase.AfterRestored);
	registerEditorContribution(NPadEndOfLine.ID, NPadEndOfLine, EditorContributionInstantiation.AfterFirstRender);
	Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
		id: 'npad', title: localize('npadSettings', "NPad"), properties: {
			'npad.showEndOfLine': { type: 'boolean', default: false, description: localize('npadEolSetting', "Show CRLF or LF markers at the ends of visible lines.") }
		}
	});
	for (const [submenu, title, order] of [
		[insertMenu, localize('npadInsertMenu', "Insert"), 1],
		[textMenu, localize('npadTextMenu', "Text Operations"), 2],
		[clipboardMenu, localize('npadClipboardMenu', "Copy to Clipboard"), 3],
		[bookmarkMenu, localize('npadBookmarkMenu', "Bookmarks"), 4],
		[highlightMenu, localize('npadHighlightMenu', "Highlights"), 5]
	] as const) {
		MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, { submenu, title, group: '8_npad_tools', order });
	}
	MenuRegistry.appendMenuItem(textMenu, { submenu: sortMenu, title: localize('npadSortMenu', "Sort Lines"), group: '2_sort', order: 1 });
	for (const [submenu, title, order] of [
		[highlightAllMenu, localize('npadHighlightAllMenu', "Style All Occurrences"), 2],
		[highlightOneMenu, localize('npadHighlightOneMenu', "Style Selection / Word"), 3],
		[clearHighlightMenu, localize('npadClearHighlightMenu', "Clear Style"), 4]
	] as const) {
		MenuRegistry.appendMenuItem(highlightMenu, { submenu, title, group: '1_highlights', order });
	}

	type Label = ReturnType<typeof localize2>;
	const feature = (nppId: string, id: string, title: Label, menu: MenuId, run: (accessor: ServicesAccessor) => void | Promise<void>, write = false, toggled?: ContextKeyExpression) => {
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: `npad.${id}`, title, category: localize2('npadCategory', "NPad"), f1: true,
					colorSwatch: highlightCommandSwatch(`npad.${id}`),
					precondition: write ? writable : hasEditor,
					toggled,
					menu: { id: menu, group: menu === MenuId.MenubarFileMenu ? '4_npad_file' : menu === MenuId.MenubarViewMenu ? '8_npad_tools' : '1_actions', order: featureOrder++ },
					metadata: { description: `${nppId}: ${title.original}` }
				});
			}
			override run(accessor: ServicesAccessor) { return run(accessor); }
		});
	};
	let featureOrder = 0;
	feature('IDM_FILE_SAVECOPYAS', 'saveCopyAs', localize2('npadSaveCopyAction', "Save a Copy As..."), MenuId.MenubarFileMenu, saveCopy);
	feature('IDM_FILE_PRINT', 'print', localize2('npadPrintAction', "Print..."), MenuId.MenubarFileMenu, async accessor => {
		const model = activeEditor(accessor).getModel()!;
		await accessor.get(INativeHostService).showTextPrintPreview(basename(model.uri), model.getValue());
	});
	feature('IDM_EDIT_INSERT_DATETIME_SHORT', 'dateTimeShort', localize2('npadShortDateAction', "Insert Date Time (Short)"), insertMenu, accessor => insertDate(accessor, 'short'), true);
	feature('IDM_EDIT_INSERT_DATETIME_LONG', 'dateTimeLong', localize2('npadLongDateAction', "Insert Date Time (Long)"), insertMenu, accessor => insertDate(accessor, 'long'), true);
	feature('IDM_EDIT_INSERT_DATETIME_CUSTOMIZED', 'dateTimeCustom', localize2('npadCustomDateAction', "Insert Date Time (Customized)..."), insertMenu, accessor => insertDate(accessor, 'custom'), true);
	feature('IDM_EDIT_FILENAMETOCLIP', 'copyFilename', localize2('npadCopyNameAction', "Copy Current Filename"), clipboardMenu, accessor => copyPaths(accessor, 'name'));
	feature('IDM_EDIT_CURRENTDIRTOCLIP', 'copyDirectory', localize2('npadCopyDirectoryAction', "Copy Current Directory Path"), clipboardMenu, accessor => copyPaths(accessor, 'directory'));
	feature('IDM_EDIT_COPY_ALL_NAMES', 'copyAllFilenames', localize2('npadCopyAllNamesAction', "Copy All Filenames"), clipboardMenu, accessor => copyPaths(accessor, 'names'));
	feature('IDM_EDIT_COPY_ALL_PATHS', 'copyAllPaths', localize2('npadCopyAllPathsAction', "Copy All File Paths"), clipboardMenu, accessor => copyPaths(accessor, 'paths'));
	feature('IDM_EDIT_REMOVE_CONSECUTIVE_DUP_LINES', 'removeAdjacentDuplicates', localize2('npadRemoveAdjacentAction', "Remove Consecutive Duplicate Lines"), textMenu, cleanup('adjacentDuplicates'), true);
	feature('IDM_EDIT_REMOVEEMPTYLINES', 'removeEmptyLines', localize2('npadRemoveEmptyAction', "Remove Empty Lines"), textMenu, cleanup('emptyLines'), true);
	feature('IDM_EDIT_REMOVEEMPTYLINESWITHBLANK', 'removeBlankLines', localize2('npadRemoveBlankAction', "Remove Empty or Whitespace-Only Lines"), textMenu, cleanup('blankLines'), true);
	feature('IDM_EDIT_SORTLINES_INTEGER_ASCENDING', 'sortIntegerAscending', localize2('npadIntegerAscAction', "Integers Ascending"), sortMenu, sort('integer', false), true);
	feature('IDM_EDIT_SORTLINES_INTEGER_DESCENDING', 'sortIntegerDescending', localize2('npadIntegerDescAction', "Integers Descending"), sortMenu, sort('integer', true), true);
	feature('IDM_EDIT_SORTLINES_DECIMALCOMMA_ASCENDING', 'sortDecimalCommaAscending', localize2('npadCommaAscAction', "Decimals (Comma) Ascending"), sortMenu, sort('decimalComma', false), true);
	feature('IDM_EDIT_SORTLINES_DECIMALCOMMA_DESCENDING', 'sortDecimalCommaDescending', localize2('npadCommaDescAction', "Decimals (Comma) Descending"), sortMenu, sort('decimalComma', true), true);
	feature('IDM_EDIT_SORTLINES_DECIMALDOT_ASCENDING', 'sortDecimalDotAscending', localize2('npadDotAscAction', "Decimals (Dot) Ascending"), sortMenu, sort('decimalDot', false), true);
	feature('IDM_EDIT_SORTLINES_DECIMALDOT_DESCENDING', 'sortDecimalDotDescending', localize2('npadDotDescAction', "Decimals (Dot) Descending"), sortMenu, sort('decimalDot', true), true);
	feature('IDM_EDIT_SORTLINES_LENGTH_ASCENDING', 'sortLengthAscending', localize2('npadLengthAscAction', "Length Ascending"), sortMenu, sort('length', false), true);
	feature('IDM_EDIT_SORTLINES_LENGTH_DESCENDING', 'sortLengthDescending', localize2('npadLengthDescAction', "Length Descending"), sortMenu, sort('length', true), true);
	feature('IDM_EDIT_TRIMLINEHEAD', 'trimLeading', localize2('npadTrimLeadingAction', "Trim Leading Space"), textMenu, cleanup('trimLeading'), true);
	feature('IDM_EDIT_TRIM_BOTH', 'trimBoth', localize2('npadTrimBothAction', "Trim Leading and Trailing Space"), textMenu, cleanup('trimBoth'), true);
	feature('IDM_EDIT_TRIMALL', 'trimAndJoin', localize2('npadTrimJoinAction', "Trim Both and Join Lines"), textMenu, cleanup('trimAndJoin'), true);
	feature('IDM_EDIT_REDACT_SELECTION', 'redactSelection', localize2('npadRedactAction', "Redact Selection..."), textMenu, redact, true);
	feature('IDM_EDIT_COLUMNMODE', 'columnEditor', localize2('npadColumnAction', "Column Editor..."), textMenu, columnEditor, true);
	feature('IDM_EDIT_CHAR_PANEL', 'characterPicker', localize2('npadCharacterAction', "Character / Unicode Picker..."), insertMenu, characterPicker, true);
	feature('IDM_SEARCH_MARK', 'mark', localize2('npadMarkAction', "Mark Text..."), highlightMenu, mark);
	feature('IDM_SEARCH_MARKALLEXT1', 'highlightAll1', localize2('npadHighlightAll1', "Style All: 1"), highlightAllMenu, accessor => accessor.get(INPadEditorState).highlight(activeEditor(accessor), 0, true));
	feature('IDM_SEARCH_MARKALLEXT2', 'highlightAll2', localize2('npadHighlightAll2', "Style All: 2"), highlightAllMenu, accessor => accessor.get(INPadEditorState).highlight(activeEditor(accessor), 1, true));
	feature('IDM_SEARCH_MARKALLEXT3', 'highlightAll3', localize2('npadHighlightAll3', "Style All: 3"), highlightAllMenu, accessor => accessor.get(INPadEditorState).highlight(activeEditor(accessor), 2, true));
	feature('IDM_SEARCH_MARKALLEXT4', 'highlightAll4', localize2('npadHighlightAll4', "Style All: 4"), highlightAllMenu, accessor => accessor.get(INPadEditorState).highlight(activeEditor(accessor), 3, true));
	feature('IDM_SEARCH_MARKALLEXT5', 'highlightAll5', localize2('npadHighlightAll5', "Style All: 5"), highlightAllMenu, accessor => accessor.get(INPadEditorState).highlight(activeEditor(accessor), 4, true));
	feature('IDM_SEARCH_MARKONEEXT1', 'highlightOne1', localize2('npadHighlightOne1', "Style Selection / Word: 1"), highlightOneMenu, accessor => accessor.get(INPadEditorState).highlight(activeEditor(accessor), 0, false));
	feature('IDM_SEARCH_MARKONEEXT2', 'highlightOne2', localize2('npadHighlightOne2', "Style Selection / Word: 2"), highlightOneMenu, accessor => accessor.get(INPadEditorState).highlight(activeEditor(accessor), 1, false));
	feature('IDM_SEARCH_MARKONEEXT3', 'highlightOne3', localize2('npadHighlightOne3', "Style Selection / Word: 3"), highlightOneMenu, accessor => accessor.get(INPadEditorState).highlight(activeEditor(accessor), 2, false));
	feature('IDM_SEARCH_MARKONEEXT4', 'highlightOne4', localize2('npadHighlightOne4', "Style Selection / Word: 4"), highlightOneMenu, accessor => accessor.get(INPadEditorState).highlight(activeEditor(accessor), 3, false));
	feature('IDM_SEARCH_MARKONEEXT5', 'highlightOne5', localize2('npadHighlightOne5', "Style Selection / Word: 5"), highlightOneMenu, accessor => accessor.get(INPadEditorState).highlight(activeEditor(accessor), 4, false));
	feature('IDM_SEARCH_UNMARKALLEXT1', 'clearHighlight1', localize2('npadClear1', "Clear Style 1"), clearHighlightMenu, accessor => accessor.get(INPadEditorState).clearHighlight(activeEditor(accessor).getModel()!, 0));
	feature('IDM_SEARCH_UNMARKALLEXT2', 'clearHighlight2', localize2('npadClear2', "Clear Style 2"), clearHighlightMenu, accessor => accessor.get(INPadEditorState).clearHighlight(activeEditor(accessor).getModel()!, 1));
	feature('IDM_SEARCH_UNMARKALLEXT3', 'clearHighlight3', localize2('npadClear3', "Clear Style 3"), clearHighlightMenu, accessor => accessor.get(INPadEditorState).clearHighlight(activeEditor(accessor).getModel()!, 2));
	feature('IDM_SEARCH_UNMARKALLEXT4', 'clearHighlight4', localize2('npadClear4', "Clear Style 4"), clearHighlightMenu, accessor => accessor.get(INPadEditorState).clearHighlight(activeEditor(accessor).getModel()!, 3));
	feature('IDM_SEARCH_UNMARKALLEXT5', 'clearHighlight5', localize2('npadClear5', "Clear Style 5"), clearHighlightMenu, accessor => accessor.get(INPadEditorState).clearHighlight(activeEditor(accessor).getModel()!, 4));
	feature('IDM_SEARCH_CLEARALLMARKS', 'clearHighlights', localize2('npadClearAll', "Clear All Styles"), clearHighlightMenu, accessor => accessor.get(INPadEditorState).clearHighlight(activeEditor(accessor).getModel()!));
	feature('IDM_SEARCH_TOGGLE_BOOKMARK', 'toggleBookmark', localize2('npadToggleBookmark', "Toggle Bookmark"), bookmarkMenu, accessor => accessor.get(INPadEditorState).toggleBookmark(activeEditor(accessor)));
	feature('IDM_SEARCH_NEXT_BOOKMARK', 'nextBookmark', localize2('npadNextBookmark', "Next Bookmark"), bookmarkMenu, accessor => accessor.get(INPadEditorState).navigateBookmark(activeEditor(accessor), false));
	feature('IDM_SEARCH_PREV_BOOKMARK', 'previousBookmark', localize2('npadPreviousBookmark', "Previous Bookmark"), bookmarkMenu, accessor => accessor.get(INPadEditorState).navigateBookmark(activeEditor(accessor), true));
	feature('IDM_SEARCH_CLEAR_BOOKMARKS', 'clearBookmarks', localize2('npadClearBookmarks', "Clear All Bookmarks"), bookmarkMenu, accessor => accessor.get(INPadEditorState).clearBookmarks(activeEditor(accessor).getModel()!));
	feature('IDM_SEARCH_CUTMARKEDLINES', 'cutBookmarkedLines', localize2('npadCutBookmarks', "Cut Bookmarked Lines..."), bookmarkMenu, accessor => accessor.get(INPadEditorState).bookmarkOperation(activeEditor(accessor, true), 'cut'), true);
	feature('IDM_SEARCH_COPYMARKEDLINES', 'copyBookmarkedLines', localize2('npadCopyBookmarks', "Copy Bookmarked Lines"), bookmarkMenu, accessor => accessor.get(INPadEditorState).bookmarkOperation(activeEditor(accessor), 'copy'));
	feature('IDM_SEARCH_DELETEMARKEDLINES', 'removeBookmarkedLines', localize2('npadRemoveBookmarks', "Remove Bookmarked Lines..."), bookmarkMenu, accessor => accessor.get(INPadEditorState).bookmarkOperation(activeEditor(accessor, true), 'remove'), true);
	feature('IDM_SEARCH_DELETEUNMARKEDLINES', 'removeNonBookmarkedLines', localize2('npadRemoveNonBookmarks', "Remove Non-Bookmarked Lines..."), bookmarkMenu, accessor => accessor.get(INPadEditorState).bookmarkOperation(activeEditor(accessor, true), 'keep'), true);
	feature('IDM_VIEW_EOL', 'showEndOfLine', localize2('npadEolAction', "Show End of Line"), MenuId.MenubarAppearanceMenu, async accessor => {
		const configuration = accessor.get(IConfigurationService);
		await configuration.updateValue('npad.showEndOfLine', !configuration.getValue<boolean>('npad.showEndOfLine'));
	}, false, ContextKeyExpr.equals('config.npad.showEndOfLine', true));
	feature('IDM_VIEW_SUMMARY', 'summary', localize2('npadSummaryAction', "Document Summary..."), MenuId.MenubarViewMenu, summary);
	feature('IDM_VIEW_MONITORING', 'monitoring', localize2('npadMonitoringAction', "Monitoring (tail -f)"), MenuId.MenubarViewMenu, accessor => accessor.get(INPadEditorState).toggleMonitoring(activeEditor(accessor)), false, ContextKeyExpr.has('npadMonitoring'));
}
