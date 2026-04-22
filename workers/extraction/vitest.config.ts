import path from "node:path";
import { withShared } from "../../vitest.shared";

export default withShared({
	resolve: {
		alias: {
			"cloudflare:workers": path.resolve(import.meta.dirname, "../../common/common/local.do-mock"),
			"stripe": path.resolve(import.meta.dirname, "../_common/vendor/stubs/stripe.ts"),
			"@supabase/supabase-js": path.resolve(import.meta.dirname, "../_common/vendor/stubs/supabase-js.ts"),
			"@sendgrid/mail": path.resolve(import.meta.dirname, "../_common/vendor/stubs/sendgrid-mail.ts"),
			"@cerebras/cerebras_cloud_sdk": path.resolve(import.meta.dirname, "../_common/vendor/stubs/cerebras.ts"),
		},
	},
	test: {
		name: "workers-extraction",
		globals: true,
		root: import.meta.dirname,
		include: ["**/*.test.ts"],
		exclude: ["**/node_modules/**"],
	},
});
