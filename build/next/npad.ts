/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import type * as esbuild from 'esbuild';
import type { IProductConfiguration } from '../../src/vs/base/common/product.ts';
import { isNPadMainThreadCustomer } from '../../src/vs/workbench/api/common/npadApi.ts';

const excludedWorkbenchFeatures = new Set([
	'chat', 'inlineChat', 'inlineCompletions', 'agentsVoice', 'mcp', 'speech', 'remoteCodingAgents',
	'remote', 'remoteTunnel', 'debug', 'notebook', 'interactive', 'replNotebook', 'testing',
	'terminal', 'externalTerminal', 'tasks', 'git', 'github', 'scm', 'mergeEditor', 'multiDiffEditor',
	'extensions', 'callHierarchy', 'typeHierarchy', 'codeActions', 'userDataSync', 'authentication',
	'userDataProfile', 'editSessions', 'timeline', 'outline', 'markers', 'output', 'telemetry', 'editTelemetry', 'browserView',
	'bracketPairColorizer2Telemetry', 'surveys', 'welcomeGettingStarted', 'welcomeAgentSessions',
	'welcomeWalkthrough', 'welcomeOnboarding', 'onboarding', 'canvases', 'update', 'localization',
]);

const excludedEditorFeatures = new Set([
	'codeAction', 'codelens', 'inlineCompletions', 'inlayHints', 'rename', 'gotoSymbol',
	'semanticTokens', 'linkedEditing', 'parameterHints',
]);

const sourceEntries = new Set([
	'vs/workbench/workbench.common.main.ts',
	'vs/workbench/workbench.desktop.main.ts',
	'vs/workbench/contrib/codeEditor/browser/codeEditor.contribution.ts',
	'vs/editor/editor.all.ts',
]);

/** Keeps shared service registrations; this is a contribution boundary, not a runtime capability check. */
export function isNPadExcludedImport(moduleId: string): boolean {
	if (moduleId.endsWith('.service.contribution.js') || moduleId.endsWith('/extensionHostDebugService.js')) {
		return false;
	}
	if (/^vs\/(?:workbench\/services|platform)\/agentHost\//.test(moduleId)) {
		return true;
	}
	const customer = /^vs\/workbench\/api\/browser\/mainThread(?<suffix>[^/]+)\.js$/.exec(moduleId)?.groups?.suffix;
	if (customer) {
		return !isNPadMainThreadCustomer(`MainThread${customer}`);
	}
	if (/\/browserView\/electron-browser\/(?:tools\/|features\/(?:browserEditorChatFeatures|browserAutoReloadFeatures|browserRemoteFeatures)\.js$)/.test(moduleId)) {
		return true;
	}
	if (/\/(?:searchChatContext|markerChatContext|speechAccessibilitySignal|dynamicSpeechAccessibilityConfiguration)(?:\.contribution)?\.js$/.test(moduleId)) {
		return true;
	}
	const workbenchFeature = /^vs\/workbench\/contrib\/(?<feature>[^/]+)\//.exec(moduleId)?.groups?.feature;
	if (workbenchFeature && excludedWorkbenchFeatures.has(workbenchFeature)) {
		return true;
	}
	const editorFeature = /^vs\/editor\/contrib\/(?<feature>[^/]+)\//.exec(moduleId)?.groups?.feature;
	if (editorFeature && excludedEditorFeatures.has(editorFeature)) {
		return true;
	}
	return /\/(?:dictation\/editorDictation|emptyTextEditorHint\/emptyTextEditorHint|workbenchReferenceSearch|searchActionsSymbol|suggest\/browser\/suggestInlineCompletions|onboarding\/[^/]+)\.js$/.test(moduleId);
}

