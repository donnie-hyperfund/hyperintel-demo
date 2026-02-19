/**
 * Message/history endpoints redact write_document and edit_document blocks.
 *
 * Block redaction in saved messages is UNCONDITIONAL — it applies regardless
 * of is_internal. This is a secondary defense layer; the primary visibility
 * mechanism is ArtifactVersionEntity.toJSON().
 *
 * Calls route handlers directly with mocked Clerk auth + real DB.
 */

import { NextRequest } from "next/server";
import { getTestEm, clearDatabase, closeTestOrm } from "@/tests/helpers/db";
import { mockClerkNextjs, setMockClerkUser } from "@/tests/helpers/clerk-mock";
import { UserEntity } from "@/lib/orm/entities/users/user.entity";
import { ProjectEntity } from "@/lib/orm/entities/projects/project.entity";
import { ChatEntity } from "@/lib/orm/entities/chats/chat.entity";
import { ChatMessageEntity } from "@/lib/orm/entities/chats/chat-message.entity";
import type { StreamBlock } from "@/common/ai/agent/types";

mockClerkNextjs();

const SECRET = "# SECRET artifact body never for frontend eyes.";
const PUBLIC_BODY = "# PUBLIC deliverable content for client.";
const CLERK_ID = "user_history_test";

const internalBlocks: StreamBlock[] = [
	{ id: "b1", type: "text", content: "Creating your document." },
	{ id: "b2", type: "tool_call", toolName: "write_document", toolCallId: "tc1",
		content: SECRET, toolInput: { content: SECRET }, toolOutput: "Written." },
	{ id: "b3", type: "tool_call", toolName: "edit_document", toolCallId: "tc2",
		content: "diff with secrets", toolInput: { edits: [] }, toolOutput: "Edited." },
	{ id: "b4", type: "tool_call", toolName: "web_search", toolCallId: "tc3",
		content: "search results", toolInput: { query: "test" }, toolOutput: "Found." },
	{ id: "b5", type: "text", content: "Done." },
];

const publicBlocks: StreamBlock[] = [
	{ id: "b6", type: "text", content: "Creating your deliverable." },
	{ id: "b7", type: "tool_call", toolName: "write_document", toolCallId: "tc4",
		content: PUBLIC_BODY, toolInput: { content: PUBLIC_BODY }, toolOutput: "Written." },
	{ id: "b8", type: "text", content: "Deliverable ready." },
];

let chatId: string;
let internalMessageId: string;
let publicMessageId: string;

beforeAll(async () => {
	const em = await getTestEm();
	const user = em.create(UserEntity, { email: "history-test@t.com", emailConfirmed: true, clerkId: CLERK_ID });
	const project = em.create(ProjectEntity, { name: "P", user });
	const chat = em.create(ChatEntity, { phase: "chat", project });
	const internalMessage = em.create(ChatMessageEntity, { role: "assistant", content: "doc", blocks: internalBlocks, chat });
	const publicMessage = em.create(ChatMessageEntity, { role: "assistant", content: "deliverable", blocks: publicBlocks, chat });
	await em.persistAndFlush([user, project, chat, internalMessage, publicMessage]);
	chatId = chat.id;
	internalMessageId = internalMessage.id;
	publicMessageId = publicMessage.id;
});

beforeEach(() => {
	setMockClerkUser({ userId: CLERK_ID });
});

afterAll(async () => {
	await clearDatabase();
	await closeTestOrm();
});

function req(url: string) {
	return new NextRequest(new URL(url, "http://localhost:3000"));
}

function assertBlocksRedacted(blocks: any[]) {
	for (const b of blocks) {
		if (b.type === "tool_call" && ["write_document", "edit_document"].includes(b.toolName)) {
			expect(b.content).toBe("REDACTED");
			expect(b.toolInput).toBe("REDACTED");
			expect(b.toolOutput).toBe("REDACTED");
		}
	}
}

describe("history block redaction — internal document messages", () => {
	it("GET /messages — list redacts document tool calls", async () => {
		const { GET } = await import("@/app/api/chats/[chatId]/messages/route");
		const res = await GET(req(`/api/chats/${chatId}/messages`), { params: Promise.resolve({ chatId }) });
		expect(res.status).toBe(200);
		const body = await res.json();
		const msg = body.data?.find((m: any) => m.id === internalMessageId);
		expect(msg).toBeDefined();
		assertBlocksRedacted(msg.blocks);
		expect(JSON.stringify(msg.blocks)).not.toContain(SECRET);
	});

	it("GET /messages/:mid — single message redacts document tool calls", async () => {
		const { GET } = await import("@/app/api/chats/[chatId]/messages/[messageId]/route");
		const res = await GET(req(`/api/chats/${chatId}/messages/${internalMessageId}`), { params: Promise.resolve({ chatId, messageId: internalMessageId }) });
		expect(res.status).toBe(200);
		const body = await res.json();
		assertBlocksRedacted(body.blocks);
		expect(JSON.stringify(body.blocks)).not.toContain(SECRET);
	});

	it("text blocks and non-document tools survive", async () => {
		const { GET } = await import("@/app/api/chats/[chatId]/messages/[messageId]/route");
		const res = await GET(req(`/api/chats/${chatId}/messages/${internalMessageId}`), { params: Promise.resolve({ chatId, messageId: internalMessageId }) });
		const body = await res.json();
		const text = body.blocks.filter((b: any) => b.type === "text");
		expect(text.length).toBe(2);
		expect(text[0].content).toBe("Creating your document.");
		expect(text[1].content).toBe("Done.");

		const search = body.blocks.find((b: any) => b.toolName === "web_search");
		expect(search.content).not.toBe("REDACTED");
	});
});

/** Block redaction is always unconditional — real content lives on ArtifactVersionEntity. */
describe("history block redaction — non-internal document messages (still redacted)", () => {
	it("GET /messages/:mid — non-internal write_document blocks are still redacted", async () => {
		const { GET } = await import("@/app/api/chats/[chatId]/messages/[messageId]/route");
		const res = await GET(req(`/api/chats/${chatId}/messages/${publicMessageId}`), { params: Promise.resolve({ chatId, messageId: publicMessageId }) });
		expect(res.status).toBe(200);
		const body = await res.json();
		assertBlocksRedacted(body.blocks);
		expect(JSON.stringify(body.blocks)).not.toContain(PUBLIC_BODY);
	});

	it("text blocks in non-internal messages survive", async () => {
		const { GET } = await import("@/app/api/chats/[chatId]/messages/[messageId]/route");
		const res = await GET(req(`/api/chats/${chatId}/messages/${publicMessageId}`), { params: Promise.resolve({ chatId, messageId: publicMessageId }) });
		const body = await res.json();
		const text = body.blocks.filter((b: any) => b.type === "text");
		expect(text.length).toBe(2);
		expect(text[0].content).toBe("Creating your deliverable.");
		expect(text[1].content).toBe("Deliverable ready.");
	});
});
