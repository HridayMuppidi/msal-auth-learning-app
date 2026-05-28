"""
Weather Route
=============
GET /weather?zipcode=95814

By the time execution reaches this handler, AuthMiddleware has already:
  - Verified the Bearer token signature against Azure AD's public keys
  - Confirmed the token has not expired
  - Confirmed the issuer is Microsoft for the correct tenant
  - Attached the decoded JWT claims to request.state.user

This handler only needs to worry about the business logic.
"""

import re
import logging
from fastapi import APIRouter, HTTPException, Query, Request
from services.weather_service import get_weather_for_zipcode

logger  = logging.getLogger(__name__)
router  = APIRouter(prefix="/weather", tags=["weather"])

ZIP_RE = re.compile(r"^\d{5}$")   # US 5-digit ZIP code


@router.get(
    "",
    summary="Get current weather by US ZIP code",
    response_description="Current weather conditions for the given ZIP code",
)
async def get_weather(
    request: Request,
    zipcode: str = Query(..., description="5-digit US ZIP code", example="95814"),
):
    """
    Returns current weather data sourced from Open-Meteo (free, no key required).

    The response is validated against a strict Pydantic schema before it is
    returned to the client — malformed upstream responses become HTTP 502, not
    silent bugs.
    """
    if not ZIP_RE.match(zipcode):
        raise HTTPException(
            status_code=422,
            detail="'zipcode' must be exactly 5 digits (e.g. 95814).",
        )

    # Log who made the request using the validated JWT claims from middleware
    user = getattr(request.state, "user", {})
    caller = user.get("preferred_username") or user.get("upn") or user.get("oid", "unknown")
    logger.info("Weather request | zipcode=%s | caller=%s", zipcode, caller)

    try:
        data = await get_weather_for_zipcode(zipcode)
        return data

    except ValueError as exc:
        # Raised by geocoding (ZIP not found) or schema validation (upstream changed)
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    except Exception as exc:
        logger.exception("Unexpected error fetching weather for %s", zipcode)
        raise HTTPException(status_code=502, detail="Failed to retrieve weather data.") from exc
