"""
FastAPI Weather Server
======================
Runs on http://localhost:8000

Every request passes through two layers before hitting a route:

  Browser → [CORSMiddleware] → [AuthMiddleware] → route handler
                ↑                     ↑
         Handles OPTIONS         Validates JWT
         preflight and           against Azure AD
         adds CORS headers       JWKS endpoint

Middleware is added in reverse — last added runs first.
So add AuthMiddleware first, then CORSMiddleware (outermost).
"""

from dotenv import load_dotenv
load_dotenv()  # Must be first — reads .env before anything calls os.getenv()

import os
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from middleware.auth_middleware import AuthMiddleware
from routes.weather import router as weather_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [%(levelname)-8s]  %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)

app = FastAPI(
    title="Weather API",
    description="MSAL-authenticated weather service. JWT is validated against Azure AD on every request.",
    version="1.0.0",
)

# ── Middleware stack (last added = outermost = runs first) ────────────────────

# 2. AuthMiddleware — inner layer
#    Validates the Bearer JWT. Returns 401 immediately if invalid.
#    Attaches decoded claims to request.state.user for use in routes.
app.add_middleware(AuthMiddleware)

# 1. CORSMiddleware — outer layer (added last, runs first)
#    Handles browser preflight (OPTIONS) requests BEFORE auth is checked.
#    Also adds Access-Control-* headers to ALL responses, including 401s.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("ALLOWED_ORIGIN", "http://localhost:3001")],
    allow_credentials=True,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# ── Routes ────────────────────────────────────────────────────────────────────
app.include_router(weather_router)


@app.get("/health", tags=["health"])
async def health_check():
    """Public endpoint — no auth required. Use to confirm the server is up."""
    return {"status": "ok", "server": "Weather API"}
