import { getTestEm, clearDatabase, closeTestOrm } from "@/tests/helpers/db";
import { mockClerkNextjs, setMockClerkUser } from "@/tests/helpers/clerk-mock";
import { callRoute } from "@/tests/helpers/api";
import { UserEntity } from "@/lib/orm/entities/users/user.entity";
import { ProjectEntity } from "@/lib/orm/entities/projects/project.entity";
import { ChatEntity } from "@/lib/orm/entities/chats/chat.entity";
import { ArtifactEntity } from "@/lib/orm/entities/artifacts/artifact.entity";
import { ArtifactVersionEntity } from "@/lib/orm/entities/artifacts/artifact-version.entity";

mockClerkNextjs();

const CLERK_ID_A = "user_artifacts_a";
const CLERK_ID_B = "user_artifacts_b";

let projectId: string;
let chatId: string;
let uploadedArtifactId: string;
let aiArtifactId: string;
let intakeArtifactId: string;

beforeAll(async () => {
	const em = await getTestEm();

	const userA = em.create(UserEntity, { email: "artifacts-a@t.com", emailConfirmed: true, clerkId: CLERK_ID_A });
	const userB = em.create(UserEntity, { email: "artifacts-b@t.com", emailConfirmed: true, clerkId: CLERK_ID_B });
	const project = em.create(ProjectEntity, { name: "Art Project", user: userA });
	const chat = em.create(ChatEntity, { phase: "chat", project, user: userA });

	// Uploaded artifact (can be deleted)
	const uploaded = em.create(ArtifactEntity, { key: "uploaded.md", title: "Uploaded", version: 1, project, user: userA });
	const uv1 = em.create(ArtifactVersionEntity, {
		artifact: uploaded, version: 1, content: "uploaded content", status: "approved", chat, is_uploaded: true,
	});
	uploaded.current_version = uv1;

	// AI-generated artifact (cannot be deleted via API)
	const aiArt = em.create(ArtifactEntity, { key: "ai-doc.md", title: "AI Doc", version: 1, project, user: userA });
	const av1 = em.create(ArtifactVersionEntity, {
		artifact: aiArt, version: 1, content: "ai content", status: "approved", chat, is_uploaded: false,
	});
	aiArt.current_version = av1;

	// Intake artifact (no project)
	const intake = em.create(ArtifactEntity, { key: "intake.md", title: "Intake", version: 1, user: userA });
	const iv1 = em.create(ArtifactVersionEntity, {
		artifact: intake, version: 1, content: "intake content", status: "proposed",
	});

	await em.persistAndFlush([userA, userB, project, chat, uploaded, uv1, aiArt, av1, intake, iv1]);

	projectId = project.id;
	chatId = chat.id;
	uploadedArtifactId = uploaded.id;
	aiArtifactId = aiArt.id;
	intakeArtifactId = intake.id;
});

beforeEach(() => setMockClerkUser({ userId: CLERK_ID_A }));

afterAll(async () => {
	await clearDatabase();
	await closeTestOrm();
});

describe("artifact list dispatcher", () => {
	it("GET /api/artifacts (no params) — returns intake artifacts", async () => {
		const { GET } = await import("@/app/api/artifacts/route");
		const { status, body } = await callRoute(GET, "/api/artifacts");
		expect(status).toBe(200);
		expect(Array.isArray(body)).toBe(true);
		expect(body.some((a: any) => a.id === intakeArtifactId)).toBe(true);
		expect(body.some((a: any) => a.id === uploadedArtifactId)).toBe(false);
	});

	it("GET /api/artifacts?projectId= — returns project artifacts", async () => {
		const { GET } = await import("@/app/api/artifacts/route");
		const { status, body } = await callRoute(GET, `/api/artifacts?projectId=${projectId}`);
		expect(status).toBe(200);
		expect(body.data).toBeDefined();
		expect(body.data.some((a: any) => a.id === uploadedArtifactId)).toBe(true);
	});

	it("GET /api/artifacts?chatId= — returns chat artifacts", async () => {
		const { GET } = await import("@/app/api/artifacts/route");
		const { status, body } = await callRoute(GET, `/api/artifacts?chatId=${chatId}`);
		expect(status).toBe(200);
		expect(body.data).toBeDefined();
		expect(body.data.some((a: any) => a.id === uploadedArtifactId)).toBe(true);
	});
});

