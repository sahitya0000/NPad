/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler, Sequencer, Throttler } from '../../../../base/common/async.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { dirname, isEqual } from '../../../../base/common/resources.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextModel, TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { localize } from '../../../../nls.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { FileChangeType, FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IFilesConfigurationService } from '../../../services/filesConfiguration/common/filesConfigurationService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';

export const INPadEditorState = createDecorator<NPadEditorState>('npadEditorState');
const monitoringKey = new RawContextKey<boolean>('npadMonitoring', false);
const bookmarkStorageKey = 'npad.editor.bookmarks';
const maxHighlights = 10000;
const monitorLimit = 8 * 1024 * 1024;

interface ModelState {
	bookmarks: string[];
	styles: string[][];
	store: DisposableStore;
}

interface Monitor {
	model: ITextModel;
	store: DisposableStore;
	wasReadonly: ReturnType<IFilesConfigurationService['isReadonly']>;
	waiting: boolean;
}

export class NPadEditorState extends Disposable {
	declare readonly _serviceBrand: undefined;
	private readonly states = new Map<ITextModel, ModelState>();
	private readonly savedBookmarks: Record<string, number[]> = Object.create(null);
	private readonly monitors = new Map<ITextModel, Monitor>();
	private readonly monitorChanges = new Sequencer();
	private readonly monitorContext;

	constructor(
		@IModelService private readonly models: IModelService,
		@IStorageService private readonly storage: IStorageService,
		@IClipboardService private readonly clipboard: IClipboardService,
		@IDialogService private readonly dialogs: IDialogService,
		@IFileService private readonly files: IFileService,
		@ITextFileService private readonly textFiles: ITextFileService,
		@IFilesConfigurationService private readonly filesConfiguration: IFilesConfigurationService,
		@INotificationService private readonly notifications: INotificationService,
		@ILogService private readonly log: ILogService,
		@ICodeEditorService private readonly editors: ICodeEditorService,
		@IEditorService editorService: IEditorService,
		@IContextKeyService contextKeys: IContextKeyService,
	) {
		super();
		this.monitorContext = monitoringKey.bindTo(contextKeys);
		const saved = storage.getObject<object>(bookmarkStorageKey, StorageScope.WORKSPACE, {});
		if (saved && typeof saved === 'object') {
			for (const [uri, lines] of Object.entries(saved)) {
				if (Array.isArray(lines) && lines.length <= 10000 && lines.every(line => Number.isInteger(line) && line > 0)) {
					this.savedBookmarks[uri] = lines;
				} else {
					log.warn('Ignoring invalid NPad bookmark data', uri);
				}
			}
		}
		for (const model of models.getModels()) {
			this.restore(model);
		}
		this._register(models.onModelAdded(model => this.restore(model)));
		this._register(storage.onWillSaveState(() => this.save()));
		this._register(editorService.onDidActiveEditorChange(() => this.updateMonitorContext()));
	}

	private restore(model: ITextModel): void {
		if (this.savedBookmarks[model.uri.toString()]?.length) {
			this.state(model);
		}
	}

	private state(model: ITextModel): ModelState {
		let state = this.states.get(model);
		if (!state) {
			state = { bookmarks: [], styles: Array.from({ length: 5 }, () => []), store: new DisposableStore() };
			this.states.set(model, state);
			this.setBookmarks(model, (this.savedBookmarks[model.uri.toString()] ?? []).filter(line => line <= model.getLineCount()));
			const store = state.store;
			store.add(model.onWillDispose(() => {
				this.remember(model);
				this.states.delete(model);
				this.stopMonitoring(model);
				store.dispose();
			}));
		}
		return state;
	}

	private remember(model: ITextModel): void {
		if (model.uri.scheme === 'file') {
			const lines = this.bookmarkLines(model);
			if (lines.length) {
				this.savedBookmarks[model.uri.toString()] = lines;
			} else {
				delete this.savedBookmarks[model.uri.toString()];
			}
		}
	}

