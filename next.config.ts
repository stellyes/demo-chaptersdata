import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure server-side environment variables are available at runtime
  serverExternalPackages: ['@aws-sdk/client-s3', '@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'],
  // Enable compression for responses
  compress: true,
};

export default nextConfig;
