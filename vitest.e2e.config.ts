import { withShared } from "./vitest.shared";

export default withShared({
	test: {
		name: "app-e2e",
		include: ["**/*.e2e.test.ts"],
		testTimeout: 15_000,
		hookTimeout: 30_000,
		fileParallelism: false,
	},
});
