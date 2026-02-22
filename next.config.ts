import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure server-side environment variables are available at runtime
  serverExternalPackages: ['@aws-sdk/client-s3', '@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb', '@aws-sdk/client-secrets-manager', '@aws-sdk/credential-providers', '@anthropic-ai/sdk'],
  // Enable compression for responses
  compress: true,
  // Increase API body size limit for large data payloads
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
