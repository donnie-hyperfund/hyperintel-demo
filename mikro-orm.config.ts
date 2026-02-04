import 'dotenv/config';
import type { AnyEntity, EntityClass } from '@mikro-orm/core';
import { Options, PostgreSqlDriver, UnderscoreNamingStrategy } from '@mikro-orm/postgresql';
import * as entities from '@/lib/orm/entities';

class CustomUnderscoreNamingStrategy extends UnderscoreNamingStrategy {
    indexName(
        tableName: string,
        columns: string[],
        type: 'primary' | 'foreign' | 'unique' | 'index' | 'sequence' | 'check',
    ): string {
        if (tableName.includes('.')) {
            tableName = tableName.substring(tableName.indexOf('.') + 1);
        }
        if (type === 'foreign') {
            return `${tableName}_${columns.join('_')}_fk`;
        }
        return super.indexName(tableName, columns, type);
    }
}

const ssl = (process.env.DATABASE_USE_SSL ?? 'true') === 'true';

const filteredEntities = Object.entries(entities)
    .filter(([name, v]) => v && name.endsWith('Entity'))
    .map(([, v]) => v);
export const config: Options = {
    entities: filteredEntities as EntityClass<AnyEntity>[],
    clientUrl: process.env.DATABASE_URL,
    debug: false,
    allowGlobalContext: true,
    namingStrategy: CustomUnderscoreNamingStrategy,
    driver: PostgreSqlDriver,
    driverOptions: {
        connection: { ssl },
    },
};

export default config;
