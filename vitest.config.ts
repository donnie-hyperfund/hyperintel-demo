import { withShared } from "./vitest.shared";

export default withShared({
	test: {
		projects: [
			"./vitest.unit.config.ts",
			"./vitest.integration.config.ts",
			"./vitest.e2e.config.ts",
			"./common/vitest.config.ts",
			"./common/vitest.integration.config.ts",
			"./workers/_common/vitest.config.ts",
			"./workers/*/vitest.config.ts",
		],
	},
});
