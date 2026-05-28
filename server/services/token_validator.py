"""
Token Validator — with detailed step-by-step logging
=====================================================
Validates Azure AD JWTs by verifying the cryptographic signature against
Microsoft's public JWKS keys, then checking every security-relevant claim.

BUG FIX — "Signature verification failed" on valid tokens
---------------------------------------------------------
Azure AD's JWKS includes extra fields on each key: x5c (X.509 cert chain),
x5t (cert thumbprint), x5t#S256 (SHA-256 thumbprint). python-jose v3.3 tries
to construct the RSA key from x5c FIRST, and if x5c parsing glitches for any
reason, it raises "Signature verification failed" — even though the n/e RSA
math would work fine.

FIX: strip the JWK down to ONLY the RSA parameters (kty, n, e) before passing
to jwt.decode(). This forces python-jose to use pure RSA math, bypassing x5c.

Log format (what you will see in the terminal):
  [4a] JWT header .............. alg=RS256  kid=2ZQpJ3Up8bJIWS0...
  [4b] JWKS cache .............. HIT  (fetched 142s ago, 3458s left)
  [4c] Key found ............... kid=2ZQpJ3Up8bJIWS0...  kty=RSA  ✓
  [4d] RSA key ................. using n + e params only (x5c stripped)
  [4e] Try 1/6 ................. aud=0c7237fb...  iss=.../v2.0  → ✗ InvalidAudienceError
  [4e] Try 2/6 ................. aud=0c7237fb...  iss=.../sts.windows  → ✗ InvalidAudienceError
  [4e] Try 3/6 ................. aud=https://graph.microsoft.com  iss=.../v2.0  → ✓ PASS
  [4f] Tenant check ............ bf2489d8 == bf2489d8  ✓
  [4g] Token VALID ............. user=you@example.com  aud=https://graph.microsoft.com
"""

import os
import time
import logging
import httpx
from typing import Optional
from jose import jwt, JWTError

logger = logging.getLogger("services.token_validator")


