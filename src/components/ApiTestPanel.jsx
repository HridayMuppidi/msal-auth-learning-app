/**
 * API Test Panel
 * ==============
 * Deliberately sends wrong or malicious data to the FastAPI server so you can
 * see how each protection layer responds. Every test shows:
 *   - What is being sent and why it should fail (or pass)
 *   - The HTTP status code returned
 *   - The exact error message from the server
 *
 * Watch the FastAPI terminal while running these — you will see the middleware
 * log exactly which step caught each problem.
 */

import React, { useState, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import { loginRequest } from "../authConfig";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Test definitions ─────────────────────────────────────────────────────────
// Each test has:
//   category   : what layer catches it
//   label      : shown in the UI
//   description: what this test is doing and why
//   expectCode : the HTTP status code the server should return
//   run(token) : function that performs the fetch (token may be null for tests that don't need it)

function buildTests(tenantId, clientId) {
  return [
    // ── Authentication layer (AuthMiddleware) ─────────────────────────────────
    {
      id:          "no-header",
      category:    "auth",
      label:       "No Authorization header",
      description: "Sends the request with zero headers. The middleware's first check is for the Authorization header — if it's missing, the request is rejected immediately before any JWT parsing happens.",
      expectCode:  401,
      expectPhrase: "Missing Authorization header",
      run: async () => fetch(`${API_BASE}/weather?zipcode=95814`),
    },
    {
      id:          "wrong-scheme",
      category:    "auth",
      label:       "Wrong auth scheme (Basic)",
      description: "Sends 'Basic dXNlcjpwYXNz' — a base64-encoded username:password. This is HTTP Basic auth, not Bearer. The middleware only accepts Bearer tokens.",
      expectCode:  401,
      expectPhrase: "Invalid Authorization scheme",
      run: async () => fetch(`${API_BASE}/weather?zipcode=95814`, {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      }),
    },
    {
      id:          "empty-bearer",
      category:    "auth",
      label:       "Bearer with empty token",
      description: "Sends 'Bearer ' with nothing after the space. The middleware checks for this after confirming the Bearer prefix.",
      expectCode:  401,
      expectPhrase: "Empty token",
      run: async () => fetch(`${API_BASE}/weather?zipcode=95814`, {
        headers: { Authorization: "Bearer " },
      }),
    },

    // ── JWT structure layer ───────────────────────────────────────────────────
    {
      id:          "not-a-jwt",
      category:    "jwt-structure",
      label:       "Random string (not a JWT)",
      description: "Sends 'Bearer hello_world_not_a_jwt'. A JWT must have exactly 3 parts separated by dots (header.payload.signature). This has zero dots, so the structure check fails before any cryptography happens.",
      expectCode:  401,
      expectPhrase: "3 parts",
      run: async () => fetch(`${API_BASE}/weather?zipcode=95814`, {
        headers: { Authorization: "Bearer hello_world_not_a_jwt" },
      }),
    },
    {
      id:          "two-part-jwt",
      category:    "jwt-structure",
      label:       "Partial JWT (only 2 parts)",
      description: "Sends 'Bearer header.payload' — missing the signature. A JWT without a signature part has no cryptographic protection at all.",
      expectCode:  401,
      expectPhrase: "3 parts",
      run: async () => fetch(`${API_BASE}/weather?zipcode=95814`, {
        headers: {
          Authorization: `Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0`,
        },
      }),
    },
    {
      id:          "wrong-algorithm",
      category:    "jwt-structure",
      label:       "Wrong algorithm (HS256 header)",
      description: "A JWT whose header claims alg=HS256 (symmetric HMAC — requires a shared secret). Azure AD uses RS256 (asymmetric RSA). The middleware rejects any non-RS256 algorithm before fetching the JWKS.",
      expectCode:  401,
      expectPhrase: "RS256",
      run: async () => {
        // Build a token that CLAIMS to be HS256 in its header
        const fakeHeader  = b64url({ typ: "JWT", alg: "HS256", kid: "fake" });
        const fakePayload = b64url({ sub: "attacker", exp: futureExp() });
        return fetch(`${API_BASE}/weather?zipcode=95814`, {
          headers: { Authorization: `Bearer ${fakeHeader}.${fakePayload}.FAKE_HMAC_SIGNATURE` },
        });
      },
    },

    // ── Cryptographic layer ───────────────────────────────────────────────────
    {
      id:          "tampered-signature",
      category:    "crypto",
      label:       "Tampered signature (last char flipped)",
      description: "Takes your REAL valid token and changes just one character in the signature. The RS256 math will fail because the signature no longer matches the header+payload. This proves the server checks the ACTUAL cryptography, not just the token structure.",
      expectCode:  401,
      expectPhrase: "Signature",
      needsToken:  true,
      run: async (token) => {
        const parts = token.split(".");
        const sig   = parts[2];
        // Flip the last character A↔B to corrupt the signature
        const last    = sig.slice(-1);
        const flipped = last === "A" ? "B" : "A";
        const tampered = `${parts[0]}.${parts[1]}.${sig.slice(0, -1)}${flipped}`;
        return fetch(`${API_BASE}/weather?zipcode=95814`, {
          headers: { Authorization: `Bearer ${tampered}` },
        });
      },
    },
    {
      id:          "tampered-payload",
      category:    "crypto",
      label:       "Tampered payload (changed oid claim)",
      description: "Takes your REAL token, decodes the payload, changes the 'oid' claim to a fake value, then puts the ORIGINAL signature back. The server will reject this because the signature was created for the ORIGINAL payload. One changed byte = signature verification fails.",
      expectCode:  401,
      expectPhrase: "Signature",
      needsToken:  true,
      run: async (token) => {
        const [header, payload, sig] = token.split(".");
        try {
          const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
          decoded.oid = "00000000-0000-0000-0000-000000000000";  // fake OID
          const newPayload = btoa(JSON.stringify(decoded))
            .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
          return fetch(`${API_BASE}/weather?zipcode=95814`, {
            headers: { Authorization: `Bearer ${header}.${newPayload}.${sig}` },
          });
        } catch {
          // If base64 decode fails just flip a signature char instead
          const flipped = sig.slice(0, -1) + (sig.slice(-1) === "A" ? "B" : "A");
          return fetch(`${API_BASE}/weather?zipcode=95814`, {
            headers: { Authorization: `Bearer ${header}.${payload}.${flipped}` },
          });
        }
      },
    },
    {
      id:          "fake-expired-token",
      category:    "crypto",
      label:       "Fake expired token (built from scratch)",
      description: "A token built entirely in the browser with an exp claim set to 1 hour ago. It has no valid Azure AD signature, so the server rejects it at the cryptographic layer — but the logging will show it DID read the exp timestamp before failing.",
      expectCode:  401,
      expectPhrase: "failed",
      run: async () => {
        const header  = b64url({ typ: "JWT", alg: "RS256", kid: "expired-test-key" });
        const payload = b64url({
          aud: "https://graph.microsoft.com",
          iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
          iat: Math.floor(Date.now() / 1000) - 7200,
          nbf: Math.floor(Date.now() / 1000) - 7200,
          exp: Math.floor(Date.now() / 1000) - 3600,   // expired 1 hour ago
          oid: "00000000-0000-0000-0000-000000000000",
          tid: tenantId,
          sub: "fake-subject",
        });
        return fetch(`${API_BASE}/weather?zipcode=95814`, {
          headers: { Authorization: `Bearer ${header}.${payload}.UNSIGNED_FAKE_SIGNATURE` },
        });
      },
    },
    {
      id:          "wrong-tenant",
      category:    "crypto",
      label:       "Different tenant in payload",
      description: "A fake token where the tid (tenant ID) claim is set to a completely different Azure AD tenant. Even if the signature were valid, the server's tenant check would catch this — one org's tokens cannot access another org's API.",
      expectCode:  401,
      expectPhrase: "failed",
      run: async () => {
        const header  = b64url({ typ: "JWT", alg: "RS256", kid: "wrong-tenant-key" });
        const payload = b64url({
          aud: "https://graph.microsoft.com",
          iss: `https://login.microsoftonline.com/ffffffff-ffff-ffff-ffff-ffffffffffff/v2.0`,
          tid: "ffffffff-ffff-ffff-ffff-ffffffffffff",   // a different tenant
          exp: futureExp(),
          oid: "11111111-1111-1111-1111-111111111111",
        });
        return fetch(`${API_BASE}/weather?zipcode=95814`, {
          headers: { Authorization: `Bearer ${header}.${payload}.UNSIGNED_FAKE_SIGNATURE` },
        });
      },
    },

    // ── Input validation layer (route handler) ────────────────────────────────
    {
      id:          "bad-zip-letters",
      category:    "input",
      label:       "ZIP with letters (not digits)",
      description: "Sends a valid token but zipcode='ABCDE'. The route handler validates the ZIP format before geocoding — it must be exactly 5 digits.",
      expectCode:  422,
      expectPhrase: "5 digits",
      needsToken:  true,
      run: async (token) => fetch(`${API_BASE}/weather?zipcode=ABCDE`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    },
    {
      id:          "zip-injection",
      category:    "input",
      label:       "ZIP code injection attempt",
      description: "Sends zipcode='95814;DROP TABLE users--'. A real SQL injection attack pattern. The route handler's regex rejects it before any geocoding call is made — the ';' makes it fail the 5-digit check.",
      expectCode:  422,
      expectPhrase: "5 digits",
      needsToken:  true,
      run: async (token) => fetch(`${API_BASE}/weather?zipcode=95814;DROP TABLE users--`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    },
    {
      id:          "nonexistent-zip",
      category:    "input",
      label:       "Valid format, non-existent ZIP (00000)",
      description: "Sends a valid token and a correctly formatted ZIP (00000) that doesn't exist anywhere in the US. This passes auth AND input validation, but Nominatim returns no results → 404.",
      expectCode:  404,
      expectPhrase: "not found",
      needsToken:  true,
      run: async (token) => fetch(`${API_BASE}/weather?zipcode=00000`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    },

    // ── Success case ──────────────────────────────────────────────────────────
    {
      id:          "valid-request",
      category:    "success",
      label:       "Valid request — everything correct",
      description: "A real authenticated request with a valid token and a real ZIP code. This should pass every check: CORS → auth header → JWT structure → signature → claims → tenant → input → geocoding → Open-Meteo → Pydantic validation. Watch the server logs for the full journey.",
      expectCode:  200,
      needsToken:  true,
      run: async (token) => fetch(`${API_BASE}/weather?zipcode=90210`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    },
  ];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function b64url(obj) {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function futureExp() {
  return Math.floor(Date.now() / 1000) + 3600;
}

const CATEGORY_META = {
  auth:          { label: "Auth Middleware",    color: "#7c3aed", bg: "#f3e8ff" },
  "jwt-structure": { label: "JWT Structure",     color: "#b45309", bg: "#fef3c7" },
  crypto:        { label: "Cryptography",       color: "#dc2626", bg: "#fee2e2" },
  input:         { label: "Input Validation",   color: "#0369a1", bg: "#e0f2fe" },
  success:       { label: "Success Path",       color: "#15803d", bg: "#dcfce7" },
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function ApiTestPanel() {
  const { instance, accounts } = useMsal();
  const account   = accounts[0];
  const tenantId  = account?.idTokenClaims?.tid  || "";
  const clientId  = import.meta.env.VITE_CLIENT_ID || "";
  const tests     = buildTests(tenantId, clientId);

  const [results,  setResults ] = useState({});   // testId → { status, body, elapsed }
  const [running,  setRunning ] = useState({});   // testId → true
  const [token,    setToken   ] = useState(null); // cached access token
  const [runningAll, setRunningAll] = useState(false);

  // Get a cached access token (fetched once, reused across tests)
  const getToken = useCallback(async () => {
    if (token) return token;
    const resp = await instance.acquireTokenSilent({ ...loginRequest, account });
    setToken(resp.accessToken);
    return resp.accessToken;
  }, [token, instance, account]);

  const runTest = useCallback(async (test) => {
    setRunning(r => ({ ...r, [test.id]: true }));
    const t0 = performance.now();
    let result;

    try {
      const tok = test.needsToken ? await getToken() : null;
      const response = await test.run(tok);
      const body = await response.json().catch(() => null);
      result = {
        status:  response.status,
        ok:      response.ok,
        body:    body,
        elapsed: Math.round(performance.now() - t0),
        passed:  response.status === test.expectCode,
      };
    } catch (err) {
      result = {
        status:  0,
        ok:      false,
        body:    { error: err.message },
        elapsed: Math.round(performance.now() - t0),
        passed:  false,
        networkError: true,
      };
    }

    setResults(r => ({ ...r, [test.id]: result }));
    setRunning(r => ({ ...r, [test.id]: false }));
    return result;
  }, [getToken]);

  const runAll = useCallback(async () => {
    setRunningAll(true);
    setResults({});
    setToken(null);
    for (const test of tests) {
      await runTest(test);
      // Small delay so logs are readable in the server terminal
      await new Promise(r => setTimeout(r, 400));
    }
    setRunningAll(false);
  }, [tests, runTest]);

  const resetAll = () => { setResults({}); setToken(null); };

  const passCount = Object.values(results).filter(r => r.passed).length;
  const totalRun  = Object.keys(results).length;

  return (
    <div className="test-panel">
      {/* Header */}
      <div className="test-panel-header">
        <div>
          <h2 className="test-panel-title">Middleware &amp; API Test Suite</h2>
          <p className="test-panel-subtitle">
            Intentionally sends wrong and malicious data to verify every protection layer.
            Watch your FastAPI terminal while these run — you will see exactly which
            middleware step catches each problem.
          </p>
        </div>
        <div className="test-panel-actions">
          {totalRun > 0 && (
            <span className="test-score">
              {passCount}/{totalRun} expected
            </span>
          )}
          <button className="btn-reset" onClick={resetAll} disabled={runningAll}>
            Reset
          </button>
          <button className="btn-run-all" onClick={runAll} disabled={runningAll}>
            {runningAll ? "Running…" : "Run All Tests"}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="test-legend">
        {Object.entries(CATEGORY_META).map(([key, meta]) => (
          <span key={key} className="legend-chip"
            style={{ background: meta.bg, color: meta.color, borderColor: meta.color }}>
            {meta.label}
          </span>
        ))}
      </div>

      {/* Test cards */}
      <div className="test-cards">
        {tests.map(test => {
          const result  = results[test.id];
          const isRunning = running[test.id];
          const meta    = CATEGORY_META[test.category];

          return (
            <div key={test.id} className={`test-card ${result ? (result.passed ? "card-passed" : "card-failed") : ""}`}>
              {/* Card header */}
              <div className="card-top">
                <div className="card-meta">
                  <span className="card-category-chip"
                    style={{ background: meta.bg, color: meta.color, borderColor: meta.color }}>
                    {meta.label}
                  </span>
                  <span className="card-expect">Expect HTTP {test.expectCode}</span>
                </div>
                <button
                  className="btn-run-one"
                  onClick={() => runTest(test)}
                  disabled={isRunning || runningAll}
                >
                  {isRunning ? "…" : "Run"}
                </button>
              </div>

              <h3 className="card-title">{test.label}</h3>
              <p className="card-desc">{test.description}</p>

              {/* Result */}
              {result && (
                <div className={`card-result ${result.passed ? "result-ok" : "result-bad"}`}>
                  <div className="result-row">
                    <span className={`result-status ${result.passed ? "status-ok" : "status-bad"}`}>
                      {result.passed ? "✓" : "✗"}  HTTP {result.status || "ERR"}
                    </span>
                    <span className="result-time">{result.elapsed}ms</span>
                    {result.passed
                      ? <span className="result-verdict">Expected ✓</span>
                      : <span className="result-verdict verdict-wrong">Unexpected!</span>
                    }
                  </div>
                  {result.body && (
                    <pre className="result-body">
                      {JSON.stringify(result.body, null, 2)}
                    </pre>
                  )}
                  {result.networkError && (
                    <p className="result-network-err">
                      Network error — is the FastAPI server running on port 8000?
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
