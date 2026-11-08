import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicClientApplication, EventType } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { loginRequest, msalConfig } from './config/msal';
import { TokenAuthProvider } from './context/TokenAuthContext';
import App from './App';
import './index.css';

const msalInstance = new PublicClientApplication(msalConfig);

// If this page was opened as an MSAL popup (acquireTokenPopup), the URL
// contains an auth response in the hash. Don't initialize the full app —
// the parent window's MSAL instance will read the popup URL and close it.
const isPopupResponse = !!window.opener && window.location.hash.includes('code=');

async function startApp() {
  if (isPopupResponse) return;

  await msalInstance.initialize();

  // Handle redirect responses (loginRedirect / acquireTokenRedirect).
  await msalInstance.handleRedirectPromise();

  let accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    msalInstance.setActiveAccount(accounts[0]);
  } else if (!sessionStorage.getItem('azure_access_token') && !localStorage.getItem('pendingLogin')) {
    try {
      const result = await msalInstance.ssoSilent({
        scopes: loginRequest.scopes,
        redirectUri: `${window.location.origin}/sso-silent.html`,
      });
      msalInstance.setActiveAccount(result.account);
      accounts = msalInstance.getAllAccounts();
    } catch {
      // Keep the existing interactive login page as the fallback.
    }
  }

  // Listen for sign-in events
  msalInstance.addEventCallback((event) => {
    if (
      event.eventType === EventType.LOGIN_SUCCESS &&
      event.payload &&
      typeof event.payload === 'object' &&
      'account' in event.payload &&
      event.payload.account
    ) {
      msalInstance.setActiveAccount(event.payload.account);
    }
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MsalProvider instance={msalInstance}>
        <TokenAuthProvider>
          <App />
        </TokenAuthProvider>
      </MsalProvider>
    </StrictMode>,
  );
}

void startApp();
