"""
Weather Service
===============
Orchestrates two external API calls to produce weather data for a ZIP code:

  1. Nominatim (OpenStreetMap) — free geocoding, converts ZIP → lat/lon
  2. Open-Meteo — free weather API, no API key needed

Response validation:
  The Open-Meteo response is parsed through strict Pydantic models BEFORE
  it is returned to the client. If the upstream API changes its schema or
  returns unexpected data, Pydantic raises a ValidationError and the route
  handler returns a 502 instead of silently passing through junk data.

This is the "response validation" the middleware docstring refers to —
we validate what comes back from the third-party API, not just what the
client sends to us.
"""

import logging
import httpx
from typing import Optional
from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

NOMINATIM_URL  = "https://nominatim.openstreetmap.org/search"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# Required by Nominatim's terms of service
NOMINATIM_HEADERS = {"User-Agent": "MSAL-Auth-Learning-App/1.0 (educational project)"}


# ── WMO Weather Interpretation Codes ─────────────────────────────────────────
# Open-Meteo returns a numeric WMO code describing current conditions.
# Full table: https://open-meteo.com/en/docs#weathervariables
WMO_CODES: dict[int, tuple[str, str]] = {
    0:  ("Clear Sky",              "☀️"),
    1:  ("Mainly Clear",           "🌤️"),
    2:  ("Partly Cloudy",          "⛅"),
    3:  ("Overcast",               "☁️"),
    45: ("Foggy",                  "🌫️"),
    48: ("Depositing Rime Fog",    "🌫️"),
    51: ("Light Drizzle",          "🌦️"),
    53: ("Moderate Drizzle",       "🌦️"),
    55: ("Dense Drizzle",          "🌧️"),
    61: ("Slight Rain",            "🌧️"),
    63: ("Moderate Rain",          "🌧️"),
    65: ("Heavy Rain",             "🌧️"),
    71: ("Slight Snow",            "🌨️"),
    73: ("Moderate Snow",          "❄️"),
    75: ("Heavy Snow",             "❄️"),
    77: ("Snow Grains",            "🌨️"),
    80: ("Slight Rain Showers",    "🌦️"),
    81: ("Moderate Rain Showers",  "🌧️"),
    82: ("Violent Rain Showers",   "⛈️"),
    85: ("Slight Snow Showers",    "🌨️"),
    86: ("Heavy Snow Showers",     "❄️"),
    95: ("Thunderstorm",           "⛈️"),
    96: ("Thunderstorm w/ Hail",   "⛈️"),
    99: ("Thunderstorm w/ Heavy Hail", "⛈️"),
}


# ── Pydantic Models — Open-Meteo Response Validation ─────────────────────────
# These models define exactly what shape we expect from Open-Meteo.
# If any required field is missing or the wrong type, Pydantic raises
# a ValidationError and we return 502 (Bad Gateway) to the client.

class CurrentWeatherData(BaseModel):
    temperature_2m:        float
    wind_speed_10m:        float
    precipitation:         float
    weather_code:          int
    relative_humidity_2m:  int
    time:                  Optional[str] = None
    interval:              Optional[int] = None


class CurrentUnitsData(BaseModel):
    temperature_2m:       str
    wind_speed_10m:       str
    precipitation:        str
    relative_humidity_2m: Optional[str] = "%"
    time:                 Optional[str] = None
    interval:             Optional[str] = None

    model_config = {"extra": "ignore"}   # Silently ignore any extra fields


class OpenMeteoResponse(BaseModel):
    latitude:      float
    longitude:     float
    current:       CurrentWeatherData
    current_units: CurrentUnitsData

    model_config = {"extra": "ignore"}   # Open-Meteo adds many extra top-level fields


# ── Geocoding ─────────────────────────────────────────────────────────────────

async def geocode_zipcode(zipcode: str) -> tuple[float, float, str, str]:
    """
    Convert a US ZIP code to (latitude, longitude, city, full_location).
    Uses Nominatim (OpenStreetMap) — free, no API key required.
    """
    async with httpx.AsyncClient(timeout=10.0, headers=NOMINATIM_HEADERS) as client:
        response = await client.get(
            NOMINATIM_URL,
            params={
                "postalcode":   zipcode,
                "countrycodes": "us",
                "format":       "json",
                "limit":        1,
                "addressdetails": 1,
            },
        )
        response.raise_for_status()
        results = response.json()

    if not results:
        raise ValueError(f"ZIP code '{zipcode}' was not found. Check the code and try again.")

    hit     = results[0]
    address = hit.get("address", {})

    city = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("county")
        or zipcode
    )
    full_location = hit.get("display_name", city)

    logger.info("Geocoded %s → (%s, %s) — %s", zipcode, hit["lat"], hit["lon"], city)
    return float(hit["lat"]), float(hit["lon"]), city, full_location


# ── Weather Fetch ─────────────────────────────────────────────────────────────

async def fetch_open_meteo(lat: float, lon: float) -> OpenMeteoResponse:
    """
    Call Open-Meteo and return a validated response model.
    Raises ValueError if the response doesn't match the expected schema.
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            OPEN_METEO_URL,
            params={
                "latitude":          lat,
                "longitude":         lon,
                "current":           (
                    "temperature_2m,"
                    "wind_speed_10m,"
                    "precipitation,"
                    "weather_code,"
                    "relative_humidity_2m"
                ),
                "temperature_unit":  "fahrenheit",
                "wind_speed_unit":   "mph",
                "precipitation_unit":"inch",
                "forecast_days":     1,
            },
        )
        response.raise_for_status()
        raw = response.json()

    # ── Response Validation ───────────────────────────────────────────────────
    # Pydantic validates the structure here. If Open-Meteo changes its API
    # or returns an error body, this raises ValidationError and we return 502
    # instead of forwarding garbage data to the client.
    try:
        validated = OpenMeteoResponse(**raw)
    except ValidationError as exc:
        logger.error("Open-Meteo response failed schema validation:\n%s", exc)
        raise ValueError(
            f"Unexpected response from weather service — schema mismatch: {exc.error_count()} error(s)"
        ) from exc

    return validated


# ── Main Entry Point ──────────────────────────────────────────────────────────

async def get_weather_for_zipcode(zipcode: str) -> dict:
    """
    Full pipeline:
      ZIP code → geocode → Open-Meteo → validate → formatted response dict
    """
    lat, lon, city, full_location = await geocode_zipcode(zipcode)
    weather = await fetch_open_meteo(lat, lon)

    code             = weather.current.weather_code
    description, emoji = WMO_CODES.get(code, ("Unknown Conditions", "🌡️"))

    return {
        "zipcode":  zipcode,
        "city":     city,
        "location": full_location,
        "coordinates": {
            "latitude":  round(lat, 4),
            "longitude": round(lon, 4),
        },
        "condition": {
            "code":        code,
            "description": description,
            "emoji":       emoji,
        },
        "temperature": {
            "value": weather.current.temperature_2m,
            "unit":  weather.current_units.temperature_2m,
        },
        "wind": {
            "speed": weather.current.wind_speed_10m,
            "unit":  weather.current_units.wind_speed_10m,
        },
        "humidity": {
            "value": weather.current.relative_humidity_2m,
            "unit":  weather.current_units.relative_humidity_2m or "%",
        },
        "precipitation": {
            "value": weather.current.precipitation,
            "unit":  weather.current_units.precipitation,
        },
    }
