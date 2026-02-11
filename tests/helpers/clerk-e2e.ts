/**
 * Real Clerk auth for e2e tests.
 *
 * Uses @clerk/backend + CLERK_SECRET_KEY to create test users,
 * sessions, and JWT tokens. Each `createTestClerkUser()` call
 * returns an isolated handle — no global state.
 *
 * Requirements:
 *   - CLERK_SECRET_KEY env var (dev instance)
 *   - Running Next.js dev server
 */

import { createClerkClient } from "@clerk/backend";

let _client: ReturnType<typeof createClerkClient>;

function getClient() {
	if (!_client) {
		_client = createClerkClient({
			secretKey: process.env.CLERK_SECRET_KEY!,
		});
	}
	return _client;
}

export interface TestClerkUser {
	/** Clerk user ID — use as `clerkId` when seeding UserEntity. */
	clerkId: string;
	/** Get a fresh JWT (tokens expire in 60s). */
	getToken(): Promise<string>;
	/** Authenticated fetch — injects Bearer token. */
	fetch(url: string, init?: RequestInit): Promise<Response>;
	/** Delete this user from Clerk (revokes sessions). */
	cleanup(): Promise<void>;
}

let counter = 0;

/**
 * Create a real Clerk user + session. Returns an isolated handle
 * with its own `getToken`, `fetch`, and `cleanup`.
 */
export async function createTestClerkUser(
	email?: string,
): Promise<TestClerkUser> {
	const client = getClient();
	const addr = email ?? `e2e-test-${Date.now()}-${++counter}@hyperintel-test.com`;

	// Find or create
	const existing = await client.users.getUserList({ emailAddress: [addr] });
	const clerkId =
		existing.data.length > 0
			? existing.data[0].id
			: (await client.users.createUser({ emailAddress: [addr], skipPasswordRequirement: true })).id;

	const session = await client.sessions.createSession({ userId: clerkId });
	const sessionId = session.id;

	async function getToken() {
		return (await client.sessions.getToken(sessionId)).jwt;
	}

	async function authFetch(url: string, init?: RequestInit) {
		const token = await getToken();
		const existingCookie = (init?.headers as Record<string, string>)?.cookie ?? "";
		return fetch(url, {
			...init,
			headers: {
				...init?.headers,
				Authorization: `Bearer ${token}`,
				cookie: `__session=${token}${existingCookie ? `; ${existingCookie}` : ""}`,
			},
		});
	}

	async function cleanup() {
		try {
			await client.users.deleteUser(clerkId);
		} catch {
			// Already deleted
		}
	}

	return { clerkId, getToken, fetch: authFetch, cleanup };
}
