/**
 * VersionStatus type includes 'deleted' and is consistent across entity + schema.
 *
 * Verifies single source of truth: VERSION_STATUSES array drives both
 * the entity type and the Zod schema.
 */

import { VERSION_STATUSES } from "@/lib/orm/entities/artifacts/artifact-version.entity";
import { VersionStatusSchema } from "@/lib/schema/artifact";

describe("VERSION_STATUSES", () => {
	it("includes all expected statuses", () => {
		expect(VERSION_STATUSES).toContain("proposed");
		expect(VERSION_STATUSES).toContain("approved");
		expect(VERSION_STATUSES).toContain("rejected");
		expect(VERSION_STATUSES).toContain("superseded");
		expect(VERSION_STATUSES).toContain("deleted");
	});
});

describe("VersionStatusSchema (Zod) matches VERSION_STATUSES", () => {
	it.each([...VERSION_STATUSES])("accepts '%s'", (status) => {
		expect(VersionStatusSchema.safeParse(status).success).toBe(true);
	});

	it("rejects unknown status", () => {
		expect(VersionStatusSchema.safeParse("nonexistent").success).toBe(false);
	});

	it("has same values as VERSION_STATUSES", () => {
		expect(VersionStatusSchema.options).toEqual([...VERSION_STATUSES]);
	});
});
