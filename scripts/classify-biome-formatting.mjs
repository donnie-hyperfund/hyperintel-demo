import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { structuredPatch } from 'diff';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const biomeBin = path.join(repoRoot, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
const args = process.argv.slice(2);

const jsonOutput = args.includes('--json');

function runBiome(args, options = {}) {
    const result = spawnSync(process.execPath, [biomeBin, ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
        windowsHide: true,
        ...options,
    });

    return result;
}

function runBiomeFormatReport() {
    const result = runBiome(['format', '--reporter=json', '--colors=off', '--max-diagnostics=none', '.']);

    if (result.stdout?.trim()) {
        return result.stdout;
    }

    throw new Error(result.stderr?.trim() || `Biome exited with code ${result.status}`);
}

function formatFile(relativePath, originalText) {
    const result = runBiome(['format', '--colors=off', '--stdin-file-path', relativePath], {
        input: originalText,
    });

    if (result.status !== 0) {
        throw new Error(`${relativePath}: ${result.stderr || result.stdout || `Biome exited with code ${result.status}`}`);
    }

    return result.stdout;
}

function parseBiomeJson(stdout) {
    const trimmed = stdout.trim();
    if (!trimmed) {
        return { diagnostics: [] };
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        throw new Error('Biome did not emit JSON output.');
    }

    const jsonText = trimmed.slice(firstBrace, lastBrace + 1);
    const repairedJsonText = escapeBiomePathBackslashes(jsonText);

    try {
        return JSON.parse(repairedJsonText);
    } catch {
        return JSON.parse(escapeInvalidJsonBackslashes(repairedJsonText));
    }
}

function escapeBiomePathBackslashes(jsonText) {
    return jsonText.replace(/("path"\s*:\s*")([^"]*)(")/g, (_match, prefix, value, suffix) => {
        return `${prefix}${value.replaceAll('\\', '\\\\')}${suffix}`;
    });
}

function escapeInvalidJsonBackslashes(jsonText) {
    let repaired = '';

    for (let index = 0; index < jsonText.length; index += 1) {
        const char = jsonText[index];

        if (char !== '\\') {
            repaired += char;
            continue;
        }

        const next = jsonText[index + 1];

        if (next === undefined) {
            repaired += '\\\\';
            continue;
        }

        if (next === 'u') {
            const unicodeDigits = jsonText.slice(index + 2, index + 6);

            if (/^[0-9a-fA-F]{4}$/.test(unicodeDigits)) {
                repaired += `\\u${unicodeDigits}`;
                index += 5;
            } else {
                repaired += '\\\\';
            }

            continue;
        }

        if ('"\\/bfnrt'.includes(next)) {
            repaired += `\\${next}`;
            index += 1;
            continue;
        }

        repaired += '\\\\';
    }

    return repaired;
}

