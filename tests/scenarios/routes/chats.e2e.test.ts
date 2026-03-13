import { getTestEm, clearDatabase, closeTestOrm } from "@/tests/helpers/db";
import { mockClerkNextjs, setMockClerkUser } from "@/tests/helpers/clerk-mock";
import { callRoute } from "@/tests/helpers/api";
import { UserEntity } from "@/lib/orm/entities/users/user.entity";
import { ProjectEntity } from "@/lib/orm/entities/projects/project.entity";

mockClerkNextjs();

const CLERK_ID_A = "user_chats_a";
const CLERK_ID_B = "user_chats_b";
let projectIdA: string;

beforeAll(async () => {
	const em = await getTestEm();
	const userA = em.create(UserEntity, { email: "chats-a@t.com", emailConfirmed: true, clerkId: CLERK_ID_A });
	const userB = em.create(UserEntity, { email: "chats-b@t.com", emailConfirmed: true, clerkId: CLERK_ID_B });
	const projectA = em.create(ProjectEntity, { name: "Chat Project", user: userA });
	await em.persistAndFlush([userA, userB, projectA]);
	projectIdA = projectA.id;
});

beforeEach(() => setMockClerkUser({ userId: CLERK_ID_A }));

afterAll(async () => {
	await clearDatabase();
	await closeTestOrm();
});

describe("project chat CRUD", () => {
	let chatId: string;

	it("POST /api/chats — creates project chat", async () => {
		const { POST } = await import("@/app/api/chats/route");
		const { status, body } = await callRoute(POST, "/api/chats", {}, {
			method: "POST",
			body: { projectId: projectIdA, title: "My Chat" },
		});
		expect(status).toBe(201);
		expect(body.id).toBeDefined();
		expect(body.summary).toBe("My Chat");
		chatId = body.id;
	});

	it("GET /api/chats — lists chats", async () => {
		const { GET } = await import("@/app/api/chats/route");
		const { status, body } = await callRoute(GET, "/api/chats");
		expect(status).toBe(200);
		expect(body.data.some((c: any) => c.id === chatId)).toBe(true);
	});

	it("GET /api/chats/:id — gets chat with message_count", async () => {
		const { GET } = await import("@/app/api/chats/[chatId]/route");
		const { status, body } = await callRoute(GET, `/api/chats/${chatId}`, { chatId });
		expect(status).toBe(200);
		expect(body.id).toBe(chatId);
		expect(body.message_count).toBe(0);
	});

	it("DELETE /api/chats/:id — deletes chat", async () => {
		const { DELETE } = await import("@/app/api/chats/[chatId]/route");
		const { status } = await callRoute(DELETE, `/api/chats/${chatId}`, { chatId }, { method: "DELETE" });
		expect(status).toBe(200);
	});

	it("GET /api/chats/:id — 404 after delete", async () => {
		const { GET } = await import("@/app/api/chats/[chatId]/route");
		const { status } = await callRoute(GET, `/api/chats/${chatId}`, { chatId });
		expect(status).toBe(404);
	});
});

describe("intake chat", () => {
	it("POST with framework=cpf creates intake chat", async () => {
		const { POST } = await import("@/app/api/chats/route");
		const { status, body } = await callRoute(POST, "/api/chats", {}, {
			method: "POST",
			body: { framework: "cpf" },
		});
		expect(status).toBe(201);
		expect(body.type).toBe("intake");
		expect(body.metadata?.framework).toBe("cpf");
	});

	it("POST with framework=hpf + category creates intake chat", async () => {
		const { POST } = await import("@/app/api/chats/route");
		const { status, body } = await callRoute(POST, "/api/chats", {}, {
			method: "POST",
			body: { framework: "hpf", category: "principal" },
		});
		expect(status).toBe(201);
		expect(body.metadata?.framework).toBe("hpf");
		expect(body.metadata?.category).toBe("principal");
	});
});

describe("chat validation", () => {
	it("POST without projectId or framework → 400", async () => {
		const { POST } = await import("@/app/api/chats/route");
		const { status } = await callRoute(POST, "/api/chats", {}, {
			method: "POST",
			body: { title: "orphan" },
		});
		expect(status).toBe(400);
	});

	it("POST with framework=hpf without category → 400", async () => {
		const { POST } = await import("@/app/api/chats/route");
		const { status } = await callRoute(POST, "/api/chats", {}, {
			method: "POST",
			body: { framework: "hpf" },
		});
		expect(status).toBe(400);
	});

	it("POST with non-existent projectId → 404", async () => {
		const { POST } = await import("@/app/api/chats/route");
		const { status } = await callRoute(POST, "/api/chats", {}, {
			method: "POST",
			body: { projectId: "00000000-0000-0000-0000-000000000000" },
		});
		expect(status).toBe(404);
	});
});

describe("convenience wrapper", () => {
	let chatId: string;

	beforeAll(async () => {
		setMockClerkUser({ userId: CLERK_ID_A });
		const { POST } = await import("@/app/api/chats/route");
		const { body } = await callRoute(POST, "/api/chats", {}, {
			method: "POST",
			body: { projectId: projectIdA },
		});
		chatId = body.id;
	});

	it("GET /api/projects/:pid/chats returns same chat", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/chats/route");
		const { status, body } = await callRoute(GET, `/api/projects/${projectIdA}/chats`, { projectId: projectIdA });
		expect(status).toBe(200);
		expect(body.data.some((c: any) => c.id === chatId)).toBe(true);
	});

	it("GET /api/chats?projectId= returns same chat", async () => {
		const { GET } = await import("@/app/api/chats/route");
		const { status, body } = await callRoute(GET, `/api/chats?projectId=${projectIdA}`);
		expect(status).toBe(200);
		expect(body.data.some((c: any) => c.id === chatId)).toBe(true);
	});
});

describe("chat ownership", () => {
	let chatIdA: string;

	beforeAll(async () => {
		setMockClerkUser({ userId: CLERK_ID_A });
		const { POST } = await import("@/app/api/chats/route");
		const { body } = await callRoute(POST, "/api/chats", {}, {
			method: "POST",
			body: { projectId: projectIdA },
		});
		chatIdA = body.id;
	});

	it("user B cannot GET user A's chat", async () => {
		setMockClerkUser({ userId: CLERK_ID_B });
		const { GET } = await import("@/app/api/chats/[chatId]/route");
		const { status } = await callRoute(GET, `/api/chats/${chatIdA}`, { chatId: chatIdA });
		expect(status).toBe(404);
	});

	it("user B cannot DELETE user A's chat", async () => {
		setMockClerkUser({ userId: CLERK_ID_B });
		const { DELETE } = await import("@/app/api/chats/[chatId]/route");
		const { status } = await callRoute(DELETE, `/api/chats/${chatIdA}`, { chatId: chatIdA }, { method: "DELETE" });
		expect(status).toBe(404);
	});
});
