import React, { useState } from "react";
import { useMsal } from "@azure/msal-react";
import { loginRequest } from "../authConfig";

// FastAPI server base URL — comes from .env, defaults to localhost:8000
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function WeatherTab() {
  const { instance, accounts } = useMsal();
  const account = accounts[0];

  const [zipcode, setZipcode] = useState("");
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError  ] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setWeather(null);

    try {
      // ── Step 1: Get a fresh access token silently ──────────────────────────
      // acquireTokenSilent reads from MSAL's sessionStorage cache first.
      // If the cached token is near expiry, MSAL silently gets a new one
      // via a hidden iframe — no user interaction needed.
      const tokenResponse = await instance.acquireTokenSilent({
        ...loginRequest,
        account,
      });

      // ── Step 2: Call our FastAPI server with the JWT in the header ─────────
      // The Authorization header is how APIs know you are authenticated.
      // "Bearer" just means "the holder of this token is allowed in."
      const response = await fetch(
        `${API_BASE}/weather?zipcode=${zipcode}`,
        {
          headers: {
            Authorization: `Bearer ${tokenResponse.accessToken}`,
          },
        }
      );

      // ── Step 3: Handle errors returned by the server ───────────────────────
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = body.detail || body.error || `HTTP ${response.status}`;

        if (response.status === 401) {
          throw new Error(`Authentication rejected by server: ${message}`);
        }
        if (response.status === 404) {
          throw new Error(`ZIP code not found: ${message}`);
        }
        throw new Error(`Server error: ${message}`);
      }

      // ── Step 4: Parse and display the weather data ─────────────────────────
      const data = await response.json();
      setWeather(data);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="weather-tab">
      {/* How it works explanation */}
      <div className="weather-intro">
        <p>
          Enter a US ZIP code. Your Microsoft access token is sent as a{" "}
          <code>Bearer</code> header to the FastAPI server on{" "}
          <code>localhost:8000</code>, which validates it against Azure AD before
          fetching live weather data from Open-Meteo.
        </p>
        <div className="weather-flow">
          <span className="flow-step">React → JWT</span>
          <span className="flow-arrow">→</span>
          <span className="flow-step">FastAPI validates</span>
          <span className="flow-arrow">→</span>
          <span className="flow-step">Open-Meteo</span>
          <span className="flow-arrow">→</span>
          <span className="flow-step">Weather card</span>
        </div>
      </div>

      {/* ZIP code form */}
      <form className="zip-form" onSubmit={handleSubmit}>
        <input
          className="zip-input"
          type="text"
          inputMode="numeric"
          placeholder="ZIP code — e.g. 95814"
          value={zipcode}
          maxLength={5}
          onChange={(e) =>
            setZipcode(e.target.value.replace(/\D/g, "").slice(0, 5))
          }
        />
        <button
          className="btn-fetch"
          type="submit"
          disabled={loading || zipcode.length !== 5}
        >
          {loading ? "Fetching…" : "Get Weather"}
        </button>
      </form>

      {/* Error state */}
      {error && (
        <div className="weather-error">
          <span className="error-icon">⚠️</span>
          <div>
            <strong>Request failed</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="weather-loading">
          <div className="spinner" />
          <p>
            Sending JWT → FastAPI → Open-Meteo…
          </p>
        </div>
      )}

      {/* Weather result */}
      {weather && !loading && <WeatherCard data={weather} />}
    </div>
  );
}

// ─── Weather Card ──────────────────────────────────────────────────────────────

function WeatherCard({ data }) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="weather-card">
      {/* Header */}
      <div className="weather-header">
        <div className="weather-emoji">{data.condition.emoji}</div>
        <div className="weather-title">
          <h2 className="weather-city">{data.city}</h2>
          <p className="weather-location">{data.location}</p>
          <p className="weather-condition">{data.condition.description}</p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="weather-grid">
        <WeatherStat
          icon="🌡️"
          label="Temperature"
          value={`${data.temperature.value}${data.temperature.unit}`}
        />
        <WeatherStat
          icon="💧"
          label="Humidity"
          value={`${data.humidity.value}${data.humidity.unit}`}
        />
        <WeatherStat
          icon="💨"
          label="Wind Speed"
          value={`${data.wind.speed} ${data.wind.unit}`}
        />
        <WeatherStat
          icon="🌧️"
          label="Precipitation"
          value={`${data.precipitation.value} ${data.precipitation.unit}`}
        />
      </div>

      {/* Coordinates */}
      <p className="weather-coords">
        📍 {data.coordinates.latitude}°, {data.coordinates.longitude}°
        &nbsp;·&nbsp; ZIP {data.zipcode}
      </p>

      {/* Raw JSON — useful for learning */}
      <div className="weather-raw">
        <button
          className="raw-toggle"
          onClick={() => setShowRaw((s) => !s)}
        >
          {showRaw ? "▲ Hide" : "▼ Show"} raw FastAPI response (JSON)
        </button>
        {showRaw && (
          <pre className="raw-json">{JSON.stringify(data, null, 2)}</pre>
        )}
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
