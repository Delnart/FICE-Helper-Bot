/** @type {import('next').NextConfig} */
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@fice/shared'],
  experimental: {
    typedRoutes: true,
  },
  // Skip the in-build TS + ESLint passes — they're the heaviest steps of
  // `next build` (~500 MB peak RAM) and we already run them as separate CI
  // steps locally (`npx tsc --noEmit` before each push). On a 1 GB VPS this
  // turns a 3-hour swap-thrashing build into ~5-10 min.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` },
    ];
  },
  async headers() {
    // Telegram Mini Apps render the page inside an iframe under web.telegram.org / t.me.
    // We drop X-Frame-Options (which would force SAMEORIGIN) and instead allow only
    // Telegram's domains via CSP frame-ancestors. Anything else is still blocked.
    const frameAncestors = [
      "'self'",
      'https://web.telegram.org',
      'https://k.web.telegram.org',
      'https://a.web.telegram.org',
      'https://telegram.org',
      'https://t.me',
    ].join(' ');
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${frameAncestors};`,
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
