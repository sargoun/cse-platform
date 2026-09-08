import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // D-04: serverless functions run in Frankfurt. Recorded here as well as in
  // the Vercel project so a reviewer can see the intent in the repository.
  env: { VERCEL_REGION: process.env['VERCEL_REGION'] ?? 'fra1' },
};

export default config;
