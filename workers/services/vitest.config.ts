import path from 'node:path';
import { withShared } from '../../vitest.shared';

export default withShared({
    resolve: {
        alias: {
            'cloudflare:workers': path.resolve(import.meta.dirname, '../../common/common/local.do-mock'),
            '@worker': path.resolve(import.meta.dirname, '../_common'),
            '@common': path.resolve(import.meta.dirname, '../../common'),
            '@': path.resolve(import.meta.dirname, '../..'),
        },
    },
    test: {
        name: 'workers-services',
        globals: true,
        root: import.meta.dirname,
        include: ['**/*.test.ts'],
        exclude: ['**/node_modules/**'],
    },
});
