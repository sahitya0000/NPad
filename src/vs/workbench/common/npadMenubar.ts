/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction, Separator } from '../../base/common/actions.js';

const hiddenActions = new Set([
	'workbench.action.openWorkspace',
	'addRootFolder',
	'workbench.action.addRootFolder',
	'workbench.action.saveWorkspaceAs',
	'workbench.action.duplicateWorkspaceInNewWindow',
	'workbench.action.selectProductIconTheme',
	'settings.filterByOnline',
	'welcome.showNewFileEntries',
	'workbench.action.selectIconTheme',
	'editor.emmet.action.expandAbbreviation',
	'workbench.action.toggleMultiCursorModifier',
	'workbench.action.openView',
	'workbench.action.toggleCenteredLayout',
	'workbench.action.toggleAuxiliaryBar',
	'workbench.action.togglePanel',
	'workbench.action.toggleSidebarPosition',
	'submenuitem.ActivityBarPositionMenu',
	'submenuitem.PanelPositionMenu',
	'submenuitem.PanelAlignmentMenu',
	'submenuitem.EditorTabsBarShowTabsSubmenu',
	'submenuitem.EditorActionsPositionSubmenu',
	'editor.action.toggleMinimap',
	'editor.action.toggleStickyScroll',
	'editor.action.renderWhitespace.boundary',
	'editor.action.renderWhitespace.selection',
	'workbench.action.splitEditorUp',
	'workbench.action.splitEditorLeft',
	'workbench.action.splitEditorInGroup',
	'workbench.action.joinEditorInGroup',
	'workbench.action.editorLayoutThreeColumns',
	'workbench.action.editorLayoutThreeRows',
	'workbench.action.editorLayoutTwoByTwoGrid',
	'workbench.action.editorLayoutTwoRowsRight',
	'workbench.action.editorLayoutTwoColumnsBottom',
	'workbench.action.nextEditorInGroup',
	'workbench.action.previousEditorInGroup',
	'workbench.action.openNextRecentlyUsedEditorInGroup',
	'workbench.action.openPreviousRecentlyUsedEditorInGroup',
	'workbench.action.focusThirdEditorGroup',
	'workbench.action.focusFourthEditorGroup',
	'workbench.action.focusFifthEditorGroup',
	'workbench.action.focusLeftGroup',
	'workbench.action.focusRightGroup',
	'workbench.action.focusAboveGroup',
	'workbench.action.focusBelowGroup',
	'editor.action.revealDefinition',
	'editor.action.revealDeclaration',
	'editor.action.goToTypeDefinition',
	'editor.action.goToImplementation',
	'editor.action.goToReferences',
	'editor.action.referenceSearch.trigger',
	'editor.action.marker.nextInFiles',
	'editor.action.marker.prevInFiles',
	'workbench.action.askVScode',
	'workbench.action.getStartedWithAccessibilityFeatures',
	'workbench.action.openIssueReporter',
	'workbench.action.toggleDevTools',
	'workbench.action.openProcessExplorer',
]);

/** Curates only the menu bar, leaving command registrations, shortcuts, and other menus intact. */
export function getMenubarActions(actions: readonly IAction[], topLevelTitle: string, isNPad: boolean): readonly IAction[] {
	if (!isNPad) {
		return actions;
	}

	return Separator.clean(actions.filter(action =>
		!hiddenActions.has(action.id) && !(topLevelTitle === 'Help' && action.id === 'workbench.action.showCommands')));
}
