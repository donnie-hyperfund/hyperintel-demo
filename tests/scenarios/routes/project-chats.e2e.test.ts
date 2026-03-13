import { getTestEm, clearDatabase, closeTestOrm } from "@/tests/helpers/db";
import { mockClerkNextjs, setMockClerkUser } from "@/tests/helpers/clerk-mock";
import { callRoute } from "@/tests/helpers/api";
import { UserEntity } from "@/lib/orm/entities/users/user.entity";
import { ProjectEntity } from "@/lib/orm/entities/projects/project.entity";
import { ChatEntity } from "@/lib/orm/entities/chats/chat.entity";

mockClerkNextjs();

const CLERK_ID_A = "user_projchats_a";
const CLERK_ID_B = "user_projchats_b";

let projectIdA: string;
let projectIdB: string;
let chatIdA0: string;
let chatIdA1: string;
let chatIdA2: string;
let intakeChatId: string;

beforeAll(async () => {
	const em = await getTestEm();
	const userA = em.create(UserEntity, { email: "projchats-a@t.com", emailConfirmed: true, clerkId: CLERK_ID_A });
	const userB = em.create(UserEntity, { email: "projchats-b@t.com", emailConfirmed: true, clerkId: CLERK_ID_B });
	const projectA = em.create(ProjectEntity, { name: "Project A", user: userA });
	const projectB = em.create(ProjectEntity, { name: "Project B", user: userB });

	const chatA0 = em.create(ChatEntity, { phase: "active", phase_index: 0, project: projectA, user: userA });
	const chatA1 = em.create(ChatEntity, { phase: "active", phase_index: 1, project: projectA, user: userA });
	const chatA2 = em.create(ChatEntity, { phase: "active", phase_index: 2, project: projectA, user: userA });
	const intakeChat = em.create(ChatEntity, { phase: "active", phase_index: 0, type: "intake", user: userA });

	await em.persistAndFlush([userA, userB, projectA, projectB, chatA0, chatA1, chatA2, intakeChat]);

	projectIdA = projectA.id;
	projectIdB = projectB.id;
	chatIdA0 = chatA0.id;
	chatIdA1 = chatA1.id;
	chatIdA2 = chatA2.id;
	intakeChatId = intakeChat.id;
});

beforeEach(() => setMockClerkUser({ userId: CLERK_ID_A }));

afterAll(async () => {
	await clearDatabase();
	await closeTestOrm();
});

describe("GET /api/projects/:pid/chats", () => {
	it("returns only chats for the given project", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/chats/route");
		const { status, body } = await callRoute(GET, `/api/projects/${projectIdA}/chats`, { projectId: projectIdA });
		expect(status).toBe(200);
		expect(body.data).toBeDefined();
		expect(body.pagination).toBeDefined();
		expect(body.data.some((c: any) => c.id === chatIdA0)).toBe(true);
		expect(body.data.some((c: any) => c.id === chatIdA1)).toBe(true);
		expect(body.data.some((c: any) => c.id === chatIdA2)).toBe(true);
		// Intake chat should NOT appear
		expect(body.data.some((c: any) => c.id === intakeChatId)).toBe(false);
	});

	it("returns paginated response", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/chats/route");
		const { status, body } = await callRoute(GET, `/api/projects/${projectIdA}/chats?limit=1`, { projectId: projectIdA });
		expect(status).toBe(200);
		expect(body.data.length).toBe(1);
		expect(body.pagination.page).toBe(1);
		expect(body.pagination.totalPages).toBe(1);
	});

	it("page 2 returns next chat", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/chats/route");
		const { status, body } = await callRoute(GET, `/api/projects/${projectIdA}/chats?limit=1&page=2`, { projectId: projectIdA });
		expect(status).toBe(200);
		expect(body.data.length).toBe(1);
		expect(body.pagination.page).toBe(2);
	});

	it("orders by phase_index ascending", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/chats/route");
		const { status, body } = await callRoute(GET, `/api/projects/${projectIdA}/chats`, { projectId: projectIdA });
		expect(status).toBe(200);
		const indices = body.data.map((c: any) => c.phase_index);
		for (let i = 1; i < indices.length; i++) {
			expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
		}
	});
});

describe("project chats ownership", () => {
	it("user B cannot list user A's project chats", async () => {
		setMockClerkUser({ userId: CLERK_ID_B });
		const { GET } = await import("@/app/api/projects/[projectId]/chats/route");
		const { status, body } = await callRoute(GET, `/api/projects/${projectIdA}/chats`, { projectId: projectIdA });
		expect(status).toBe(200);
		expect(body.data.length).toBe(0);
	});

	it("user B sees chats in own project", async () => {
		// Seed a chat in user B's project
		const em = await getTestEm();
		const userB = await em.findOneOrFail(UserEntity, { clerkId: CLERK_ID_B });
		const projectB = await em.findOneOrFail(ProjectEntity, { id: projectIdB });
		const chatB = em.create(ChatEntity, { phase: "active", phase_index: 0, project: projectB, user: userB });
		await em.persistAndFlush(chatB);

		setMockClerkUser({ userId: CLERK_ID_B });
		const { GET } = await import("@/app/api/projects/[projectId]/chats/route");
		const { status, body } = await callRoute(GET, `/api/projects/${projectIdB}/chats`, { projectId: projectIdB });
		expect(status).toBe(200);
		expect(body.data.some((c: any) => c.id === chatB.id)).toBe(true);
	});
});

describe("equivalence with unified endpoint", () => {
	it("GET /api/projects/:pid/chats matches GET /api/chats?projectId=", async () => {
		const { GET: getProjectChats } = await import("@/app/api/projects/[projectId]/chats/route");
		const { GET: getUnifiedChats } = await import("@/app/api/chats/route");

		const { body: projectBody } = await callRoute(getProjectChats, `/api/projects/${projectIdA}/chats`, { projectId: projectIdA });
		const { body: unifiedBody } = await callRoute(getUnifiedChats, `/api/chats?projectId=${projectIdA}`);

		const projectChatIds = projectBody.data.map((c: any) => c.id).sort();
		const unifiedChatIds = unifiedBody.data.map((c: any) => c.id).sort();
		expect(projectChatIds).toEqual(unifiedChatIds);
	});
});
