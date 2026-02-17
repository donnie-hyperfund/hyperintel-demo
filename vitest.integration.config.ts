import { withShared } from "./vitest.shared";

export default withShared({
	test: {
		name: "app-integration",
		include: ["**/*.integration.test.ts"],
		fileParallelism: false,
	},
});
