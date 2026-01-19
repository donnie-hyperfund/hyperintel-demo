/**
 * Document Tools - Public API
 */

export {
    applyEdits,
    countLines,
    type DocumentInfo,
    type EditOperation,
    type EditResult,
    extractViewport,
    findDocumentByName,
    formatWithLineNumbers,
    listDocuments,
    normalizeDocumentName,
    updateDocumentContent,
    upsertDocument,
} from './document-service';
export { DraftManager, type DraftSession, getDraftManager } from './draft-manager';
export { createDocumentTools, DocumentToolGroup, type DocumentToolsContext } from './tools';
