# Document Editing Loop Analysis

## The "Death Loop" Issue

The agent gets stuck in a repetitive loop of `read_document` -> `patch_document` -> `read_document` -> `patch_document` until it exhausts the 20 `maxToolCalls` limit. This is fundamentally a collision between the tool's strict requirements, the LLM's spatial reasoning limitations, and the penalty for a single mistake.

### 1. The "Exact Match" Patch Trap
The `patch_document` tool requires `startLine`, `endLine`, `newContent`, AND an exact string match for `oldContent`. 
If the agent hallucinates a single trailing whitespace, gets indentation wrong, or miscalculates the exact `oldContent` string in relation to `startLine` and `endLine`, the `applyEdits` function in `document-service.ts` throws a harsh rejection:

* `"oldContent not found in lines X-Y"`
* `"Multiple matches for oldContent... Edit is ambiguous."`

When Claude receives this error, its immediate impulse is to re-verify the text. It burns a tool call on `read_document`, inspects the exact lines, attempts `patch_document` again, and potentially fails again due to JSON encoding or whitespace mismatches. It then loops.

### 2. Cognitive Load on Batching
The `behavioralGuidance` in `tools.ts` explicitly demands: *"Batch ALL edits into a single patch_document call. NEVER re-read a document after patching..."*

While Claude 3.5 Sonnet is highly capable, planning 5 separate granular spatial edits (with perfect exact string matches and line number mappings) inside a single JSON tool call places extreme stress on its context window and structural prediction. It is far "safer" for the model to make one change, see if it worked, and iterate.

The rigid guidance demands complete batching, but the high friction of exact-string-matching strongly incentivizes the agent to go step-by-step to avoid cascading errors.

### 3. Too Aggressive Tool Limit
The `maxToolCalls` configuration in `runAgentStream` (`chat-handler.ts`) is currently set to `20`. For an advanced document editing agent that relies on conversational back-and-forth and interactive file patching, this is quite tight.

A single document editing sequence might look like:
1. `search_knowledge` (1)
2. `begin_document` (1)
3. `write_document` (1)
4. Tries to `patch_document` to fix a detail, fails exact match (1)
5. `read_document` to inspect (1)
6. `patch_document` succeeds (1)
7. `finalize_document` (1)

Just one or two complex iterations per turn can rapidly exhaust the 20-call budget, culminating in a sudden failure right as it is finishing the edits.

---

## Recommendations / Heuristics

### 1. Increase `maxToolCalls`
A simple heuristic fix is to increase `maxToolCalls` to `40-50` for tool groups that include heavy document manipulation. Modern LLMs (and Anthropic specifically) are well-equipped to handle deep tool-use paths, and the agent should not fail simply because it needed to double-check its line numbers.

### 2. Looser Patch Requirements (The `replace_lines` Approach)
Consider altering `patch_document` or introducing a `replace_lines` tool that only requires `startLine`, `endLine`, and `newContent`. 
By completely dropping the exact `oldContent` string match requirement, you drastically reduce the error surface. If the agent knows lines 45-50 need to vanish, instructing it to just overwrite them is vastly less error-prone than enforcing a character-perfect match of 6 lines of code within JSON payload strings.

### 3. Contextual Error Nudging
If an agent fails a document patch because of a whitespace or line-number mismatch, do not just return `"error: no match"`. Instead, dynamically append a slice of the actual text from the document at the targeted line numbers within the error payload. 
*Example:* `Error: oldContent mismatch. The actual text at lines 40-45 is: <text ...>`
This gives the agent the exact string it needs to correct its next call without forcing it to burn a completely separate roundtrip on `read_document`.
