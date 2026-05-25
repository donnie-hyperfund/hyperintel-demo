/**
 * Document Tools - Public API
 */

export {
    type AppliedEdit,
    applyEdits,
    approveVersion,
    BEGIN_EDIT_MAX_CHARS,
    BEGIN_EDIT_MAX_ESTIMATED_TOKENS,
    BEGIN_EDIT_MAX_LINES,
    buildPatchTouchedRegions,
    cleanupOrphanArtifact,
    countLines,
    countReplacementLines,
    type DocumentInfo,
    type DocumentListItem,
    type DocumentScope,
    draftFitsBeginContentCap,
    type EditOperation,
    type EditResult,
    estimateTokensFromChars,
    extractViewport,
    findBaseVersionForEdit,
    findDocumentByName,
    findVersionByStatus,
    formatFullDraftContent,
    formatWithLineNumbers,
    inferEndLine,
    listDocuments,
    PATCH_TOUCHED_CONTEXT_LINES,
    PATCH_TOUCHED_MAX_CHARS,
    rejectVersion,
    supersedeProposedVersion,
    type TouchedRegion,
    upsertDocument,
} from './document-service';
export { DraftManager, type DraftSession } from './draft-manager';
export { generateInternalSummary } from './pecp-generator';
export { shouldGenerateInternalSummary } from './pecp-service';
export { createDocumentTools, DocumentToolGroup, type DocumentToolsContext } from './tools';
