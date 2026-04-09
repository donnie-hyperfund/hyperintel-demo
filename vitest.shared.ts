import dotenv from "dotenv";
import path from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
// @ts-expect-error vitest v4 renamed UserConfig to TestUserConfig
import type { UserConfig } from "vitest/config";

dotenv.config({ path: path.resolve(import.meta.dirname, ".env.test"), override: true });

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
		setupFiles: [path.resolve(root, "vitest.setup.ts")],
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
