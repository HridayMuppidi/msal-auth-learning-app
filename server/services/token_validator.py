"""
Token Validator
===============
Validates Azure AD JWT tokens by:
  1. Fetching Microsoft's public signing keys (JWKS) — cached for 1 hour
  2. Finding the key that matches the token's 'kid' header
  3. Verifying the cryptographic signature (RS256)
  4. Checking expiry, issuer, and tenant ID

Why is a JWKS needed?
  Azure AD signs every JWT with an RSA private key and publishes the matching
  public keys at the JWKS URL. Anyone can fetch these public keys and use them
  to VERIFY the signature — but only Microsoft can SIGN with the private key.
  This is the core trust model of public-key cryptography.

Why cache the JWKS?
  The keys rarely change (only during key rotation). Fetching on every request
  would be slow and would hammer Microsoft's servers. 1-hour cache is the
  industry standard — short enough to pick up rotations, long enough to be fast.
"""

import os
import time
import logging
import httpx
from typing import Optional
from jose import jwt, JWTError

logger = logging.getLogger(__name__)


class TokenValidator:
    """Stateful validator — one instance shared across all requests via AuthMiddleware."""

    _CACHE_TTL = 3600  # seconds — how long to keep JWKS before re-fetching

    def __init__(self) -> None:
        self.jwks_uri  = os.getenv("JWKS_URI")
        self.tenant_id = os.getenv("TENANT_ID")
        self.client_id = os.getenv("CLIENT_ID")

        if not all([self.jwks_uri, self.tenant_id, self.client_id]):
            raise RuntimeError(
                "Missing required environment variables: JWKS_URI, TENANT_ID, CLIENT_ID"
            )

        self._jwks_cache:      Optional[dict] = None
        self._jwks_fetched_at: float          = 0.0

    # ── JWKS Caching ──────────────────────────────────────────────────────────

    async def _fetch_jwks(self) -> dict:
        """Return cached JWKS or refresh from Azure AD if TTL expired."""
        now = time.monotonic()
        if self._jwks_cache and (now - self._jwks_fetched_at) < self._CACHE_TTL:
            return self._jwks_cache
        return await self._refresh_jwks()

    async def _refresh_jwks(self) -> dict:
        """Unconditionally fetch fresh JWKS from Azure AD and cache it."""
        logger.info("Fetching JWKS from Azure AD → %s", self.jwks_uri)
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(self.jwks_uri)
            response.raise_for_status()
        self._jwks_cache      = response.json()
        self._jwks_fetched_at = time.monotonic()
        logger.info("JWKS cached: %d signing keys available", len(self._jwks_cache.get("keys", [])))
        return self._jwks_cache

    def _find_key(self, jwks: dict, kid: str) -> Optional[dict]:
        """Return the JWK whose 'kid' matches the token header's 'kid'."""
        return next(
            (k for k in jwks.get("keys", []) if k.get("kid") == kid),
            None,
        )

    # ── Validation ────────────────────────────────────────────────────────────

    async def validate(self, token: str) -> dict:
        """
        Fully validate a JWT. Raises on any failure. Returns decoded claims on success.

        Steps:
          1. Read the unverified header to get 'kid' (which signing key to use)
          2. Fetch the matching public key from JWKS (cached)
          3. Try decoding against each valid (audience, issuer) combination
          4. Verify the tenant ID in the claims matches our expected tenant

        Why multiple audiences?
          In a production app, you'd register a custom API scope
          (e.g. api://your-app-id/Weather.Read) and the access token would have
          aud = your client ID. Here, since no custom scope exists, the React app
          sends a Graph-scoped access token (aud = Graph's app ID). We accept
          both to support this learning setup.
        """
        # Step 1: Read header without verification (safe — just inspecting metadata)
        try:
            header = jwt.get_unverified_header(token)
        except JWTError as exc:
            raise ValueError(f"Malformed JWT — cannot read header: {exc}") from exc

        alg = header.get("alg", "")
        kid = header.get("kid", "")

        if alg != "RS256":
            raise ValueError(f"Rejected: algorithm '{alg}' is not allowed. Only RS256 is accepted.")

        # Step 2: Find the matching public key
        jwks = await self._fetch_jwks()
        key  = self._find_key(jwks, kid)

        if key is None:
            # kid not found — Azure may have just rotated keys. Force one refresh.
            logger.warning("kid='%s' not in cached JWKS — forcing refresh", kid)
            jwks = await self._refresh_jwks()
            key  = self._find_key(jwks, kid)

        if key is None:
            raise ValueError(f"No public key found for kid='{kid}' — token cannot be verified")

        # Step 3: Try every valid (audience × issuer) combination.
        # Azure AD v2.0 issues tokens with one of these issuers:
        valid_issuers = [
            f"https://login.microsoftonline.com/{self.tenant_id}/v2.0",
            f"https://sts.windows.net/{self.tenant_id}/",
        ]
        # And one of these audiences (see docstring above for why):
        valid_audiences = [
            self.client_id,                              # ID token or own-API access token
            "https://graph.microsoft.com",              # Graph access token (most common)
            "00000003-0000-0000-c000-000000000000",     # Graph access token (alternate form)
        ]

        last_error: Optional[Exception] = None

        for audience in valid_audiences:
            for issuer in valid_issuers:
                try:
                    claims = jwt.decode(
                        token,
                        key,
                        algorithms=["RS256"],
                        audience=audience,
                        issuer=issuer,
                        options={
                            "verify_exp": True,   # Reject expired tokens
                            "verify_nbf": True,   # Reject tokens not yet valid
                            "verify_iat": True,   # Verify issued-at is in the past
                        },
                    )

                    # Step 4: Tenant check — the token must belong to Joe's tenant.
                    # This prevents tokens from OTHER Azure AD tenants from working
                    # even if they have a valid signature.
                    token_tid = claims.get("tid")
                    if token_tid and token_tid != self.tenant_id:
                        raise JWTError(
                            f"Token tenant '{token_tid}' does not match expected '{self.tenant_id}'"
                        )

                    user_id = (
                        claims.get("preferred_username")
                        or claims.get("upn")
                        or claims.get("oid", "unknown")
                    )
                    logger.info("✓ Token valid | user=%s | aud=%s", user_id, audience)
                    return claims

                except JWTError as exc:
                    last_error = exc
                    continue

        raise JWTError(f"Token rejected — all validation attempts failed. Last error: {last_error}")
