"""
Auth Middleware
==============
Intercepts EVERY incoming HTTP request and validates the Bearer JWT
before the request reaches any route handler.

Also intercepts the outgoing response — if the upstream weather API
returns an unexpected structure, the weather service raises a ValueError
which becomes a 502 here, preventing malformed data from reaching the client.

Flow:
  Request →  extract Bearer token
          →  validate with TokenValidator (signature + claims)
          →  attach decoded claims to request.state.user
          →  pass to route handler
          ←  route returns response
          ←  response passes back through CORS middleware to browser
"""

import logging
import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from jose import JWTError
from services.token_validator import TokenValidator

logger = logging.getLogger(__name__)

# Paths that bypass JWT validation
PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}


class AuthMiddleware(BaseHTTPMiddleware):

    def __init__(self, app) -> None:
        super().__init__(app)
        # One TokenValidator instance for the lifetime of the server.
        # Its JWKS cache is shared across all requests — this is intentional.
        self.validator = TokenValidator()
        logger.info("AuthMiddleware initialised (TokenValidator ready)")

    async def dispatch(self, request: Request, call_next):

        # ── Skip auth for OPTIONS preflight and public paths ─────────────────
        if request.method == "OPTIONS" or request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        # ── Extract Bearer token ──────────────────────────────────────────────
        auth_header = request.headers.get("Authorization", "")

        if not auth_header:
            return self._reject(
                401,
                "Missing Authorization header",
                "Add 'Authorization: Bearer <your_access_token>' to the request.",
            )

        if not auth_header.startswith("Bearer "):
            return self._reject(
                401,
                "Invalid Authorization format",
                "Header must be exactly: Authorization: Bearer <token>",
            )

        token = auth_header.removeprefix("Bearer ").strip()

        if not token:
            return self._reject(401, "Empty token", "No token found after 'Bearer '.")

        # ── Validate the JWT ──────────────────────────────────────────────────
        try:
            claims = await self.validator.validate(token)

        except httpx.RequestError as exc:
            # JWKS endpoint unreachable — not the client's fault
            logger.error("Could not reach Azure AD JWKS endpoint: %s", exc)
            return self._reject(
                503,
                "Auth service unavailable",
                "Could not fetch signing keys from Azure AD. Try again shortly.",
            )

        except (JWTError, ValueError) as exc:
            logger.warning("Token validation failed: %s", exc)
            return self._reject(401, "Invalid or expired token", str(exc))

        # ── Token is valid — attach claims and continue ───────────────────────
        request.state.user = claims
        return await call_next(request)

    @staticmethod
    def _reject(status: int, error: str, detail: str) -> JSONResponse:
        return JSONResponse(
            status_code=status,
            content={"error": error, "detail": detail},
        )
