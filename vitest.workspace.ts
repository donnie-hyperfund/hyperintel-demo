import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
	"./vitest.config.ts",
	"./vitest.integration.config.ts",
	"./vitest.e2e.config.ts",
	"./common/vitest.config.ts",
	"./common/vitest.integration.config.ts",
	"./workers/_common/vitest.config.ts",
	"./workers/*/vitest.config.ts",
]);
