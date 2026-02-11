/**
 * Playwright auth setup — log in once, save session, reuse across tests.
 *
 * Uses Playwright's `storageState` pattern:
 * 1. This setup project runs first (configured in playwright.config.ts)
 * 2. It authenticates with Clerk and saves cookies/localStorage to .auth/user.json
 * 3. All other test projects load that storageState automatically
 *
 * ## Environment variables required:
 *   E2E_CLERK_EMAIL    — test account email
 *   E2E_CLERK_PASSWORD — test account password
 *
 * ## Clerk sign-in flow:
 * Clerk renders its own sign-in UI (either embedded or redirected).
 * The selectors below target Clerk's standard sign-in component.
 * If your Clerk UI customization changes these, update the selectors.
 *
 * ## Alternative: manual cookie fixture
 * If Clerk uses CAPTCHA or other bot protection that blocks automated login:
 * 1. Log in manually in a browser
 * 2. Open DevTools → Application → Cookies, copy all cookies
 * 3. Save as tests/pw/.auth/user.json in Playwright's storageState format:
 *    { "cookies": [...], "origins": [...] }
 * 4. Skip this setup project in playwright.config.ts (remove from deps)
 */

import { test as setup, expect } from "@playwright/test";
import path from "node:path";

const authFile = path.join(import.meta.dirname, ".auth", "user.json");

setup("authenticate", async ({ page }) => {
	const email = process.env.E2E_CLERK_EMAIL;
	const password = process.env.E2E_CLERK_PASSWORD;

	if (!email || !password) {
		throw new Error(
			"E2E_CLERK_EMAIL and E2E_CLERK_PASSWORD must be set. " +
				"See tests/pw/auth.setup.ts for details.",
		);
	}

	// Navigate to sign-in page
	await page.goto("/sign-in");

	// Clerk's sign-in component renders these inputs
	// These selectors work with Clerk's default <SignIn /> component
	await page.getByLabel("Email address").fill(email);
	await page.getByRole("button", { name: "Continue" }).click();

	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Continue" }).click();

	// Wait for redirect after successful login — adjust URL if your app
	// redirects to a different page after sign-in
	await page.waitForURL("/", { timeout: 15_000 });

	// Verify we're logged in
	await expect(page).not.toHaveURL(/sign-in/);

	// Save auth state for reuse
	await page.context().storageState({ path: authFile });
});
