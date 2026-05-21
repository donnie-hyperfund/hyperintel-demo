/** Browser's IANA timezone. Call from browser only — on the server (incl. Workers) this returns the server's TZ, not the user's. */
export function getClientTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

export function withClientTimezone<T extends object>(data: T): T & { timezone: string } {
    return { ...data, timezone: getClientTimezone() };
}