function normalizeBiomePath(filePath) {
    return path.normalize(filePath).replaceAll(path.sep, '/').replaceAll('\\', '/').replace(/^\.\//, '');
}

function lineText(patchLine) {
    return patchLine.slice(1);
}

function removeWhitespace(text) {
    return text.replace(/\s+/g, '');
}

function leadingWhitespace(text) {
    return text.match(/^\s*/)?.[0] ?? '';
}

function isQuoteOnly(oldText, newText) {
    return oldText.replaceAll("'", '"') === newText.replaceAll("'", '"') && oldText !== newText;
}

function isTrailingCommaOnly(oldText, newText) {
    return oldText.replace(/,\s*$/, '') === newText.replace(/,\s*$/, '') && /,\s*$/.test(oldText + newText);
}

function classifyLinePair(oldLine, newLine) {
    const oldText = lineText(oldLine);
    const newText = lineText(newLine);
    const oldTrim = oldText.trim();
    const newTrim = newText.trim();

    if (oldTrim === newTrim && leadingWhitespace(oldText) !== leadingWhitespace(newText)) {
        return 'indentation';
    }

    if (removeWhitespace(oldText) === removeWhitespace(newText) && oldText !== newText) {
        return 'spacing';
    }

    if (isQuoteOnly(oldText, newText)) {
        return 'quotes';
    }

    if (isTrailingCommaOnly(oldTrim, newTrim)) {
        return 'trailing-comma';
    }

    if (oldTrim.replace(/,\s*$/, '') === newTrim.replace(/,\s*$/, '') && oldTrim !== newTrim) {
        return 'trailing-comma/spacing';
    }

    return 'line-content';
}

function classifyHunk(hunk) {
    const removed = hunk.lines.filter((line) => line.startsWith('-'));
    const added = hunk.lines.filter((line) => line.startsWith('+'));
    const context = hunk.lines.filter((line) => line.startsWith(' '));

    if (removed.length === 0 && added.length > 0) {
        return 'line-insertions';
    }

    if (added.length === 0 && removed.length > 0) {
        return 'line-removals';
    }

    if (removed.length === added.length && removed.length > 0) {
        const pairKinds = removed.map((line, index) => classifyLinePair(line, added[index]));
        const uniqueKinds = [...new Set(pairKinds)];

        if (uniqueKinds.length === 1) {
            return uniqueKinds[0];
        }

        if (
            uniqueKinds.every((kind) =>
                ['indentation', 'spacing', 'trailing-comma', 'trailing-comma/spacing'].includes(kind),
            )
        ) {
            return 'layout-spacing';
        }
    }

    const removedJoined = removed.map(lineText).join('').replace(/\s+/g, '');
    const addedJoined = added.map(lineText).join('').replace(/\s+/g, '');

    if (removedJoined === addedJoined) {
        if (removed.length > added.length) {
            return 'line-joining';
        }

        if (added.length > removed.length) {
            return 'line-wrapping';
        }

        return 'layout-spacing';
    }

    if (removedJoined.replaceAll(',', '') === addedJoined.replaceAll(',', '')) {
        return 'trailing-comma';
    }

    if (context.length === 0 && (removed.length > 4 || added.length > 4)) {
        return 'block-reflow';
    }

    return 'mixed/complex';
}

function getFormattingFiles() {
    const report = parseBiomeJson(runBiomeFormatReport());

    return [
        ...new Set(
            (report.diagnostics ?? [])
                .filter((diagnostic) => diagnostic.category === 'format' && diagnostic.location?.path)
                .map((diagnostic) => normalizeBiomePath(diagnostic.location.path)),
        ),
    ].sort();
}

function classifyFiles(files) {
    const counts = new Map();
    const filesByKind = new Map();
    let hunkCount = 0;

    for (const relativePath of files) {
        const originalText = readFileSync(path.join(repoRoot, relativePath), 'utf8');
        const formattedText = formatFile(relativePath, originalText);
        const patch = structuredPatch(relativePath, relativePath, originalText, formattedText, '', '', { context: 0 });

        for (const hunk of patch.hunks) {
            const kind = classifyHunk(hunk);

            hunkCount += 1;
            counts.set(kind, (counts.get(kind) ?? 0) + 1);

            if (!filesByKind.has(kind)) {
                filesByKind.set(kind, new Set());
            }

            filesByKind.get(kind).add(relativePath);
        }
    }

    const classifications = [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([kind, hunks]) => ({
            kind,
            hunks,
            files: filesByKind.get(kind)?.size ?? 0,
        }));

    return {
        formattingFiles: files.length,
        formattingHunks: hunkCount,
        classifications,
    };
}

function printReport(report) {
    console.log('Biome formatting hunk classification');
    console.log(`format files: ${report.formattingFiles}`);
    console.log(`format hunks: ${report.formattingHunks}`);
    console.log('');
    console.log('kind\thunks\tfiles');

    for (const classification of report.classifications) {
        console.log(`${classification.kind}\t${classification.hunks}\t${classification.files}`);
    }
}

function main() {
    const report = classifyFiles(getFormattingFiles());

    if (jsonOutput) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }

    printReport(report);
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
