import { LogLevel, PublicClientApplication } from "@azure/msal-browser";

// ─── MSAL Configuration Object ───────────────────────────────────────────────
// This is the single object that tells MSAL everything it needs to know
// about YOUR app registration in Azure AD.
export const msalConfig = {
  auth: {
    // clientId: The unique ID of your app registration in Azure AD.
    // Every app registered in Azure gets one of these.
    clientId: import.meta.env.VITE_CLIENT_ID,

    // authority: The URL that MSAL will contact to authenticate users.
    // Format: https://login.microsoftonline.com/<tenantId>
    // The tenant ID tells Azure "only users from THIS organization can log in."
    // Using "common" instead of a tenant ID would allow ANY Microsoft account.
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_TENANT_ID}`,

    // redirectUri: After a successful login, Microsoft sends the user BACK
    // to this exact URL (with the auth code in the query string).
    // This MUST match what Joe registered in the Azure portal exactly.
    redirectUri: import.meta.env.VITE_REDIRECT_URI || "http://localhost:3001",

    // postLogoutRedirectUri: Where to send the user after they log out.
    postLogoutRedirectUri: import.meta.env.VITE_REDIRECT_URI || "http://localhost:3001",
  },

  cache: {
    // cacheLocation: Where MSAL stores the tokens after login.
    // "sessionStorage" = tokens are cleared when the browser tab closes (safer).
    // "localStorage"   = tokens survive browser restarts (more persistent).
    cacheLocation: "sessionStorage",

    // storeAuthStateInCookie: Set to true only if you need IE11/Edge Legacy support.
    // False is fine for modern browsers.
    storeAuthStateInCookie: false,
  },

  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        // containsPii = contains Personally Identifiable Information — never log that
        if (containsPii) return;
        switch (level) {
          case LogLevel.Error:   console.error(message); break;
          case LogLevel.Warning: console.warn(message);  break;
          case LogLevel.Info:    console.info(message);  break;
          case LogLevel.Verbose: console.debug(message); break;
        }
      },
      logLevel: LogLevel.Warning,
    },
  },
};

// ─── Login Request ────────────────────────────────────────────────────────────
// This object defines WHAT we are asking Microsoft for when the user logs in.
// "scopes" = the list of permissions we want the user to consent to.
export const loginRequest = {
  scopes: [
    "openid",    // Required for OpenID Connect — gives us the ID Token
    "profile",   // Includes name, preferred_username in the ID Token
    "email",     // Includes email address in the token
    "User.Read", // Permission to call Microsoft Graph API to read the user's profile
  ],
};

// ─── MSAL Instance ────────────────────────────────────────────────────────────
// We create ONE instance of PublicClientApplication and share it everywhere.
// "Public" = a client app that cannot keep secrets (no server-side secret storage).
// This is the correct type for SPAs and mobile apps.
export const msalInstance = new PublicClientApplication(msalConfig);
