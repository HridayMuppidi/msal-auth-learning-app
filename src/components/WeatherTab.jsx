/**
 * WeatherTab — Live Auth Tester
 *
 * Two things in one place:
 *  1. Real weather  — type a ZIP, click Get Weather, see the result
 *  2. Break it      — click a scenario button to send something wrong
 *                     and see exactly which layer of the server catches it
 *
 * Every result panel explains WHAT was sent, WHAT came back, and WHY.
 */
import React, { useState, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import { weatherApiRequest } from "../authConfig";
import TestingPanel from "./TestingPanel";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Attack scenarios ──────────────────────────────────────────────────────────
const SCENARIOS = [
  {
    id:    "no-token",
    emoji: "🚫",
    label: "No Token",
    color: "red",
    sent:  "A request with NO Authorization header at all",
    layer: "Auth Middleware — Step 1",
    why:   "The very first thing the middleware does is check for an Authorization header. If it's missing, the request is rejected before any token is read, any database is touched, or any weather data is fetched. Cost: zero.",
    run:   async () => fetch(`${API_BASE}/weather?zipcode=90210`),
  },
  {
    id:    "wrong-scheme",
    emoji: "🔑",
    label: "Wrong Scheme",
    color: "orange",
    sent:  "Authorization: API-Key abc123  (not Bearer)",
    layer: "Auth Middleware — Step 2",
    why:   "The server only speaks Bearer tokens (OAuth 2.0). API-Key is a different authentication scheme entirely. It's rejected at the scheme check, before any JWT decoding happens.",
    run:   async () => fetch(`${API_BASE}/weather?zipcode=90210`, {
      headers: { Authorization: "API-Key abc123" },
    }),
  },
  {
    id:    "not-a-jwt",
    emoji: "🗑️",
    label: "Random String",
    color: "orange",
    sent:  "Authorization: Bearer hello_world  (not a JWT)",
    layer: "Auth Middleware — Step 3",
    why:   "A JWT must have exactly 3 parts separated by dots: header.payload.signature. 'hello_world' has zero dots, so the structure check fails before any cryptography runs.",
    run:   async () => fetch(`${API_BASE}/weather?zipcode=90210`, {
      headers: { Authorization: "Bearer hello_world" },
    }),
  },
  {
    id:       "tampered",
    emoji:    "✂️",
    label:    "Tampered Token",
    color:    "purple",
    sent:     "Your real token — but the last character of the signature is flipped",
    layer:    "Token Validator — RS256 Signature",
    why:      "RS256 is math. Microsoft signs the token with their private key. Your server verifies it with Microsoft's public key. Changing ONE character makes the math fail. This is the entire point of cryptographic signatures — you cannot forge or modify a JWT without the private key.",
    needsToken: true,
    run: async (token) => {
      const [h, p, sig] = token.split(".");
      const bad = sig.slice(0, -1) + (sig.slice(-1) === "A" ? "B" : "A");
      return fetch(`${API_BASE}/weather?zipcode=90210`, {
        headers: { Authorization: `Bearer ${h}.${p}.${bad}` },
      });
    },
  },
  {
    id:       "tampered-payload",
    emoji:    "🎭",
    label:    "Fake Identity",
    color:    "purple",
    sent:     "Your real token — payload modified to claim you are someone else, original signature kept",
    layer:    "Token Validator — RS256 Signature",
    why:      "The payload (your name, email, permissions) is base64-decoded, the 'oid' is changed to a fake ID, then re-encoded. But the signature still belongs to the ORIGINAL payload. The server rejects it because the signature no longer matches the tampered payload.",
    needsToken: true,
    run: async (token) => {
      const [h, p, sig] = token.split(".");
      try {
        const pad    = p.length % 4 ? p + "=".repeat(4 - p.length % 4) : p;
        const claims = JSON.parse(atob(pad.replace(/-/g, "+").replace(/_/g, "/")));
        claims.oid   = "00000000-0000-0000-0000-000000000000";
        claims.name  = "Hacker McHackface";
        const newP   = btoa(JSON.stringify(claims))
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        return fetch(`${API_BASE}/weather?zipcode=90210`, {
          headers: { Authorization: `Bearer ${h}.${newP}.${sig}` },
        });
      } catch {
        // Fallback if base64 decode fails — just flip a sig char
        const bad = sig.slice(0, -1) + (sig.slice(-1) === "A" ? "B" : "A");
        return fetch(`${API_BASE}/weather?zipcode=90210`, {
          headers: { Authorization: `Bearer ${h}.${p}.${bad}` },
        });
      }
    },
  },
  {
    id:       "letters-zip",
    emoji:    "💉",
    label:    "Letters in ZIP",
    color:    "blue",
    sent:     "Valid token ✓ — but zipcode=ABCDE (not digits)",
    layer:    "Route Handler — Input Validation",
    why:      "Auth PASSES — the token is legitimate. But the route handler validates the ZIP with a regex before geocoding: /^\\d{5}$/. Letters fail that check. This shows defence in depth: authentication AND input validation are separate layers.",
    needsToken: true,
    run: async (token) => fetch(`${API_BASE}/weather?zipcode=ABCDE`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  },
  {
    id:       "sql-injection",
    emoji:    "☠️",
    label:    "SQL Injection",
    color:    "blue",
    sent:     "Valid token ✓ — but zipcode=95814;DROP TABLE users--",
    layer:    "Route Handler — Input Validation",
    why:      "Classic SQL injection. The regex catches it: the semicolon makes it fail /^\\d{5}$/. Even if it got through (this API doesn't use SQL), it's a URL parameter, not a query. Defence in depth still wins.",
    needsToken: true,
    run: async (token) => fetch(
      `${API_BASE}/weather?zipcode=${encodeURIComponent("95814;DROP TABLE users--")}`,
      { headers: { Authorization: `Bearer ${token}` } }
    ),
  },
  {
    id:       "ghost-zip",
    emoji:    "👻",
    label:    "Ghost ZIP",
    color:    "gray",
    sent:     "Valid token ✓ — valid format ✓ — but ZIP 00000 doesn't exist",
    layer:    "Weather Service — Geocoding",
    why:      "Auth passes ✓, format passes ✓. The request reaches Nominatim (the geocoding API). 00000 is not a real US ZIP, so Nominatim returns zero results → 404 Not Found. This is the deepest a bad request can get.",
    needsToken: true,
    run: async (token) => fetch(`${API_BASE}/weather?zipcode=00000`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  },
];

const STATUS_TEXT = {
  200: "OK", 401: "Unauthorized", 403: "Forbidden",
  404: "Not Found", 422: "Unprocessable", 500: "Server Error", 503: "Unavailable",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function WeatherTab() {
  const { instance, accounts } = useMsal();
  const account = accounts[0];

  const [zipcode,     setZipcode    ] = useState("");
  const [result,      setResult     ] = useState(null);
  const [loading,     setLoading    ] = useState(false);
  const [cachedToken, setCachedToken] = useState(null);

  // Grab a token once; reuse it across scenario runs so we're not making
  // a new MSAL call for every button press.
  const getToken = useCallback(async () => {
    if (cachedToken) return cachedToken;
    const resp = await instance.acquireTokenSilent({ ...weatherApiRequest, account });
    setCachedToken(resp.accessToken);
    return resp.accessToken;
  }, [cachedToken, instance, account]);

  const run = async (fetchFn, meta) => {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetchFn();
      const body = await response.json().catch(() => null);
      setResult({ ...meta, status: response.status, ok: response.ok, body });
    } catch (err) {
      setResult({ ...meta, status: 0, ok: false, body: { error: err.message }, networkError: true });
    }
    setLoading(false);
  };

  const handleWeather = async (e) => {
    e.preventDefault();
    try {
      const token = await getToken();
      await run(
        () => fetch(`${API_BASE}/weather?zipcode=${zipcode}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        { mode: "weather", zipcode }
      );
    } catch (err) {
      setResult({ mode: "err", body: { error: err.message } });
      setLoading(false);
    }
  };

  const handleScenario = async (scenario) => {
    try {
      const token = scenario.needsToken ? await getToken() : null;
      await run(() => scenario.run(token), { mode: "scenario", scenario });
    } catch (err) {
      setResult({ mode: "err", body: { error: err.message } });
      setLoading(false);
    }
  };

  return (
    <div className="wt-root">

      {/* ── Auth flow diagram ─────────────────────────────────────────────── */}
      {/* Shows the path every request takes through the stack.             */}
      {/* The Auth Middleware step is highlighted because that's where      */}
      {/* most of the attack scenarios get stopped.                         */}
      <div className="wt-flow">
        {[
          { icon: "🔑", label: "MSAL token" },
          { icon: "📤", label: "GET /weather + Bearer" },
          { icon: "🛡️", label: "CORS" },
          { icon: "🔍", label: "Auth Middleware", accent: true },
          { icon: "📋", label: "Route Handler" },
          { icon: "🌐", label: "Open-Meteo" },
          { icon: "✅", label: "Weather data" },
        ].map((step, i, arr) => (
          <React.Fragment key={step.label}>
            <div className={`flow-item${step.accent ? " flow-item-accent" : ""}`}>
              <span className="flow-item-icon">{step.icon}</span>
              <span className="flow-item-label">{step.label}</span>
            </div>
            {i < arr.length - 1 && <span className="flow-arrow">›</span>}
          </React.Fragment>
        ))}
      </div>

      {/* ── Single combined card: form + attack chips ──────────────────────── */}
      {/* The "Get Weather" button and the attack scenarios are the same       */}
      {/* thing — they all send a request to the same endpoint. The only       */}
      {/* difference is what's in the Authorization header or the ZIP value.   */}
      <div className="wt-section">
        <form className="zip-form" onSubmit={handleWeather}>
          <input
            className="zip-input"
            type="text"
            inputMode="numeric"
            placeholder="Enter a ZIP code — e.g. 95814"
            value={zipcode}
            maxLength={5}
            onChange={(e) => setZipcode(e.target.value.replace(/\D/g, "").slice(0, 5))}
          />
          <button className="btn-fetch" type="submit" disabled={loading || zipcode.length !== 5}>
            {loading ? "Fetching…" : "🌤️ Get Weather"}
          </button>
        </form>

        <div className="wt-or">
          <div className="wt-or-line" />
          <span className="wt-or-text">or send a broken request — see which layer catches it</span>
          <div className="wt-or-line" />
        </div>

        <div className="scenario-grid">
          {SCENARIOS.map(s => (
            <button
              key={s.id}
              className={`scenario-chip chip-${s.color}`}
              onClick={() => handleScenario(s)}
              disabled={loading}
              title={s.sent}
            >
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="weather-loading">
          <div className="spinner" />
          <p>Sending request to FastAPI…</p>
        </div>
      )}

      {/* ── Result ─────────────────────────────────────────────────────────── */}
      {result && !loading && <ResultPanel result={result} />}

      {/* ── Testing Panel ─────────────────────────────────────────────────── */}
      <TestingPanel />
    </div>
  );
}

// ── Result Panel ──────────────────────────────────────────────────────────────

function ResultPanel({ result }) {
  const [showRaw, setShowRaw] = useState(false);

  // ── Network / MSAL error ─────────────────────────────────────────────────
  if (result.networkError || result.mode === "err") {
    return (
      <div className="rp rp-err">
        <div className="rp-top">
          <span className="rp-badge badge-err">Error</span>
          <span className="rp-title">Could not complete request</span>
        </div>
        <p className="rp-body-text">{result.body?.error}</p>
        {result.networkError && (
          <p className="rp-hint">Is the FastAPI server running? → <code>uvicorn main:app --reload --port 8000</code></p>
        )}
      </div>
    );
  }

  // ── Successful weather result ─────────────────────────────────────────────
  if (result.mode === "weather" && result.ok) {
    const d = result.body;
    return (
      <div className="rp rp-ok">
        <div className="rp-top">
          <span className="rp-badge badge-200">200 OK</span>
          <span className="rp-title">GET /weather?zipcode={result.zipcode}</span>
          <span className="rp-flow-note">All layers passed ✓</span>
        </div>
        <div className="weather-card">
          <div className="weather-header">
            <div className="weather-emoji">{d.condition.emoji}</div>
            <div className="weather-title">
              <h2 className="weather-city">{d.city}</h2>
              <p className="weather-location">{d.location}</p>
              <p className="weather-condition">{d.condition.description}</p>
            </div>
          </div>
          <div className="weather-grid">
            <WeatherStat icon="🌡️" label="Temperature" value={`${d.temperature.value}${d.temperature.unit}`} />
            <WeatherStat icon="💧" label="Humidity"     value={`${d.humidity.value}${d.humidity.unit}`} />
            <WeatherStat icon="💨" label="Wind"         value={`${d.wind.speed} ${d.wind.unit}`} />
            <WeatherStat icon="🌧️" label="Precipitation" value={`${d.precipitation.value} ${d.precipitation.unit}`} />
          </div>
        </div>
        <div className="weather-raw">
          <button className="raw-toggle" onClick={() => setShowRaw(s => !s)}>
            {showRaw ? "▲ Hide" : "▼ Show"} raw JSON from FastAPI
          </button>
          {showRaw && <pre className="raw-json">{JSON.stringify(d, null, 2)}</pre>}
        </div>
      </div>
    );
  }

  // ── Failed weather request (e.g. user typed bad ZIP) ─────────────────────
  if (result.mode === "weather" && !result.ok) {
    return (
      <div className="rp rp-bad">
        <div className="rp-top">
          <span className="rp-badge badge-4xx">
            {result.status} {STATUS_TEXT[result.status] || ""}
          </span>
          <span className="rp-title">GET /weather?zipcode={result.zipcode}</span>
        </div>
        <p className="rp-body-text">{result.body?.detail || result.body?.error}</p>
      </div>
    );
  }

  // ── Scenario result ───────────────────────────────────────────────────────
  if (result.mode === "scenario") {
    const s      = result.scenario;
    const caught = result.status >= 400;

    return (
      <div className={`rp ${caught ? "rp-caught" : "rp-ok"}`}>
        {/* Header */}
        <div className="rp-top">
          <span className={`rp-badge ${result.status < 400 ? "badge-200" : result.status < 500 ? "badge-4xx" : "badge-5xx"}`}>
            {result.status} {STATUS_TEXT[result.status] || ""}
          </span>
          <span className="rp-scenario-name">{s.emoji} {s.label}</span>
          {caught
            ? <span className="rp-caught-by">Caught by {s.layer} ✓</span>
            : <span className="rp-passed">Passed all layers</span>
          }
        </div>

        {/* Three info blocks */}
        <div className="rp-blocks">
          <div className="rp-block">
            <div className="rp-block-label">What was sent</div>
            <div className="rp-block-body">{s.sent}</div>
          </div>
          <div className="rp-block">
            <div className="rp-block-label">Which layer caught it</div>
            <div className="rp-block-body rp-layer">{s.layer}</div>
          </div>
          <div className="rp-block">
            <div className="rp-block-label">Why the server responded this way</div>
            <div className="rp-block-body">{s.why}</div>
          </div>
        </div>

        {/* Server's raw response */}
        {result.body && (
          <details className="rp-details">
            <summary>Server response JSON</summary>
            <pre className="rp-pre">{JSON.stringify(result.body, null, 2)}</pre>
          </details>
        )}
      </div>
    );
  }

  return null;
}

// ── Small helpers ─────────────────────────────────────────────────────────────


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
