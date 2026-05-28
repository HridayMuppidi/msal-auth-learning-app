import React from "react";
import ReactDOM from "react-dom/client";
import { MsalProvider } from "@azure/msal-react";
import { msalInstance } from "./authConfig";
import App from "./App";
import "./index.css";

// initialize() MUST be called before any other MSAL operations.
// It processes the redirect response from Microsoft (the auth code in the URL)
// before React even renders for the first time.
// This is what completes the OAuth "authorization code" exchange automatically.
msalInstance.initialize().then(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      {/*
        MsalProvider makes the MSAL instance available to every component
        in the tree via React Context. It also subscribes to auth events
        and keeps the UI in sync with the current auth state.
        This is why it wraps the entire App.
      */}
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </React.StrictMode>
  );
});