	private save(): void {
		for (const model of this.states.keys()) {
			this.remember(model);
		}
		this.storage.store(bookmarkStorageKey, this.savedBookmarks, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	bookmarkLines(model: ITextModel): number[] {
		return [...new Set((this.states.get(model)?.bookmarks ?? []).flatMap(id => {
			const range = model.getDecorationRange(id);
			return range ? [range.startLineNumber] : [];
		}))].sort((a, b) => a - b);
	}

	private setBookmarks(model: ITextModel, lines: number[]): void {
		const state = this.states.get(model)!;
		state.bookmarks = model.deltaDecorations(state.bookmarks, lines.map(line => ({
			range: new Range(line, 1, line, 1),
			options: {
				description: 'npad-bookmark', isWholeLine: true, linesDecorationsClassName: 'npad-bookmark-line',
				glyphMarginClassName: 'npad-bookmark-glyph', glyphMarginHoverMessage: { value: localize('npadBookmark', "Bookmark") },
				stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
			}
		})));
	}

	toggleBookmark(editor: ICodeEditor): void {
		const model = editor.getModel()!;
		this.state(model);
		const line = editor.getPosition()!.lineNumber;
		const lines = this.bookmarkLines(model);
		this.setBookmarks(model, lines.includes(line) ? lines.filter(value => value !== line) : [...lines, line]);
	}

	clearBookmarks(model: ITextModel): void {
		this.state(model);
		this.setBookmarks(model, []);
	}

	navigateBookmark(editor: ICodeEditor, previous: boolean): void {
		const model = editor.getModel()!;
		this.state(model);
		const lines = this.bookmarkLines(model);
		if (!lines.length) {
			this.notifications.info(localize('npadNoBookmarks', "This document has no bookmarks."));
			return;
		}
		const current = editor.getPosition()!.lineNumber;
		const target = previous ? [...lines].reverse().find(line => line < current) ?? lines[lines.length - 1] : lines.find(line => line > current) ?? lines[0];
		editor.setPosition({ lineNumber: target, column: 1 });
		editor.revealLineInCenter(target);
		editor.focus();
	}

	async bookmarkOperation(editor: ICodeEditor, operation: 'copy' | 'cut' | 'remove' | 'keep'): Promise<void> {
		const model = editor.getModel()!;
		this.state(model);
		const marked = new Set(this.bookmarkLines(model));
		if (!marked.size) {
			this.notifications.info(localize('npadNoBookmarks', "This document has no bookmarks."));
			return;
		}
		const lines = model.getLinesContent();
		const selected = lines.filter((_, index) => marked.has(index + 1));
		if (operation === 'copy') {
			await this.clipboard.writeText(selected.join(model.getEOL()) + model.getEOL());
			return;
		}
		const version = model.getVersionId();
		const removed = lines.filter((_, index) => operation === 'keep' ? !marked.has(index + 1) : marked.has(index + 1));
		const result = await this.dialogs.confirm({
			message: localize('npadRemoveLines', "Remove {0} lines?", removed.length),
			detail: localize('npadRemoveLinesDetail', "Preview of the first removed lines:\n{0}\n\nYou can undo this edit.", removed.slice(0, 5).join('\n').slice(0, 2000)),
			primaryButton: localize('npadRemoveLinesButton', "&&Remove Lines")
		});
		if (!result.confirmed) {
			return;
		}
		if (model.isDisposed() || editor.getModel() !== model || model.getVersionId() !== version || editor.getOption(EditorOption.readOnly)) {
			throw new Error(localize('npadChangedDocument', "The document changed or became read-only. Run the command again."));
		}
		if (operation === 'cut') {
			await this.clipboard.writeText(selected.join(model.getEOL()) + model.getEOL());
			if (model.isDisposed() || editor.getModel() !== model || model.getVersionId() !== version || editor.getOption(EditorOption.readOnly)) {
				throw new Error(localize('npadChangedDocument', "The document changed or became read-only. Run the command again."));
			}
		}
		const remaining = lines.filter((_, index) => operation === 'keep' ? marked.has(index + 1) : !marked.has(index + 1));
		editor.pushUndoStop();
		editor.executeEdits('npad.bookmarks', [{ range: model.getFullModelRange(), text: remaining.join(model.getEOL()) }]);
		editor.pushUndoStop();
		this.setBookmarks(model, operation === 'keep' ? remaining.map((_, index) => index + 1) : []);
		editor.focus();
	}

	highlight(editor: ICodeEditor, style: number, all: boolean, query?: string): void {
		const model = editor.getModel()!;
		const selection = editor.getSelection()!;
		const word = model.getWordAtPosition(selection.getStartPosition());
		const text = query ?? (selection.isEmpty() ? word?.word : model.getValueInRange(selection));
		if (!text) {
			this.notifications.info(localize('npadSelectToken', "Select text or place the cursor on a word to highlight."));
			return;
		}
		const ranges = all ? model.findMatches(text, false, false, true, null, false, maxHighlights + 1).map(match => match.range)
			: [selection.isEmpty() ? new Range(selection.startLineNumber, word!.startColumn, selection.startLineNumber, word!.endColumn) : selection];
		const state = this.state(model);
		const count = state.styles.reduce((sum, ids) => sum + ids.length, 0);
		if (count + ranges.length > maxHighlights) {
			throw new Error(localize('npadHighlightLimit', "A document can have at most 10,000 NPad highlights. Clear a style or select a smaller token scope."));
		}
		state.styles[style].push(...model.deltaDecorations([], ranges.map(range => ({
			range, options: { description: 'npad-highlight', inlineClassName: `npad-highlight-${style + 1}`, stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges }
		}))));
	}

	clearHighlight(model: ITextModel, style?: number): void {
		const state = this.state(model);
		for (let index = 0; index < 5; index++) {
			if (style === undefined || index === style) {
				state.styles[index] = model.deltaDecorations(state.styles[index], []);
			}
		}
	}

	private updateMonitorContext(): void {
		const model = this.editors.getActiveCodeEditor()?.getModel();
		this.monitorContext.set(!!model && this.monitors.has(model));
	}

	private stopMonitoring(model: ITextModel): void {
		const monitor = this.monitors.get(model);
		if (monitor) {
			this.monitors.delete(model);
			monitor.store.dispose();
			this.updateMonitorContext();
			this.filesConfiguration.updateReadonly(model.uri, monitor.wasReadonly).catch(error => {
				this.log.error(error);
				this.notifications.error(error);
			});
		}
	}

	toggleMonitoring(editor: ICodeEditor): Promise<void> {
		const model = editor.getModel()!;
		return this.monitorChanges.queue(() => this.doToggleMonitoring(model));
	}

	private async doToggleMonitoring(model: ITextModel): Promise<void> {
		if (model.isDisposed()) {
			throw new Error(localize('npadMonitorClosed', "The monitored file model is no longer available."));
		}
		if (this.monitors.has(model)) {
			this.stopMonitoring(model);
			return;
		}
		if (model.uri.scheme !== 'file' || this.textFiles.isDirty(model.uri)) {
			throw new Error(localize('npadMonitorSavedFile', "Save the local file before enabling monitoring. Unsaved changes are never discarded."));
		}
		if ((await this.files.stat(model.uri)).size > monitorLimit) {
			throw new Error(localize('npadMonitorSize', "Monitoring is limited to files up to 8 MiB. Use ordinary file viewing for larger files."));
		}
		const wasReadonly = this.filesConfiguration.isReadonly(model.uri);
		await this.filesConfiguration.updateReadonly(model.uri, true);
		if (model.isDisposed() || this.textFiles.isDirty(model.uri)) {
			await this.filesConfiguration.updateReadonly(model.uri, wasReadonly);
			throw new Error(localize('npadMonitorChanged', "The file changed while enabling monitoring. Try again after saving."));
		}
		this.state(model);
		const monitor: Monitor = { model, store: new DisposableStore(), wasReadonly, waiting: false };
		this.monitors.set(model, monitor);
		this.updateMonitorContext();
		const queue = monitor.store.add(new Throttler());
		const refresh = async () => {
			if (!this.monitors.has(model)) {
				return;
			}
			try {
				if (this.textFiles.isDirty(model.uri)) {
					throw new Error(localize('npadMonitorDirty', "Monitoring stopped to preserve unsaved changes."));
				}
				const fileModel = this.textFiles.files.get(model.uri);
				if (!fileModel) {
					throw new Error(localize('npadMonitorClosed', "The monitored file model is no longer available."));
				}
				await fileModel.resolve({ forceReadFromFile: true, limits: { size: monitorLimit } });
				monitor.waiting = false;
				if (!model.isDisposed() && this.monitors.has(model)) {
					for (const candidate of this.editors.listCodeEditors()) {
						if (candidate.getModel() === model) {
							candidate.revealLine(model.getLineCount());
						}
					}
				}
			} catch (error) {
				if (error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND) {
					if (!monitor.waiting) {
						monitor.waiting = true;
						this.notifications.info(localize('npadMonitorRotation', "Monitored file was removed. Waiting for it to be recreated at the same path."));
					}
				} else {
					this.log.error(error instanceof Error ? error : String(error));
					this.notifications.error(error instanceof Error ? error : String(error));
					this.stopMonitoring(model);
				}
			}
		};
		const scheduler = monitor.store.add(new RunOnceScheduler(() => { void queue.queue(refresh); }, 250));
		try {
			monitor.store.add(this.files.watch(dirname(model.uri)));
		} catch (error) {
			this.stopMonitoring(model);
			throw error;
		}
		monitor.store.add(this.files.onDidFilesChange(event => {
			if (event.contains(model.uri, FileChangeType.UPDATED, FileChangeType.ADDED, FileChangeType.DELETED)) {
				if (!scheduler.isScheduled()) { scheduler.schedule(); }
			}
		}));
		monitor.store.add(this.textFiles.files.onDidChangeDirty(changed => {
			if (isEqual(changed.resource, model.uri) && changed.isDirty()) {
				this.notifications.warn(localize('npadMonitorDirty', "Monitoring stopped to preserve unsaved changes."));
				this.stopMonitoring(model);
			}
		}));
		scheduler.schedule();
		this.notifications.info(localize('npadMonitorEnabled', "Monitoring enabled (read-only, up to 8 MiB). Run Monitoring again to stop."));
	}

	override dispose(): void {
		this.save();
		for (const model of this.monitors.keys()) {
			this.stopMonitoring(model);
		}
		for (const [model, state] of this.states) {
			state.store.dispose();
			if (!model.isDisposed()) {
				model.deltaDecorations([...state.bookmarks, ...state.styles.flat()], []);
			}
		}
		this.states.clear();
		super.dispose();
	}
}
