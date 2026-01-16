# Chat Frontend Integration Guide

Guide for frontend developers implementing the chat UI with agent interactions.

---

## Architecture Overview

```
┌─────────────┐     SSE Stream      ┌─────────────┐
│   Backend   │ ─────────────────── │  Frontend   │
│ (chat-handler)                    │             │
└─────────────┘                     └─────────────┘
       │                                   │
       │  Persists StreamLog               │  Replays from StreamLog
       ▼                                   ▼
   ┌───────┐                          ┌───────┐
   │  DB   │ ◄─────────────────────── │ Fetch │
   └───────┘                          └───────┘
```

**Two render paths:**
1. **Live streaming** — consume SSE events as they arrive
2. **Replay** — reconstruct UI from persisted `StreamLog`

Both should produce identical UI.

---

## SSE Event Types

### Core Events

| Event | Description |
|-------|-------------|
| `delta` | Text content chunk |
| `reasoning_start` | Begin thinking block |
| `reasoning_delta` | Thinking content chunk |
| `reasoning_done` | End thinking block |
| `tool_start` | Tool execution begins |
| `tool_result` | Tool execution completes |
| `done` | Stream complete |
| `error` | Error occurred |

### Document Events

| Event | Description |
|-------|-------------|
| `document_start` | Document streaming begins (after validation passes) |
| `document_delta` | Document content chunk |
| `document_complete` | Document saved to DB |
| `document_edit` | Non-streaming edit completed |

---

## Document Events

### `document_start`
```typescript
{ type: 'document_start'; name: string; title: string; pendingVersion: number }
```
Emitted when document streaming begins. Open document panel, show "Generating...".

### `document_delta`
```typescript
{ type: 'document_delta'; name: string; pendingVersion: number; content: string }
```
Append content to document panel. Group by `(name, pendingVersion)`.

### `document_complete`
```typescript
{ 
  type: 'document_complete'; 
  name: string; 
  version: number; 
  lines: number; 
  action: 'created' | 'replaced' | 'committed' 
}
```
Document is now in DB. Show "✓ Saved" indicator.

---

## Document Directive

After document operations, backend injects a directive into message text:

```
::document[filename.md]{version=3 action=replaced lines=142}
```

**On replay**, parse this directive to reconstruct document references.

**Regex:**
```typescript
const DIRECTIVE_REGEX = /::document\[([^\]]+)\]\{([^}]+)\}/g;

function parseDocumentDirectives(text: string) {
  const docs = [];
  let match;
  while ((match = DIRECTIVE_REGEX.exec(text)) !== null) {
    const name = match[1];
    const attrs = Object.fromEntries(
      match[2].split(' ').map(p => {
        const [k, v] = p.split('=');
        return [k, isNaN(+v) ? v : +v];
      })
    );
    docs.push({ name, ...attrs });
  }
  return docs;
}
```

---

## StreamLog Structure

Persisted with each message:

```typescript
interface StreamLog {
  blocks: StreamBlock[];       // Ordered list of content blocks
  toolCalls: ToolCallRecord[]; // Metadata for all tool calls
  fullContent: string;         // Joined text (includes directives)
}

interface StreamBlock {
  id: string;
  type: 'text' | 'reasoning' | 'tool_call' | 'citation';
  content?: string;
  metadata?: Record<string, any>;
}
```

---

## UI Layout Recommendation

```
┌─────────────────────────────────────┐
│ [▶ Thinking + Actions]              │  ← Collapsible
│ 💭 "Checking if document exists..." │
│ 🔧 write_document("analysis.md")    │
│ 💭 "Structuring the sections..."    │
└─────────────────────────────────────┘

Here's the market analysis you requested...   ← Main response

[📄 analysis.md v3]                           ← Document card (from directive)
```

### Rendering Logic

```tsx
const reasoningAndTools = blocks.filter(
  b => b.type === 'reasoning' || b.type === 'tool_call'
);
const textBlocks = blocks.filter(b => b.type === 'text');
const text = textBlocks.map(b => b.content).join('\n');
const documents = parseDocumentDirectives(text);

return (
  <>
    {reasoningAndTools.length > 0 && (
      <CollapsibleSection title="Thinking + Actions">
        {reasoningAndTools.map(block => (
          block.type === 'reasoning' 
            ? <ReasoningBubble content={block.content} />
            : <ToolCallBadge tool={block.metadata.tool} />
        ))}
      </CollapsibleSection>
    )}
    
    <MessageBody content={text} />
    
    {documents.map(doc => (
      <DocumentCard 
        name={doc.name} 
        version={doc.version}
        onClick={() => openDocumentPanel(doc.name)}
      />
    ))}
  </>
);
```

---

## Document Panel

### During Streaming

1. `document_start` → Open panel, show title + "Generating..."
2. `document_delta` → Append content (use `pendingVersion` to group)
3. `document_complete` → Show "✓ v{version} saved"

### On Replay

1. Parse `::document[name]{...}` from `fullContent`
2. Fetch document content from API: `GET /api/documents/{projectId}/{name}`
3. Display in panel

---

## Key Points

1. **Directive is source of truth for replay** — document events are live-only
2. **`pendingVersion` groups deltas** — handles parallel document operations
3. **`document_complete` means "in DB"** — safe to show saved indicator
4. **Reasoning + tools are interleaved** — preserve temporal order in UI
5. **Text is separate** — render main response below thinking section
