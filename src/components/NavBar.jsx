import React from "react";
import { useMsal } from "@azure/msal-react";

export default function NavBar() {
  // useMsal gives us the MSAL instance (for calling logout)
  // and the list of authenticated accounts (usually just one for a SPA).
  const { instance, accounts } = useMsal();
  const account = accounts[0];

  const handleLogout = () => {
    // logoutRedirect clears the token cache and redirects to Microsoft's
    // logout endpoint, which also clears the Microsoft session cookie.
    instance.logoutRedirect();
  };

  return (
    <nav className="navbar">
      <div className="nav-brand">
        <svg width="22" height="22" viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg">
          <rect x="1"  y="1"  width="10" height="10" fill="#f25022" />
          <rect x="12" y="1"  width="10" height="10" fill="#7fba00" />
          <rect x="1"  y="12" width="10" height="10" fill="#00a4ef" />
          <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
        </svg>
        <span>MSAL Auth Lab</span>
      </div>

      <div className="nav-user">
        <span className="user-name">{account?.name}</span>
        <button className="btn-logout" onClick={handleLogout}>
          Sign Out
        </button>
      </div>
    </nav>
  );
}
