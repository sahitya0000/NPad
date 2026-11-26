/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout, RunOnceScheduler, Throttler } from '../../../../base/common/async.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { FileAccess, Schemas } from '../../../../base/common/network.js';
import { IWebWorkerClient } from '../../../../base/common/worker/webWorker.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { Range } from '../../../../editor/common/core/range.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IMarker, IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { WebWorkerDescriptor } from '../../../../platform/webWorker/browser/webWorkerDescriptor.js';
import { IWebWorkerService } from '../../../../platform/webWorker/browser/webWorkerService.js';
import { INPadSpellingWorker, isSpellingWord, SpellingInputError, spellingPersonalWordLimit, spellingWordKey, validateSpellingInput } from '../common/npadSpelling.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

export const INPadSpelling = createDecorator<NPadSpelling>('npadSpelling');
const owner = 'npad.spelling';
const personalWordsSetting = 'npad.spelling.userWords';
const enabledSetting = 'npad.spelling.enabled';

interface CheckedDocument {
	store: DisposableStore;
	scheduler: RunOnceScheduler;
	throttler: Throttler;
	generation: number;
	warnedLimit: boolean;
}

export class NPadSpelling extends Disposable {
	declare readonly _serviceBrand: undefined;
	private worker: IWebWorkerClient<INPadSpellingWorker> | undefined;
	private readonly documents = new Map<ITextModel, CheckedDocument>();
	private readonly ignored = new Set<string>();
	private readonly paused = new Set<ITextModel>();

