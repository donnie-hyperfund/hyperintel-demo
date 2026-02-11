import dotenv from "dotenv";
import path from "node:path";
import { defineConfig, mergeConfig, type UserConfig } from "vitest/config";

dotenv.config({ path: ".env.test" });

const root = import.meta.dirname;

const sharedConfig = defineConfig({
	resolve: {
		alias: {
			"@": root,
			"@common": path.resolve(root, "common"),
			"@worker": path.resolve(root, "workers/_common"),
		},
	},
	test: {
		globals: true,
		setupFiles: ["./vitest.setup.ts"],
		exclude: [
			"**/common/**",
			"**/workers/**",
			"**/tests/pw/**",
			"**/node_modules/**",
		],
		coverage: {
			provider: "v8",
			include: ["app/**", "lib/**"],
			exclude: [
				"**/*.test.ts",
				"**/*.test.tsx",
				"**/*.integration.test.ts",
				"**/*.e2e.test.ts",
				"**/tests/**",
			],
		},
	},
});

export const withShared = (config: UserConfig) => mergeConfig(sharedConfig, config);
