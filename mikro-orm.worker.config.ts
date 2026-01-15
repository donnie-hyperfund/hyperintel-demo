import { Options } from '@mikro-orm/postgresql';
import { config as baseConfig } from './mikro-orm.config';

export const config: Options = {
    dbName: 'neondb',
    ...baseConfig,
    allowGlobalContext: true,
    pool: {
        min: 1,
        max: 1,
    },
    disableTransactions: true,
    discovery: { disableDynamicFileAccess: true },
};

export default config;