	constructor(
		@IWebWorkerService private readonly workers: IWebWorkerService,
		@IMarkerService private readonly markers: IMarkerService,
		@ICodeEditorService private readonly editors: ICodeEditorService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IQuickInputService private readonly quickInput: IQuickInputService,
		@INotificationService private readonly notifications: INotificationService,
		@ILogService private readonly log: ILogService,
		@IModelService private readonly models: IModelService
	) {
		super();
		this._register(configuration.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(enabledSetting)) {
				for (const model of [...this.documents.keys()]) { this.clear(model); }
				this.paused.clear();
				this.startAutomaticChecks();
			} else if (event.affectsConfiguration(personalWordsSetting)) { this.recheck(); }
		}));
		this._register(models.onModelAdded(model => this.startAutomatic(model)));
		this._register(models.onModelRemoved(model => {
			this.paused.delete(model);
			this.clear(model);
		}));
		this._register(models.onModelLanguageChanged(({ model }) => {
			if (this.documents.has(model)) { this.invalidate(model); }
			else { this.startAutomatic(model); }
		}));
	}

	startAutomaticChecks(): void {
		for (const model of this.models.getModels()) { this.startAutomatic(model); }
	}

	private isAutomaticFile(model: ITextModel): boolean {
		return model.uri.scheme === Schemas.file && /\.(?:txt|md)$/i.test(model.uri.path);
	}

	private startAutomatic(model: ITextModel): void {
		if (!this.configuration.getValue<boolean>(enabledSetting) || !this.isAutomaticFile(model) || model.isDisposed() || model.isForSimpleWidget || this.paused.has(model) || this.documents.has(model)) { return; }
		this.document(model).scheduler.schedule();
	}

	private personalWords(): string[] {
		const words = this.configuration.getValue<unknown>(personalWordsSetting);
		if (!Array.isArray(words) || words.length > spellingPersonalWordLimit || !words.every((word): word is string => typeof word === 'string' && isSpellingWord(word))) {
			throw new Error(localize('npadSpellingInvalidDictionary', "Personal dictionary must contain at most 2,000 English words, each 2 to 64 letters (apostrophes allowed)."));
		}
		return words;
	}

	private client(): IWebWorkerClient<INPadSpellingWorker> {
		return this.worker ??= this.workers.createWorkerClient<INPadSpellingWorker>(new WebWorkerDescriptor({
			esmModuleLocation: FileAccess.asBrowserUri('vs/workbench/contrib/npadEditor/common/npadSpellingWorkerMain.js'),
			label: 'NPad English Spelling'
		}));
	}

	private async suggestions(word: string): Promise<string[]> {
		const worker = this.client();
		const result = await raceTimeout(worker.proxy.$suggest(word), 15000, () => worker.dispose());
		if (!result) { throw new Error(localize('npadSpellingTimeout', "The local spelling worker timed out.")); }
		return result;
	}

	async check(model: ITextModel): Promise<void> {
		if (!this.configuration.getValue<boolean>(enabledSetting)) {
			this.notifications.info(localize('npadSpellingDisabled', "Spell checking is disabled. Enable npad.spelling.enabled in Settings to resume."));
			return;
		}
		this.paused.delete(model);
		const document = this.document(model);
		document.scheduler.cancel();
		document.generation++;
		try { await document.throttler.queue(() => this.compute(model, true)); }
		catch (error) { this.fail(model, error, document); }
	}

	private document(model: ITextModel): CheckedDocument {
		let document = this.documents.get(model);
		if (!document) {
			const store = new DisposableStore();
			const throttler = store.add(new Throttler());
			const scheduler = store.add(new RunOnceScheduler(() => {
				void throttler.queue(() => this.compute(model, false)).catch(error => this.fail(model, error, document));
			}, 500));
			document = { store, scheduler, throttler, generation: 0, warnedLimit: false };
			this.documents.set(model, document);
			store.add(model.onWillDispose(() => this.clear(model)));
			store.add(model.onDidChangeContent(() => this.invalidate(model)));
		}
		return document;
	}

	private async compute(model: ITextModel, manual: boolean): Promise<void> {
		const document = this.documents.get(model);
		if (!document || model.isDisposed()) { return; }
		const generation = document.generation;
		const version = model.getVersionId();
		const text = model.getValue();
		try { validateSpellingInput(text); }
		catch (error) {
			if (!(error instanceof SpellingInputError)) { throw error; }
			this.log.warn('NPad spell checking skipped oversized document', model.uri.toString(), error.message);
			this.clear(model);
			this.notifications.warn(localize('npadSpellingOversized', "Spell checking skipped this document: {0}", error.message));
			return;
		}
		const ignored = [...this.ignored, ...this.personalWords()];
		const worker = this.client();
		const result = await raceTimeout(worker.proxy.$check(text, ignored), 15000, () => worker.dispose());
		if (this.documents.get(model) !== document || model.isDisposed()) { return; }
		if (!result) { throw new Error(localize('npadSpellingTimeout', "The local spelling worker timed out.")); }
		if (model.getVersionId() !== version || document.generation !== generation) {
			if (manual) {
				this.notifications.info(this.isAutomaticFile(model) ?
					localize('npadSpellingChanged', "The document changed while checking. Spelling will be checked again.") :
					localize('npadSpellingManualChanged', "The document changed while checking. Run Check Spelling (English) again."));
			}
			return;
		}
		this.markers.changeOne(owner, model.uri, result.misspellings.map(item => ({
			...Range.fromPositions(model.getPositionAt(item.offset), model.getPositionAt(item.offset + item.length)),
			code: owner, severity: MarkerSeverity.Info, source: localize('npadSpellingSource', "Spelling (English)"), modelVersionId: version,
			message: localize('npadSpellingUnknown', "Unknown English word: {0}. Use Spelling Suggestions to correct or ignore it.", item.word)
		})));
		if (result.limited && (manual || !document.warnedLimit)) {
			this.notifications.warn(localize('npadSpellingLimited', "Spelling results are limited to the first 20,000 eligible words and 200 underlines."));
		} else if (manual) {
			this.notifications.info(this.isAutomaticFile(model) ?
				localize('npadSpellingComplete', "Spelling checked: {0} words, {1} possible misspellings. Checking stays on for this document until you clear its spelling highlights.", result.checkedWords, result.misspellings.length) :
				localize('npadSpellingManualComplete', "Spelling checked: {0} words, {1} possible misspellings. Run Check Spelling (English) again after editing this file.", result.checkedWords, result.misspellings.length));
		}
		document.warnedLimit = result.limited;
	}

	private invalidate(model: ITextModel, explicitRecheck = false): void {
		const document = this.documents.get(model);
		if (!document) { return; }
		if (!this.isAutomaticFile(model) && !explicitRecheck) {
			this.clear(model);
			return;
		}
		document.generation++;
		this.markers.remove(owner, [model.uri]);
		document.scheduler.schedule();
	}

	private recheck(): void {
		for (const model of this.documents.keys()) { this.invalidate(model, true); }
	}

	clear(model: ITextModel, pause = false): void {
		if (pause) { this.paused.add(model); }
		const document = this.documents.get(model);
		this.documents.delete(model);
		document?.store.dispose();
		this.markers.remove(owner, [model.uri]);
		if (!this.documents.size) {
			this.worker?.dispose();
			this.worker = undefined;
		}
	}

	private fail(model: ITextModel, error: unknown, document: CheckedDocument | undefined): void {
		if (!document || this.documents.get(model) !== document) { return; }
		this.log.error('NPad spell checking failed', error);
		for (const checked of [...this.documents.keys()]) { this.clear(checked); }
		this.notifications.error(localize('npadSpellingFailed', "Spell checking stopped: {0}", error instanceof Error ? error.message : String(error)));
	}

	private markerAt(model: ITextModel, range: Range): IMarker | undefined {
		return this.markers.read({ owner, resource: model.uri }).find(marker => Range.areIntersectingOrTouching(Range.lift(marker), range));
	}

	async ignoreWord(word: unknown, persistent: boolean): Promise<void> {
		if (typeof word !== 'string' || !isSpellingWord(word)) { throw new Error(localize('npadSpellingInvalidWord', "Choose an English word of 2 to 64 letters.")); }
		if (persistent) {
			const words = this.personalWords();
			if (!words.some(saved => spellingWordKey(saved) === spellingWordKey(word))) {
				if (words.length === spellingPersonalWordLimit) { throw new Error(localize('npadSpellingDictionaryFull', "The personal dictionary already contains 2,000 words.")); }
				await this.configuration.updateValue(personalWordsSetting, [...words, word], ConfigurationTarget.USER);
			}
		} else { this.ignored.add(spellingWordKey(word)); }
		this.recheck();
	}

	async suggestAtCursor(): Promise<void> {
		const editor = this.editors.getActiveCodeEditor();
		const model = editor?.getModel();
		const position = editor?.getPosition();
		if (!editor || !model || !position) { throw new Error(localize('npadSpellingNeedEditor', "Open a text document first.")); }
		const marker = this.markerAt(model, Range.fromPositions(position));
		if (!marker) {
			this.notifications.info(localize('npadSpellingNeedWord', "Run Check Spelling (English), then place the caret in an underlined word."));
			return;
		}
		const version = model.getVersionId();
		const word = model.getValueInRange(marker);
		const document = this.documents.get(model);
		let suggestions: string[];
		try { suggestions = await this.suggestions(word); }
		catch (error) { this.fail(model, error, document); return; }
		if (editor.getModel() !== model || model.isDisposed() || model.getVersionId() !== version || this.documents.get(model) !== document) {
			this.notifications.info(localize('npadSpellingSuggestionsChanged', "The document or spelling highlights changed. Run Spelling Suggestions again."));
			return;
		}
		type Item = IQuickPickItem & { operation: 'replace' | 'ignore' | 'add'; replacement?: string };
		const items: Item[] = suggestions.map(replacement => ({ label: replacement, replacement, operation: 'replace' }));
		items.push(
			{ label: localize('npadSpellingIgnore', "Ignore '{0}' (This Session)", word), operation: 'ignore' },
			{ label: localize('npadSpellingAdd', "Add '{0}' to Personal Dictionary", word), operation: 'add' }
		);
		const choice = await this.quickInput.pick(items, {
			title: localize('npadSpellingSuggestions', "Spelling Suggestions: {0}", word),
			placeHolder: word.length > 32 ? localize('npadSpellingLongWord', "Suggestions are limited to words up to 32 characters. Ignore or add this word.") :
				suggestions.length ? localize('npadSpellingChoose', "Choose a correction, ignore, or add the word") : localize('npadSpellingNoSuggestions', "No dictionary suggestions. Ignore or add this word.")
		});
		if (!choice) { return; }
		if (choice.operation !== 'replace') { await this.ignoreWord(word, choice.operation === 'add'); return; }
		if (editor.getModel() !== model || model.isDisposed() || model.getVersionId() !== version || this.documents.get(model) !== document || editor.getOption(EditorOption.readOnly)) {
			throw new Error(localize('npadSpellingEditChanged', "The document changed or became read-only. Run Spelling Suggestions again."));
		}
		editor.pushUndoStop();
		editor.executeEdits(owner, [{ range: Range.lift(marker), text: choice.replacement! }]);
		editor.pushUndoStop();
		editor.focus();
	}

	override dispose(): void {
		for (const model of [...this.documents.keys()]) { this.clear(model); }
		this.paused.clear();
		super.dispose();
	}
}

