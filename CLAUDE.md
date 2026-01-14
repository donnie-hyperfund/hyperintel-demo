# HyperIntel Demo - AI Assistant Context

> Master documentation file for AI assistants working on this project.

## Quick Links

- [Business Context](./CLAUDE_BUSINESS.md) - Product vision, phases, marketing
- [Technical Context](./CLAUDE_TECHNICAL.md) - Implementation details, architecture

## Project Overview

**HyperIntel** is an AI-powered strategic intelligence platform that creates specialized "Superhuman" teams to tackle business challenges. Think Anthropic Claude with artifacts, but with multi-phase workflows, prompt-controlled agent personas, and rigorous QA validation.

## Key Constraints

1. **Prompt-Driven Architecture**: The system designer controls behavior through `.md` prompt files - minimize hardcoded algorithmic logic
2. **No Prompt Leakage**: System prompts, agent instructions, and internal knowledge MUST NEVER appear in user-facing artifacts or responses
3. **Langfuse Integration**: All prompts managed via Langfuse Prompt Management (versioned, fetchable at runtime)
4. **Multi-Phase Required**: MVP must support multiple phases (exact phase definitions TBD)

## Codebase Structure

```
hyperintel-demo/
├── app/                    # Next.js frontend
├── common/                 # Shared submodule (cross-project)
│   └── ai/
│       ├── agent/          # Agent runner, tool groups
│       ├── inference/      # OpenAI, Anthropic, OpenRouter
│       └── tools/          # Document viewport, etc.
├── lib/                    # App-specific utilities
│   ├── orm/entities/       # MikroORM entities
│   └── schema/             # Zod schemas
├── workers/                # Cloudflare Workers
│   └── chat/               # Main chat worker (scaffold)
└── migrations/             # Database migrations
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js, React |
| Backend | Cloudflare Workers, Hono |
| Database | Neon PostgreSQL + pgvector |
| ORM | MikroORM |
| AI Providers | OpenAI, Anthropic, OpenRouter |
| Prompts | Langfuse Prompt Management |
| Auth | Clerk (via BetterAuth wrapper) |

## Current Status

- [x] Document viewport tooling ready
- [x] Agent runner infrastructure exists
- [x] AI inference layer (multi-provider)
- [x] Project/Chat/Artifact entities
- [ ] Multi-phase conversation handling
- [ ] Langfuse prompt loading tools
- [ ] Semantic search / RAG

## Coding Preferences & Style

> User hates unnecessary boilerplate. Prefers intelligent, type-safe wrappers.

### Do
- **Type-safe helpers**: Infer types, reduce explicit annotations
- **Smart defaults**: Make common cases require no config
- **Lean business logic**: Heavy lifting in reusable utilities
- **Pragmatism**: If it works and is maintainable, it's fine

### Don't
- **Big-tech patterns for small teams**: No patterns designed for 100+ devs
- **Ceremony without value**: Skip rigid patterns that add no clarity
- **Repetitive code**: Abstract if you're writing similar code twice
- **Over-engineering**: YAGNI applies

## Working Agreements

- Update these CLAUDE files as understanding evolves
- Versioned artifacts (not just current state)
- LibreChat-style split-pane UI (artifacts panel)
- Conversation summaries as primary context method (MVP)