describe("convenience wrapper", () => {
	it("GET /api/projects/:pid/artifacts returns same data", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/artifacts/route");
		const { status, body } = await callRoute(GET, `/api/projects/${projectId}/artifacts`, { projectId });
		expect(status).toBe(200);
		expect(body.data.some((a: any) => a.id === uploadedArtifactId)).toBe(true);
	});
});

describe("artifact by ID", () => {
	it("GET /api/artifacts/:id — returns artifact", async () => {
		const { GET } = await import("@/app/api/artifacts/[artifactId]/route");
		const { status, body } = await callRoute(GET, `/api/artifacts/${uploadedArtifactId}`, { artifactId: uploadedArtifactId });
		expect(status).toBe(200);
		expect(body.id).toBe(uploadedArtifactId);
		expect(body.key).toBe("uploaded.md");
	});

	it("GET /api/artifacts/:id?version=1 — includes loaded_version", async () => {
		const { GET } = await import("@/app/api/artifacts/[artifactId]/route");
		const { status, body } = await callRoute(GET, `/api/artifacts/${uploadedArtifactId}?version=1`, { artifactId: uploadedArtifactId });
		expect(status).toBe(200);
		expect(body.loaded_version).toBeDefined();
		expect(body.loaded_version.version).toBe(1);
	});

	it("GET /api/artifacts/:id?version=999 — 404", async () => {
		const { GET } = await import("@/app/api/artifacts/[artifactId]/route");
		const { status } = await callRoute(GET, `/api/artifacts/${uploadedArtifactId}?version=999`, { artifactId: uploadedArtifactId });
		expect(status).toBe(404);
	});

	it("GET /api/artifacts/nonexistent — 404", async () => {
		const { GET } = await import("@/app/api/artifacts/[artifactId]/route");
		const { status } = await callRoute(GET, `/api/artifacts/00000000-0000-0000-0000-000000000000`, { artifactId: "00000000-0000-0000-0000-000000000000" });
		expect(status).toBe(404);
	});
});

describe("artifact delete", () => {
	it("DELETE uploaded artifact → 200", async () => {
		const { DELETE } = await import("@/app/api/artifacts/[artifactId]/route");
		const { status, body } = await callRoute(DELETE, `/api/artifacts/${uploadedArtifactId}`, { artifactId: uploadedArtifactId }, { method: "DELETE" });
		expect(status).toBe(200);
		expect(body.success).toBe(true);
	});

	it("DELETE already deleted artifact → 400", async () => {
		const { DELETE } = await import("@/app/api/artifacts/[artifactId]/route");
		const { status, body } = await callRoute(DELETE, `/api/artifacts/${uploadedArtifactId}`, { artifactId: uploadedArtifactId }, { method: "DELETE" });
		expect(status).toBe(400);
		expect(body.code).toBe("ALREADY_DELETED");
	});

	it("DELETE non-uploaded artifact → 403", async () => {
		const { DELETE } = await import("@/app/api/artifacts/[artifactId]/route");
		const { status, body } = await callRoute(DELETE, `/api/artifacts/${aiArtifactId}`, { artifactId: aiArtifactId }, { method: "DELETE" });
		expect(status).toBe(403);
		expect(body.code).toBe("NOT_UPLOADED_ARTIFACT");
	});
});

describe("artifact ownership", () => {
	it("user B cannot GET user A's artifact", async () => {
		setMockClerkUser({ userId: CLERK_ID_B });
		const { GET } = await import("@/app/api/artifacts/[artifactId]/route");
		const { status } = await callRoute(GET, `/api/artifacts/${aiArtifactId}`, { artifactId: aiArtifactId });
		expect(status).toBe(404);
	});

	it("user B cannot DELETE user A's artifact", async () => {
		setMockClerkUser({ userId: CLERK_ID_B });
		const { DELETE } = await import("@/app/api/artifacts/[artifactId]/route");
		const { status } = await callRoute(DELETE, `/api/artifacts/${aiArtifactId}`, { artifactId: aiArtifactId }, { method: "DELETE" });
		expect(status).toBe(404);
	});

	it("user B gets empty intake list", async () => {
		setMockClerkUser({ userId: CLERK_ID_B });
		const { GET } = await import("@/app/api/artifacts/route");
		const { status, body } = await callRoute(GET, "/api/artifacts");
		expect(status).toBe(200);
		expect(body.length).toBe(0);
	});
});
