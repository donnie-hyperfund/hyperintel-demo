/**
 * Message/history endpoints redact write_document and edit_document blocks.
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
const CLERK_ID = "user_history_test";

const blocks: StreamBlock[] = [
	{ id: "b1", type: "text", content: "Creating your document." },
	{ id: "b2", type: "tool_call", toolName: "write_document", toolCallId: "tc1",
		content: SECRET, toolInput: { content: SECRET }, toolOutput: "Written." },
	{ id: "b3", type: "tool_call", toolName: "edit_document", toolCallId: "tc2",
		content: "diff with secrets", toolInput: { edits: [] }, toolOutput: "Edited." },
	{ id: "b4", type: "tool_call", toolName: "web_search", toolCallId: "tc3",
		content: "search results", toolInput: { query: "test" }, toolOutput: "Found." },
	{ id: "b5", type: "text", content: "Done." },
];

let projectId: string;
let chatId: string;
let messageId: string;

beforeAll(async () => {
	const em = await getTestEm();
	const user = em.create(UserEntity, { email: "history-test@t.com", emailConfirmed: true, clerkId: CLERK_ID });
	const project = em.create(ProjectEntity, { name: "P", user });
	const chat = em.create(ChatEntity, { phase: "chat", project });
	const message = em.create(ChatMessageEntity, { role: "assistant", content: "doc", blocks, chat });
	await em.persistAndFlush([user, project, chat, message]);
	projectId = project.id;
	chatId = chat.id;
	messageId = message.id;
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

describe("history block redaction", () => {
	it("GET /messages — list redacts document tool calls", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/chats/[chatId]/messages/route");
		const res = await GET(req(`/api/projects/${projectId}/chats/${chatId}/messages`), { params: Promise.resolve({ projectId, chatId }) });
		expect(res.status).toBe(200);
		const body = await res.json();
		const msg = body.data?.find((m: any) => m.id === messageId);
		expect(msg).toBeDefined();
		assertBlocksRedacted(msg.blocks);
		expect(JSON.stringify(msg.blocks)).not.toContain(SECRET);
	});

	it("GET /messages/:mid — single message redacts document tool calls", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/chats/[chatId]/messages/[messageId]/route");
		const res = await GET(req(`/api/projects/${projectId}/chats/${chatId}/messages/${messageId}`), { params: Promise.resolve({ projectId, chatId, messageId }) });
		expect(res.status).toBe(200);
		const body = await res.json();
		assertBlocksRedacted(body.blocks);
		expect(JSON.stringify(body.blocks)).not.toContain(SECRET);
	});

	it("GET /api/chat — legacy endpoint redacts document tool calls", async () => {
		const { GET } = await import("@/app/api/chat/route");
		const res = await GET();
		expect(res.status).toBe(200);
		const body = await res.json();
		for (const msg of body.messages ?? []) {
			if (msg.blocks) {
				assertBlocksRedacted(msg.blocks);
				expect(JSON.stringify(msg.blocks)).not.toContain(SECRET);
			}
		}
	});

	it("text blocks and non-document tools survive", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/chats/[chatId]/messages/[messageId]/route");
		const res = await GET(req(`/api/projects/${projectId}/chats/${chatId}/messages/${messageId}`), { params: Promise.resolve({ projectId, chatId, messageId }) });
		const body = await res.json();
		const text = body.blocks.filter((b: any) => b.type === "text");
		expect(text.length).toBe(2);
		expect(text[0].content).toBe("Creating your document.");
		expect(text[1].content).toBe("Done.");

		const search = body.blocks.find((b: any) => b.toolName === "web_search");
		expect(search.content).not.toBe("REDACTED");
	});
});
