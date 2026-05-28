"""
Auth Middleware — with detailed step-by-step logging
=====================================================
Every line of the auth flow is logged so you can watch it in your terminal.

Log format (set in main.py):
  HH:MM:SS  [LEVEL   ]  middleware.auth — message

What you will see for a SUCCESSFUL request:
  ► GET  /weather?zipcode=95814
  Step 1  Auth header .......... FOUND ✓
  Step 2  Token preview ........ eyJ0eXAiOiJKV1QiLCJhb...  (50 chars)
  Step 3  Handing to TokenValidator →
  (TokenValidator logs appear here)
  ✅ APPROVED — user=you@example.com  (took 143ms)
  ✅ COMPLETE — GET /weather → 200  (total 1.2s)

What you will see for a REJECTED request:
  ► POST /weather
  Step 1  Auth header .......... MISSING ✗
  ❌ REJECTED (401) — Missing Authorization header
"""

import time
import logging
import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from jose import JWTError
from services.token_validator import TokenValidator

logger = logging.getLogger("middleware.auth")

PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}

_LINE = "─" * 62


class AuthMiddleware(BaseHTTPMiddleware):

    def __init__(self, app) -> None:
        super().__init__(app)
        self.validator = TokenValidator()
        logger.info("AuthMiddleware ready — TokenValidator initialised")

    async def dispatch(self, request: Request, call_next):
        t_start = time.monotonic()

        # ── Skip auth silently for OPTIONS and public paths ───────────────────
        if request.method == "OPTIONS":
            return await call_next(request)

        if request.url.path in PUBLIC_PATHS:
            logger.info("⬡ PUBLIC  %s %s (no auth required)", request.method, request.url.path)
            return await call_next(request)

        # ── Log request banner ────────────────────────────────────────────────
        logger.info(_LINE)
        logger.info("► %-6s %s", request.method, str(request.url))
        logger.info(_LINE)

        # ── Step 1: Check for Authorization header ────────────────────────────
        auth_header = request.headers.get("Authorization", "")

        if not auth_header:
            logger.warning("  Step 1  Auth header .......... MISSING ✗")
            logger.warning("❌ REJECTED (401) — Missing Authorization header")
            return self._reject(401, "Missing Authorization header",
                                "Add 'Authorization: Bearer <access_token>' to your request.")

        logger.info("  Step 1  Auth header .......... FOUND ✓")

        # ── Step 2: Validate Bearer format ────────────────────────────────────
        if not auth_header.startswith("Bearer "):
            scheme = auth_header.split(" ")[0] if " " in auth_header else auth_header[:20]
            logger.warning("  Step 2  Scheme ............... '%s' ✗  (must be 'Bearer')", scheme)
            logger.warning("❌ REJECTED (401) — Wrong auth scheme: '%s'", scheme)
            return self._reject(401, "Invalid Authorization scheme",
                                f"Got '{scheme}', expected 'Bearer'. "
                                f"Header must be: Authorization: Bearer <token>")

        token = auth_header.removeprefix("Bearer ").strip()

        if not token:
            logger.warning("  Step 2  Token ................ EMPTY ✗")
            logger.warning("❌ REJECTED (401) — Empty token after 'Bearer '")
            return self._reject(401, "Empty token", "No token was found after 'Bearer '.")

        # ── Step 3: Show token preview (first 50 chars) ───────────────────────
        preview = token[:50] + "…" if len(token) > 50 else token
        logger.info("  Step 3  Token preview ........ %s", preview)
        logger.info("  Step 3  Token length ......... %d characters", len(token))

        # Count the JWT parts so we know early if it's malformed
        parts = token.count(".")
        if parts != 2:
            logger.warning("  Step 3  JWT structure ........ %d dots found ✗  (need exactly 2)", parts)
            logger.warning("❌ REJECTED (401) — Not a JWT: found %d dot(s), need 2", parts)
            return self._reject(401, "Malformed token",
                                f"A JWT must have exactly 3 parts separated by dots. "
                                f"This token has {parts + 1} part(s).")

        logger.info("  Step 3  JWT structure ........ 3 parts ✓  (header.payload.signature)")

        # ── Step 4: Validate the JWT via TokenValidator ───────────────────────
        logger.info("  Step 4  Handing to TokenValidator →")

        try:
            claims = await self.validator.validate(token)

        except httpx.RequestError as exc:
            elapsed_ms = (time.monotonic() - t_start) * 1000
            logger.error("  Step 4  JWKS fetch FAILED .... %s", exc)
            logger.error("❌ REJECTED (503) — Cannot reach Azure AD  (took %.0fms)", elapsed_ms)
            return self._reject(503, "Auth service unavailable",
                                "Could not fetch signing keys from Azure AD. Try again shortly.")

        except (JWTError, ValueError) as exc:
            elapsed_ms = (time.monotonic() - t_start) * 1000
            logger.warning("  Step 4  Validation FAILED .... %s", exc)
            logger.warning("❌ REJECTED (401) — %s  (took %.0fms)", exc, elapsed_ms)
            return self._reject(401, "Invalid or expired token", str(exc))

        # ── Step 5: Token valid — attach claims and pass request through ──────
        elapsed_ms = (time.monotonic() - t_start) * 1000
        user = (claims.get("preferred_username")
                or claims.get("upn")
                or claims.get("oid", "unknown"))
        logger.info("  Step 5  Claims attached ...... user=%s  tid=%s",
                    user, claims.get("tid", "?"))
        logger.info("✅ APPROVED — user=%-40s  (auth took %.0fms)", user, elapsed_ms)

        request.state.user = claims
        t_route_start = time.monotonic()
        response = await call_next(request)

        total_ms = (time.monotonic() - t_start) * 1000
        route_ms = (time.monotonic() - t_route_start) * 1000
        logger.info("✅ COMPLETE — %-6s %s → %d  (route: %.0fms | total: %.0fms)",
                    request.method, request.url.path, response.status_code, route_ms, total_ms)
        return response

    @staticmethod
    def _reject(status: int, error: str, detail: str) -> JSONResponse:
        return JSONResponse(status_code=status, content={"error": error, "detail": detail})
