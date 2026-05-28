/**
 * TestingPanel
 * ============
 * Collapsible panel inside the Weather tab.
 * Every button makes a real fetch() call to localhost:8000 —
 * nothing is simulated or hardcoded in the response.
 *
 * useMsal() is called here directly so the component can acquire
 * the real token from MSAL without needing props passed down.
 */
import React, { useState } from "react";
import { useMsal } from "@azure/msal-react";
import { weatherApiRequest, loginRequest } from "../authConfig";

const ENDPOINT = "http://localhost:8000/weather?zipcode=95630";

export default function TestingPanel() {
  const { instance, accounts } = useMsal();
  const account = accounts[0];

  const [isOpen,  setIsOpen ] = useState(false);
  const [results, setResults] = useState({});   // testId → result object
  const [busy,    setBusy   ] = useState({});   // testId → bool

  // ── Token helpers ──────────────────────────────────────────────────────────

  async function getApiToken() {
    // Requests api://clientId/Weather.Read scope
    // → token aud = "api://0c7237fb-e064-419c-a097-f44cd8b9bddd"
    const r = await instance.acquireTokenSilent({ ...weatherApiRequest, account });
    return r.accessToken;
  }

  async function getGraphToken() {
    // Requests User.Read scope (Microsoft Graph)
    // → token aud = "https://graph.microsoft.com" — wrong for this API
    const r = await instance.acquireTokenSilent({ ...loginRequest, account });
    return r.accessToken;
  }

  // ── Core fetch wrapper ─────────────────────────────────────────────────────
  // authHeader = null means the Authorization header is omitted entirely.
  // Everything else is a real fetch() call with that exact string.

  async function send(id, authHeader, expectedStatus) {
    setBusy(b => ({ ...b, [id]: true }));
    try {
      const headers = authHeader !== null ? { Authorization: authHeader } : {};

      const response = await fetch(ENDPOINT, { headers });
      const body     = await response.json().catch(() => null);

      setResults(r => ({
        ...r,
        [id]: {
          status:   response.status,
          authSent: authHeader === null
            ? "(no Authorization header sent)"
            : authHeader.slice(0, 80) + (authHeader.length > 80 ? "…" : ""),
          body:     JSON.stringify(body, null, 2),
          passed:   response.status === expectedStatus,
          expected: expectedStatus,
        },
      }));
    } catch (err) {
      setResults(r => ({
        ...r,
        [id]: {
          status:   0,
          authSent: authHeader === null ? "(none)" : authHeader.slice(0, 80) + "…",
          body:     `Network error: ${err.message}\n\nIs the FastAPI server running on port 8000?`,
          passed:   false,
          expected: expectedStatus,
        },
      }));
    }
    setBusy(b => ({ ...b, [id]: false }));
  }

  // ── Button handlers ────────────────────────────────────────────────────────
  // Each one does exactly what the spec says and nothing more.

  async function runValid() {
    const token = await getApiToken();
    // Button 1 — real token, full valid request
    await send("valid", `Bearer ${token}`, 200);
  }

  async function runNoToken() {
    // Button 2 — no Authorization header at all
    await send("no-token", null, 401);
  }

  async function runFakeToken() {
    // Button 3 — completely made-up string, not a JWT
    await send("fake-token", "Bearer thisisafaketoken123", 401);
  }

  async function runTampered() {
    const token = await getApiToken();
    // Button 4 — real token with characters 50–60 replaced by XXXXXXXXXX
    // The signature was created over the original payload.
    // Swapping 10 characters makes the RS256 math fail.
    const tampered = token.slice(0, 50) + "XXXXXXXXXX" + token.slice(60);
    await send("tampered", `Bearer ${tampered}`, 401);
  }

  async function runWrongAudience() {
    const token = await getGraphToken();
    // Button 5 — real, valid Microsoft Graph token
    // Signature IS valid, but aud = "https://graph.microsoft.com"
    // Server only accepts aud = "api://clientId" → 401
    await send("wrong-audience", `Bearer ${token}`, 401);
  }

  // ── Test list ──────────────────────────────────────────────────────────────

  const TESTS = [
    {
      id:       "valid",
      num:      1,
      label:    "Valid Request",
      desc:     "Real api://clientId/Weather.Read scoped JWT — all middleware checks pass",
      expected: 200,
      run:      runValid,
    },
    {
      id:       "no-token",
      num:      2,
      label:    "No Token",
      desc:     "Request sent with no Authorization header — middleware rejects at step 1",
      expected: 401,
      run:      runNoToken,
    },
    {
      id:       "fake-token",
      num:      3,
      label:    "Fake Token",
      desc:     "Authorization: Bearer thisisafaketoken123 — not a JWT (no dots), fails structure check",
      expected: 401,
      run:      runFakeToken,
    },
    {
      id:       "tampered",
      num:      4,
      label:    "Tampered Token",
      desc:     "Real JWT with chars 50–60 replaced by XXXXXXXXXX — RS256 signature no longer matches",
      expected: 401,
      run:      runTampered,
    },
    {
      id:       "wrong-audience",
      num:      5,
      label:    "Wrong Audience",
      desc:     "Real Microsoft Graph token (User.Read scope) — valid signature, wrong aud claim",
      expected: 401,
      run:      runWrongAudience,
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="tp-wrapper">

      {/* Collapsible header */}
      <button className="tp-toggle" onClick={() => setIsOpen(o => !o)}>
        <span className="tp-toggle-chevron">{isOpen ? "▲" : "▼"}</span>
        <span className="tp-toggle-title">🧪 Middleware Testing Panel</span>
        <span className="tp-toggle-hint">
          {isOpen
            ? "click to collapse"
            : "5 live tests — real fetch() calls, real server responses"}
        </span>
      </button>

      {isOpen && (
        <div className="tp-body">

          {/* Show the endpoint all tests hit */}
          <p className="tp-url-note">
            All tests call <code>GET {ENDPOINT}</code> with different Authorization headers.
          </p>

          {/* One card per test */}
          <div className="tp-grid">
            {TESTS.map(t => {
              const result = results[t.id];
              const isbusy = busy[t.id];

              return (
                <div
                  key={t.id}
                  className={`tp-card${result
                    ? result.passed ? " tp-card-pass" : " tp-card-fail"
                    : ""}`}
                >
                  {/* Card header: number + name + expected badge + Run button */}
                  <div className="tp-card-header">
                    <div className="tp-card-title-row">
                      <span className="tp-card-num">#{t.num}</span>
                      <span className="tp-card-name">{t.label}</span>
                      <span className={`tp-expected-badge ${t.expected === 200 ? "badge-allowed" : "badge-rejected"}`}>
                        expect {t.expected}
                      </span>
                    </div>
                    <button
                      className="tp-run-btn"
                      onClick={t.run}
                      disabled={isbusy}
                    >
                      {isbusy ? <span className="tp-spinner" /> : "Run"}
                    </button>
                  </div>

                  {/* Short description of what this test does */}
                  <p className="tp-card-desc">{t.desc}</p>

                  {/* Live result — only shown after the fetch completes */}
                  {result && (
                    <div className="tp-result-block">

                      {/* HTTP status + pass/fail verdict */}
                      <div className="tp-result-row">
                        <div className="tp-result-left">
                          <span className={`tp-status-pill ${
                            result.status === 0      ? "s-err"  :
                            result.status  < 400     ? "s-2xx"  :
                            result.status  < 500     ? "s-4xx"  : "s-5xx"
                          }`}>
                            {result.status || "ERR"}
                          </span>
                          <span className={`tp-verdict ${result.passed ? "verdict-pass" : "verdict-fail"}`}>
                            {result.passed
                              ? "✓ Behaved as expected"
                              : `✗ Expected ${result.expected} — got ${result.status}`}
                          </span>
                        </div>
                      </div>

                      {/* Exact Authorization header that was sent */}
                      <div className="tp-detail-row">
                        <span className="tp-detail-label">Authorization header sent (first 80 chars)</span>
                        <code className="tp-detail-value tp-auth-value">{result.authSent}</code>
                      </div>

                      {/* Raw JSON body from the server */}
                      <div className="tp-detail-row">
                        <span className="tp-detail-label">Raw response body from server</span>
                        <pre className="tp-raw-response">{result.body}</pre>
                      </div>

                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
