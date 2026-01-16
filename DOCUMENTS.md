# Document System Design

## Overview

Documents are persistent markdown files that live in a project's **Project Knowledge**. They are created and edited by AI agents during conversations, with real-time streaming to the frontend.

**Key Requirements:**
1. Stream document content in real-time during generation
2. Support both one-shot and multi-step (interruptible) writing
3. Upsert semantics — create or replace, model doesn't need to pre-check
4. Precision editing for surgical changes
5. Viewport-based reading for long documents (context efficiency)
6. Draft mode with full read/edit support before commit

---

## Terminology

We use **"document"** (not "artifact") to align with existing PMA framework terminology:
- "Master Instruction Document"
- "Source Documents"
- "Project Knowledge... Documents loaded"

Documents are referenced by **name** (like filenames), not UUID:
- `market-analysis.md`
- `project-dna.md`
- `action-plan.md`

Names auto-append `.md` if not provided.

---

## Architecture: Layered Approach

### Layer 1: Agent Runner (Generic)
- Emits raw `tool_call_delta` events containing JSON fragments
- Supports `appendedOutput` for injecting directives into message content
- No document-specific logic

### Layer 2: Application Layer (Document Abstraction)
- Intercepts `tool_call_delta` and extracts streamable fields using `StreamingFieldParser`
- Emits document-specific events (`document_delta`, etc.) to frontend
- Manages draft sessions in memory
- Handles persistence, versioning, and directive injection

---

## Tool Set

### One-Shot Writing (Streaming)

#### `write_document(name, title, content)`

Create or replace document in a single streaming call.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Document name, e.g. `"market-analysis.md"` |
| `title` | string | Display title, e.g. `"Market Analysis"` |
| `content` | string | Full document content (streams) |

**Response:**
```json
{
  "action": "created",  // or "replaced"
  "name": "market-analysis.md",
  "version": 1,
  "lines": 142
}
```

If replacing:
```json
{
  "action": "replaced",
  "name": "market-analysis.md",
  "version": 3,
  "lines": 156,
  "previousVersion": 2,
  "previousVersionLines": 142
}
```

**Safety:** Content is not committed until stream completes. Crash mid-stream = no change.

---

### Multi-Step Writing (Streaming, Interruptible)

For complex documents where the model wants to pause, reason, and resume.

#### `begin_document(name, title)`

Start a draft session.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Document name |
| `title` | string | Display title |

**Response (new document):**
```json
{
  "action": "creating",
  "name": "market-analysis.md",
  "mode": "draft",
  "draftLines": 0
}
```

**Response (existing document):**
```json
{
  "action": "replacing",
  "name": "market-analysis.md",
  "mode": "draft",
  "draftLines": 142,
  "previousVersion": 2
}
```

**Important:** When replacing an existing document, the draft buffer is pre-loaded with the current content. The model can then read/edit the existing content before committing.

---

#### `continue_document(name, content)`

Append content to the active draft. Streams to frontend.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Document name (must have active draft) |
| `content` | string | Content to append (streams) |

**Response:**
```json
{
  "mode": "draft",
  "name": "market-analysis.md",
  "appendedLines": 25,
  "draftLines": 167
}
```

---

#### `finish_document(name)`

Commit the draft as a new version. Ends draft session.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Document name |

**Response:**
```json
{
  "action": "committed",
  "name": "market-analysis.md",
  "version": 3,
  "lines": 167
}
```

---

### Reading (Viewport Support)

#### `read_document(name, viewport?)`

Read document content with line numbers. Supports viewport for long documents.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Document name |
| `viewport.startLine` | number? | First line to return (1-indexed) |
| `viewport.endLine` | number? | Last line to return (inclusive) |

**Draft-Aware:** If a draft session is active for this document, returns draft content. Otherwise returns committed version.

**Response:**
```json
{
  "mode": "draft",  // or "committed"
  "name": "market-analysis.md",
  "version": 2,     // only if mode=committed
  "totalLines": 142,
  "viewport": { "startLine": 20, "endLine": 50 },
  "content": "20: ## Market Opportunity\n21: \n22: The addressable market..."
}
```

**Error (document not found):**
```json
{
  "error": "Document 'market-analysis.md' not found. Use write_document or begin_document to create it."
}
```

---

### Precision Editing

#### `edit_document(name, edits[])`

Make precise line-range edits with exact match validation.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Document name |
| `edits` | array | List of edit operations |

Each edit:
```typescript
{
  startLine: number;    // Start of search range (1-indexed)
  endLine: number;      // End of search range (inclusive)
  oldContent: string;   // Exact content to find
  newContent: string;   // Replacement content
}
```

**Draft-Aware:** If a draft session is active, edits the draft buffer. Otherwise edits the committed version (creates new version on commit).

**Response:**
```json
{
  "mode": "draft",  // or "committed"
  "name": "market-analysis.md",
  "editsApplied": 2,
  "linesNow": 148
}
```

