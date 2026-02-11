import { withShared } from "./vitest.shared";

export default withShared({
	test: {
		name: "app",
		include: ["**/*.test.ts", "**/*.test.tsx"],
		exclude: ["**/*.integration.test.ts"],
	},
});
