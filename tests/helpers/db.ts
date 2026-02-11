/**
 * Database utilities for e2e/integration tests.
 *
 * Uses the real DATABASE_URL from env. Tests that need DB should
 * skipIf(!process.env.DATABASE_URL).
 */

import { EntityManager, MikroORM } from "@mikro-orm/postgresql";

let orm: MikroORM | null = null;

/** Get (or init) a shared MikroORM instance for tests. */
export async function getTestOrm(): Promise<MikroORM> {
	if (orm) return orm;
	// Dynamic import so vitest can resolve aliases
	const { default: config } = await import("@/mikro-orm.config");
	orm = await MikroORM.init({ ...config, allowGlobalContext: true });
	return orm;
}

/** Get a forked EntityManager. */
export async function getTestEm(): Promise<EntityManager> {
	const o = await getTestOrm();
	return o.em.fork();
}

/** Truncate all application tables. Call in beforeEach. */
export async function clearDatabase() {
	const o = await getTestOrm();
	const em = o.em.fork();

	const tables: { tablename: string }[] = await em.execute(`
		SELECT tablename FROM pg_tables
		WHERE schemaname = 'public' AND tablename != 'mikro_orm_migrations'
	`);

	if (tables.length === 0) return;

	const names = tables.map((t) => `"${t.tablename}"`).join(", ");
	await em.execute(`TRUNCATE ${names} CASCADE`);
}

/** Close the shared ORM connection. Call in afterAll of root suite. */
export async function closeTestOrm() {
	if (orm) {
		await orm.close(true);
		orm = null;
	}
}
