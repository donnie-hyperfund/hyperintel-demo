/**
 * Vitest mock for @clerk/nextjs auth.
 *
 * Intercepts `auth()` from `@clerk/nextjs/server` so that
 * `assertClerkAuth()`, `assertAuth()`, and `withAuth()` work
 * without hitting real Clerk.
 *
 * Usage:
 *   import { setMockClerkUser, clearMockClerkUser } from "@/tests/helpers/clerk-mock";
 *
 *   beforeEach(() => clearMockClerkUser()); // reset between tests
 *
 *   it("authed", async () => {
 *     setMockClerkUser({ userId: "user_123" });
 *     const result = await assertClerkAuth();
 *     expect(result.userId).toBe("user_123");
 *   });
 *
 *   it("unauthed", async () => {
 *     setMockClerkUser(null);
 *     await expect(assertClerkAuth()).rejects.toThrow("Unauthorized");
 *   });
 *
 * NOTE: `assertAuth()` and `withAuth()` also look up a UserEntity in the DB.
 * You'll need to mock `@/lib/orm/orm` (`getOrm`) separately for those paths.
 * This mock only covers the Clerk auth layer.
 */

import type { ClerkUser } from "@/lib/types/clerk";
import { createMockClerkUser } from "./factories";

// --- State ---

let _mockUser: ClerkUser | null = createMockClerkUser();

/**
 * Set the user that `auth()` will return.
 * Pass `null` to simulate an unauthenticated request.
 * Pass partial overrides to merge with defaults.
 */
export function setMockClerkUser(
	userOrOverrides: Partial<ClerkUser> | null,
): void {
	_mockUser =
		userOrOverrides === null
			? null
			: createMockClerkUser(userOrOverrides);
}

/** Reset to unauthenticated state. */
export function clearMockClerkUser(): void {
	_mockUser = null;
}

// --- Module mock ---

/**
 * Call this in your test file (or vitest.setup.ts) to activate the mock.
 *
 * Must be called at the top level of the module (hoisted by vitest).
 */
export function mockClerkNextjs() {
	vi.mock("@clerk/nextjs/server", () => ({
		auth: () =>
			Promise.resolve({
				userId: _mockUser?.userId ?? null,
				sessionId: _mockUser?.sessionId ?? null,
				sessionClaims: _mockUser?.sessionClaims ?? null,
			}),
		currentUser: () => Promise.resolve(_mockUser ? { id: _mockUser.userId } : null),
		clerkMiddleware: () => (_req: unknown, _evt: unknown) => {},
	}));
}
