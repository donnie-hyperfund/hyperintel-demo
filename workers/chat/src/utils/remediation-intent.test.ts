import { describe, expect, it } from 'vitest';
import { looksLikeRemediationIntent } from './remediation-intent';

describe('looksLikeRemediationIntent', () => {
    it('matches bulk apply phrasing', () => {
        expect(looksLikeRemediationIntent('Surgically apply all remediations')).toBe(true);
        expect(looksLikeRemediationIntent('apply all QA remediations to B1')).toBe(true);
        expect(looksLikeRemediationIntent('remediate all findings from QA')).toBe(true);
    });

    it('matches one-at-a-time remediation phrasing', () => {
        expect(looksLikeRemediationIntent('remediate findings one at a time')).toBe(true);
    });

    it('does not match unrelated messages', () => {
        expect(looksLikeRemediationIntent('approve the document')).toBe(false);
        expect(looksLikeRemediationIntent('run QA on B1')).toBe(false);
        expect(looksLikeRemediationIntent(null)).toBe(false);
    });
});
