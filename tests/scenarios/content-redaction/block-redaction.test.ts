/**
 * Tests that ChatMessageEntity.redactBlocks strips artifact content
 * from write_document / edit_document tool call blocks.
 *
 * Block redaction is UNCONDITIONAL — it applies regardless of is_internal.
 * This is a secondary defense layer; the primary visibility mechanism
 * is ArtifactVersionEntity.toJSON() which conditionally exposes content.
 */

import { MikroORM } from "@mikro-orm/core";
import { defineConfig } from "@mikro-orm/postgresql";
import type { ToolCallStreamBlock, TextStreamBlock, StreamBlock } from "@/common/ai/agent/types";
import { ArtifactVersionEntity } from "@/lib/orm/entities/artifacts/artifact-version.entity";
import { ArtifactEntity } from "@/lib/orm/entities/artifacts/artifact.entity";
import { ChatMessageEntity } from "@/lib/orm/entities/chats/chat-message.entity";
import { ChatEntity } from "@/lib/orm/entities/chats/chat.entity";
import { ProjectEntity } from "@/lib/orm/entities/projects/project.entity";
import { UserEntity } from "@/lib/orm/entities/users/user.entity";

let orm: MikroORM;

beforeAll(async () => {
	orm = await MikroORM.init(
		defineConfig({
			clientUrl: "postgresql://fake:fake@localhost:5432/fake",
			connect: false,
			allowGlobalContext: true,
			entities: [ArtifactVersionEntity, ArtifactEntity, ChatMessageEntity, ChatEntity, ProjectEntity, UserEntity],
		}),
	);
});

afterAll(async () => {
	await orm?.close();
});

// Access the private method for direct testing
function redactBlocks(blocks: StreamBlock[], groups?: string[]): StreamBlock[] {
	const entity = new ChatMessageEntity();
	return (entity as any).redactBlocks(blocks, groups);
}

// -- fixtures ----------------------------------------------------------------

function toolBlock(toolName: string, overrides?: Partial<ToolCallStreamBlock>): ToolCallStreamBlock {
	return {
		id: "block_1",
		type: "tool_call",
		toolName,
		toolCallId: "tc_1",
		content: "some raw content",
		toolInput: { content: "full document body here" },
		toolOutput: "Document written successfully",
		...overrides,
	};
}

function textBlock(text = "Hello world"): TextStreamBlock {
	return { id: "block_t", type: "text", content: text };
}

// -- tests -------------------------------------------------------------------

describe("ChatMessageEntity block redaction", () => {
	it("redacts write_document tool call fields", () => {
		const blocks = [toolBlock("write_document")];
		const result = redactBlocks(blocks);

		expect(result).toHaveLength(1);
		const b = result[0] as ToolCallStreamBlock;
		expect(b.content).toBe("REDACTED");
		expect(b.toolInput).toBe("REDACTED");
		expect(b.toolOutput).toBe("REDACTED");
	});

	it("redacts edit_document tool call fields", () => {
		const blocks = [toolBlock("edit_document")];
		const result = redactBlocks(blocks);

		const b = result[0] as ToolCallStreamBlock;
		expect(b.content).toBe("REDACTED");
		expect(b.toolInput).toBe("REDACTED");
		expect(b.toolOutput).toBe("REDACTED");
	});

	it("preserves non-content fields on redacted blocks", () => {
		const blocks = [toolBlock("write_document", { toolCallId: "tc_99", toolSuccess: true })];
		const result = redactBlocks(blocks);

		const b = result[0] as ToolCallStreamBlock;
		expect(b.type).toBe("tool_call");
		expect(b.toolName).toBe("write_document");
		expect(b.toolCallId).toBe("tc_99");
		expect(b.toolSuccess).toBe(true);
	});

	it("does NOT redact other tool calls", () => {
		const blocks = [toolBlock("web_search"), toolBlock("read_file")];
		const result = redactBlocks(blocks);

		for (const b of result as ToolCallStreamBlock[]) {
			expect(b.content).not.toBe("REDACTED");
			expect(b.toolInput).not.toBe("REDACTED");
			expect(b.toolOutput).not.toBe("REDACTED");
		}
	});

	it("does NOT redact text blocks", () => {
		const blocks = [textBlock("keep me")];
		const result = redactBlocks(blocks);

		expect((result[0] as TextStreamBlock).content).toBe("keep me");
	});

	it("handles mixed blocks — only document tools are redacted", () => {
		const blocks: StreamBlock[] = [
			textBlock("intro"),
			toolBlock("begin_document"),
			toolBlock("write_document"),
			toolBlock("finalize_document"),
			textBlock("outro"),
		];
		const result = redactBlocks(blocks);

		// text blocks untouched
		expect((result[0] as TextStreamBlock).content).toBe("intro");
		expect((result[4] as TextStreamBlock).content).toBe("outro");

		// begin_document, finalize_document — NOT in the redaction list
		expect((result[1] as ToolCallStreamBlock).content).not.toBe("REDACTED");
		expect((result[3] as ToolCallStreamBlock).content).not.toBe("REDACTED");

		// write_document — redacted
		expect((result[2] as ToolCallStreamBlock).content).toBe("REDACTED");
	});

	it("handles empty blocks array", () => {
		expect(redactBlocks([])).toEqual([]);
	});

	it("toJSON() redacts document tool blocks without needing groups", () => {
		const entity = orm.em.create(ChatMessageEntity, {
			role: "assistant",
			content: "test",
			blocks: [
				textBlock("visible"),
				toolBlock("write_document"),
				toolBlock("web_search"),
			],
			chat: "00000000-0000-0000-0000-000000000001" as any,
			created_at: new Date("2026-01-01"),
		});

		const json = entity.toJSON();
		const blocks = json.blocks as StreamBlock[];

		expect((blocks[0] as TextStreamBlock).content).toBe("visible");
		expect((blocks[1] as ToolCallStreamBlock).content).toBe("REDACTED");
		expect((blocks[1] as ToolCallStreamBlock).toolInput).toBe("REDACTED");
		expect((blocks[1] as ToolCallStreamBlock).toolOutput).toBe("REDACTED");
		expect((blocks[2] as ToolCallStreamBlock).content).toBe("some raw content");
	});
});

/** Block redaction is always unconditional — real content lives on ArtifactVersionEntity. */
describe("block redaction is unconditional (applies regardless of is_internal)", () => {
	it("redacts write_document blocks even for non-internal content", () => {
		const blocks = [toolBlock("write_document", { content: "public deliverable body" })];
		const result = redactBlocks(blocks);

		const b = result[0] as ToolCallStreamBlock;
		expect(b.content).toBe("REDACTED");
		expect(b.toolInput).toBe("REDACTED");
		expect(b.toolOutput).toBe("REDACTED");
	});

	it("redacts edit_document blocks even for non-internal content", () => {
		const blocks = [toolBlock("edit_document", { content: "public edit diff" })];
		const result = redactBlocks(blocks);

		const b = result[0] as ToolCallStreamBlock;
		expect(b.content).toBe("REDACTED");
		expect(b.toolInput).toBe("REDACTED");
		expect(b.toolOutput).toBe("REDACTED");
	});
});
