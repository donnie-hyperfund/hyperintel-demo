export const BLURB_TOOL_NAME = 'generate_blurb';

export const OUTPUT_CONTRACT = `# OUTPUT CONTRACT — READ FIRST

Your response for this turn MUST consist of exactly ONE terminal tool call:

\`${BLURB_TOOL_NAME}\`

Do NOT write summary text, recap text, preamble, commentary, markdown, or any normal assistant response.

The \`blurb\` parameter must contain the next-phase initialization prompt from the approved Completion Brief, copied as faithfully as possible. Prefer the code block under a section titled "NEXT-PHASE INITIALIZATION BLURB" when present. If that exact heading or format is missing, infer the intended next-phase seed prompt from the approved Completion Brief and pass only that prompt as \`blurb\` — no header, no fences, no commentary.

Calling \`${BLURB_TOOL_NAME}\` is a TERMINAL action — it ends this run.`;

export const TRANSITION_REQUEST_MESSAGE =
    'Extract the next-phase initialization prompt from the approved Completion Brief and call generate_blurb now. Do not write any normal assistant text.';
