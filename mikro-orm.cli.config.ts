import { Options } from '@mikro-orm/core';
import { config as baseConfig } from './mikro-orm.config';
import { SqlHighlighter } from '@mikro-orm/sql-highlighter';
import { EntityGenerator } from '@mikro-orm/entity-generator';
import { Migrator } from '@mikro-orm/migrations';

export const config: Options = {
    ...baseConfig,
    // Use direct connection for migrations (not pooler)
    clientUrl: process.env.DATABASE_MIGRATE_URL || process.env.DATABASE_URL,
    allowGlobalContext: true,
    discovery: { disableDynamicFileAccess: true },
    highlighter: new SqlHighlighter(),
    extensions: [Migrator, EntityGenerator],
    // debug: true,
    migrations: {
        safe: true,
        dropTables: false,
        transactional: true,
    },
    metadataCache: { options: { cacheDir: 'lib/orm/' } },
};

export default config;
