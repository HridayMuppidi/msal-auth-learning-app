import React, { useState } from "react";
import { useMsal } from "@azure/msal-react";
import { loginRequest, weatherApiRequest } from "../authConfig";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function WeatherTab() {
  const { instance, accounts } = useMsal();
  const account = accounts[0];

  const [zipcode,   setZipcode  ] = useState("");
  const [weather,   setWeather  ] = useState(null);
  const [loading,   setLoading  ] = useState(false);
  const [error,     setError    ] = useState(null);
  const [tokenInfo, setTokenInfo] = useState(null);   // what token was used

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setWeather(null);
    setTokenInfo(null);

    try {
      // ── Step 1: Acquire an access token ───────────────────────────────────
      //
      // WHAT TOKEN IS SENT?
      //   tokenResponse.accessToken  ← THIS is the access token. NOT the ID token.
      //   tokenResponse.idToken      ← This is the ID token (NOT sent to the API).
      //
      // The access token is what you put in the Authorization: Bearer header.
      // It tells the API what you are allowed to do (scopes/permissions).
      // The ID token is only for YOUR app to know who the user is.
      //
      // WHICH SCOPE IS REQUESTED?
      //   We try weatherApiRequest first → scopes: ["api://clientId/Weather.Read"]
      //   This would produce a token with aud = your client ID (ideal for FastAPI).
      //   If Joe hasn't configured that scope in Azure portal, MSAL throws an error.
      //   We catch it and fall back to loginRequest → User.Read (Graph-scoped token).
      //
      let tokenResponse;
      let tokenType;
      let scopeUsed;

      try {
        tokenResponse = await instance.acquireTokenSilent({
          ...weatherApiRequest,
          account,
        });
        tokenType = "api-scoped";
        scopeUsed = weatherApiRequest.scopes[0];
      } catch {
        // Custom API scope not configured in Azure portal yet — fall back to Graph token
        tokenResponse = await instance.acquireTokenSilent({
          ...loginRequest,
          account,
        });
        tokenType = "graph-scoped (fallback)";
        scopeUsed = "User.Read (Microsoft Graph)";
      }

      // Show what token was used so you can see it in the UI
      setTokenInfo({
        type:      tokenType,
        scope:     scopeUsed,
        preview:   tokenResponse.accessToken.slice(0, 60) + "…",
        expiresOn: tokenResponse.expiresOn?.toLocaleTimeString(),
      });

      // ── Step 2: Call FastAPI with Bearer token in Authorization header ─────
      const response = await fetch(
        `${API_BASE}/weather?zipcode=${zipcode}`,
        {
          headers: {
            // THIS is where the token is attached.
            // The FastAPI AuthMiddleware reads this header on every request.
            Authorization: `Bearer ${tokenResponse.accessToken}`,
          },
        }
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const msg  = body.detail || body.error || `HTTP ${response.status}`;
        if (response.status === 401) throw new Error(`Server rejected token: ${msg}`);
        if (response.status === 404) throw new Error(`ZIP code not found: ${msg}`);
        throw new Error(`Server error: ${msg}`);
      }

      setWeather(await response.json());

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="weather-tab">
      <div className="weather-intro">
        <p>
          Enter a US ZIP code. Your Microsoft <strong>access token</strong>{" "}
          (not the ID token) is attached as a <code>Bearer</code> header to
          the FastAPI server on <code>localhost:8000</code>, which validates it
          against Azure AD before fetching live weather data.
        </p>
        <div className="weather-flow">
          <span className="flow-step">acquireTokenSilent()</span>
          <span className="flow-arrow">→</span>
          <span className="flow-step">Authorization: Bearer …</span>
          <span className="flow-arrow">→</span>
          <span className="flow-step">FastAPI AuthMiddleware</span>
          <span className="flow-arrow">→</span>
          <span className="flow-step">Open-Meteo</span>
        </div>
      </div>

      <form className="zip-form" onSubmit={handleSubmit}>
        <input
          className="zip-input"
          type="text"
          inputMode="numeric"
          placeholder="ZIP code — e.g. 95814"
          value={zipcode}
          maxLength={5}
          onChange={(e) => setZipcode(e.target.value.replace(/\D/g, "").slice(0, 5))}
        />
        <button className="btn-fetch" type="submit"
          disabled={loading || zipcode.length !== 5}>
          {loading ? "Fetching…" : "Get Weather"}
        </button>
      </form>

      {/* Token info banner — shows which token was used */}
      {tokenInfo && (
        <div className="token-info-banner">
          <div className="token-info-row">
            <span className="ti-label">Token sent</span>
            <span className={`ti-badge ${tokenInfo.type === "api-scoped" ? "badge-green" : "badge-yellow"}`}>
              {tokenInfo.type}
            </span>
          </div>
          <div className="token-info-row">
            <span className="ti-label">Scope used</span>
            <code className="ti-value">{tokenInfo.scope}</code>
          </div>
          <div className="token-info-row">
            <span className="ti-label">Token preview</span>
            <code className="ti-value">{tokenInfo.preview}</code>
          </div>
          <div className="token-info-row">
            <span className="ti-label">Expires at</span>
            <code className="ti-value">{tokenInfo.expiresOn}</code>
          </div>
          {tokenInfo.type !== "api-scoped" && (
            <p className="ti-note">
              ⚠️ Using Graph-scoped fallback token. To use a proper API-scoped token,
              Joe needs to expose a <code>Weather.Read</code> scope in Azure portal
              under App Registration → Expose an API.
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="weather-error">
          <span className="error-icon">⚠️</span>
          <div><strong>Request failed</strong><p>{error}</p></div>
        </div>
      )}

      {loading && (
        <div className="weather-loading">
          <div className="spinner" />
          <p>Sending JWT → FastAPI → Open-Meteo…</p>
        </div>
      )}

      {weather && !loading && <WeatherCard data={weather} />}
    </div>
  );
}

function WeatherCard({ data }) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="weather-card">
      <div className="weather-header">
        <div className="weather-emoji">{data.condition.emoji}</div>
        <div className="weather-title">
          <h2 className="weather-city">{data.city}</h2>
          <p className="weather-location">{data.location}</p>
          <p className="weather-condition">{data.condition.description}</p>
        </div>
      </div>
      <div className="weather-grid">
        <WeatherStat icon="🌡️" label="Temperature" value={`${data.temperature.value}${data.temperature.unit}`} />
        <WeatherStat icon="💧" label="Humidity"     value={`${data.humidity.value}${data.humidity.unit}`} />
        <WeatherStat icon="💨" label="Wind Speed"   value={`${data.wind.speed} ${data.wind.unit}`} />
        <WeatherStat icon="🌧️" label="Precipitation" value={`${data.precipitation.value} ${data.precipitation.unit}`} />
      </div>
      <p className="weather-coords">
        📍 {data.coordinates.latitude}°, {data.coordinates.longitude}° · ZIP {data.zipcode}
      </p>
      <div className="weather-raw">
        <button className="raw-toggle" onClick={() => setShowRaw(s => !s)}>
          {showRaw ? "▲ Hide" : "▼ Show"} raw FastAPI response (JSON)
        </button>
        {showRaw && <pre className="raw-json">{JSON.stringify(data, null, 2)}</pre>}
      </div>
    </div>
  );
}

function WeatherStat({ icon, label, value }) {
  return (
    <div className="weather-stat">
      <span className="stat-icon">{icon}</span>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </div>
  );
}
