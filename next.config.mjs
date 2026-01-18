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

/** @type {import('next').NextConfig} */
const nextConfig = {
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
    productionBrowserSourceMaps: true,
    webpack(config, { dev, isServer }) {
        if (!dev /*&& !isServer*/) {
            config.devtool = 'source-map';
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

export default nextConfig;