**Validation:**
- `oldContent` must match exactly within the specified line range
- If not found → error (content has drifted)
- If multiple matches within range → error (ambiguous)
- All edits validated before any applied (atomic)

**Error (document not found):**
```json
{
  "error": "Document 'market-analysis.md' not found. Use write_document or begin_document to create it."
}
```

---

### Discovery

#### `list_documents(filter?)`

Browse available documents.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filter.search` | string? | Filter by name/title substring |

**Response:**
```json
{
  "documents": [
    { "name": "project-dna.md", "title": "Project DNA", "lines": 234, "version": 5 },
    { "name": "action-plan.md", "title": "Action Plan", "lines": 89, "version": 2 }
  ]
}
```

---

#### `search_documents(query)`

Semantic search across all documents. Returns relevant chunks.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Natural language search query |

**Response:**
```json
{
  "results": [
    {
      "name": "market-analysis.md",
      "title": "Market Analysis",
      "score": 0.89,
      "snippet": "...the pricing strategy focuses on...",
      "lineRange": { "start": 45, "end": 52 }
    }
  ]
}
```

---

## Draft Mode Behavior

### When Draft is Active

| Tool | Behavior |
|------|----------|
| `read_document` | Returns draft buffer content |
| `edit_document` | Edits draft buffer |
| `continue_document` | Appends to draft buffer |
| `finish_document` | Commits draft as new version |

### When No Draft Active

| Tool | Behavior |
|------|----------|
| `read_document` | Returns committed version |
| `edit_document` | Edits committed version (creates new version) |
| `continue_document` | Error: no active draft |
| `finish_document` | Error: no active draft |

### Response Mode Indicator

Every response includes `mode: 'draft' | 'committed'` so the model always knows what it's operating on.

---

## Upsert Semantics

The model does **not** need to check if a document exists before writing:

| Tool | Document Exists? | Result |
|------|-----------------|--------|
| `write_document` | No | Creates new (v1) |
| `write_document` | Yes | Replaces (v+1) |
| `begin_document` | No | Creates empty draft |
| `begin_document` | Yes | Creates draft with current content |

Response always indicates `action: 'created' | 'replaced' | 'creating' | 'replacing'`.

---

## Error Handling

### Read/Edit Non-Existent Document

`read_document` and `edit_document` return an error if document doesn't exist:

```json
{
  "error": "Document 'market-analysis.md' not found. Use write_document or begin_document to create it."
}
```

### Edit Validation Failure

```json
{
  "error": "Edit failed: oldContent not found in lines 25-30. Content may have changed."
}
```

### No Active Draft

```json
{
  "error": "No active draft for 'market-analysis.md'. Use begin_document first."
}
```

---

## Directive Persistence

Documents referenced in chat are persisted via directives in message content:

**Format:** `::document[document-name.md]{version=X action=Y lines=Z}`

**Injection:** The tool executor returns `appendedOutput` (just the directive, no whitespace):
```typescript
appendedOutput: `::document[${name}]{version=${v} action=${action} lines=${lines}}`
```

The agent runner handles **context-aware whitespace**:
- If there's existing content → adds `\n\n` **before** the directive
- If no existing content → adds `\n\n` **after** the directive

This ensures proper separation without leading blank lines when the directive comes first.

**Frontend:** Parses directives on render, shows interactive document button/card.

---

## Database Entities

### DocumentEntity (currently ArtifactEntity)

```typescript
@Entity({ tableName: 'artifacts' })
@Unique({ properties: ['project', 'name'] })
export class ArtifactEntity {
    @PrimaryKey()
    id!: string;  // UUID

    @Property({ type: 'text' })
    name!: string;  // "market-analysis.md" - unique per project, .md auto-appended

    @Property({ type: 'text' })
    title!: string;  // "Market Analysis" - display name

    @Property({ type: 'int', default: 1 })
    version!: number;

    @Property({ type: 'int' })
    lineCount!: number;  // NEW: for efficient metadata queries

    @ManyToOne(() => 'ProjectEntity')
    project!: ProjectEntity;

    @ManyToOne(() => 'ChatEntity')
    chat!: ChatEntity;  // Chat that created this document

    @OneToOne(() => 'ArtifactVersionEntity', { nullable: true, eager: true })
    currentVersion!: ArtifactVersionEntity;  // Nullable to handle circular FK on insert

    @OneToMany(() => 'ArtifactVersionEntity', v => v.artifact)
    versions = new Collection<ArtifactVersionEntity>(this);

    @Property({ type: 'json', nullable: true })
    metadata?: Record<string, unknown>;
}
```

**Note:** `currentVersion` is nullable at the database level to break the circular FK dependency during insert. The two-phase insert (artifact first, then version, then link) is wrapped in `em.transactional()` for atomicity.

### DocumentVersionEntity (currently ArtifactVersionEntity)

```typescript
@Entity({ tableName: 'artifact_versions' })
export class ArtifactVersionEntity {
    @PrimaryKey()
    id!: string;  // UUID

    @ManyToOne(() => 'ArtifactEntity')
    artifact!: ArtifactEntity;

