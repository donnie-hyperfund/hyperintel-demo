import { withShared } from "./vitest.shared";

export default withShared({
	test: {
		name: "app-unit",
		include: ["**/*.test.ts", "**/*.test.tsx"],
		exclude: ["**/*.integration.test.ts", "**/*.e2e.test.ts"],
	},
});
