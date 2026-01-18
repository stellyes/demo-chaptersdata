'use client';

import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { CookieStorage } from 'aws-amplify/utils';

const region = process.env.NEXT_PUBLIC_AWS_REGION || 'us-west-1';
const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || '';
const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '';
const identityPoolId = process.env.NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID || '';

let isConfiguredFlag = false;

// Get the cookie domain for cross-subdomain SSO
function getCookieDomain(): string {
  if (typeof window === 'undefined') return 'localhost';

  const hostname = window.location.hostname;

  // For production, use .chaptersdata.com to share cookies across subdomains
  if (hostname.endsWith('chaptersdata.com')) {
    return '.chaptersdata.com';
  }

  // For localhost development
  return hostname;
}

export function configureAmplify() {
  if (!hasAmplifyCredentials() || isConfiguredFlag) {
    return;
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        identityPoolId,
        loginWith: {
          email: true,
        },
      },
    },
  });

  // Use cookie storage for cross-subdomain SSO
  cognitoUserPoolsTokenProvider.setKeyValueStorage(new CookieStorage({
    domain: getCookieDomain(),
    path: '/',
    expires: 30, // days
    secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
    sameSite: 'lax',
  }));

  isConfiguredFlag = true;
}

// Check if Amplify credentials are available
export function hasAmplifyCredentials(): boolean {
  return !!(userPoolId && userPoolClientId);
}

// Check if Amplify is configured (for backward compatibility)
export function isAmplifyConfigured(): boolean {
  return hasAmplifyCredentials();
}

// Get Cognito configuration for debugging
export function getCognitoConfig() {
  return {
    region,
    userPoolId,
    userPoolClientId,
    identityPoolId,
    isConfigured: hasAmplifyCredentials(),
  };
}
