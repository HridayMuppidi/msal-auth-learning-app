import React, { useState, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import { loginRequest } from "../authConfig";
import TokenDisplay from "./TokenDisplay";
import WeatherTab from "./WeatherTab";

export default function Dashboard({ authResult }) {
  const { instance, accounts } = useMsal();
  const account = accounts[0];

  const [accessToken, setAccessToken]   = useState(null);
  const [rawIdToken, setRawIdToken]     = useState(authResult?.idToken || null);
  const [tokenError, setTokenError]     = useState(null);
  const [activeTab, setActiveTab]       = useState("profile");

  useEffect(() => {
    if (!account) return;

    // acquireTokenSilent tries to get tokens from the cache first,
    // then silently refreshes them in a hidden iframe if they're expired.
    // No user interaction needed — this is the "silent" flow.
    instance
      .acquireTokenSilent({ ...loginRequest, account })
      .then((res) => {
        setAccessToken(res.accessToken);
        // If the page was refreshed (no LOGIN_SUCCESS event fired),
        // the silent response still gives us the raw ID token.
        if (!rawIdToken && res.idToken) setRawIdToken(res.idToken);
      })
      .catch((err) => setTokenError(err.message));
  }, [instance, account]);

  // idTokenClaims is already decoded by MSAL and attached to the account object.
  // It contains the same data as decoding the raw ID token yourself.
  const idTokenClaims = account?.idTokenClaims;

  const tabs = [
    { id: "profile",      label: "User Profile" },
    { id: "id-token",     label: "ID Token" },
    { id: "access-token", label: "Access Token" },
    { id: "weather",      label: "🌤️ Weather" },
  ];

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Authentication Successful!</h1>
        <p className="success-message">
          Signed in as <strong>{account?.name}</strong> ({account?.username})
        </p>
      </div>

      <div className="tab-bar">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab-btn${activeTab === t.id ? " active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {activeTab === "profile" && (
          <ProfileTab account={account} claims={idTokenClaims} />
        )}

        {activeTab === "id-token" && (
          <TokenDisplay
            rawToken={rawIdToken}
            decodedClaims={idTokenClaims}
            explanation="The ID Token proves WHO you are. It's issued by Microsoft's identity platform and tells your app the user's identity — name, email, unique ID, which tenant they belong to, and how they authenticated."
            claimExplanations={ID_TOKEN_CLAIM_NOTES}
          />
        )}

        {activeTab === "access-token" && (
          <TokenDisplay
            rawToken={accessToken}
            explanation="The Access Token proves WHAT you can access. You attach this as a Bearer token in the Authorization header when calling Microsoft Graph API. It tells the API exactly what permissions your app has been granted."
            claimExplanations={ACCESS_TOKEN_CLAIM_NOTES}
            error={tokenError}
          />
        )}

        {activeTab === "weather" && <WeatherTab />}
      </div>
    </div>
  );
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab({ account, claims }) {
  const rows = [
    { icon: "👤", label: "Display Name",       value: account?.name },
    { icon: "📧", label: "Email / UPN",         value: account?.username },
    { icon: "🔑", label: "Object ID (oid)",     value: claims?.oid },
    { icon: "🏢", label: "Tenant ID (tid)",     value: claims?.tid },
    { icon: "🕐", label: "Token Issued At",      value: claims?.iat ? new Date(claims.iat * 1000).toLocaleString() : null },
    { icon: "⏰", label: "Token Expires",        value: claims?.exp ? new Date(claims.exp * 1000).toLocaleString() : null },
    { icon: "🔐", label: "Auth Methods (amr)",  value: Array.isArray(claims?.amr) ? claims.amr.join(", ") : claims?.amr },
    { icon: "🏷️", label: "Preferred Username",  value: claims?.preferred_username },
  ];

  return (
    <div className="profile-tab">
      <div className="profile-grid">
        {rows.map(({ icon, label, value }) => (
          <div key={label} className="profile-card">
            <span className="profile-icon">{icon}</span>
            <div>
              <div className="profile-label">{label}</div>
              <div className="profile-value">{value || "N/A"}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Claim Explanations ───────────────────────────────────────────────────────
// Click any claim in the token view to see what it means.

const ID_TOKEN_CLAIM_NOTES = {
  aud: "Audience — the Client ID of YOUR app. Microsoft puts this here so your app can confirm the token was issued specifically for it, not for someone else's app.",
  iss: "Issuer — who created and signed this token. Always Microsoft's identity platform URL for Azure AD tokens.",
  iat: "Issued At — Unix timestamp (seconds since Jan 1 1970) of when Microsoft created this token.",
  nbf: "Not Before — the token is invalid if used before this Unix timestamp. Usually the same as 'iat'.",
  exp: "Expiration — Unix timestamp when this token expires. ID tokens typically last 1 hour.",
  name: "The user's display name as configured in Azure AD (e.g. 'Jane Smith').",
  oid: "Object ID — a unique, permanent ID for this user inside Azure AD. This NEVER changes, even if the user's email or name changes. Use this as your primary user key in a database.",
  preferred_username: "The user's primary login identifier — usually their email address or UPN.",
  sub: "Subject — a unique ID for this user scoped to your specific app. Different apps get different 'sub' values for the same user (unlike 'oid' which is global).",
  tid: "Tenant ID — identifies which Azure AD organization (tenant/company) this user belongs to.",
  ver: "Token version — '1.0' or '2.0'. The version is determined by the authority URL you configured.",
  amr: "Authentication Methods References — how the user proved their identity. Common values: 'pwd' = password, 'mfa' = multi-factor authentication, 'rsa' = certificate.",
  nonce: "A random string your app generated and sent with the login request. Microsoft echoes it back. Your app checks it matches to prevent replay attacks (someone reusing an old login response).",
  aio: "Azure Internal Only — an opaque string used by Microsoft for internal token tracking. You can safely ignore this.",
  rh:  "Routing Hint — internal Microsoft value used during token validation. You can safely ignore this.",
  uti: "Unique Token Identifier — a short ID for this specific token, used for Microsoft's internal tracing and debugging.",
  email: "The user's email address as stored in Azure AD.",
  acct: "Account type — 0 = work or school account, 1 = personal Microsoft account (Outlook, Xbox, etc).",
};

const ACCESS_TOKEN_CLAIM_NOTES = {
  aud: "Audience — who this token is FOR (the resource/API). For Microsoft Graph API tokens, this is 'https://graph.microsoft.com'. The Graph API rejects tokens with a different audience.",
  iss: "Issuer — who created and signed this token (Microsoft's Secure Token Service).",
  iat: "Issued At — Unix timestamp of when this token was issued.",
  nbf: "Not Before — the token is invalid before this timestamp.",
  exp: "Expiration — Unix timestamp when this token expires. Access tokens typically expire in 1 hour. MSAL automatically refreshes them silently before they expire.",
  oid: "Object ID — the unique ID for this user in Azure AD. Same value as in the ID Token.",
  sub: "Subject — unique user ID scoped to the resource being accessed.",
  tid: "Tenant ID — which Azure AD organization the user belongs to.",
  scp: "Scopes — the specific permissions this token grants. e.g. 'User.Read profile email openid'. The API checks this to decide what the caller is allowed to do.",
  roles: "App Roles — role-based permissions explicitly assigned to this user or application in the Azure portal.",
  appid: "Application ID — the Client ID of the app that requested this token (your app's client ID).",
  name: "The user's display name.",
  upn: "User Principal Name — the user's primary Azure AD identifier (their login email).",
  unique_name: "Same as UPN — the user's unique login name in Azure AD.",
  ver: "Token version — '1.0' or '2.0'.",
  aio: "Azure Internal Only — internal tracking. Safe to ignore.",
  rh:  "Routing Hint — internal Microsoft validation value. Safe to ignore.",
  uti: "Unique Token Identifier — used for Microsoft's internal tracing.",
};
