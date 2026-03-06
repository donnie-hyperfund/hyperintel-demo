import { randomUUID } from "crypto";
import { getTestEm, clearDatabase, closeTestOrm } from "@/tests/helpers/db";
import { mockClerkNextjs, setMockClerkUser } from "@/tests/helpers/clerk-mock";
import { callRoute } from "@/tests/helpers/api";
import { UserEntity } from "@/lib/orm/entities/users/user.entity";
import { ProjectEntity } from "@/lib/orm/entities/projects/project.entity";
import { ChatEntity } from "@/lib/orm/entities/chats/chat.entity";

mockClerkNextjs();

const CLERK_ID_A = "user_messages_a";
const CLERK_ID_B = "user_messages_b";
let projectId: string;
let chatId: string;

beforeAll(async () => {
	const em = await getTestEm();
	const userA = em.create(UserEntity, { email: "messages-a@t.com", emailConfirmed: true, clerkId: CLERK_ID_A });
	const userB = em.create(UserEntity, { email: "messages-b@t.com", emailConfirmed: true, clerkId: CLERK_ID_B });
	const project = em.create(ProjectEntity, { name: "Msg Project", user: userA });
	const chat = em.create(ChatEntity, { phase: "chat", phase_index: 0, project, user: userA });
	await em.persistAndFlush([userA, userB, project, chat]);
	projectId = project.id;
	chatId = chat.id;
});

beforeEach(() => setMockClerkUser({ userId: CLERK_ID_A }));

afterAll(async () => {
	await clearDatabase();
	await closeTestOrm();
});

describe("messages CRUD", () => {
	let messageId: string;

	it("POST /api/chats/:cid/messages — creates a message", async () => {
		const { POST } = await import("@/app/api/chats/[chatId]/messages/route");
		const { status, body } = await callRoute(POST, `/api/chats/${chatId}/messages`, { chatId }, {
			method: "POST",
			body: { content: "Hello world", role: "user" },
		});
		expect(status).toBe(201);
		expect(body.content).toBe("Hello world");
		expect(body.role).toBe("user");
		expect(body.id).toBeDefined();
		messageId = body.id;
	});

	it("GET /api/chats/:cid/messages — lists messages", async () => {
		const { GET } = await import("@/app/api/chats/[chatId]/messages/route");
		const { status, body } = await callRoute(GET, `/api/chats/${chatId}/messages`, { chatId });
		expect(status).toBe(200);
		expect(body.data.some((m: any) => m.id === messageId)).toBe(true);
		expect(body.pagination).toBeDefined();
	});

	it("GET /api/chats/:cid/messages/:mid — gets a message", async () => {
		const { GET } = await import("@/app/api/chats/[chatId]/messages/[messageId]/route");
		const { status, body } = await callRoute(GET, `/api/chats/${chatId}/messages/${messageId}`, { chatId, messageId });
		expect(status).toBe(200);
		expect(body.id).toBe(messageId);
		expect(body.content).toBe("Hello world");
	});
});

describe("message auto-create chat", () => {
	it("POST to non-existent chatId with projectId in body creates chat + message", async () => {
		const newChatId = randomUUID();
		const { POST } = await import("@/app/api/chats/[chatId]/messages/route");
		const { status, body } = await callRoute(POST, `/api/chats/${newChatId}/messages`, { chatId: newChatId }, {
			method: "POST",
			body: { content: "Auto-created", role: "user", projectId },
		});
		expect(status).toBe(201);
		expect(body.content).toBe("Auto-created");

		const { GET } = await import("@/app/api/chats/[chatId]/route");
		const { status: chatStatus } = await callRoute(GET, `/api/chats/${newChatId}`, { chatId: newChatId });
		expect(chatStatus).toBe(200);
	});

	it("POST to non-existent chatId without projectId → 404", async () => {
		const newChatId = randomUUID();
		const { POST } = await import("@/app/api/chats/[chatId]/messages/route");
		const { status } = await callRoute(POST, `/api/chats/${newChatId}/messages`, { chatId: newChatId }, {
			method: "POST",
			body: { content: "Orphan", role: "user" },
		});
		expect(status).toBe(404);
	});
});

describe("message validation", () => {
	it("POST without content → 400", async () => {
		const { POST } = await import("@/app/api/chats/[chatId]/messages/route");
		const { status } = await callRoute(POST, `/api/chats/${chatId}/messages`, { chatId }, {
			method: "POST",
			body: { role: "user" },
		});
		expect(status).toBe(400);
	});

	it("POST without role → 400", async () => {
		const { POST } = await import("@/app/api/chats/[chatId]/messages/route");
		const { status } = await callRoute(POST, `/api/chats/${chatId}/messages`, { chatId }, {
			method: "POST",
			body: { content: "no role" },
		});
		expect(status).toBe(400);
	});
});

describe("message ownership", () => {
	let messageIdA: string;

	beforeAll(async () => {
		setMockClerkUser({ userId: CLERK_ID_A });
		const { POST } = await import("@/app/api/chats/[chatId]/messages/route");
		const { body } = await callRoute(POST, `/api/chats/${chatId}/messages`, { chatId }, {
			method: "POST",
			body: { content: "Private msg", role: "user" },
		});
		messageIdA = body.id;
	});

	it("user B cannot list messages in user A's chat", async () => {
		setMockClerkUser({ userId: CLERK_ID_B });
		const { GET } = await import("@/app/api/chats/[chatId]/messages/route");
		const { status } = await callRoute(GET, `/api/chats/${chatId}/messages`, { chatId });
		expect(status).toBe(404);
	});

	it("user B cannot get user A's message", async () => {
		setMockClerkUser({ userId: CLERK_ID_B });
		const { GET } = await import("@/app/api/chats/[chatId]/messages/[messageId]/route");
		const { status } = await callRoute(GET, `/api/chats/${chatId}/messages/${messageIdA}`, { chatId, messageId: messageIdA });
		expect(status).toBe(404);
	});
});
