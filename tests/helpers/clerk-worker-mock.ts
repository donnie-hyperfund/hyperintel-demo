/**
 * Vitest mock for worker-side Clerk auth.
 *
 * Mocks `authenticateClerkRequest` and `assertClerkAuth` from
 * `workers/_common/vendor/clerk.ts` so Hono middleware-protected
 * routes can be tested with `app.request()` without real Clerk.
 *
 * Usage:
 *   import { setMockWorkerUser, clearMockWorkerUser, mockClerkWorker } from "@/tests/helpers/clerk-worker-mock";
 *
 *   mockClerkWorker(); // hoisted vi.mock
 *
 *   beforeEach(() => clearMockWorkerUser());
 *
 *   it("returns data for authed user", async () => {
 *     setMockWorkerUser({ userId: "user_abc" });
 *     const res = await app.request("/api/data");
 *     expect(res.status).toBe(200);
 *   });
 *
 *   it("returns 401 when unauthed", async () => {
 *     setMockWorkerUser(null);
 *     const res = await app.request("/api/data");
 *     expect(res.status).toBe(401);
 *   });
 *
 * NOTE: The middleware also calls `initInferredContext` which may set up ORM, etc.
 * You'll likely need to mock that separately. This mock only covers the Clerk auth layer.
 */

import type { ClerkUser } from "@/lib/types/clerk";
import { createMockClerkUser } from "./factories";

// --- State ---

let _mockUser: ClerkUser | null = createMockClerkUser();

/**
 * Set the user returned by `authenticateClerkRequest` / `assertClerkAuth`.
 * Pass `null` for unauthenticated.
 */
export function setMockWorkerUser(
	userOrOverrides: Partial<ClerkUser> | null,
): void {
	_mockUser =
		userOrOverrides === null
			? null
			: createMockClerkUser(userOrOverrides);
}

/** Reset to unauthenticated state. */
export function clearMockWorkerUser(): void {
	_mockUser = null;
}

// --- Module mock ---

export function mockClerkWorker() {
	vi.mock("@/workers/_common/vendor/clerk", () => ({
		authenticateClerkRequest: () =>
			Promise.resolve(
				_mockUser
					? { user: _mockUser }
					: { user: null, reason: "mock-no-user", status: "signed-out" },
			),
		assertClerkAuth: async () => {
			if (!_mockUser) {
				// Mirror the real implementation: throw a WorkerResponseAsError-like error
				const err = new Error("Unauthorized");
				(err as any).status = 401;
				throw err;
			}
			return _mockUser;
		},
		isClerkEnv: () => true,
		// Re-export the type so imports don't break
		ClerkUser: {},
	}));
}
