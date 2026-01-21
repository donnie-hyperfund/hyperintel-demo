import { type NextRequest } from 'next/server';
import { processMarkdownWithDirectives } from '@/lib/markdown/directives';

function chunkString(str: string, chunkSize = 100): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < str.length; i += chunkSize) {
        chunks.push(str.slice(i, i + chunkSize));
    }
    return chunks;
}

async function handleStreamArtifact(req: NextRequest) {
    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();

            const sendChunk = (data: string) => {
                controller.enqueue(encoder.encode(data));
            };

            try {
                const textChunks = [
                    'Welcome! ',
                    'This is ',
                    'a comprehensive ',
                    'demonstration ',
                    'of a streaming ',
                    'text response ',
                    'system. ',
                    'The system ',
                    'is designed ',
                    'to simulate ',
                    'real-time ',
                    'AI responses ',
                    'that are ',
                    'delivered ',
                    'incrementally, ',
                    'chunk by chunk, ',
                    'to provide ',
                    'a smooth ',
                    'user experience. ',
                    'As you can see, ',
                    'the text appears ',
                    'gradually, ',
                    'creating a sense ',
                    'of natural ',
                    'conversation flow.\n\n',
                    'The streaming ',
                    'mechanism allows ',
                    'users to start ',
                    'reading the response ',
                    'immediately, ',
                    'rather than waiting ',
                    'for the entire ',
                    'content to be ',
                    'generated. ',
                    'This is particularly ',
                    'important for ',
                    'long-form content ',
                    'or when dealing ',
                    'with complex ',
                    'computations that ',
                    'take time to complete.\n\n',
                    'In addition to ',
                    'streaming text, ',
                    'this system also ',
                    'supports the generation ',
                    'of rich artifacts. ',
                    'These artifacts can ',
                    'contain not just ',
                    'plain text, but also ',
                    'structured content, ',
                    'interactive elements, ',
                    'and custom components ',
                    'that enhance the ',
                    'overall presentation.\n\n',
                    'Now, let me prepare ',
                    'a comprehensive artifact ',
                    'that demonstrates ',
                    'various features and ',
                    'capabilities. ',
                    'This artifact will ',
                    'include multiple ',
                    'sections, examples, ',
                    'and different types ',
                    'of content to showcase ',
                    'the full potential ',
                    'of the system...\n\n',
                ];

                for (const chunk of textChunks) {
                    sendChunk(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`);
                    await new Promise((resolve) => setTimeout(resolve, 80));
                }

                await new Promise((resolve) => setTimeout(resolve, 800));

                const artifactMarkdown = `# Comprehensive Artifact with Markdown Directives

This is a detailed example artifact that demonstrates the full capabilities of the markdown directive processing system. The artifact contains multiple sections, various types of content, and showcases different directive types that can be used to create rich, interactive documents.

## Introduction

Artifacts are structured documents that can be generated dynamically and contain a wide variety of content types. They support standard markdown syntax as well as custom directives that extend the functionality beyond what traditional markdown can offer.

The system processes these directives using a callback-based architecture, allowing for flexible and extensible content generation. Each directive type can have its own custom handler that determines how the content should be rendered.

## Video Content

One of the most powerful features is the ability to embed video content directly into artifacts. This is done using the YouTube directive:

::youtube[Introduction to Advanced AI Systems]{v=dQw4w9WgXcQ}

This allows for seamless integration of multimedia content without breaking the document flow. The directive system handles the conversion from markdown syntax to proper HTML embedding.

## Notifications and Alerts

The system supports various types of notifications and alerts to draw attention to important information:

::note[This is an informational note that provides additional context]{type=info}

::note[This is a warning message that alerts users to potential issues]{type=warning}

::note[This is an error notification that indicates something went wrong]{type=error}

::note[This is a success message confirming that an operation completed successfully]{type=success}

Each note type can be styled differently to match the severity and importance of the message.

## Callouts and Highlights

Callouts are useful for highlighting specific sections or providing additional information:

::callout[Important Information]{title=Key Points}
This callout contains critical information that users should pay special attention to. Callouts can contain multiple paragraphs and support full markdown formatting within their content.

You can include:
- Bullet points
- **Bold text**
- *Italic text*
- And even [links](https://example.com)
:::

::callout[Technical Details]{title=Implementation Notes}
For developers working with this system, here are some important technical details:

1. Directives are processed server-side using remark-directive
2. Each directive type has a corresponding callback handler
3. The system uses AST (Abstract Syntax Tree) traversal to process directives
4. Custom handlers can be easily added by extending the directiveHandlers map
:::

## Code Examples

The artifact system also supports code blocks and technical documentation:

\`\`\`typescript
// Example of directive processing
function processDirective(directive: Directive) {
    const handler = directiveHandlers[directive.name];
    if (handler) {
        return handler(directive);
    }
    return null;
}
\`\`\`

## Additional Content Sections

### Section 1: Overview

This section provides a high-level overview of the system architecture and design principles. The system is built with extensibility in mind, allowing developers to easily add new directive types and customize the rendering behavior.

### Section 2: Use Cases

Common use cases for this system include:
- Documentation generation
- Interactive tutorials
- Rich content creation
- Educational materials
- Technical documentation

### Section 3: Advanced Features

The system supports advanced features such as:
- Nested directives
- Custom attribute parsing
- Dynamic content generation
- Server-side rendering
- Client-side hydration

## Multiple Video Examples

Here are additional video examples to demonstrate the flexibility:

::youtube[Advanced Markdown Processing Techniques]{v=example123}

::youtube[Building Custom Directives]{v=example456}

## Conclusion

This comprehensive artifact demonstrates the full range of capabilities available in the directive processing system. By combining standard markdown with custom directives, we can create rich, interactive documents that go far beyond traditional text-based content.

The callback-based architecture ensures that the system remains flexible and extensible, allowing for easy addition of new directive types and custom rendering logic. This makes it an ideal solution for applications that need to generate dynamic, structured content with rich formatting and interactive elements.

## Final Notes

::note[Remember to test all directive types thoroughly before deploying to production]{type=warning}

::callout[Best Practices]{title=Recommendations}
When working with directives:
- Always validate directive attributes
- Provide fallback content for unsupported directives
- Test rendering across different browsers
- Consider accessibility when designing custom directives
:::

End of comprehensive artifact demonstration.`;

                const processedArtifact = processMarkdownWithDirectives(artifactMarkdown);
                const artifactChunks = chunkString(processedArtifact, 200);

                const artifactId = `artifact-${Date.now()}`;
                sendChunk(
                    `data: ${JSON.stringify({
                        type: 'artifact_start',
                        artifactId,
                        identifier: 'demo-artifact',
                        title: 'Comprehensive Artifact Demo',
                        artifactType: 'text/markdown',
                    })}\n\n`,
                );

                for (const chunk of artifactChunks) {
                    sendChunk(`data: ${JSON.stringify({ type: 'artifact_chunk', artifactId, content: chunk })}\n\n`);
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }

                sendChunk(`data: ${JSON.stringify({ type: 'artifact_end', artifactId })}\n\n`);
                sendChunk('data: [DONE]\n\n');
                controller.close();
            } catch (error) {
                console.error('Error in stream:', error);
                sendChunk(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`);
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        },
    });
}

export const GET = async (req: NextRequest) => {
    try {
        return await handleStreamArtifact(req);
    } catch (error) {
        console.error('Error in stream-artifact API:', error);
        return new Response(JSON.stringify({ error: 'Failed to process stream' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
