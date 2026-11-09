import type { Configuration, PopupRequest } from '@azure/msal-browser';

const customClientId = localStorage.getItem('customClientId') || '';
const defaultTenant = (import.meta.env.VITE_AZURE_TENANT_ID ?? '').trim();

export const msalConfig: Configuration = {
  auth: {
    clientId: customClientId || (import.meta.env.VITE_AZURE_CLIENT_ID ?? ''),
    authority: `https://login.microsoftonline.com/${defaultTenant || 'organizations'}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
  system: {
    allowRedirectInIframe: true,
  },
};

export const loginRequest: PopupRequest = {
  scopes: ['https://management.azure.com/user_impersonation'],
};

export const managementScope = 'https://management.azure.com/.default';
