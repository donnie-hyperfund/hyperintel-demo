export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        const sms = await import('source-map-support');

        function fixSources(map: Record<string, unknown>): Record<string, unknown> {
            if (Array.isArray(map.sources)) {
                map.sources = (map.sources as string[]).map((s) => {
                    if (typeof s === 'string' && s.startsWith('file:')) {
                        try { return fileURLToPath(s); } catch { return s; }
                    }
                    return s;
                });
            }
            if (Array.isArray(map.sections)) {
                map.sections = (map.sections as { offset: unknown; map: Record<string, unknown> }[]).map(
                    (section) => section.map ? { ...section, map: fixSources({ ...section.map }) } : section,
                );
            }
            return map;
        }

        sms.install({
            retrieveSourceMap(source) {
                try {
                    const content = fs.readFileSync(source, 'utf8');
                    const match = /\/\/# sourceMappingURL=(.+)$/m.exec(content);
                    if (!match) return null;
                    const mapPath = path.resolve(path.dirname(source), decodeURIComponent(match[1].trim()));
                    if (!fs.existsSync(mapPath)) return null;
                    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
                    return { url: mapPath, map: JSON.stringify(fixSources(map)) };
                } catch {
                    return null;
                }
            },
        });

        // Strip cwd, normalize to forward slashes, and prefix with ./ so IDEs auto-link file:line:col
        const cwd = process.cwd().replaceAll('\\', '/') + '/';
        const smsPrepare = Error.prepareStackTrace!;
        Error.prepareStackTrace = (err, stack) => {
            const result = smsPrepare(err, stack);
            return typeof result === 'string'
                ? result.replaceAll('\\', '/').replaceAll(cwd, '')
                : result;
        };
    }
}
