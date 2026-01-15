import { GeneratedCacheAdapter, Options } from '@mikro-orm/postgresql';
import ormdata from './lib/orm/metadata.json';
import { config as baseConfig } from './mikro-orm.config';

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
