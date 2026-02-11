/**
 * Artifact endpoints never expose document content or ai_content.
 *
 * Calls route handlers directly with mocked Clerk auth + real DB.
 */

import { NextRequest } from "next/server";
import { getTestEm, clearDatabase, closeTestOrm } from "@/tests/helpers/db";
import { mockClerkNextjs, setMockClerkUser } from "@/tests/helpers/clerk-mock";
import { UserEntity } from "@/lib/orm/entities/users/user.entity";
import { ProjectEntity } from "@/lib/orm/entities/projects/project.entity";
import { ChatEntity } from "@/lib/orm/entities/chats/chat.entity";
import { ArtifactEntity } from "@/lib/orm/entities/artifacts/artifact.entity";
import { ArtifactVersionEntity } from "@/lib/orm/entities/artifacts/artifact-version.entity";

mockClerkNextjs();

const SECRET = "# SECRET BODY that must never reach the frontend.";
const AI_SECRET = "AI secret content.";
const CLERK_ID = "user_artifact_test";
let projectId: string;
let chatId: string;
let artifactId: string;
let artifactKey: string;

beforeAll(async () => {
	const em = await getTestEm();
	const user = em.create(UserEntity, { email: "artifact-test@t.com", emailConfirmed: true, clerkId: CLERK_ID });
	const project = em.create(ProjectEntity, { name: "P", user });
	const chat = em.create(ChatEntity, { phase: "chat", project });
	const artifact = em.create(ArtifactEntity, { key: "secret-doc.md", title: "Secret", version: 2, chat, project });
	const v1 = em.create(ArtifactVersionEntity, { artifact, version: 1, content: SECRET, ai_content: AI_SECRET, status: "approved" });
	const v2 = em.create(ArtifactVersionEntity, { artifact, version: 2, content: SECRET + "\nv2", ai_content: AI_SECRET + "\nv2", status: "proposed" });
	artifact.current_version = v1;
	await em.persistAndFlush([user, project, chat, artifact, v1, v2]);
	projectId = project.id;
	chatId = chat.id;
	artifactId = artifact.id;
	artifactKey = artifact.key;
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

describe("artifact content redaction", () => {
	it("GET /projects/:pid/artifacts — no content in list", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/artifacts/route");
		const res = await GET(req(`/api/projects/${projectId}/artifacts`), { params: Promise.resolve({ projectId }) });
		const json = await res.text();
		expect(res.status).toBe(200);
		expect(json).not.toContain(SECRET);
		expect(json).not.toContain(AI_SECRET);
	});

	it("GET /projects/:pid/artifacts?key=... — no content by key", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/artifacts/route");
		const res = await GET(req(`/api/projects/${projectId}/artifacts?key=${artifactKey}`), { params: Promise.resolve({ projectId }) });
		const json = await res.text();
		expect(res.status).toBe(200);
		expect(json).not.toContain(SECRET);
		expect(json).not.toContain(AI_SECRET);
	});

	it("GET /projects/:pid/artifacts/:aid — no content on single", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/artifacts/[artifactId]/route");
		const res = await GET(req(`/api/projects/${projectId}/artifacts/${artifactId}`), { params: Promise.resolve({ projectId, artifactId }) });
		const json = await res.text();
		expect(res.status).toBe(200);
		expect(json).not.toContain(SECRET);
		expect(json).not.toContain(AI_SECRET);
	});

	it("GET /projects/:pid/artifacts/:aid?version=1 — no content on loaded version", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/artifacts/[artifactId]/route");
		const res = await GET(req(`/api/projects/${projectId}/artifacts/${artifactId}?version=1`), { params: Promise.resolve({ projectId, artifactId }) });
		const json = await res.text();
		expect(res.status).toBe(200);
		expect(json).not.toContain(SECRET);
		expect(json).not.toContain(AI_SECRET);
	});

	it("GET /chats/:cid/artifacts — no content in chat artifact list", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/chats/[chatId]/artifacts/route");
		const res = await GET(req(`/api/projects/${projectId}/chats/${chatId}/artifacts`), { params: Promise.resolve({ projectId, chatId }) });
		const json = await res.text();
		expect(res.status).toBe(200);
		expect(json).not.toContain(SECRET);
		expect(json).not.toContain(AI_SECRET);
	});

	it("GET /chats/:cid/artifacts/:aid — no content on single chat artifact", async () => {
		const { GET } = await import("@/app/api/projects/[projectId]/chats/[chatId]/artifacts/[artifactId]/route");
		const res = await GET(req(`/api/projects/${projectId}/chats/${chatId}/artifacts/${artifactId}`), { params: Promise.resolve({ projectId, chatId, artifactId }) });
		const json = await res.text();
		expect(res.status).toBe(200);
		expect(json).not.toContain(SECRET);
		expect(json).not.toContain(AI_SECRET);
	});
});
