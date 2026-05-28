import React from "react";
import { useMsal } from "@azure/msal-react";
import { loginRequest } from "../authConfig";

// The Microsoft logo as an inline SVG so we have no extra dependencies.
function MicrosoftLogo({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg">
      <rect x="1"  y="1"  width="10" height="10" fill="#f25022" />
      <rect x="12" y="1"  width="10" height="10" fill="#7fba00" />
      <rect x="1"  y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}

export default function LoginPage() {
  const { instance } = useMsal();

  const handleLogin = () => {
    // loginRedirect sends the user to Microsoft's login page.
    // The loginRequest object tells Microsoft what scopes (permissions) we want.
    // After login, Microsoft redirects back to our redirectUri with an auth code.
    instance.loginRedirect(loginRequest);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <MicrosoftLogo size={52} />
        </div>

        <h1>Microsoft Authentication Lab</h1>
        <p className="subtitle">
          Sign in with your Microsoft account to see the full{" "}
          <strong>OAuth 2.0 + OpenID Connect</strong> flow in action — then
          inspect every token returned.
        </p>

        <div className="flow-explanation">
          <h3>What happens when you click Sign In:</h3>
          <ol>
            <li>
              <strong>Redirect</strong> — Your browser is sent to{" "}
              <code>login.microsoftonline.com</code>
            </li>
            <li>
              <strong>Authenticate</strong> — You enter your Microsoft credentials
            </li>
            <li>
              <strong>Authorization Code</strong> — Microsoft sends a short-lived,
              one-time code back to <code>http://localhost:3001</code>
            </li>
            <li>
              <strong>Token Exchange</strong> — MSAL automatically exchanges that
              code for tokens (you never see this happen)
            </li>
            <li>
              <strong>Tokens Received</strong> — You get an{" "}
              <strong>ID Token</strong> (who you are) and an{" "}
              <strong>Access Token</strong> (what you can access)
            </li>
          </ol>
        </div>

        <button className="btn-microsoft" onClick={handleLogin}>
          <MicrosoftLogo size={20} />
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}
