/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import product from '../../../../platform/product/common/product.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { InEditorZenModeContext } from '../../../common/contextkeys.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ActivityBarPosition, EditorTabsMode, LayoutSettings } from '../../../services/layout/browser/layoutService.js';
import '../../../contrib/npadEditor/browser/npadEditor.contribution.js';

if (product.isNPad) {
	Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerDefaultConfigurations([{
		overrides: { 'editor.minimap.enabled': false, 'editor.wordWrap': 'on' }
	}]);

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.npad.toggleActivityBar',
				title: localize2('npadActivityBar', "Activity Bar"),
				category: Categories.View,
				f1: true,
				toggled: ContextKeyExpr.notEquals(`config.${LayoutSettings.ACTIVITY_BAR_LOCATION}`, ActivityBarPosition.HIDDEN),
				menu: { id: MenuId.MenubarAppearanceMenu, group: '2_workbench_layout', order: 1 }
			});
		}

		override run(accessor: ServicesAccessor): Promise<void> {
			const configurationService = accessor.get(IConfigurationService);
			const location = configurationService.getValue<ActivityBarPosition>(LayoutSettings.ACTIVITY_BAR_LOCATION);
			return configurationService.updateValue(LayoutSettings.ACTIVITY_BAR_LOCATION, location === ActivityBarPosition.HIDDEN ? ActivityBarPosition.DEFAULT : ActivityBarPosition.HIDDEN);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.npad.toggleTabBar',
				title: localize2('npadTabBar', "Tab Bar"),
				category: Categories.View,
				f1: true,
				toggled: ContextKeyExpr.notEquals(`config.${LayoutSettings.EDITOR_TABS_MODE}`, EditorTabsMode.NONE),
				precondition: InEditorZenModeContext.negate(),
				menu: { id: MenuId.MenubarAppearanceMenu, group: '3_workbench_layout_move', order: 10, when: InEditorZenModeContext.negate() }
			});
		}

		override run(accessor: ServicesAccessor): Promise<void> {
			const configurationService = accessor.get(IConfigurationService);
			const mode = configurationService.getValue<EditorTabsMode>(LayoutSettings.EDITOR_TABS_MODE);
			return configurationService.updateValue(LayoutSettings.EDITOR_TABS_MODE, mode === EditorTabsMode.NONE ? EditorTabsMode.MULTIPLE : EditorTabsMode.NONE);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.npad.reportIssue',
				title: localize2('npadReportIssue', "Report Issue"),
				category: Categories.Help,
				f1: true,
				menu: { id: MenuId.MenubarHelpMenu, group: '3_feedback', order: 3 }
			});
		}

		override async run(accessor: ServicesAccessor): Promise<void> {
			await accessor.get(IEditorService).openEditor({
				contents: localize('npadIssueDraft', "# NPad Issue\n\nThis is a local issue draft. No report has been sent.\nShare the completed draft with your NPad maintainer. An NPad issue tracker has not been configured; do not submit NPad-specific issues to the upstream issue tracker.\n\nVersion: {0}\n\n## What Happened?\n\n\n## Steps to Reproduce\n\n1. \n\n## Expected Behavior\n\n\n", product.version),
				languageId: 'markdown',
				options: { pinned: true }
			});
		}
	});
}
