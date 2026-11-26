/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';

export function resolvePackageDirectory(from: string, name: string): string {
	for (let directory = from; ; directory = path.dirname(directory)) {
		const candidate = path.join(directory, 'node_modules', name);
		if (fs.existsSync(path.join(candidate, 'package.json'))) {
			return candidate;
		}
		if (path.dirname(directory) === directory) {
			throw new Error(`Missing dependency ${name} required by ${from}. Run pnpm install --frozen-lockfile.`);
		}
	}
}

/** Preserve Node resolution, including nested versions, without copying build-only packages. */
export function getProductionDependencies(root: string, names: readonly string[]): string[] {
	const selected = new Set<string>();
	const pending = names.map(name => ({ from: root, name }));
	while (pending.length) {
		const { from, name } = pending.pop()!;
		const directory = resolvePackageDirectory(from, name);
		if (selected.has(directory)) {
			continue;
		}
		if (path.relative(root, directory).startsWith('..')) {
			throw new Error(`Dependency ${name} resolved outside this repository: ${directory}`);
		}
		selected.add(directory);
		const manifest: { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> } =
			JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
		for (const dependency of Object.keys(manifest.dependencies ?? {})) {
			pending.push({ from: directory, name: dependency });
		}
		for (const optional of Object.keys(manifest.optionalDependencies ?? {})) {
			let found = false;
			for (let current = directory; ; current = path.dirname(current)) {
				if (fs.existsSync(path.join(current, 'node_modules', optional, 'package.json'))) {
					found = true;
					break;
				}
				if (path.dirname(current) === current) {
					break;
				}
			}
			if (found) {
				pending.push({ from: directory, name: optional });
			}
		}
	}
	return [...selected].sort();
}
