/**
 * TestingPanel — Middleware Test Suite
 * =====================================
 * A collapsible panel that lives inside the Weather tab.
 * Lets you simulate 6 different request types — from valid to malicious —
 * and see exactly how the FastAPI middleware responds to each one.
 *
 * Every result shows:
 *   • The exact Authorization header that was sent
 *   • The HTTP status code returned
 *   • The raw JSON response body from the server
 *   • Which middleware step caught the problem
 *   • Green if the server behaved as expected, red if not
 */

import React, { useState, useCallback } from "react";
import { useMsal } from "@azure/msal-react";
import { weatherApiRequest, loginRequest } from "../authConfig";

const API_BASE    = import.meta.env.VITE_API_URL    || "http://localhost:8000";
const TENANT_ID   = import.meta.env.VITE_TENANT_ID  || "";
const CLIENT_ID   = import.meta.env.VITE_CLIENT_ID  || "";
const TEST_ZIP    = "90210";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** base64url-encode a plain object (for building fake JWTs) */
function b64url(obj) {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Corrupt a real JWT by overwriting 10 characters in the middle of the payload */
function tamperToken(token) {
  const [h, payload, sig] = token.split(".");
  const mid      = Math.floor(payload.length / 2);
  const tampered = payload.slice(0, mid - 5) + "TAMPERED99" + payload.slice(mid + 5);
  return `${h}.${tampered}.${sig}`;
}

/**
 * Build a structurally valid JWT whose payload claims it expired 1 hour ago.
 * The signature is fake, so the server will fail at crypto — not at the expiry
 * claim check. We note this in the UI: it's educational about the order of checks.
 */
function buildExpiredToken() {
  const header  = b64url({ typ: "JWT", alg: "RS256", kid: "demo-expired-key-not-real" });
  const payload = b64url({
    aud:  `api://${CLIENT_ID}`,
    iss:  `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    iat:  Math.floor(Date.now() / 1000) - 7200,    // issued 2 hours ago
    nbf:  Math.floor(Date.now() / 1000) - 7200,
    exp:  Math.floor(Date.now() / 1000) - 3600,    // ← expired 1 hour ago
    name: "Expired Demo User",
    oid:  "00000000-0000-0000-0000-000000000000",
    tid:  TENANT_ID,
    scp:  "Weather.Read",
  });
  // Signature is deliberately fake — a real expired token would have a valid
  // signature that passes crypto, then fail the exp check.
  return `${header}.${payload}.UNSIGNED_FAKE_FOR_DEMO`;
}

/** Send a request and return a structured result object */
async function makeRequest(authHeader) {
  const url     = `${API_BASE}/weather?zipcode=${TEST_ZIP}`;
  const headers = authHeader ? { Authorization: authHeader } : {};
  const t0      = performance.now();
  const response = await fetch(url, { headers });
  const body     = await response.json().catch(() => null);
  return {
    url,
    authHeaderSent: authHeader ?? "(none — header omitted entirely)",
    status:  response.status,
    ok:      response.ok,
    body,
    elapsed: Math.round(performance.now() - t0),
  };
}

// ── Test definitions ──────────────────────────────────────────────────────────

/**
 * Each test specifies:
 *   expectStatus   the HTTP status the server SHOULD return
 *   expectBehavior "ALLOWED" or "REJECTED" — what the correct middleware action is
 *   run(tokens)    async function — executes the actual request
 *   explain        plain-English explanation of why it fails (or passes)
 *   step           which validation step is responsible
 */
const TESTS = [
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  {
    id:             "valid",
    number:         1,
    name:           "Valid Request",
    expectStatus:   200,
    expectBehavior: "ALLOWED",
    headerPreview:  (tokens) => `Bearer ${tokens.api.slice(0, 40)}… (real JWT — ${tokens.api.length} chars)`,
    step:           "All checks pass — CORS ✓ → header ✓ → structure ✓ → signature ✓ → claims ✓ → route ✓",
    explain: `Your real access token is sent with the api://clientId/Weather.Read scope.
The middleware verifies the RS256 signature against Microsoft's public keys,
confirms the audience matches this API, and confirms the token hasn't expired.
All layers pass and the weather data is returned.`,
    run: async (tokens) => makeRequest(`Bearer ${tokens.api}`),
  },

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  {
    id:             "no-token",
    number:         2,
    name:           "No Token",
    expectStatus:   401,
    expectBehavior: "REJECTED",
    headerPreview:  () => "(header not included in request)",
    step:           "Middleware Step 1 — Authorization header is absent → immediate 401",
    explain: `The middleware's very first action is to check whether an Authorization header
exists at all. If it doesn't, the request is rejected before any token parsing,
any database lookup, or any weather API call. Cost to the server: zero.`,
    run: async () => makeRequest(null),
  },

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  {
    id:             "fake-token",
    number:         3,
    name:           "Fake Token",
    expectStatus:   401,
    expectBehavior: "REJECTED",
    headerPreview:  () => "Bearer thisisafaketoken123",
    step:           "Middleware Step 3 — JWT structure check: needs header.payload.signature (3 dots), this has 0",
    explain: `The string "thisisafaketoken123" is sent as-is. A JWT must have exactly 3 parts
separated by dots: header.payload.signature. This string has no dots at all,
so the structural check fails immediately. The server never attempts any
cryptography — it doesn't need to.`,
    run: async () => makeRequest("Bearer thisisafaketoken123"),
  },

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  {
    id:             "tampered",
    number:         4,
    name:           "Tampered Token",
    expectStatus:   401,
    expectBehavior: "REJECTED",
    headerPreview:  (tokens) => {
      const t = tamperToken(tokens.api);
      return `Bearer ${t.slice(0, 40)}… (real JWT, 10 chars in payload replaced with TAMPERED99)`;
    },
    step:           "Token Validator — RS256 signature check: payload was changed, signature still belongs to the original",
    explain: `Your real token is taken, 10 characters in the middle of the payload section are
replaced with "TAMPERED99", and the result is sent with the original signature.

The RS256 signature was created by Microsoft over the ORIGINAL header+payload.
Changing even one character of the payload makes the math fail:
  verify(new_payload, original_signature, microsoft_public_key) → FAIL

This is the entire point of cryptographic signatures. You cannot modify a JWT
without the private key to re-sign it.`,
    run: async (tokens) => makeRequest(`Bearer ${tamperToken(tokens.api)}`),
  },

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  {
    id:             "expired",
    number:         5,
    name:           "Expired Token",
    expectStatus:   401,
    expectBehavior: "REJECTED",
    headerPreview:  () => {
      const t = buildExpiredToken();
      const exp = new Date((Math.floor(Date.now() / 1000) - 3600) * 1000).toLocaleTimeString();
      return `Bearer ${t.slice(0, 40)}… (crafted JWT, exp=${exp} — 1 hour ago)`;
    },
    step:           "Token Validator — fake signature fails first; in production a real expired token fails at the exp claim check",
    explain: `A JWT is constructed in the browser whose payload has exp = 1 hour ago.
The signature is fake ("UNSIGNED_FAKE_FOR_DEMO"), so the server catches it at
the signature verification step before it even reaches the expiry check.

⚠️  Important order of operations in the middleware:
  1. Verify RS256 signature  ← fails here for this demo token
  2. Check exp (not expired)
  3. Check nbf (not before)
  4. Check iss (issuer)
  5. Check tid (tenant)

In the real world, if Microsoft issued you a valid token and it then expired,
step 1 would pass and step 2 would catch it with "Token is expired".
The server would still return 401 — just with a different detail message.`,
    run: async () => makeRequest(`Bearer ${buildExpiredToken()}`),
  },

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  {
    id:             "wrong-audience",
    number:         6,
    name:           "Wrong Audience Token",
    expectStatus:   401,
    expectBehavior: "REJECTED",
    headerPreview:  (tokens) => `Bearer ${tokens.graph.slice(0, 40)}… (REAL Graph token — aud=https://graph.microsoft.com)`,
    step:           "Token Validator — valid Microsoft signature, but aud=graph.microsoft.com not accepted by this API",
    explain: `A REAL, cryptographically valid token from Microsoft is used — but it was
requested with the User.Read scope, which produces a Graph-scoped token:
  aud = "https://graph.microsoft.com"

The server only accepts:
  aud = "api://0c7237fb-e064-419c-a097-f44cd8b9bddd"  (this API)
  aud = "0c7237fb-e064-419c-a097-f44cd8b9bddd"         (bare GUID form)

The signature IS valid — Microsoft did sign it. But audience validation prevents
a token meant for Graph from being used to call a completely different API.
This is why every API must validate the audience, not just the signature.`,
    run: async (tokens) => makeRequest(`Bearer ${tokens.graph}`),
  },
];

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_TEXT = {
  200: "OK", 401: "Unauthorized", 403: "Forbidden",
  404: "Not Found", 422: "Unprocessable", 500: "Server Error", 503: "Unavailable",
};

function statusClass(code) {
  if (code >= 500) return "s-5xx";
  if (code >= 400) return "s-4xx";
  if (code >= 200) return "s-2xx";
  return "s-err";
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TestingPanel() {
  const { instance, accounts } = useMsal();
  const account = accounts[0];

  const [isOpen,      setIsOpen     ] = useState(false);
  const [results,     setResults    ] = useState({});
  const [running,     setRunning    ] = useState({});
  const [runningAll,  setRunningAll ] = useState(false);
  const [apiToken,    setApiToken   ] = useState(null);   // api-scoped (for tests 1, 4)
  const [graphToken,  setGraphToken ] = useState(null);   // graph-scoped (for test 6)

  const getApiToken = useCallback(async () => {
    if (apiToken) return apiToken;
    const r = await instance.acquireTokenSilent({ ...weatherApiRequest, account });
    setApiToken(r.accessToken);
    return r.accessToken;
  }, [apiToken, instance, account]);

  const getGraphToken = useCallback(async () => {
    if (graphToken) return graphToken;
    // loginRequest uses User.Read — produces aud=graph.microsoft.com
    const r = await instance.acquireTokenSilent({ ...loginRequest, account });
    setGraphToken(r.accessToken);
    return r.accessToken;
  }, [graphToken, instance, account]);

  const runTest = useCallback(async (test) => {
    setRunning(r => ({ ...r, [test.id]: true }));
    try {
      // Acquire only the tokens this specific test actually needs
      const tokens = {
        api:   (test.id === "valid" || test.id === "tampered") ? await getApiToken() : "",
        graph: (test.id === "wrong-audience")                  ? await getGraphToken() : "",
      };

      const raw    = await test.run(tokens);
      const passed = raw.status === test.expectStatus;

      setResults(r => ({
        ...r,
        [test.id]: {
          ...raw,
          passed,
          headerPreview:  test.headerPreview(tokens),
          validationStep: test.step,
          explain:        test.explain,
          expectStatus:   test.expectStatus,
          expectBehavior: test.expectBehavior,
        },
      }));
    } catch (err) {
      setResults(r => ({
        ...r,
        [test.id]: {
          status: 0, ok: false, elapsed: 0, passed: false,
          body:           { error: err.message },
          headerPreview:  "(could not acquire token)",
          validationStep: test.step,
          explain:        test.explain,
          expectStatus:   test.expectStatus,
          expectBehavior: test.expectBehavior,
          acquisitionError: true,
        },
      }));
    }
    setRunning(r => ({ ...r, [test.id]: false }));
  }, [getApiToken, getGraphToken]);

  const runAll = useCallback(async () => {
    setRunningAll(true);
    setResults({});
    setApiToken(null);
    setGraphToken(null);
    for (const test of TESTS) {
      await runTest(test);
      await new Promise(res => setTimeout(res, 350)); // gap keeps server logs readable
    }
    setRunningAll(false);
  }, [runTest]);

  const passCount = Object.values(results).filter(r => r.passed).length;
  const doneCount = Object.keys(results).length;

  return (
    <div className="tp-wrapper">

      {/* ── Collapsible toggle ────────────────────────────────────────────── */}
      <button className="tp-toggle" onClick={() => setIsOpen(o => !o)}>
        <span className="tp-toggle-chevron">{isOpen ? "▲" : "▼"}</span>
        <span className="tp-toggle-title">🧪 Middleware Testing Panel</span>
        <span className="tp-toggle-hint">
          {isOpen
            ? "click to collapse"
            : "6 test cases — simulate bad requests without leaving the page"}
        </span>
        {doneCount > 0 && (
          <span className={`tp-score ${passCount === doneCount ? "tp-score-all" : "tp-score-partial"}`}>
            {passCount}/{doneCount} behaved as expected
          </span>
        )}
      </button>

      {/* ── Panel body ────────────────────────────────────────────────────── */}
      {isOpen && (
        <div className="tp-body">

          {/* Toolbar */}
          <div className="tp-toolbar">
            <p className="tp-intro-text">
              Every test calls <code>GET /weather?zipcode={TEST_ZIP}</code> but with a
              different Authorization header. <strong>Green</strong> = server responded
              exactly as expected. <strong>Red</strong> = something unexpected happened.
              Watch your FastAPI terminal while these run.
            </p>
            <div className="tp-toolbar-btns">
              <button className="tp-btn-clear" onClick={() => setResults({})} disabled={runningAll}>
                Clear
              </button>
              <button className="tp-btn-run-all" onClick={runAll} disabled={runningAll}>
                {runningAll ? "Running…" : "▶ Run All 6"}
              </button>
            </div>
          </div>

          {/* Test cards */}
          <div className="tp-grid">
            {TESTS.map(test => {
              const result = results[test.id];
              const busy   = running[test.id] || runningAll;

              return (
                <TestCard
                  key={test.id}
                  test={test}
                  result={result}
                  busy={busy}
                  onRun={() => runTest(test)}
                />
              );
            })}
          </div>

          {/* Thunder Client / Postman guide */}
          <ExternalToolGuide />
        </div>
      )}
    </div>
  );
}

// ── Individual test card ──────────────────────────────────────────────────────

function TestCard({ test, result, busy, onRun }) {
  const [expanded, setExpanded] = useState(false);

  const cardClass = result
    ? result.passed ? "tp-card tp-card-pass" : "tp-card tp-card-fail"
    : "tp-card";

  return (
    <div className={cardClass}>
      {/* Header row */}
      <div className="tp-card-header">
        <div className="tp-card-title-row">
          <span className="tp-card-num">#{test.number}</span>
          <span className="tp-card-name">{test.name}</span>
          <span className={`tp-expected-badge ${test.expectBehavior === "ALLOWED" ? "badge-allowed" : "badge-rejected"}`}>
            Expect {test.expectStatus} {STATUS_TEXT[test.expectStatus]}
          </span>
        </div>
        <button className="tp-run-btn" onClick={onRun} disabled={busy}>
          {busy ? <span className="tp-spinner" /> : "Run"}
        </button>
      </div>

      {/* Result rows (only visible after run) */}
      {result && (
        <div className="tp-result-block">

          {/* Status line */}
          <div className="tp-result-row">
            <div className="tp-result-left">
              <span className={`tp-status-pill ${statusClass(result.status)}`}>
                {result.status} {STATUS_TEXT[result.status] || "Error"}
              </span>
              <span className={`tp-verdict ${result.passed ? "verdict-pass" : "verdict-fail"}`}>
                {result.passed
                  ? `✓ Behaved as expected`
                  : `✗ Expected ${result.expectStatus}, got ${result.status}`
                }
              </span>
            </div>
            <span className="tp-elapsed">{result.elapsed}ms</span>
          </div>

          {/* Auth header sent */}
          <div className="tp-detail-row">
            <span className="tp-detail-label">Authorization header sent</span>
            <code className="tp-detail-value tp-auth-value">{result.headerPreview}</code>
          </div>

          {/* Which step caught it */}
          <div className="tp-detail-row">
            <span className="tp-detail-label">Middleware step</span>
            <span className="tp-detail-value tp-step-value">{result.validationStep}</span>
          </div>

          {/* Server response body */}
          <div className="tp-detail-row">
            <span className="tp-detail-label">Raw server response</span>
            <pre className="tp-raw-response">
              {JSON.stringify(result.body, null, 2)}
            </pre>
          </div>

          {/* Expandable explanation */}
          <button className="tp-explain-toggle" onClick={() => setExpanded(e => !e)}>
            {expanded ? "▲ Hide explanation" : "▼ Why does this happen?"}
          </button>
          {expanded && (
            <pre className="tp-explain-text">{result.explain}</pre>
          )}

          {result.acquisitionError && (
            <p className="tp-acq-error">
              Could not acquire token from MSAL — are you logged in?
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Thunder Client / Postman guide ────────────────────────────────────────────

function ExternalToolGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="ext-guide">
      <button className="ext-guide-toggle" onClick={() => setOpen(o => !o)}>
        {open ? "▲" : "▼"} How to run these same tests in Thunder Client or Postman
      </button>

      {open && (
        <div className="ext-guide-body">

          <section className="ext-section">
            <h4>Step 1 — Get your real JWT from the browser</h4>
            <p>While logged in to <code>localhost:3001</code>, open DevTools and run this in the Console tab:</p>
            <pre className="ext-code">{`// Paste into browser DevTools console (F12 → Console)
// Finds your api-scoped access token in sessionStorage
const keys = Object.keys(sessionStorage);
const key  = keys.find(k => k.toLowerCase().includes("accesstoken"));
const jwt  = key ? JSON.parse(sessionStorage[key]).secret : null;
console.log(jwt);       // copy this whole string
console.log("aud:", JSON.parse(atob(jwt.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")+  "==")).aud);`}</pre>
          </section>

          <section className="ext-section">
            <h4>Step 2 — Base request setup</h4>
            <div className="ext-request-table">
              <div className="ext-row"><span className="ext-key">Method</span><code>GET</code></div>
              <div className="ext-row"><span className="ext-key">URL</span><code>http://localhost:8000/weather?zipcode=95814</code></div>
              <div className="ext-row"><span className="ext-key">Header</span><code>Authorization: Bearer {"<paste your JWT>"}</code></div>
            </div>
          </section>

          <section className="ext-section">
            <h4>Step 3 — Reproduce each test</h4>
            <div className="ext-tests-table">
              <div className="ext-test-row ext-test-header">
                <span>#</span><span>Test</span><span>Change this</span><span>Expected</span>
              </div>
              {[
                { n:1, name:"Valid",          change:"Keep the real JWT",                                       exp:"200" },
                { n:2, name:"No Token",       change:"Delete the Authorization header entirely",                exp:"401" },
                { n:3, name:"Fake Token",     change:"Authorization: Bearer thisisafaketoken123",               exp:"401" },
                { n:4, name:"Tampered",       change:"Edit ~10 chars in the middle section of your JWT",        exp:"401" },
                { n:5, name:"Expired",        change:"Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6ImV4cGlyZWQifQ.eyJleHAiOjE2MDAwMDAwMDB9.FAKE", exp:"401" },
                { n:6, name:"Wrong Audience", change:"Use a token acquired with User.Read scope (Graph token)",  exp:"401" },
              ].map(t => (
                <div key={t.n} className="ext-test-row">
                  <span className="ext-test-n">#{t.n}</span>
                  <span className="ext-test-name">{t.name}</span>
                  <code className="ext-test-change">{t.change}</code>
                  <span className={`ext-test-exp ${t.exp === "200" ? "exp-200" : "exp-401"}`}>{t.exp}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="ext-section">
            <h4>Postman Environment Variables (optional)</h4>
            <p>Create a Postman environment with:</p>
            <pre className="ext-code">{`BASE_URL      = http://localhost:8000
REAL_TOKEN    = (paste JWT here — refresh after 1 hour)
FAKE_TOKEN    = thisisafaketoken123
TEST_ZIP      = 95814`}</pre>
            <p>Then use <code>{"{{REAL_TOKEN}}"}</code> in the Authorization header value.</p>
          </section>

        </div>
      )}
    </div>
  );
}
