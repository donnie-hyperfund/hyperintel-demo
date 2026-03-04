/**
 * Document Tools - Public API
 */

export {
    applyEdits,
    approveVersion,
    countLines,
    type DocumentInfo,
    type DocumentListItem,
    type DocumentScope,
    type EditOperation,
    type EditResult,
    extractViewport,
    findBaseVersionForEdit,
    findDocumentByName,
    findVersionByStatus,
    formatWithLineNumbers,
    listDocuments,
    rejectVersion,
    supersedeProposedVersion,
    upsertDocument,
} from './document-service';
export { DraftManager, type DraftSession } from './draft-manager';
export { createDocumentTools, DocumentToolGroup, type DocumentToolsContext } from './tools';
