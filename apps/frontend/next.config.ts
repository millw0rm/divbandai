import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@divband/backend', '@divband/auth'],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