    @Property({ type: 'int' })
    version!: number;

    @Property({ type: 'text' })
    content!: string;

    @Property({ type: 'int' })
    lineCount!: number;  // NEW

    @Property({ nullable: true })
    createdByMessageId?: string;  // NEW: traceability

    @Property()
    createdAt!: Date;
}
```

---

## Streaming Implementation

### One-Shot (`write_document`)

1. Tool is marked with `streamableFields: ['content']`
2. Agent runner emits `tool_call_delta` events as JSON fragments arrive
3. Application layer uses `StreamingFieldParser` to extract `content` incrementally
4. Frontend receives `document_delta` events, renders in real-time
5. On successful completion: persist to DB, update `currentVersion`, inject `::document[name]` directive
6. On failure: discard, no changes committed

### Multi-Step (`begin/continue/finish`)

1. `begin_document`:
   - If new: create empty buffer
   - If existing: copy current content into buffer
   - Store buffer in memory map keyed by `(projectId, documentName)`
   
2. `continue_document`:
   - Content field streams via `tool_call_delta`
   - Parser extracts content, appends to buffer
   - Frontend receives deltas
   
3. `read_document` / `edit_document`:
   - Check if draft exists for this document
   - If yes: operate on buffer
   - If no: operate on committed version

4. `finish_document`:
   - Create new `ArtifactVersionEntity` with buffer content
   - Update `artifact.currentVersion` pointer
   - Update `artifact.version` counter
   - Clear buffer from memory
   - Inject directive

**New Artifact Creation:** Uses two-phase insert wrapped in `em.transactional()`:
1. Insert artifact with `current_version_id = NULL`
2. Insert version with `artifact_id` pointing to artifact
3. Update artifact to set `current_version_id`

This handles the circular FK dependency while maintaining atomicity (rollback on failure).

---

## Tool Descriptions (for Model)

### write_document
> Create or replace a document in the project knowledge base. Content streams in real-time.
> If the document exists, it will be replaced with a new version.
> Document names should end with `.md` (auto-appended if missing).

### begin_document
> Start a draft session for creating or replacing a document.
> If the document already exists, the draft will contain the current content, allowing you to edit it before committing.
> Use `continue_document` to append content, `read_document`/`edit_document` to view/modify the draft, and `finish_document` to commit.

### continue_document
> Append content to an active draft session. Content streams in real-time.
> Requires an active draft started with `begin_document`.

### finish_document
> Commit the current draft as a new version and end the draft session.
> The document becomes the new committed version.

### read_document
> View document content with optional line range (viewport).
> If you have an active draft session for this document, returns the draft content.
> Otherwise returns the committed version.
> Response includes `mode: 'draft' | 'committed'` to indicate which you're viewing.

### edit_document
> Make precise edits to a document using line ranges and exact content matching.
> If you have an active draft session for this document, edits the draft.
> Otherwise edits the committed version (creates a new version).
> Response includes `mode: 'draft' | 'committed'` to indicate which you edited.

---

## Implementation Checklist

### Phase 1: Core Infrastructure
- [x] Add `lineCount` field to `ArtifactVersionEntity`
- [x] Add `name` field to `ArtifactEntity` (uses `key` field)
- [x] Implement name normalization (auto-append `.md`)
- [x] Implement in-memory draft buffer manager (`draft-manager.ts`)
- [x] Wire `appendedOutput` support in tool execution

### Phase 2: Tool Implementation
- [x] `write_document` — one-shot streaming with atomic commit
- [x] `begin_document` — create draft (empty or with current content)
- [x] `continue_document` — append to draft
- [x] `finish_document` — commit draft
- [x] `read_document` — draft-aware with viewport
- [x] `edit_document` — draft-aware with validation (validation not yet implemented)
- [x] `list_documents` — browse with optional filter

### Phase 3: Discovery
- [ ] `search_documents` — semantic search (requires chunking/embedding)

### Phase 4: Frontend Events (Backend Extraction)
- [x] `document_start` — emit when streaming tool begins
- [x] `document_delta` — emit extracted content from `tool_call_delta`
- [x] `document_complete` — emit on tool success
- [x] `document_edit` — emit on edit success
- [x] Use `StreamingFieldParser` in chat-handler for content extraction
- [x] Lazy parser setup for `continue_document`

### Phase 5: Frontend
- [ ] Directive parsing (`::document[name.md]{...}`)
- [ ] Document panel/viewer
- [ ] Real-time streaming display
- [ ] Version history UI

---

## Design Principles

1. **Upsert by default** — Model doesn't need to pre-check existence
2. **Informative responses** — Every response indicates action and mode
3. **Stream everything substantial** — One-shot and multi-step both stream
4. **Context efficiency** — Viewports for reading, concise edits for modification
5. **Draft-aware** — `read_document` and `edit_document` work on drafts when active
6. **Safety** — Atomic commits, strict match validation on edits
7. **File-like naming** — Documents have `.md` names, familiar UX
