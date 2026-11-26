/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ModesRegistry } from '../../../../editor/common/languages/modesRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IOutputService, LOG_MIME, LOG_MODE_ID, OUTPUT_MIME, OUTPUT_MODE_ID } from '../../../services/output/common/output.js';
import { OutputService } from './outputServices.js';

registerSingleton(IOutputService, OutputService, InstantiationType.Delayed);

ModesRegistry.registerLanguage({ id: OUTPUT_MODE_ID, extensions: [], mimetypes: [OUTPUT_MIME] });
ModesRegistry.registerLanguage({ id: LOG_MODE_ID, extensions: [], mimetypes: [LOG_MIME] });
