# HyperIntel - Technical Context

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Chat Pane  │  │  Artifacts  │  │  Phase/Project Sidebar  │  │
│  │  (Messages) │  │  (Split)    │  │                         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Cloudflare Workers                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   Chat Worker (Hono)                     │    │
│  │  ┌──────────────┐  ┌────────────┐  ┌─────────────────┐  │    │
│  │  │ Master Agent │  │ Tool Exec  │  │ Prompt Loader   │  │    │
│  │  │  (Prompt)    │  │            │  │ (Langfuse API)  │  │    │
│  │  └──────────────┘  └────────────┘  └─────────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │  Neon    │   │ Langfuse │   │ AI APIs  │
        │PostgreSQL│   │ Prompts  │   │ (LLMs)   │
        │+pgvector │   │          │   │          │
        └──────────┘   └──────────┘   └──────────┘
```

## Data Model

```
User (from Clerk webhook)
  └── Project
        ├── name, description, current_phase
        └── Chat[] (one per phase)
              ├── phase, summary
              ├── ChatMessage[]
              └── Artifact[] (metadata only, key unique per project)
                    └── ArtifactVersion[] (immutable content snapshots)
```

## Agent Architecture

### Artifact Generation: Markdown Directives (Streaming)

Artifacts are created/updated via **streaming markdown directives**, not tools:

```markdown
:::artifact{key="team_composition" title="Team Composition"}
# Strategic Team

## Core Members
- Alice Chen (Lead Strategist)
- Bob Martinez (Technical Architect)
:::
```

**Why directives over tools:**
- Native streaming — no JSON escaping overhead
- Content appears character-by-character in artifact panel
- Robust to partial streams (valid markdown even if interrupted)
- Same UX as Claude's artifacts

**Parser behavior:**
- Detects `:::artifact{...}` → switches to artifact capture mode
- On closing `:::` → commits content to DB as new version
- `key` identifies which artifact (required, unique per project)

### Tools (Control Operations Only)

```typescript
tools: [
  // Artifact meta (not content creation)
  "list_artifacts",    // Show project's artifacts with keys
  "view_artifact",     // Get current content of an artifact

  // Prompt loading
  "load_prompt",             // Fetch specialist prompts from Langfuse
  "list_available_prompts",  // Show available prompt templates

  // Document viewport (existing)
  "view_document",
  "search_document",
  "document_info",
]
```

Additional tools mentioned in prompt but not loaded by default:
- `delete_artifact`, `view_artifact_versions`, etc.
- *Future idea:* `request_tool` meta-tool for dynamic loading

### Future: Sub-agent Orchestration

```
Master Agent
  ├── spawns → Specialist Agent (loaded prompt)
  ├── spawns → QA Agent (validation prompt)
  └── coordinates → Artifact updates
```

## Existing Infrastructure

### Document Viewport (`common/ai/tools/document-viewport.ts`)
- `DocumentViewportManager` class
- Range-based viewing with merge logic
- Search (text + regex)
- Max 2000 lines safety limit
- Tools: `view_document`, `search_document`, `remove_document_range`, `clear_document_view`, `document_info`

### Agent Runner (`common/ai/agent/runner.ts`)
- ~34KB of agent loop logic
- Tool execution infrastructure
- Streaming support

### Tool Groups (`common/ai/agent/tool-groups.ts`)
- Dynamic grouping by slug or explicit list
- Prompt formatting for tool documentation
- Used to inject tool guidance into system prompts

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Vector Store | pgvector | Same DB as data, full SQL, no extra billing |
| Prompt Storage | Langfuse | Versioning, hot-reload, non-dev editable |
| Artifact Format | Markdown | Readable, editable, diffable |
| Artifact Versioning | Full history | Required by stakeholder |
| Context Strategy | Summaries | MVP uses per-chat summaries, not full RAG |

## Security: Prompt Leakage Prevention

**CRITICAL**: No system prompts may appear in user-facing content.

Strategies:
1. Artifacts generated via streaming directives, parsed separately from chat
2. Prompt content never injected into artifact templates
3. Separate "agent thinking" from "user-visible output"
4. QA validation step checks for prompt fragments

## Open Technical Questions

- [ ] Artifact diffing strategy (operational transforms? git-style patches?)
- [ ] Artifact syntax: Currently using `:::artifact{...}` markdown directives for streaming. Tradeoffs vs tools:
  - **Directives**: Native streaming, no JSON escaping, robust to partial streams, better UX
  - **Tools**: Easier to validate schema, explicit boundaries, but streaming JSON strings is awkward
- [ ] Phase transition API design
- [ ] Conversation summary generation (when? how detailed?)
- [ ] Langfuse prompt versioning strategy (latest? pinned?)

## Inference & Worker Patterns (from action-item)

Observed patterns from `hyperfund/workers/action-item`:

### Router Classification
User messages classified → different downstream handling:
- `EXPLAIN` - Forward to specialized model for detailed help
- `RESPOND` - Simple acknowledgment (no AI forwarding)
- `USER_RESPONSE_VALID` / `PARTIAL` - Extract and save answer
- `SKIP` - User wants to skip the question
- `INVALID` - Re-prompt with guidance

### Fallback Chains
```typescript
const fallbacks = [
  { provider: { only: ['groq', 'baseten', 'novita', 'cerebras'], sort: 'throughput' } },
  {}, // Default
  { provider: {}, model: 'google/gemini-2.5-flash' },
];
```

### Tool Pattern: Dynamic Rule Loading
```typescript
{ name: 'load_rules', executor: async (input) => { /* add rules to context */ } }
{ name: 'unload_rules', executor: async (input) => { /* remove from context */ } }
```

### Safety Guardrails (cerberus)
Fast safety check before main processing - separate lightweight model call.

### Structured Outputs
Zod schemas with `zodResponseFormat` for type-safe LLM responses.

### Prompt-Driven Adaptation
For HyperIntel, these patterns live in **prompts** not code:
- Routing table → in master prompt
- Phase transitions → prompt instructions
- Validation rules → prompt definitions
- Code provides execution layer only
