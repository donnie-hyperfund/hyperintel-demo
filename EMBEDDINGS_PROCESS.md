# Embeddings and Chunking Process - Documentation

## Overview

The system uses **OpenRouter** for chunking documents and **OpenAI** for generating embeddings. Chunks can overlap and are stored with position information in the original document (start_line, end_line).

## Architecture

```
Document (ArtifactVersion)
    ↓
Chunking (OpenRouter) → Chunk[]
    ↓
Embeddings (OpenAI) → number[][]
    ↓
Database Storage (ArtifactEmbeddingEntity[])
```

## Components

### 1. Chunking (`workers/_common/utils/llm-chunker.ts`)

**Function:** `chunkContent()`

**Description:** Splits a document into semantic chunks using LLM via OpenRouter.

**Parameters:**
- `client: OpenRouter` - OpenRouter SDK client
- `content: string` - document content to split
- `model?: ChunkerModel` - chunking model (default: `google/gemini-2.0-flash-lite`)

**Returns:** `Promise<Chunk[]>`

**Chunk Type:**
```typescript
type Chunk = {
    content: string;        // Chunk content
    start_line: number;     // First line number in original document
    end_line: number;       // Last line number in original document
}
```

**Fallbacks:**
- Model 1: `google/gemini-2.0-flash-lite` (default)
- Model 2: `meta-llama/llama-3.1-8b-instruct`
- Model 3: `qwen/qwen-2.5-7b-instruct`
- Last resort: Simple fallback without LLM (splitting by headers/paragraphs)

**Example:**
```typescript
import { chunkContent } from '@worker/utils/llm-chunker';
import { OpenRouter } from '@openrouter/sdk';

const openrouterClient = new OpenRouter({ apiKey: '...' });
const chunks = await chunkContent(openrouterClient, documentContent);
// chunks = [{ content: "...", start_line: 0, end_line: 15 }, ...]
```

### 2. Embeddings (`workers/_common/vendor/openrouter-embeddings.ts`)

**Function:** `embedTexts()`

**Description:** Generates embedding vectors for texts using OpenAI.

**Parameters:**
- `client: OpenAI` - OpenAI client (from `@worker/vendor/openai`)
- `texts: string[]` - array of texts to embed
- `model?: EmbeddingModel` - embedding model (default: `text-embedding-3-small`)
- `dimensions?: number` - vector dimension (default: 1024)

**Returns:** `Promise<number[][]>` - array of embedding vectors

**Available Models:**
- `text-embedding-3-small` (default, cheapest)
- `text-embedding-3-large`
- `text-embedding-ada-002`

**Fallbacks:**
- Model 1: `text-embedding-3-small`
- Model 2: `text-embedding-ada-002`
- Model 3: `text-embedding-3-large`

**Example:**
```typescript
import { embedTexts } from '@worker/vendor/openrouter-embeddings';
import { createOpenAIClient } from '@worker/vendor/openai';

const openaiClient = await createOpenAIClient(env);
const embeddings = await embedTexts(openaiClient, ['text 1', 'text 2']);
// embeddings = [[0.123, -0.456, ...], [0.789, 0.012, ...]]
```

### 3. Indexing (`workers/chat/src/services/artifact-indexer.ts`)

#### 3.1. Indexing Single Artifact

**Function:** `indexArtifactVersion()`

**Description:** Indexes a single artifact version - removes old embeddings and creates new ones.

**Parameters:**
- `openaiClient: OpenAI` - OpenAI client for embeddings
- `openrouterClient: OpenRouter` - OpenRouter client for chunking
- `em: EntityManager` - MikroORM EntityManager
- `artifactVersion: ArtifactVersionEntity` - artifact version to index
- `projectId: string` - project ID

**Returns:** `Promise<{ indexed: number; deleted: number }>`

**Process:**
1. Deletes old embeddings for this version
2. Splits content into chunks (OpenRouter)
3. Generates embeddings for chunks (OpenAI)
4. Saves to database with line information

