import React, { useState, useEffect } from "react";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { EventType } from "@azure/msal-browser";
import LoginPage from "./components/LoginPage";
import Dashboard from "./components/Dashboard";
import NavBar from "./components/NavBar";

export default function App() {
  // useIsAuthenticated reads from MSAL's cache to check if a valid account exists.
  const isAuthenticated = useIsAuthenticated();

  // useMsal gives us access to the MSAL instance and current accounts.
  const { instance } = useMsal();

  // We store the full auth result from the LOGIN_SUCCESS event.
  // This contains the raw ID token and access token strings we want to display.
  const [authResult, setAuthResult] = useState(null);

  useEffect(() => {
    // MSAL fires events throughout the auth lifecycle.
    // We listen for LOGIN_SUCCESS to capture the raw tokens
    // the moment Microsoft hands them back to us.
    const callbackId = instance.addEventCallback((event) => {
      if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
        setAuthResult(event.payload);
      }
    });

    // Clean up the listener when the component unmounts.
    return () => {
      if (callbackId) instance.removeEventCallback(callbackId);
    };
  }, [instance]);

  return (
    <div className="app">
      {isAuthenticated && <NavBar />}
      <main className="main-content">
        {isAuthenticated ? (
          <Dashboard authResult={authResult} />
        ) : (
          <LoginPage />
        )}
      </main>
    </div>
  );
}
