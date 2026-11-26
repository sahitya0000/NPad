/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { getFileAssociations } from '../installer.ts';

test('installer associations follow shipped grammars, deduplicate extensions, and omit filenames', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'npad-associations-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const extensions = path.join(root, 'resources', 'app', 'extensions');
	await fs.mkdir(path.join(extensions, 'language'), { recursive: true });
	await fs.writeFile(path.join(extensions, 'language', 'package.json'), JSON.stringify({
		contributes: { languages: [{ extensions: ['.ts', '.TS', '.markdown', '.txt', '*.log.?', 'language-configuration.json', '.code-workspace', '.code-profile', '.ipynb'], filenames: ['Dockerfile'] }] }
	}));
	await fs.mkdir(path.join(extensions, 'preview'), { recursive: true });
	await fs.writeFile(path.join(extensions, 'preview', 'package.json'), '{}');
	assert.deepStrictEqual(await getFileAssociations(root), ['.log', '.markdown', '.text', '.ts', '.txt']);
	await fs.writeFile(path.join(extensions, 'language', 'package.json'), JSON.stringify({
		contributes: { languages: [{ extensions: ['.txt"; Subkey: "injected'] }] }
	}));
	await assert.rejects(getFileAssociations(root), /Invalid file association extension/);
});
