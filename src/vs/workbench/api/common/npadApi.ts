/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Whether an extension-host bridge belongs to the editing-only edition. */
export function isNPadMainThreadCustomer(identifier: string): boolean {
	return !/^MainThread(?:AgentEditorComments|Browsers|BrowserTunnelProxy|LanguageModels|Chat[^/]*|CodeMapper|LanguageModelTools|Embeddings|DebugService|QuickDiff|Speech[^/]*|EditSessionIdentityParticipant|SCM|Terminal[^/]*|GitHub|Notebook[^/]*|Interactive|Task|Authentication|Timeline|Testing|ProfileContentHandlers|Ai[^/]*|Mcp[^/]*|GitExtension(?:Service)?)$/.test(identifier);
}