class TokenValidator:
    _CACHE_TTL = 3600  # 1 hour

    def __init__(self) -> None:
        self.jwks_uri  = os.getenv("JWKS_URI")
        self.tenant_id = os.getenv("TENANT_ID")
        self.client_id = os.getenv("CLIENT_ID")

        if not all([self.jwks_uri, self.tenant_id, self.client_id]):
            raise RuntimeError("Missing env vars: JWKS_URI, TENANT_ID, CLIENT_ID")

        self._jwks_cache:      Optional[dict] = None
        self._jwks_fetched_at: float          = 0.0

    # ── JWKS helpers ──────────────────────────────────────────────────────────

    async def _get_jwks(self) -> dict:
        now = time.monotonic()
        age = now - self._jwks_fetched_at
        if self._jwks_cache and age < self._CACHE_TTL:
            remaining = int(self._CACHE_TTL - age)
            logger.info("  [4b] JWKS cache .............. HIT  (fetched %.0fs ago, %ds left)",
                        age, remaining)
            return self._jwks_cache
        return await self._refresh_jwks()

    async def _refresh_jwks(self) -> dict:
        logger.info("  [4b] JWKS cache .............. MISS — fetching from Azure AD")
        logger.info("       URL: %s", self.jwks_uri)
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(self.jwks_uri)
            resp.raise_for_status()
        data = resp.json()
        self._jwks_cache      = data
        self._jwks_fetched_at = time.monotonic()
        key_count = len(data.get("keys", []))
        kids = [k.get("kid", "?")[:20] for k in data.get("keys", [])]
        logger.info("  [4b] JWKS refreshed .......... %d key(s) cached  kids=%s",
                    key_count, kids)
        return data

    def _find_key(self, jwks: dict, kid: str) -> Optional[dict]:
        return next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)

    # ── Main validation ───────────────────────────────────────────────────────

    async def validate(self, token: str) -> dict:
        # ── Step 4a: Decode header (no signature check — just reading metadata) ─
        try:
            header = jwt.get_unverified_header(token)
        except JWTError as exc:
            logger.warning("  [4a] JWT header .............. UNREADABLE ✗  %s", exc)
            raise ValueError(f"Cannot read JWT header: {exc}") from exc

        alg = header.get("alg", "?")
        kid = header.get("kid", "?")

        logger.info("  [4a] JWT header .............. alg=%s  kid=%s…", alg, kid[:20])

        if alg != "RS256":
            logger.warning("  [4a] Algorithm ............... '%s' NOT ALLOWED ✗  (only RS256)", alg)
            raise ValueError(f"Algorithm '{alg}' rejected — only RS256 is accepted.")

        logger.info("  [4a] Algorithm ............... RS256 ✓")

        # ── Step 4b: Fetch JWKS (logged inside _get_jwks) ───────────────────────
        jwks = await self._get_jwks()

        # ── Step 4c: Find matching public key ───────────────────────────────────
        key = self._find_key(jwks, kid)

        if key is None:
            logger.warning("  [4c] Key lookup .............. kid='%s' NOT IN CACHE ⚠ — forcing refresh", kid)
            jwks = await self._refresh_jwks()
            key  = self._find_key(jwks, kid)

        if key is None:
            available = [k.get("kid", "?")[:20] for k in jwks.get("keys", [])]
            logger.error("  [4c] Key lookup .............. kid='%s' NOT FOUND ✗", kid)
            logger.error("       Available kids: %s", available)
            raise ValueError(
                f"No public key for kid='{kid}'. "
                f"Available: {available}. "
                "Azure may have rotated keys — try again."
            )

        logger.info("  [4c] Key found ............... kid=%s…  kty=%s  use=%s  ✓",
                    kid[:20], key.get("kty"), key.get("use"))

        # ── Step 4d: Strip key to RSA math params only ──────────────────────────
        # WHY: python-jose tries x5c (certificate chain) first. If x5c parsing
        # fails for any reason, it raises "Signature verification failed" even
        # though n+e would work. Stripping to n+e forces the correct path.
        rsa_key = {
            "kty": key["kty"],
            "n":   key["n"],
            "e":   key["e"],
        }
        stripped_fields = [f for f in ("x5c", "x5t", "x5t#S256", "alg", "use", "kid") if f in key]
        logger.info("  [4d] RSA key ................. using n+e params only  (stripped: %s)",
                    stripped_fields)

        # ── Step 4e: Try every (audience × issuer) combination ──────────────────
        # WeatherTab now requests api://clientId/Weather.Read so the token's aud is
        # "api://clientId" — that must be the FIRST entry so it matches on attempt 1.
        valid_audiences = [
            f"api://{self.client_id}",                   # ✅ Custom API scope  → aud = api://clientId
            self.client_id,                              # Client ID GUID alone  → aud = bare GUID
            "https://graph.microsoft.com",              # Graph access token    → aud = graph URL
            "00000003-0000-0000-c000-000000000000",     # Graph app ID alternate
        ]
        valid_issuers = [
            f"https://login.microsoftonline.com/{self.tenant_id}/v2.0",
            f"https://sts.windows.net/{self.tenant_id}/",
        ]

        total_combos  = len(valid_audiences) * len(valid_issuers)
        attempt       = 0
        last_error: Optional[Exception] = None

        for audience in valid_audiences:
            for issuer in valid_issuers:
                attempt += 1
                aud_short = audience if len(audience) < 36 else audience[:35] + "…"
                iss_short = issuer.replace("https://login.microsoftonline.com/", ".../")
                iss_short = iss_short.replace("https://sts.windows.net/", "sts/")

                try:
                    claims = jwt.decode(
                        token,
                        rsa_key,
                        algorithms=["RS256"],
                        audience=audience,
                        issuer=issuer,
                        options={
                            "verify_exp": True,
                            "verify_nbf": True,
                            "verify_iat": True,
                        },
                    )

                    logger.info("  [4e] Try %d/%d ................ aud=%-42s iss=%s  → ✓ PASS",
                                attempt, total_combos, aud_short, iss_short)

                    # ── Step 4f: Extra tenant check ──────────────────────────────
                    token_tid = claims.get("tid")
                    if token_tid and token_tid != self.tenant_id:
                        logger.warning("  [4f] Tenant check ............ %s != %s ✗ MISMATCH",
                                       token_tid, self.tenant_id)
                        raise JWTError(
                            f"Token tenant '{token_tid}' ≠ expected '{self.tenant_id}'. "
                            "This token is from a different Azure AD tenant."
                        )

                    logger.info("  [4f] Tenant check ............ %s == %s ✓",
                                token_tid, self.tenant_id)

                    # ── Step 4g: Log success summary ─────────────────────────────
                    user = (claims.get("preferred_username")
                            or claims.get("upn")
                            or claims.get("oid", "unknown"))
                    exp  = claims.get("exp", 0)
                    ttl  = max(0, int(exp - time.time()))

                    logger.info("  [4g] Token VALID ............. user=%s", user)
                    logger.info("       aud=%s", audience)
                    logger.info("       iss=%s", claims.get("iss"))
                    logger.info("       oid=%s", claims.get("oid"))
                    logger.info("       exp=%d  (expires in %ds / %.1fmin)", exp, ttl, ttl / 60)
                    logger.info("       scp=%s", claims.get("scp") or claims.get("roles") or "(none)")

                    return claims

                except JWTError as exc:
                    error_type = type(exc).__name__
                    logger.warning("  [4e] Try %d/%d ................ aud=%-42s iss=%s  → ✗ %s",
                                   attempt, total_combos, aud_short, iss_short, error_type)
                    logger.debug("       Detail: %s", exc)
                    last_error = exc
                    continue

        logger.error("  [4e] ALL %d COMBINATIONS FAILED ✗", total_combos)
        logger.error("       Last error: %s", last_error)
        logger.error("       Hint: if error is 'Signature verification failed', check that")
        logger.error("             the JWKS kid matches the token kid above.")
        logger.error("             If error is 'InvalidAudienceError', the token's aud claim")
        logger.error("             does not match any expected value (see authConfig.js).")
        raise JWTError(
            f"Token rejected — all {total_combos} validation attempts failed. "
            f"Last error: {last_error}"
        )
