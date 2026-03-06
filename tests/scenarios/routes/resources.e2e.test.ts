import { getTestEm, clearDatabase, closeTestOrm } from "@/tests/helpers/db";
import { mockClerkNextjs, setMockClerkUser } from "@/tests/helpers/clerk-mock";
import { callRoute } from "@/tests/helpers/api";
import { UserEntity } from "@/lib/orm/entities/users/user.entity";
import { ProjectEntity } from "@/lib/orm/entities/projects/project.entity";
import { ArtifactEntity } from "@/lib/orm/entities/artifacts/artifact.entity";
import { ArtifactVersionEntity } from "@/lib/orm/entities/artifacts/artifact-version.entity";

mockClerkNextjs();

const CLERK_ID_A = "user_resources_a";
const CLERK_ID_B = "user_resources_b";

let projectId: string;
let userResourceId: string;
let importedResourceId: string;
let approvedResourceId: string;

beforeAll(async () => {
	const em = await getTestEm();

	const userA = em.create(UserEntity, { email: "resources-a@t.com", emailConfirmed: true, clerkId: CLERK_ID_A });
	const userB = em.create(UserEntity, { email: "resources-b@t.com", emailConfirmed: true, clerkId: CLERK_ID_B });
	const project = em.create(ProjectEntity, { name: "Resource Project", user: userA });

	// User-scoped resource (no project) with proposed version
	const userRes = em.create(ArtifactEntity, { key: "user-company.md", title: "User Company", version: 1, user: userA, current_version: null! });
	const urv1 = em.create(ArtifactVersionEntity, {
		artifact: userRes, version: 1, content: "company content", status: "proposed", document_type: "Company Profile",
	});
	userRes.current_version = urv1;

	// User-scoped resource with approved version
	const approvedRes = em.create(ArtifactEntity, { key: "approved-persona.md", title: "Approved Persona", version: 1, user: userA, current_version: null! });
	const arv1 = em.create(ArtifactVersionEntity, {
		artifact: approvedRes, version: 1, content: "persona content", status: "approved", document_type: "Human Persona",
	});
	approvedRes.current_version = arv1;

	// Project-scoped imported resource
	const importedRes = em.create(ArtifactEntity, {
		key: "imported-company.md", title: "Imported Company", version: 1, project, user: userA,
		metadata: { importedFrom: "some-source-id" }, current_version: null!,
	});
	const irv1 = em.create(ArtifactVersionEntity, {
		artifact: importedRes, version: 1, content: "imported content", status: "approved", document_type: "Company Profile",
	});
	importedRes.current_version = irv1;

	await em.persistAndFlush([userA, userB, project, userRes, urv1, approvedRes, arv1, importedRes, irv1]);

	projectId = project.id;
	userResourceId = userRes.id;
	importedResourceId = importedRes.id;
	approvedResourceId = approvedRes.id;
});

beforeEach(() => setMockClerkUser({ userId: CLERK_ID_A }));

afterAll(async () => {
	await clearDatabase();
	await closeTestOrm();
});

// ---------------------------------------------------------------------------
// GET /api/resources (user-scoped)
// ---------------------------------------------------------------------------

describe("user-scoped resources", () => {
	it("GET /api/resources — lists user resources (no project)", async () => {
		const { GET } = await import("@/app/api/resources/route");
		const { status, body } = await callRoute(GET, "/api/resources");
		expect(status).toBe(200);
		expect(body.data).toBeDefined();
		expect(body.pagination).toBeDefined();
		expect(body.data.some((a: any) => a.id === userResourceId)).toBe(true);
		expect(body.data.some((a: any) => a.id === approvedResourceId)).toBe(true);
		// Imported (project-scoped) resource should NOT appear
		expect(body.data.some((a: any) => a.id === importedResourceId)).toBe(false);
	});

	it("GET /api/resources?documentType=Company Profile — filters by document type", async () => {
		const { GET } = await import("@/app/api/resources/route");
		const { status, body } = await callRoute(GET, "/api/resources?documentType=Company%20Profile");
		expect(status).toBe(200);
		expect(body.data.every((a: any) => a.current_version?.document_type === "Company Profile")).toBe(true);
		expect(body.data.some((a: any) => a.id === userResourceId)).toBe(true);
		expect(body.data.some((a: any) => a.id === approvedResourceId)).toBe(false);
	});

	it("GET /api/resources?approvedOnly=true — only approved", async () => {
		const { GET } = await import("@/app/api/resources/route");
		const { status, body } = await callRoute(GET, "/api/resources?approvedOnly=true");
		expect(status).toBe(200);
		expect(body.data.some((a: any) => a.id === approvedResourceId)).toBe(true);
		expect(body.data.some((a: any) => a.id === userResourceId)).toBe(false);
	});

	it("GET /api/resources — pagination works", async () => {
		const { GET } = await import("@/app/api/resources/route");
		const { status, body } = await callRoute(GET, "/api/resources?limit=1");
		expect(status).toBe(200);
		expect(body.data.length).toBe(1);
		expect(body.pagination.page).toBe(1);
		expect(body.pagination.totalPages).toBeGreaterThanOrEqual(2);
	});
});

// ---------------------------------------------------------------------------
// GET /api/resources/[key]
// ---------------------------------------------------------------------------