class NPadSpellingRestorer {
	constructor(@INPadSpelling spelling: NPadSpelling) { spelling.startAutomaticChecks(); }
}

export function registerNPadSpelling(): void {
	registerSingleton(INPadSpelling, NPadSpelling, InstantiationType.Delayed);
	Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
		id: 'npadSpelling', title: localize('npadSpellingSettings', "NPad Spelling"), properties: {
			[enabledSetting]: {
				type: 'boolean', default: true, scope: ConfigurationScope.APPLICATION,
				description: localize('npadSpellingEnabled', "Automatically check English spelling only in .txt and .md files, including words within identifiers. Other text-file types can be checked manually. Turn off to stop checking and clear all spelling highlights.")
			},
			[personalWordsSetting]: {
				type: 'array', default: [], uniqueItems: true, maxItems: spellingPersonalWordLimit, scope: ConfigurationScope.APPLICATION,
				items: { type: 'string', minLength: 2, maxLength: 64, pattern: "^[A-Za-z]+(?:['\u2019][A-Za-z]+)*$" },
				description: localize('npadSpellingPersonalWords', "English words accepted by the offline spelling checker. Stored locally in user settings; never sent to a server.")
			}
		}
	});
	registerWorkbenchContribution2('workbench.contrib.npadSpelling', NPadSpellingRestorer, WorkbenchPhase.AfterRestored);
	const spellingMenu = new MenuId('NPadSpellingMenu');
	MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
		submenu: spellingMenu, title: localize('npadSpellingMenu', "Spelling"), group: '7_npad_spelling', order: 1
	});
	for (const [id, title, order, write, run] of [
		['npad.spelling.check', localize2('npadSpellingCheckAction', "Check Spelling (English)"), 1, false, (service: NPadSpelling, model: ITextModel) => service.check(model)],
		['npad.spelling.suggestions', localize2('npadSpellingSuggestAction', "Spelling Suggestions..."), 2, true, (service: NPadSpelling) => service.suggestAtCursor()],
		['npad.spelling.clear', localize2('npadSpellingClearAction', "Clear Spelling Highlights"), 3, false, (service: NPadSpelling, model: ITextModel) => service.clear(model, true)]
	] as const) {
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id, title, category: localize2('npadCategory', "NPad"), f1: true,
					precondition: write ? ContextKeyExpr.and(ContextKeyExpr.has('activeEditor'), EditorContextKeys.writable) : ContextKeyExpr.has('activeEditor'),
					keybinding: id === 'npad.spelling.suggestions' ? {
						primary: KeyMod.CtrlCmd | KeyCode.Period, weight: KeybindingWeight.WorkbenchContrib,
						when: EditorContextKeys.editorTextFocus
					} : undefined,
					menu: [{ id: spellingMenu, group: '1_spelling', order }, { id: MenuId.EditorContext, group: '9_npad_spelling', order }]
				});
			}

			override run(accessor: ServicesAccessor) {
				const model = accessor.get(ICodeEditorService).getActiveCodeEditor()?.getModel();
				if (!model) { throw new Error(localize('npadSpellingNeedEditor', "Open a text document first.")); }
				return run(accessor.get(INPadSpelling), model);
			}
		});
	}
}
