import { withShared } from "./vitest.shared";

export default withShared({
	test: {
		name: "app-e2e",
		include: ["**/*.e2e.test.ts"],
	},
});
