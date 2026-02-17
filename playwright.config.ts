import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/pw",
	outputDir: "./tests/pw/.results",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI
		? [["html", { open: "never" }], ["list"]]
		: "list",

	use: {
		baseURL: process.env.BASE_URL || "http://localhost:3000",
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},

	projects: [
		{
			name: "setup",
			testMatch: /auth\.setup\.ts/,
		},
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				storageState: "tests/pw/.auth/user.json",
			},
			dependencies: ["setup"],
		},
	],

	webServer: process.env.CI
		? undefined
		: {
				command: "pnpm dev",
				url: "http://localhost:3000",
				reuseExistingServer: true,
			},
});
