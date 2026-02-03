import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Performance optimizations
  reactStrictMode: true,

  // Optimize images
  images: {
    formats: ['image/avif', 'image/webp'],
  },

  // Production optimizations
  compress: true,

  // Turbopack is enabled by default in Next.js 16
  // Add empty turbopack config to silence warnings
  turbopack: {},
};

export default nextConfig;
