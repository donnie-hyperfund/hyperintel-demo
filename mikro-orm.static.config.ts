import { Options, GeneratedCacheAdapter } from '@mikro-orm/postgresql';
import { config as baseConfig } from './mikro-orm.config';
import ormdata from './lib/orm/metadata.json';

export const config: Options = {
    ...baseConfig,
    discovery: { disableDynamicFileAccess: true },
    metadataCache: {
        enabled: true,
        adapter: GeneratedCacheAdapter,
        options: { data: ormdata },
    },
};

export default config;
