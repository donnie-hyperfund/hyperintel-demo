import { execFile, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { applyPatch, structuredPatch } from 'diff';

const execFileAsync = promisify(execFile);
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const biomeBin = path.join(repoRoot, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
const args = process.argv.slice(2);

const jsonOutput = args.includes('--json');
const hunkOutput = args.includes('--hunks');
const fixOutput = args.includes('--fix');
const includeStagedLines = args.includes('--include-staged-lines');
const includeChangedLinesArg = args.find((arg) => arg === '--include-changed-lines' || arg.startsWith('--include-changed-lines='));
const onlyStagedLines = args.includes('--only-staged-lines');
const onlyChangedLinesArg = args.find((arg) => arg === '--only-changed-lines' || arg.startsWith('--only-changed-lines='));
const monthsArg = args.find((arg) => arg.startsWith('--months='));
const maxHunksArg = args.find((arg) => arg.startsWith('--max-hunks='));
const concurrencyArg = args.find((arg) => arg.startsWith('--concurrency='));
const githubBaseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined;
const includeChangedLinesBaseRef =
    includeChangedLinesArg?.startsWith('--include-changed-lines=')
        ? includeChangedLinesArg.slice('--include-changed-lines='.length)
        : includeChangedLinesArg
          ? githubBaseRef
          : undefined;
const onlyChangedLinesBaseRef =
    onlyChangedLinesArg?.startsWith('--only-changed-lines=')
        ? onlyChangedLinesArg.slice('--only-changed-lines='.length)
        : onlyChangedLinesArg
          ? githubBaseRef
          : undefined;
const months = Number(monthsArg?.split('=')[1] ?? 2);
const maxHunks = Number(maxHunksArg?.split('=')[1] ?? 200);
const concurrency = Number(concurrencyArg?.split('=')[1] ?? 4);
const onlyLineMode = onlyStagedLines || Boolean(onlyChangedLinesBaseRef);

if ((includeStagedLines || includeChangedLinesArg || onlyStagedLines || onlyChangedLinesArg) && !hunkOutput) {
    console.error('Line-level formatting flags are only supported with --hunks.');
    process.exit(2);
}

if ((onlyStagedLines || onlyChangedLinesArg) && (includeStagedLines || includeChangedLinesArg)) {
    console.error('Use either --include-* flags or --only-* flags, not both.');
    process.exit(2);
}

if (includeChangedLinesArg && !includeChangedLinesBaseRef) {
    console.error('Missing --include-changed-lines base ref. Use --include-changed-lines=<base>, for example origin/main.');
    process.exit(2);
}

if (onlyChangedLinesArg && !onlyChangedLinesBaseRef) {
    console.error('Missing --only-changed-lines base ref. Use --only-changed-lines=<base>, for example origin/main.');
    process.exit(2);
}

if (!Number.isFinite(months) || months <= 0) {
    console.error('Invalid --months value. Use a positive number, for example --months=2.');
    process.exit(2);
}

if (!Number.isFinite(maxHunks) || maxHunks <= 0) {
    console.error('Invalid --max-hunks value. Use a positive number, for example --max-hunks=200.');
    process.exit(2);
}

if (!Number.isInteger(concurrency) || concurrency <= 0) {
    console.error('Invalid --concurrency value. Use a positive integer, for example --concurrency=4.');
    process.exit(2);
}

const cutoff = new Date();
cutoff.setMonth(cutoff.getMonth() - months);

function run(command, commandArgs, options = {}) {
    return execFileAsync(command, commandArgs, {
        cwd: repoRoot,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        ...options,
    });
}

function runWithInput(command, commandArgs, input, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, commandArgs, {
            cwd: repoRoot,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            ...options,
        });

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }

            const error = new Error(stderr.trim() || `${command} exited with code ${code}`);
            error.code = code;
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
        });

        child.stdin.end(input);
    });
}

async function runBiomeFormat() {
    try {
        const result = await run(process.execPath, [
            biomeBin,
            'format',
            '--reporter=json',
            '--colors=off',
            '--max-diagnostics=none',
            '.',
        ]);
        return result.stdout;
    } catch (error) {
        if (typeof error.stdout === 'string' && error.stdout.trim()) {
            return error.stdout;
        }

        const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
        throw new Error(stderr || error.message);
    }
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
        // Biome 2.4's JSON reporter can emit raw Windows path separators outside path fields too.
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

function formatDate(date) {
    return date.toISOString().slice(0, 10);
}

function formatOptionalDate(date) {
    return date ? formatDate(date) : 'uncommitted';
}

function lineCount(text) {
    if (text.length === 0) {
        return 0;
    }

    const normalized = text.replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n');
    return normalized.endsWith('\n') ? lines.length - 1 : lines.length;
}

async function getLastGitChange(relativePath) {
    const result = await run('git', ['log', '-1', '--format=%ct', '--', relativePath]);
    const timestamp = Number(result.stdout.trim());

    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return undefined;
    }

    return new Date(timestamp * 1000);
}

