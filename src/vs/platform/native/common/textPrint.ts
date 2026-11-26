/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function createTextPrintHtml(title: string, text: string): string {
	const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>body{margin:24px;color:#111;background:#fff}h1{font:16px system-ui;overflow-wrap:anywhere}pre{font:12px Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4}@page{margin:16mm}@media print{body{margin:0}}</style></head><body><h1>${escape(title)}</h1><pre>${escape(text)}</pre></body></html>`;
}
