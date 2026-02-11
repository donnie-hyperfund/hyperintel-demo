import type { ClerkUser } from "@/lib/types/clerk";

let counter = 0;

function randomId() {
	return `${Date.now()}_${++counter}`;
}

export function createMockClerkUser(
	overrides?: Partial<ClerkUser>,
): ClerkUser {
	return {
		userId: `user_${randomId()}`,
		sessionId: `sess_${randomId()}`,
		sessionClaims: {},
		...overrides,
	};
}