describe("resource by key", () => {
	it("GET /api/resources/:key — returns resource", async () => {
		const { GET } = await import("@/app/api/resources/[key]/route");
		const { status, body } = await callRoute(GET, "/api/resources/user-company.md", { key: "user-company.md" });
		expect(status).toBe(200);
		expect(body.id).toBe(userResourceId);
		expect(body.key).toBe("user-company.md");
	});

	it("GET /api/resources/:key?version=1 — returns specific version", async () => {
		const { GET } = await import("@/app/api/resources/[key]/route");
		const { status, body } = await callRoute(GET, "/api/resources/user-company.md?version=1", { key: "user-company.md" });
		expect(status).toBe(200);
		expect(body.proposed_version).toBeDefined();
		expect(body.proposed_version.version).toBe(1);
	});

	it("GET /api/resources/:key?version=999 — 404", async () => {
		const { GET } = await import("@/app/api/resources/[key]/route");
		const { status } = await callRoute(GET, "/api/resources/user-company.md?version=999", { key: "user-company.md" });
		expect(status).toBe(404);
	});

	it("GET /api/resources/nonexistent — 404", async () => {
		const { GET } = await import("@/app/api/resources/[key]/route");
		const { status } = await callRoute(GET, "/api/resources/nonexistent.md", { key: "nonexistent.md" });
		expect(status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// GET /api/projects/[projectId]/resources (project-scoped)
// ---------------------------------------------------------------------------

describe("project-scoped resources", () => {
	it("GET /api/projects/:pid/resources — lists imported resources", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/resources/route");
		const { status, body } = await callRoute(GET, `/api/projects/${projectId}/resources`, { projectId });
		expect(status).toBe(200);
		expect(body.data).toBeDefined();
		expect(body.pagination).toBeDefined();
		expect(body.data.some((a: any) => a.id === importedResourceId)).toBe(true);
		// User-scoped resources should NOT appear
		expect(body.data.some((a: any) => a.id === userResourceId)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/[projectId]/resources/[artifactId]
// ---------------------------------------------------------------------------

describe("remove project resource", () => {
	let removableResourceId: string;

	beforeAll(async () => {
		const em = await getTestEm();
		const project = await em.findOneOrFail(ProjectEntity, { id: projectId });
		const userA = await em.findOneOrFail(UserEntity, { clerkId: CLERK_ID_A });

		const res = em.create(ArtifactEntity, {
			key: "removable.md", title: "Removable", version: 1, project, user: userA,
			metadata: { importedFrom: "source-123" }, current_version: null!,
		});
		const rv1 = em.create(ArtifactVersionEntity, {
			artifact: res, version: 1, content: "removable", status: "approved", document_type: "Company Profile",
		});
		res.current_version = rv1;
		await em.persistAndFlush([res, rv1]);
		removableResourceId = res.id;
	});

	it("DELETE /api/projects/:pid/resources/:aid — removes resource", async () => {
		const { DELETE } = await import("@/app/api/projects/[projectId]/resources/[artifactId]/route");
		const { status, body } = await callRoute(
			DELETE,
			`/api/projects/${projectId}/resources/${removableResourceId}`,
			{ projectId, artifactId: removableResourceId },
			{ method: "DELETE" },
		);
		expect(status).toBe(200);
		expect(body.success).toBe(true);
	});

	it("DELETE same resource again — 404", async () => {
		const { DELETE } = await import("@/app/api/projects/[projectId]/resources/[artifactId]/route");
		const { status } = await callRoute(
			DELETE,
			`/api/projects/${projectId}/resources/${removableResourceId}`,
			{ projectId, artifactId: removableResourceId },
			{ method: "DELETE" },
		);
		expect(status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

describe("resource ownership", () => {
	it("user B cannot list user A's resources", async () => {
		setMockClerkUser({ userId: CLERK_ID_B });
		const { GET } = await import("@/app/api/resources/route");
		const { status, body } = await callRoute(GET, "/api/resources");
		expect(status).toBe(200);
		expect(body.data.length).toBe(0);
	});

	it("user B cannot get user A's resource by key", async () => {
		setMockClerkUser({ userId: CLERK_ID_B });
		const { GET } = await import("@/app/api/resources/[key]/route");
		const { status } = await callRoute(GET, "/api/resources/user-company.md", { key: "user-company.md" });
		expect(status).toBe(404);
	});

	it("user B cannot list user A's project resources", async () => {
		setMockClerkUser({ userId: CLERK_ID_B });
		const { GET } = await import("@/app/api/projects/[projectId]/resources/route");
		const { status, body } = await callRoute(GET, `/api/projects/${projectId}/resources`, { projectId });
		expect(status).toBe(200);
		expect(body.data.length).toBe(0);
	});

	it("user B cannot delete user A's project resource", async () => {
		setMockClerkUser({ userId: CLERK_ID_B });
		const { DELETE } = await import("@/app/api/projects/[projectId]/resources/[artifactId]/route");
		const { status } = await callRoute(
			DELETE,
			`/api/projects/${projectId}/resources/${importedResourceId}`,
			{ projectId, artifactId: importedResourceId },
			{ method: "DELETE" },
		);
		expect(status).toBe(404);
	});
});
