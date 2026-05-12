import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@worker": path.resolve(import.meta.dirname, "../_common"),
			"@common": path.resolve(import.meta.dirname, "../../common"),
			"@": path.resolve(import.meta.dirname, "../.."),
		},
	},
	test: {
		name: "workers-embedding",
		globals: true,
		root: import.meta.dirname,
		include: ["**/*.test.ts"],
		exclude: ["**/node_modules/**"],
	},
});
