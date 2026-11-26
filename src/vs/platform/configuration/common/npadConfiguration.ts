/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const unsupportedSections = [
	'chat', 'inlineChat', 'github', 'git', 'scm', 'debug', 'launch', 'task', 'tasks',
	'terminal', 'remote', 'remotePortAttributes', 'remoteOtherPortsAttributes', 'portsAttributes',
	'notebook', 'interactiveWindow', 'interactive', 'repl', 'testing', 'test',
	'mergeEditor', 'multiDiffEditor', 'mcp', 'telemetry', 'update', 'extensions',
	'settingsSync', 'profiles', 'comments', 'outline', 'timeline', 'output', 'problems',
	'browser', 'workbench.browser', 'workbench.panel', 'workbench.secondarySideBar',
	'workbench.auxiliaryBar', 'workbench.accounts', 'workbench.cloudChanges',
	'workbench.welcomePage', 'workbench.comments', 'security.workspace.trust',
	'workbench.enableExperiments', 'workbench.tips.enabled', 'workbench.activityBar.showAccounts',
	'workbench.settings.applyToAllProfiles', 'workbench.settings.enableNaturalLanguageSearch',
	'workbench.commandPalette.showAskInChat', 'workbench.commandPalette.experimental.askChatLocation',
	'workbench.commandPalette.experimental.enableNaturalLanguageSearch',
	'window.restoreWindows', 'window.newWindowProfile', 'window.confirmSaveUntitledWorkspace',
	'editor.codeActionsOnSave', 'editor.codeLens', 'editor.inlineSuggest', 'editor.inlayHints',
	'editor.parameterHints', 'editor.rename', 'editor.semanticHighlighting', 'editor.lightbulb',
	'editor.linkedEditing', 'editor.gotoLocation', 'editor.defaultFormatter',
	'editor.formatOnSave', 'editor.formatOnSaveMode', 'editor.formatOnPaste', 'editor.formatOnType',
	'editor.defaultFoldingRangeProvider', 'breadcrumbs.symbolPath', 'breadcrumbs.symbolSortOrder',
];

/** Hides unsupported preferences without removing defaults needed by shared editor services. */
export function isConfigurationPropertyVisible(key: string, isNPad: boolean): boolean {
	return !isNPad || !(
		unsupportedSections.some(section => key === section || key.startsWith(`${section}.`)) ||
		/^accessibility\.(?:verbosity|signals)\.(?:chat|inlineChat|terminal|debug|task|notebook|testing|codeAction|codeLens|inlayHints|comments)/i.test(key) ||
		/^breadcrumbs\.show(?!Files$)/.test(key) ||
		/^search\.(?:useAI|showAI)/.test(key)
	);
}