export function isNPadEntryPoint(entryPoint: string): boolean {
	return !entryPoint.startsWith('vs/sessions/')
		&& !entryPoint.startsWith('vs/platform/agentHost/')
		&& !entryPoint.startsWith('vs/platform/terminal/')
		&& !entryPoint.startsWith('vs/platform/localTranscription/')
		&& !entryPoint.startsWith('vs/platform/browserView/')
		&& !entryPoint.startsWith('vs/workbench/contrib/notebook/')
		&& !entryPoint.startsWith('vs/workbench/contrib/debug/');
}

export function createNPadProduct<T extends object>(product: T): T & Partial<IProductConfiguration> {
	return {
		...product,
		isNPad: true,
		nameShort: 'NPad',
		nameLong: 'NPad',
		applicationName: 'npad',
		dataFolderName: '.npad',
		sharedDataFolderName: '.npad-shared',
		urlProtocol: 'npad',
		win32MutexName: 'npad',
		win32DirName: 'NPad',
		win32NameVersion: 'NPad',
		win32RegValueName: 'NPad',
		win32AppUserModelId: 'NPad.Editor',
		win32ShellNameShort: 'N&Pad',
		win32x64AppId: '{{B68404B5-799D-44E3-A7A3-7F67CFB75285}',
		win32x64UserAppId: '{{B68404B5-799D-44E3-A7A3-7F67CFB75285}',
		darwinBundleIdentifier: 'org.npad.editor',
		linuxDesktopName: 'npad',
		linuxIconName: 'npad',
		enableTelemetry: false,
		enabledTelemetryLevels: { error: false, usage: false },
		aiConfig: undefined,
		tasConfig: undefined,
		builtInExtensions: [],
		extensionsGallery: undefined,
		reportIssueUrl: undefined,
		mcpGallery: undefined,
		extensionRecommendations: undefined,
		remoteExtensionTips: undefined,
		'configurationSync.store': undefined,
		'editSessions.store': undefined,
	} satisfies Partial<IProductConfiguration>;
}

/** Filters only audited side-effect imports; named imports and shared contracts remain intact. */
export function npadContributionsPlugin(srcDir: string): esbuild.Plugin {
	const bareImports = new Map<string, Promise<Set<string>>>();
	return {
		name: 'npad-contributions',
		setup(build) {
			build.onResolve({ filter: /(?:code-icon|letterpress-(?:light|dark|hcLight|hcDark))\.svg$/ }, args => {
				if (args.kind === 'url-token') {
					return { path: path.resolve(srcDir, '../resources/npad/code.png') };
				}
				return undefined;
			});
			build.onResolve({ filter: /^\./ }, async args => {
				const importer = path.relative(srcDir, args.importer).replaceAll('\\', '/');
				if (!sourceEntries.has(importer) && !importer.endsWith('.contribution.ts')) {
					return undefined;
				}
				let imports = bareImports.get(args.importer);
				if (!imports) {
					imports = fs.promises.readFile(args.importer, 'utf8').then(source =>
						new Set([...source.matchAll(/^\s*import\s+['"](?<module>[^'"]+)['"]\s*;/gm)].map(match => match.groups!.module)));
					bareImports.set(args.importer, imports);
				}
				const moduleId = path.relative(srcDir, path.resolve(path.dirname(args.importer), args.path)).replaceAll('\\', '/');
				if ((await imports).has(args.path) && [
					'vs/workbench/contrib/extensions/browser/extensions.contribution.js',
					'vs/workbench/contrib/scm/browser/quickDiff.contribution.js',
					'vs/workbench/contrib/notebook/browser/notebook.contribution.js',
					'vs/workbench/contrib/output/browser/output.contribution.js',
				].includes(moduleId)) {
					return { path: path.join(srcDir, moduleId.replace('.contribution.js', '.service.contribution.ts')) };
				}
				if ((await imports).has(args.path) && isNPadExcludedImport(moduleId)) {
					return { path: moduleId, namespace: 'npad-excluded-contribution' };
				}
				return undefined;
			});
			build.onLoad({ filter: /.*/, namespace: 'npad-excluded-contribution' }, () => ({ contents: '', loader: 'js' }));
		},
	};
}
