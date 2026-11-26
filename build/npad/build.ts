/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { prepareElectron } from './electron.ts';
import { bundleNPad } from './bundle.ts';
import { packageNPad } from './package.ts';
import { buildInstaller } from './installer.ts';
import { buildArchive } from './archive.ts';
import { buildTarget } from './platform.ts';

async function build(): Promise<void> {
	await prepareElectron();
	await bundleNPad();
	await packageNPad();
	if (buildTarget.platform === 'win32') {
		await buildInstaller();
	} else {
		await buildArchive();
	}
}

build().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
