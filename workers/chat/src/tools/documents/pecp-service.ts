/**
 * PECP Service — gates which document types receive an auto-generated PE Communication summary.
 *
 * The summary is written into the parent version's `summary_internal` field by the PECP generator
 * (see pecp-generator.ts). PECP is no longer a separate artifact, so the only public helper is the
 * type gate.
 */

import { INTERNAL_DOCUMENTS } from '@/lib/schema/artifact';

/** Returns true when the given document type should get an auto-generated PECP summary on finalize. */
export function shouldGeneratePECP(documentType: string): boolean {
    return (INTERNAL_DOCUMENTS as readonly string[]).includes(documentType);
}