**Example:**
```typescript
import { indexArtifactVersion } from '@worker/services/artifact-indexer';
import { createOpenAIClient } from '@worker/vendor/openai';
import { createOpenRouterSdkClient } from '@worker/vendor/openrouter';

const openaiClient = await createOpenAIClient(env);
const openrouterClient = await createOpenRouterSdkClient(env);
const em = ctx.em; // from context

const result = await indexArtifactVersion(
    openaiClient,
    openrouterClient,
    em,
    artifactVersion,
    projectId
);
// result = { indexed: 5, deleted: 3 }
```

#### 3.2. Reindexing Entire Project

**Function:** `reindexProject()`

**Description:** Reindexes all artifacts in a project.

**Parameters:**
- `openaiClient: OpenAI`
- `openrouterClient: OpenRouter`
- `em: EntityManager`
- `projectId: string`

**Returns:** `Promise<{ total: number; artifacts: number }>`

**Process:**
1. Fetches all current artifact versions in the project
2. Deletes all project embeddings
3. For each artifact:
   - Splits into chunks
   - Generates embeddings
   - Saves to database

**Example:**
```typescript
import { reindexProject } from '@worker/services/artifact-indexer';

const result = await reindexProject(
    openaiClient,
    openrouterClient,
    em,
    projectId
);
// result = { total: 42, artifacts: 10 }
```

### 4. Search (`workers/chat/src/tools/knowledge-search.ts`)

**Function:** `searchKnowledge()`

**Description:** Searches for similar chunks using cosine similarity.

**Parameters:**
- `query: string` - search query
- `projectId: string` - project ID
- `client: OpenAI` - OpenAI client for query embedding
- `em: EntityManager` - EntityManager
- `limit: number` - maximum number of results
- `minSimilarity: number` - minimum similarity (0-1)

**Returns:** `Promise<SearchResult[]>`

**SearchResult Type:**
```typescript
type SearchResult = {
    chunk_content: string;
    chunk_index: number;
    artifact_id: string;
    title: string;
    key: string;
    similarity: number;  // 0-1, higher = more similar
}
```

**Process:**
1. Generates embedding for the query
2. Executes SQL query with cosine similarity (`<=>` operator)
3. Returns sorted results

**Example usage via tool:**
```typescript
// In agent context
const tools = createKnowledgeTools();
// tools[0].executor() automatically uses ctx.openai and ctx.em
```

## Complete Process - Step by Step

### Scenario 1: Indexing New Document

```typescript
// 1. You have a new ArtifactVersionEntity
const artifactVersion = await em.findOne(ArtifactVersionEntity, { id: '...' });

// 2. Prepare clients (from context or env)
const openaiClient = ctx.openai; // or await createOpenAIClient(env)
const openrouterClient = ctx.orouterSdk; // or await createOpenRouterSdkClient(env)
const em = ctx.em;

// 3. Call indexing
const result = await indexArtifactVersion(
    openaiClient,
    openrouterClient,
    em,
    artifactVersion,
    projectId
);

console.log(`Indexed ${result.indexed} chunks, deleted ${result.deleted} old ones`);
```

### Scenario 2: Reindexing Project (e.g., after model change)

```typescript
const result = await reindexProject(
    openaiClient,
    openrouterClient,
    em,
    projectId
);

console.log(`Indexed ${result.total} chunks from ${result.artifacts} artifacts`);
```

### Scenario 3: Searching Knowledge Base

```typescript
// In agent tool context
const tools = createKnowledgeTools();

// Agent will automatically call:
// tools[0].executor({ query: "how does machine learning work", limit: 5 }, ctx)
// where ctx has: { openai, em, projectId }
```

## Database Structure

### Table: `artifact_embeddings`

```sql
CREATE TABLE "artifact_embeddings" (
    "id" uuid PRIMARY KEY,
    "created_at" timestamptz(3),
    "artifact_version_id" uuid NOT NULL,
    "project_id" uuid NOT NULL,
    "chunk_index" int NOT NULL,
    "chunk_content" text NOT NULL,
    "start_line" int NOT NULL,      -- First line of chunk
    "end_line" int NOT NULL,        -- Last line of chunk
    "embedding" vector(1024) NOT NULL
);
```

