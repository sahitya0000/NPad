/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'rcedit' {
	interface Options {
		icon?: string;
		'version-string'?: Record<string, string>;
	}

	export default function rcedit(executable: string, options: Options, callback: (error: Error | null) => void): void;
}
