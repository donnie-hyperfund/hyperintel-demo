// Global test setup — runs before every test file.
// Add global mocks, custom matchers, or env setup here.
//
// Example: vi.mock("next/navigation", () => ({ ... }))
// Example: expect.extend({ toBeValidArtifact: ... })

process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_mock';
