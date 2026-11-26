/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../base/common/network.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import type { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { ActiveEditorContext, ActiveEditorCanRevertContext, MultipleEditorsSelectedInGroupContext, ResourceContextKey } from '../../../common/contextkeys.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

export function registerNPadCompareMenus(): void {
	MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, {
		command: {
			id: 'workbench.files.action.compareFileWith',
			title: localize('npadCompareTab', "Compare with File..."),
			precondition: MultipleEditorsSelectedInGroupContext.negate()
		},
		when: ContextKeyExpr.equals(ResourceContextKey.Scheme.key, Schemas.file),
		group: '1_compare', order: 10
	});
	const menu = new MenuId('NPadCompareMenu');
	MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
		submenu: menu, title: localize('npadCompareMenu', "Compare"), group: '4_npad_file', order: 100
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'npad.compareFiles', title: localize2('npadCompareFiles', "Compare Two Files..."),
				category: localize2('npadCategory', "NPad"), f1: true,
				menu: { id: menu, group: '1_compare', order: 1 }
			});
		}
		override async run(accessor: ServicesAccessor): Promise<void> {
			const dialogs = accessor.get(IFileDialogService);
			const files = accessor.get(IFileService);
			const editors = accessor.get(IEditorService);
			const notifications = accessor.get(INotificationService);
			const identity = accessor.get(IUriIdentityService);
			try {
				const first = await dialogs.showOpenDialog({
					title: localize('npadCompareFirst', "Select the First File to Compare"),
					canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
					availableFileSystems: [Schemas.file]
				});
				if (!first?.length) { return; }
				const second = await dialogs.showOpenDialog({
					title: localize('npadCompareSecond', "Select the Second File to Compare"),
					defaultUri: first[0], canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
					availableFileSystems: [Schemas.file]
				});
				if (!second?.length) { return; }
				if (identity.extUri.isEqual(first[0], second[0])) {
					notifications.warn(localize('npadCompareSameFile', "Select two different files to compare."));
					return;
				}
				for (const resource of [first[0], second[0]]) {
					if (resource.scheme !== Schemas.file || !(await files.stat(resource)).isFile) {
						notifications.warn(localize('npadCompareNeedFile', "Select an existing local file to compare."));
						return;
					}
				}
				await editors.openEditor({ original: { resource: first[0] }, modified: { resource: second[0] }, options: { pinned: true } });
			} catch (error) {
				notifications.error(error instanceof Error ? error : new Error(String(error)));
			}
		}
	});
	for (const [id, title, precondition, order] of [
		['workbench.files.action.compareFileWith', localize('npadCompareActive', "Compare Active File With..."), ActiveEditorContext, 2],
		['workbench.files.action.compareWithSaved', localize('npadCompareSaved', "Compare Active File with Saved"), ActiveEditorCanRevertContext, 3]
	] as const) {
		MenuRegistry.appendMenuItem(menu, { command: { id, title, precondition }, group: '1_compare', order });
	}
}
