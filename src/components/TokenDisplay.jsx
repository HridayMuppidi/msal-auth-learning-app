import React, { useState, useMemo } from "react";
import { decodeJWT } from "../utils/tokenParser";

export default function TokenDisplay({
  rawToken,
  decodedClaims,
  explanation,
  claimExplanations,
  error,
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied]   = useState(false);

  // Decode the raw JWT if we have one; otherwise fall back to the
  // pre-decoded claims object that MSAL already parsed for us.
  const decoded = useMemo(() => {
    if (rawToken) return decodeJWT(rawToken);
    if (decodedClaims) return { header: null, payload: decodedClaims };
    return null;
  }, [rawToken, decodedClaims]);

  const copyToken = () => {
    navigator.clipboard.writeText(rawToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (error) {
    return (
      <div className="token-display">
        <div className="token-error">
          <h3>Could not acquire token</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!rawToken && !decodedClaims) {
    return (
      <div className="token-display">
        <div className="token-loading">
          <div className="spinner" />
          <p>Acquiring token silently…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="token-display">
      {/* Plain-English explanation of what this token is for */}
      <div className="token-explanation">{explanation}</div>

      {/* Switch between decoded view and raw JWT view */}
      <div className="token-section-tabs">
        <button
          className={`section-tab${!showRaw ? " active" : ""}`}
          onClick={() => setShowRaw(false)}
        >
          Decoded Claims
        </button>
        {rawToken && (
          <button
            className={`section-tab${showRaw ? " active" : ""}`}
            onClick={() => setShowRaw(true)}
          >
            Raw JWT
          </button>
        )}
      </div>

      {showRaw && rawToken ? (
        // ── Raw JWT View ────────────────────────────────────────────────
        <div className="raw-token-container">
          <div className="raw-token-parts">
            <div className="token-part header">
              <span className="part-label">Header (red)</span>
              <span className="part-value">{rawToken.split(".")[0]}</span>
            </div>
            <span className="dot">.</span>
            <div className="token-part payload">
              <span className="part-label">Payload (green)</span>
              <span className="part-value">{rawToken.split(".")[1]}</span>
            </div>
            <span className="dot">.</span>
            <div className="token-part signature">
              <span className="part-label">Signature (blue)</span>
              <span className="part-value">{rawToken.split(".")[2]}</span>
            </div>
          </div>

          <button className="copy-btn" onClick={copyToken}>
            {copied ? "Copied!" : "Copy Token"}
          </button>

          <p className="raw-token-tip">
            Paste this into{" "}
            <a href="https://jwt.ms" target="_blank" rel="noreferrer">jwt.ms</a>{" "}
            or{" "}
            <a href="https://jwt.io" target="_blank" rel="noreferrer">jwt.io</a>{" "}
            to inspect and verify it visually.
          </p>
        </div>
      ) : (
        // ── Decoded Claims View ─────────────────────────────────────────
        <div className="claims-container">
          {decoded?.header && (
            <ClaimsSection
              title="Header — Algorithm & Token Type"
              claims={decoded.header}
              explanations={{
                alg: "Algorithm — the cryptographic algorithm Microsoft used to sign this token. RS256 = RSA with SHA-256.",
                typ: "Type — always 'JWT' for JSON Web Tokens.",
                kid: "Key ID — tells token validators which of Microsoft's public keys to use to verify the signature.",
                x5t: "X.509 Certificate Thumbprint — another way to identify the signing key.",
              }}
            />
          )}

          {decoded?.payload && (
            <ClaimsSection
              title="Payload — The Actual Data (Claims)"
              claims={decoded.payload}
              explanations={claimExplanations}
            />
          )}

          {rawToken && (
            <div className="claims-section">
              <h3 className="claims-section-title">Signature — Tamper-Proof Seal</h3>
              <p className="signature-note">
                The signature is a cryptographic hash created by Microsoft using their{" "}
                <strong>private key</strong>. Anyone can verify it using Microsoft's{" "}
                <strong>public keys</strong> published at their JWKS endpoint
                (the URL is in the <code>iss</code> claim + <code>/.well-known/openid-configuration</code>).
                If even one character in the token is changed, the signature check fails
                and the token is rejected. This is what makes JWTs trustworthy.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Claims Section ───────────────────────────────────────────────────────────

function ClaimsSection({ title, claims, explanations }) {
  return (
    <div className="claims-section">
      <h3 className="claims-section-title">{title}</h3>
      <div className="claims-grid">
        {Object.entries(claims).map(([key, value]) => (
          <ClaimRow
            key={key}
            claimKey={key}
            claimValue={value}
            explanation={explanations?.[key]}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Individual Claim Row ─────────────────────────────────────────────────────

function ClaimRow({ claimKey, claimValue, explanation }) {
  const [expanded, setExpanded] = useState(false);

  const formatValue = (val) => {
    // Unix timestamps → human-readable date + raw number
    if (typeof val === "number" && ["iat", "nbf", "exp"].includes(claimKey)) {
      return `${new Date(val * 1000).toLocaleString()}  (${val})`;
    }
    if (Array.isArray(val))       return val.join(", ");
    if (typeof val === "object")  return JSON.stringify(val, null, 2);
    return String(val);
  };

  return (
    <div className={`claim-row${explanation ? " has-explanation" : ""}`}>
      <div
        className="claim-key-wrapper"
        onClick={() => explanation && setExpanded((e) => !e)}
        title={explanation ? "Click to see what this means" : undefined}
      >
        <code className="claim-key">{claimKey}</code>
        {explanation && (
          <span className="explain-icon">{expanded ? "▲" : "▼"}</span>
        )}
      </div>

      <div className="claim-value">{formatValue(claimValue)}</div>

      {expanded && explanation && (
        <div className="claim-explanation">{explanation}</div>
      )}
    </div>
  );
}