function normalizeGitPath(filePath) {
    return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function chunkArray(items, size) {
    const chunks = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

async function mapLimit(items, limit, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return results;
}

async function getGitChangedFiles(diffArgs) {
    const result = await run('git', ['diff', '--name-only', ...diffArgs]);

    return new Set(result.stdout.split(/\r?\n/).filter(Boolean).map(normalizeGitPath));
}

function mergeLineMaps(target, source) {
    for (const [file, lines] of source) {
        if (!target.has(file)) {
            target.set(file, new Set());
        }

        for (const line of lines) {
            target.get(file).add(line);
        }
    }
}

async function getGitDiffForFiles(diffArgs, files) {
    const chunks = chunkArray(files, 50);
    const outputs = [];

    for (const chunk of chunks) {
        try {
            const result = await run('git', ['diff', ...diffArgs, '--', ...chunk]);
            outputs.push(result.stdout);
        } catch (error) {
            const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
            throw new Error(stderr || error.message);
        }
    }

    return outputs.join('\n');
}

function parseNewLineRangesByFileFromDiff(diffText, allowedFiles) {
    const byFile = new Map();
    let currentFile = undefined;

    for (const line of diffText.split(/\r?\n/)) {
        if (line.startsWith('+++ ')) {
            const nextFile = line.slice(4);
            currentFile = nextFile === '/dev/null' ? undefined : normalizeGitPath(nextFile.replace(/^b\//, ''));

            if (currentFile && !allowedFiles.has(currentFile)) {
                currentFile = undefined;
            }

            continue;
        }

        if (!currentFile) {
            continue;
        }

        const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);

        if (!match) {
            continue;
        }

        const start = Number(match[1]);
        const length = match[2] === undefined ? 1 : Number(match[2]);

        if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) {
            continue;
        }

        if (!byFile.has(currentFile)) {
            byFile.set(currentFile, new Set());
        }

        for (let offset = 0; offset < length; offset += 1) {
            byFile.get(currentFile).add(start + offset);
        }
    }

    return byFile;
}

function countSetEntries(sets) {
    return [...sets].reduce((total, set) => total + set.size, 0);
}

async function getFormattedText(relativePath, originalText) {
    const result = await runWithInput(
        process.execPath,
        [biomeBin, 'format', '--colors=off', '--stdin-file-path', relativePath],
        originalText,
    );
    return result.stdout;
}

async function formatFilesInPlace(files) {
    const chunkSize = 50;

    for (let index = 0; index < files.length; index += chunkSize) {
        const chunk = files.slice(index, index + chunkSize);
        await run(process.execPath, [biomeBin, 'format', '--write', ...chunk]);
    }
}

function getAffectedOriginalLines(hunk, originalLineCount) {
    let oldLine = hunk.oldStart;
    const affectedLines = [];

    for (const line of hunk.lines) {
        const marker = line[0];

        if (marker === '-') {
            if (oldLine >= 1 && oldLine <= originalLineCount) {
                affectedLines.push(oldLine);
            }
            oldLine += 1;
            continue;
        }

        if (marker === ' ') {
            oldLine += 1;
        }
    }

    if (affectedLines.length === 0) {
        for (const anchor of [hunk.oldStart, hunk.oldStart - 1]) {
            if (anchor >= 1 && anchor <= originalLineCount) {
                affectedLines.push(anchor);
            }
        }
    }

    return [...new Set(affectedLines)].sort((left, right) => left - right);
}

async function getBlameByLine(relativePath) {
    let result;

    try {
        result = await run('git', ['blame', '--line-porcelain', '--', relativePath]);
    } catch {
        return undefined;
    }

    const blameByLine = new Map();
    let currentCommit = undefined;
    let currentAuthorTime = undefined;
    let currentLine = 0;

    for (const line of result.stdout.split(/\r?\n/)) {
        const headerMatch = line.match(/^([0-9a-f]{40}) \d+ \d+/);

        if (headerMatch) {
            currentCommit = headerMatch[1];
            currentAuthorTime = undefined;
            continue;
        }

        if (line.startsWith('author-time ')) {
            const timestamp = Number(line.slice('author-time '.length));
            currentAuthorTime = Number.isFinite(timestamp) ? new Date(timestamp * 1000) : undefined;
            continue;
        }

        if (line.startsWith('\t')) {
            currentLine += 1;
            blameByLine.set(currentLine, {
                changedAt: currentAuthorTime,
                uncommitted: currentCommit === '0000000000000000000000000000000000000000',
            });
        }
    }

    return blameByLine;
}

function formatLineRange(lines) {
    if (lines.length === 0) {
        return 'unknown';
    }

    const ranges = [];
    let start = lines[0];
    let end = lines[0];

    for (const line of lines.slice(1)) {
        if (line === end + 1) {
            end = line;
            continue;
        }

        ranges.push(start === end ? String(start) : `${start}-${end}`);
        start = line;
        end = line;
    }

    ranges.push(start === end ? String(start) : `${start}-${end}`);
    return ranges.join(',');
}

function getLatestDate(dates) {
    return dates.reduce((latest, date) => (date > latest ? date : latest), dates[0]);
}

function sortDateValue(date) {
    return date?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

async function getLineEligibilityByFile(formatFiles) {
    const byFile = new Map();
    const formatFileSet = new Set(formatFiles);
    const stagedLineModeEnabled = includeStagedLines || onlyStagedLines;
    const changedLineBaseRef = includeChangedLinesBaseRef ?? onlyChangedLinesBaseRef;
    const changedLineModeEnabled = Boolean(changedLineBaseRef);
    const needsWorkingTreeState = stagedLineModeEnabled || changedLineModeEnabled;
    const stagedChangedFiles = needsWorkingTreeState ? await getGitChangedFiles(['--cached']) : new Set();
    const unstagedChangedFiles = needsWorkingTreeState ? await getGitChangedFiles([]) : new Set();
    const stagedLinesByFile = new Map();
    const changedLinesByFile = new Map();
    const skippedStagedFilesWithUnstagedChanges = [];
    const skippedChangedLineFilesWithWorkingTreeChanges = [];
    const skippedFormattingFilesWithoutEligibleLines = [];

    if (stagedLineModeEnabled) {
        const stagedFiles = formatFiles.filter((file) => stagedChangedFiles.has(file) && !unstagedChangedFiles.has(file));
        mergeLineMaps(
            stagedLinesByFile,
            parseNewLineRangesByFileFromDiff(await getGitDiffForFiles(['--cached', '--unified=0'], stagedFiles), formatFileSet),
        );
    }

    if (changedLineBaseRef) {
        const cleanFiles = formatFiles.filter((file) => !stagedChangedFiles.has(file) && !unstagedChangedFiles.has(file));
        mergeLineMaps(
            changedLinesByFile,
            parseNewLineRangesByFileFromDiff(
                await getGitDiffForFiles(['--unified=0', `${changedLineBaseRef}...HEAD`], cleanFiles),
                formatFileSet,
            ),
        );
    }

    for (const relativePath of formatFiles) {
        const stagedLines = stagedLinesByFile.get(relativePath) ?? new Set();
        const changedLines = changedLinesByFile.get(relativePath) ?? new Set();

        if (stagedLineModeEnabled && stagedChangedFiles.has(relativePath) && unstagedChangedFiles.has(relativePath)) {
            skippedStagedFilesWithUnstagedChanges.push(relativePath);
        }

        if (changedLineModeEnabled && (stagedChangedFiles.has(relativePath) || unstagedChangedFiles.has(relativePath))) {
            skippedChangedLineFilesWithWorkingTreeChanges.push(relativePath);
        }

        byFile.set(relativePath, {
            stagedLines,
            changedLines,
        });

        if (onlyLineMode && stagedLines.size === 0 && changedLines.size === 0) {
            skippedFormattingFilesWithoutEligibleLines.push(relativePath);
        }
    }

    const candidateFiles = onlyLineMode
        ? formatFiles.filter((file) => !skippedFormattingFilesWithoutEligibleLines.includes(file))
        : formatFiles;

    return {
        byFile,
        candidateFiles,
        summary: {
            includeStagedLines,
            includeChangedLinesBaseRef,
            onlyStagedLines,
            onlyChangedLinesBaseRef,
            onlyLineMode,
            stagedEligibleLines: countSetEntries([...byFile.values()].map((eligibility) => eligibility.stagedLines)),
            changedEligibleLines: countSetEntries([...byFile.values()].map((eligibility) => eligibility.changedLines)),
            skippedStagedFilesWithUnstagedChanges,
            skippedChangedLineFilesWithWorkingTreeChanges,
            skippedFormattingFilesWithoutEligibleLines,
        },
    };
}

function analyzeHunk(hunk, blameByLine, originalLineCount, relativePath, lineEligibility) {
    const affectedLines = getAffectedOriginalLines(hunk, originalLineCount);
    const lineDecisions = affectedLines.map((line) => {
        const blameEntry = blameByLine?.get(line);
        const oldByBlame = Boolean(blameEntry?.changedAt && !blameEntry.uncommitted && blameEntry.changedAt < cutoff);
        const ageEligible = !onlyLineMode && oldByBlame;
        const stagedLine = lineEligibility?.stagedLines.has(line) ?? false;
        const changedLine = lineEligibility?.changedLines.has(line) ?? false;

        return {
            line,
            blameEntry,
            oldByBlame,
            ageEligible,
            stagedLine,
            changedLine,
            eligible: ageEligible || stagedLine || changedLine,
        };
    });
    const knownEntries = lineDecisions
        .map((decision) => decision.blameEntry)
        .filter((entry) => entry?.changedAt && !entry.uncommitted);
    const eligible = affectedLines.length > 0 && lineDecisions.every((decision) => decision.eligible);
    const latestChangedAt = knownEntries.length > 0 ? getLatestDate(knownEntries.map((entry) => entry.changedAt)) : undefined;

    return {
        path: relativePath,
        hunk,
        lines: affectedLines,
        lineRange: formatLineRange(affectedLines),
        latestChangedAt,
        eligible,
        oldEnough: eligible,
        usedStagedLineAllowance: eligible && lineDecisions.some((decision) => !decision.ageEligible && decision.stagedLine),
        usedChangedLineAllowance: eligible && lineDecisions.some((decision) => !decision.ageEligible && decision.changedLine),
        missingBlame: !onlyLineMode && lineDecisions.some(
            (decision) => !decision.blameEntry?.changedAt && !decision.stagedLine && !decision.changedLine,
        ),
    };
}

async function getFileHunkAnalysis(relativePath, lineEligibility, options = {}) {
    const absolutePath = path.join(repoRoot, relativePath);
    const originalText = await readFile(absolutePath, 'utf8');
    const formattedText = await getFormattedText(relativePath, originalText);
    const patch = structuredPatch(relativePath, relativePath, originalText, formattedText, '', '', { context: 0 });
    const blameByLine = options.skipBlame ? undefined : await getBlameByLine(relativePath);
    const originalLineCount = lineCount(originalText);

    return {
        path: relativePath,
        absolutePath,
        originalText,
        patch,
        hunks: patch.hunks.map((hunk) => analyzeHunk(hunk, blameByLine, originalLineCount, relativePath, lineEligibility)),
    };
}

async function getHunkAnalyses(formatFiles) {
    const lineEligibility = await getLineEligibilityByFile(formatFiles);
    const filesToAnalyze = lineEligibility.candidateFiles;

    const analyses = await mapLimit(filesToAnalyze, concurrency, (relativePath) =>
        getFileHunkAnalysis(relativePath, lineEligibility.byFile.get(relativePath), {
            skipBlame: onlyLineMode,
        }),
    );

    return {
        analyses,
        eligibilitySummary: lineEligibility.summary,
    };
}

function getHunkReportFromAnalyses(formatFiles, analyses, eligibilitySummary) {
    const files = [];
    const eligibleHunks = [];
    let allHunks = 0;
    let hunksWithoutBlame = 0;
    let hunksUsingStagedLineAllowance = 0;
    let hunksUsingChangedLineAllowance = 0;

    for (const analysis of analyses) {
        allHunks += analysis.hunks.length;
        hunksWithoutBlame += analysis.hunks.filter((hunk) => hunk.missingBlame).length;
        eligibleHunks.push(...analysis.hunks.filter((hunk) => hunk.eligible));
        hunksUsingStagedLineAllowance += analysis.hunks.filter((hunk) => hunk.usedStagedLineAllowance).length;
        hunksUsingChangedLineAllowance += analysis.hunks.filter((hunk) => hunk.usedChangedLineAllowance).length;

        if (analysis.hunks.length > 0) {
            files.push({
                path: analysis.path,
                hunks: analysis.hunks.length,
                stableHunks: analysis.hunks.filter((hunk) => hunk.eligible).length,
                eligibleHunks: analysis.hunks.filter((hunk) => hunk.eligible).length,
            });
        }
    }

    return {
        months,
        cutoff: formatDate(cutoff),
        formattingErrorFiles: formatFiles.length,
        formattingFilesAnalyzed: analyses.length,
        skippedFormattingFilesWithoutEligibleLines:
            eligibilitySummary?.skippedFormattingFilesWithoutEligibleLines?.length ?? 0,
        formattingHunks: allHunks,
        stableFormattingHunks: eligibleHunks.length,
        eligibleFormattingHunks: eligibleHunks.length,
        hunksWithoutBlame,
        hunksUsingStagedLineAllowance,
        hunksUsingChangedLineAllowance,
        filesWithStableHunks: new Set(eligibleHunks.map((hunk) => hunk.path)).size,
        filesWithEligibleHunks: new Set(eligibleHunks.map((hunk) => hunk.path)).size,
        ratio: `${eligibleHunks.length}/${allHunks}`,
        eligibility: eligibilitySummary,
        files,
        stableHunks: eligibleHunks
            .sort(
                (left, right) =>
                    sortDateValue(left.latestChangedAt) - sortDateValue(right.latestChangedAt) ||
                    left.path.localeCompare(right.path) ||
                    left.lines[0] - right.lines[0],
            )
            .map((hunk) => ({
                path: hunk.path,
                lines: hunk.lineRange,
                latestChanged: formatOptionalDate(hunk.latestChangedAt),
            })),
    };
}

async function getHunkReport(formatFiles) {
    const { analyses, eligibilitySummary } = await getHunkAnalyses(formatFiles);
    return getHunkReportFromAnalyses(formatFiles, analyses, eligibilitySummary);
}

async function fixStableHunks(formatFiles) {
    const { analyses, eligibilitySummary } = await getHunkAnalyses(formatFiles);
    const report = getHunkReportFromAnalyses(formatFiles, analyses, eligibilitySummary);
    const fixedFiles = [];
    let fixedHunks = 0;

    for (const analysis of analyses) {
        const selectedHunks = analysis.hunks.filter((hunk) => hunk.eligible);

        if (selectedHunks.length === 0) {
            continue;
        }

        const partialPatch = {
            ...analysis.patch,
            hunks: selectedHunks.map((hunk) => hunk.hunk),
        };
        const patchedText = applyPatch(analysis.originalText, partialPatch);

        if (patchedText === false) {
            throw new Error(`Failed to apply selected formatting hunks for ${analysis.path}`);
        }

        if (patchedText !== analysis.originalText) {
            await writeFile(analysis.absolutePath, patchedText, 'utf8');
            fixedFiles.push({
                path: analysis.path,
                hunks: selectedHunks.length,
            });
            fixedHunks += selectedHunks.length;
        }
    }

    return {
        ...report,
        fixedFiles,
        fixedFileCount: fixedFiles.length,
        fixedHunks,
    };
}

async function main() {
    const biomeOutput = await runBiomeFormat();
    const biomeReport = parseBiomeJson(biomeOutput);
    const formatFiles = [
        ...new Set(
            (biomeReport.diagnostics ?? [])
                .filter((diagnostic) => diagnostic.category === 'format' && diagnostic.location?.path)
                .map((diagnostic) => normalizeBiomePath(diagnostic.location.path)),
        ),
    ].sort();

    if (hunkOutput) {
        const report = fixOutput ? await fixStableHunks(formatFiles) : await getHunkReport(formatFiles);

        if (jsonOutput) {
            console.log(JSON.stringify(report, null, 2));
            return;
        }

        const hunkSelection = report.eligibility?.onlyLineMode ? 'matching only-line filters' : `older than ${months} months`;
        console.log(`Biome formatting hunks ${hunkSelection}${fixOutput ? ' fixed' : ''}`);
        console.log(report.eligibility?.onlyLineMode ? `Cutoff: ${report.cutoff} (not used for eligibility)` : `Cutoff: ${report.cutoff}`);
        console.log(report.eligibility?.onlyLineMode ? `Intersect/analyzed hunks: ${report.ratio}` : `Intersect/all hunks: ${report.ratio}`);
        console.log(`Formatting files: ${report.formattingErrorFiles}`);
        if (report.formattingFilesAnalyzed !== report.formattingErrorFiles) {
            console.log(`Analyzed formatting files: ${report.formattingFilesAnalyzed}`);
            console.log(`Formatting files skipped with no eligible lines: ${report.skippedFormattingFilesWithoutEligibleLines}`);
        }
        console.log(`Files with stable hunks: ${report.filesWithStableHunks}`);
        console.log(`Hunks without usable blame: ${report.hunksWithoutBlame}`);
        console.log(`Hunks using staged-line allowance: ${report.hunksUsingStagedLineAllowance}`);
        console.log(`Hunks using changed-line allowance: ${report.hunksUsingChangedLineAllowance}`);

        if (report.eligibility?.includeStagedLines || report.eligibility?.onlyStagedLines) {
            console.log(`Staged eligible lines: ${report.eligibility.stagedEligibleLines}`);
            console.log(
                `Staged-line files skipped due to unstaged changes: ${report.eligibility.skippedStagedFilesWithUnstagedChanges.length}`,
            );
        }

        if (report.eligibility?.includeChangedLinesBaseRef || report.eligibility?.onlyChangedLinesBaseRef) {
            console.log(`Changed-lines base ref: ${report.eligibility.includeChangedLinesBaseRef ?? report.eligibility.onlyChangedLinesBaseRef}`);
            console.log(`Changed eligible lines: ${report.eligibility.changedEligibleLines}`);
            console.log(
                `Changed-line files skipped due to working tree changes: ${report.eligibility.skippedChangedLineFilesWithWorkingTreeChanges.length}`,
            );
        }

        if (fixOutput) {
            console.log(`Fixed hunks: ${report.fixedHunks}`);
            console.log(`Fixed files: ${report.fixedFileCount}`);
        }

        if (report.stableHunks.length === 0) {
            return;
        }

        const shownHunks = fixOutput
            ? report.fixedFiles.map((file) => ({
                  latestChanged: 'fixed',
                  path: file.path,
                  lines: `${file.hunks} hunks`,
              }))
            : report.stableHunks.slice(0, maxHunks);

        console.log('');
        for (const hunk of shownHunks) {
            console.log(`${hunk.latestChanged}  ${hunk.path}:${hunk.lines}`);
        }

        if (!fixOutput && report.stableHunks.length > shownHunks.length) {
            console.log('');
            console.log(`... ${report.stableHunks.length - shownHunks.length} more stable hunks hidden by --max-hunks=${maxHunks}`);
        }

        return;
    }

    const checked = [];
    const withoutGitHistory = [];

    for (const relativePath of formatFiles) {
        const lastChangedAt = await getLastGitChange(relativePath);

        if (!lastChangedAt) {
            withoutGitHistory.push(relativePath);
            continue;
        }

        checked.push({
            path: relativePath,
            lastChangedAt,
            oldEnough: lastChangedAt < cutoff,
        });
    }

    const intersection = checked
        .filter((entry) => entry.oldEnough)
        .sort((left, right) => left.lastChangedAt - right.lastChangedAt || left.path.localeCompare(right.path));

    const report = {
        months,
        cutoff: formatDate(cutoff),
        formattingErrorFiles: formatFiles.length,
        trackedFormattingErrorFiles: checked.length,
        filesWithoutGitHistory: withoutGitHistory.length,
        intersection: intersection.length,
        ratio: `${intersection.length}/${formatFiles.length}`,
        files: intersection.map((entry) => ({
            path: entry.path,
            lastChanged: formatDate(entry.lastChangedAt),
        })),
        withoutGitHistory,
    };

    if (fixOutput) {
        const filesToFix = report.files.map((entry) => entry.path);

        if (filesToFix.length > 0) {
            await formatFilesInPlace(filesToFix);
        }

        report.fixedFiles = filesToFix;
        report.fixedFileCount = filesToFix.length;
    }

    if (jsonOutput) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }

    console.log(`Biome formatting files older than ${months} months${fixOutput ? ' fixed' : ''}`);
    console.log(`Cutoff: ${report.cutoff}`);
    console.log(`Intersect/all: ${report.ratio}`);
    console.log(`Tracked formatting files: ${report.trackedFormattingErrorFiles}`);
    console.log(`Files without git history: ${report.filesWithoutGitHistory}`);

    if (fixOutput) {
        console.log(`Fixed files: ${report.fixedFileCount}`);
    }

    if (intersection.length === 0) {
        return;
    }

    console.log('');
    for (const entry of report.files) {
        console.log(`${entry.lastChanged}  ${entry.path}`);
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