**Indexes:**
- `artifact_embeddings_project_artifact_version_idx` - on (project_id, artifact_version_id)
- `artifact_embeddings_embedding_idx` - HNSW index for fast vector similarity search

## Where to Use Functions

### In Worker (Cloudflare Workers)

```typescript
// workers/chat/src/index.ts or similar file
import { indexArtifactVersion } from './services/artifact-indexer';
import { Ctx } from './context';

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const inferredCtx = await initInferredContext(env, {}, { withOrm: true });
        
        // You have access to:
        // - inferredCtx.openai (OpenAI client)
        // - inferredCtx.orouterSdk (OpenRouter client)
        // - inferredCtx.em (EntityManager)
        
        const result = await indexArtifactVersion(
            inferredCtx.openai,
            inferredCtx.orouterSdk,
            inferredCtx.em,
            artifactVersion,
            projectId
        );
    }
}
```

### In API Route (Next.js)

```typescript
// app/api/artifacts/[id]/index/route.ts
import { indexArtifactVersion } from '@/workers/chat/src/services/artifact-indexer';
import { getOrm } from '@/lib/orm';
import { openai } from '@/lib/vendor/openai';
import { orouterSdk } from '@/lib/vendor/openrouter';

export async function POST(request: Request, { params }: { params: { id: string } }) {
    const { em } = await getOrm();
    const artifactVersion = await em.findOne(ArtifactVersionEntity, { id: params.id });
    
    const result = await indexArtifactVersion(
        openai,
        orouterSdk,
        em,
        artifactVersion,
        artifactVersion.project.id
    );
    
    return Response.json(result);
}
```

### In Agent Tools

```typescript
// workers/chat/src/tools/knowledge-search.ts
// Already implemented - uses ctx.openai and ctx.em

// In chat-handler.ts add to toolGroups:
import { KnowledgeSearchToolGroup, createKnowledgeTools } from './tools/knowledge-search';

const knowledgeTools = createKnowledgeTools();

// In runAgentStream:
runAgentStream(
    agentCtx,
    ctx, // must have: openai, em, projectId
    {...},
    [...pmaPromptTools, ...knowledgeTools],
    {
        toolGroups: [PromptManagementToolGroup, KnowledgeSearchToolGroup],
    }
);
```

## Context Requirements

### For `indexArtifactVersion` / `reindexProject`:

```typescript
{
    openai: OpenAI,           // from createOpenAIClient(env)
    orouterSdk: OpenRouter,   // from createOpenRouterSdkClient(env)
    em: EntityManager         // from initInferredContext(env, {}, { withOrm: true })
}
```

### For `knowledgeTools`:

```typescript
{
    openai: OpenAI,           // from createOpenAIClient(env)
    em: EntityManager,       // from initInferredContext(env, {}, { withOrm: true })
    projectId: string        // project ID
}
```

## Example Flow - Creating and Indexing Document

```typescript
// 1. Create new artifact
const artifact = em.create(ArtifactEntity, {
    project: projectId,
    title: 'Market Analysis',
    key: 'market-analysis',
    // ...
});

const version = em.create(ArtifactVersionEntity, {
    artifact: artifact,
    content: '# Market Analysis\n\n...',
    version: 1,
});

artifact.currentVersion = version;
await em.persistAndFlush([artifact, version]);

// 2. Indexing (automatic after creation)
await indexArtifactVersion(
    ctx.openai,
    ctx.orouterSdk,
    ctx.em,
    version,
    projectId
);

// 3. Document is now available for search
// Agent can use search_knowledge tool
```

## Notes

1. **Chunks can overlap** - `start_line` and `end_line` allow for overlap
2. **Vector dimension** - default 1024, can be changed via `dimensions` parameter
3. **Fallbacks** - system automatically tries alternative models on errors
4. **Costs** - chunking via OpenRouter (cheap), embeddings via OpenAI
5. **HNSW Index** - database uses HNSW for fast similarity search