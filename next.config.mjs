import { withPostHogConfig } from '@posthog/nextjs-config';

let userConfig = undefined;
try {
    userConfig = await import('./v0-user-next.config');
} catch (e) {
    // ignore error
}
let TerserPlugin;
try {
    ({ default: TerserPlugin } = await import('terser-webpack-plugin'));
} catch {}
const isProd = !['development', 'preview'].includes(process.env.VERCEL_ENV);

const workerAlias = (() => {
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF) {
    return process.env.VERCEL_GIT_COMMIT_REF
      .replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  }
  return undefined;
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
    env: {
        NEXT_PUBLIC_CLOUDFLARE_ALIAS: workerAlias,
    },
    devIndicators: false,
    typescript: {
        ignoreBuildErrors: true,
    },
    images: {
        unoptimized: true,
    },
    reactStrictMode: false,
    experimental: {
        webpackBuildWorker: true,
        parallelServerBuildTraces: true,
        parallelServerCompiles: true,
    },
    serverExternalPackages: ['cloudflare:workers'],
    webpack(config, { isServer }) {
        // Cloudflare-specific modules — never bundled by Next.js
        // (pulled in via dynamic import in cf-env-secret-mock.ts → chat-stream-do.ts)
        if (isServer) {
            config.externals = config.externals || [];
            config.externals.push(/^cloudflare:/);
        }
        // Stub the local-dev mock module when NEXT_PUBLIC_LOCAL_WORKERS is not set.
        // The file is deleted on Vercel; without this alias, webpack fails to resolve the
        // static `import('@/lib/local/cf-env-secret-mock')` calls in queue adapters and
        // broadcast helpers — even though those branches are dead at runtime (DCE happens
        // after module resolution). Setting the alias to `false` makes webpack treat it as
        // an empty module, which is safe because the code path is never executed in prod.
        if (process.env.NEXT_PUBLIC_LOCAL_WORKERS !== 'true') {
            config.resolve.alias = {
                ...(config.resolve.alias || {}),
                '@/lib/local/cf-env-secret-mock': false,
            };
        }
        config.module.rules.push({
            test: /\.svg$/,
            use: ['@svgr/webpack'],
        });
        if (TerserPlugin) {
            config.optimization.minimize = true;
            config.optimization.minimizer = [
                new TerserPlugin({
                    terserOptions: {
                        keep_classnames: true,
                        keep_fnames: true,
                        mangle: {
                            keep_classnames: true,
                            keep_fnames: true,
                        },
                    },
                }),
            ];
        }
        return config;
    },
    async redirects() {
        return [
            {
                source: '/workspace',
                destination: '/launch-pad',
                permanent: true,
            },
            {
                source: '/select-project',
                destination: '/launch-pad',
                permanent: true,
            },
        ];
    },
    async headers() {
        return isProd
            ? []
            : [
                  {
                      source: '/',
                      headers: [
                          {
                              key: 'Access-Control-Allow-Origin',
                              value: process.env.VERCEL_URL,
                          },
                          {
                              key: 'Access-Control-Allow-Methods',
                              value: 'GET, OPTIONS',
                          },
                          {
                              key: 'Access-Control-Allow-Headers',
                              value: 'Content-Type, Authorization',
                          },
                      ],
                  },
              ];
    },
};

mergeConfig(nextConfig, userConfig);

function mergeConfig(nextConfig, userConfig) {
    if (!userConfig) {
        return;
    }

    for (const key in userConfig) {
        if (
            typeof nextConfig[key] === 'object' &&
            !Array.isArray(nextConfig[key])
        ) {
            nextConfig[key] = {
                ...nextConfig[key],
                ...userConfig[key],
            };
        } else {
            nextConfig[key] = userConfig[key];
        }
    }
}

export default withPostHogConfig(nextConfig, {
    personalApiKey: process.env.POSTHOG_PRIVATE_KEY,
    projectId: process.env.POSTHOG_PROJECT_ID,
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    sourcemaps: {
        enabled: true,
        deleteAfterUpload: true,
    },
});
