/**
 * Document Tools - Public API
 */

export {
    type AppliedEdit,
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
    inferEndLine,
    listDocuments,
    rejectVersion,
    supersedeProposedVersion,
    upsertDocument,
} from './document-service';
export { DraftManager, type DraftSession } from './draft-manager';
export { generateInternalSummary } from './pecp-generator';
export { shouldGeneratePECP } from './pecp-service';
export { createDocumentTools, DocumentToolGroup, type DocumentToolsContext } from './tools';
