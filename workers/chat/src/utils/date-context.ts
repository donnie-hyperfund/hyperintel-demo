import { tz } from '@date-fns/tz';
import { format } from 'date-fns';

/** Prepended to agent prompts so the model uses the user's local "now" instead of hallucinating dates. */
export function buildDateContextBlock(timezone: string): string {
    const safeZone = isValidTimeZone(timezone) ? timezone : 'UTC';
    const now = new Date();
    const inZone = { in: tz(safeZone) };

    const verbose = format(now, 'EEEE, MMMM d, yyyy, HH:mm', inZone);
    const iso = format(now, "yyyy-MM-dd'T'HH:mm:ssXXX", inZone);
    const offsetToken = format(now, 'XXX', inZone);
    const utcOffset = offsetToken === 'Z' ? 'UTC' : `UTC${offsetToken}`;

    return [
        '**Current Context**',
        `- Current date and time: ${verbose} (${safeZone}, ${utcOffset})`,
        `- ISO: ${iso}`,
        `- User timezone: ${safeZone}`,
        '',
        'Whenever you reference today, the current date, or any "now" timestamp — in chat replies, deliverables, briefs, summaries, or any other output — use the date above. Never guess or assume dates.',
    ].join('\n');
}

function isValidTimeZone(timezone: string): boolean {
    try {
        new Intl.DateTimeFormat('en', { timeZone: timezone });
        return true;
    } catch {
        return false;
    }
}
