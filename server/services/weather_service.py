"""
Weather Service — with detailed logging
========================================
Two external calls happen here:
  1. Nominatim (OpenStreetMap) geocoding — ZIP → lat/lon
  2. Open-Meteo weather API            — lat/lon → weather data

All upstream responses are validated with Pydantic BEFORE the data is
returned to the client. If the upstream API changes its schema or returns
garbage, we return 502 (Bad Gateway) instead of forwarding bad data.

What you will see in the terminal:
  [W1] ZIP 95814 → Nominatim geocoding...
  [W2] Geocode OK .............. Sacramento, CA  (38.5811, -121.4938)  took 312ms
  [W3] Open-Meteo fetch ........ lat=38.5811  lon=-121.4938
  [W4] HTTP response ........... 200 OK  1.1KB  took 201ms
  [W5] Pydantic validation ..... PASS ✓  (all required fields present and typed correctly)
  [W6] WMO code ................ 0 → "Clear Sky" ☀️
  [W7] Summary ................. temp=72.3°F  humidity=55%  wind=5.2mph  precip=0.0in
"""

import time
import logging
import httpx
from typing import Optional
from pydantic import BaseModel, ValidationError

logger = logging.getLogger("services.weather")

NOMINATIM_URL  = "https://nominatim.openstreetmap.org/search"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
NOMINATIM_HEADERS = {"User-Agent": "MSAL-Auth-Learning-App/1.0 (educational project)"}

# WMO Weather Interpretation Codes
# Full table: https://open-meteo.com/en/docs#weathervariables
WMO_CODES: dict[int, tuple[str, str]] = {
    0:  ("Clear Sky",                  "☀️"),
    1:  ("Mainly Clear",               "🌤️"),
    2:  ("Partly Cloudy",              "⛅"),
    3:  ("Overcast",                   "☁️"),
    45: ("Foggy",                      "🌫️"),
    48: ("Depositing Rime Fog",        "🌫️"),
    51: ("Light Drizzle",              "🌦️"),
    53: ("Moderate Drizzle",           "🌦️"),
    55: ("Dense Drizzle",              "🌧️"),
    61: ("Slight Rain",                "🌧️"),
    63: ("Moderate Rain",              "🌧️"),
    65: ("Heavy Rain",                 "🌧️"),
    71: ("Slight Snow",                "🌨️"),
    73: ("Moderate Snow",              "❄️"),
    75: ("Heavy Snow",                 "❄️"),
    77: ("Snow Grains",                "🌨️"),
    80: ("Slight Rain Showers",        "🌦️"),
    81: ("Moderate Rain Showers",      "🌧️"),
    82: ("Violent Rain Showers",       "⛈️"),
    85: ("Slight Snow Showers",        "🌨️"),
    86: ("Heavy Snow Showers",         "❄️"),
    95: ("Thunderstorm",               "⛈️"),
    96: ("Thunderstorm w/ Hail",       "⛈️"),
    99: ("Thunderstorm w/ Heavy Hail", "⛈️"),
}


# ── Pydantic validation models ────────────────────────────────────────────────

class CurrentWeatherData(BaseModel):
    temperature_2m:       float
    wind_speed_10m:       float
    precipitation:        float
    weather_code:         int
    relative_humidity_2m: int
    time:                 Optional[str] = None
    interval:             Optional[int] = None


class CurrentUnitsData(BaseModel):
    temperature_2m:       str
    wind_speed_10m:       str
    precipitation:        str
    relative_humidity_2m: Optional[str] = "%"
    time:                 Optional[str] = None
    interval:             Optional[str] = None
    model_config = {"extra": "ignore"}


class OpenMeteoResponse(BaseModel):
    latitude:      float
    longitude:     float
    current:       CurrentWeatherData
    current_units: CurrentUnitsData
    model_config = {"extra": "ignore"}


# ── Geocoding ─────────────────────────────────────────────────────────────────

async def geocode_zipcode(zipcode: str) -> tuple[float, float, str, str]:
    logger.info("  [W1] ZIP %s → Nominatim geocoding...", zipcode)
    t0 = time.monotonic()

    async with httpx.AsyncClient(timeout=10.0, headers=NOMINATIM_HEADERS) as client:
        resp = await client.get(NOMINATIM_URL, params={
            "postalcode": zipcode, "countrycodes": "us",
            "format": "json", "limit": 1, "addressdetails": 1,
        })
        resp.raise_for_status()
        results = resp.json()

    elapsed_ms = (time.monotonic() - t0) * 1000

    if not results:
        logger.warning("  [W2] Geocode FAILED .......... ZIP '%s' not found  (took %.0fms)",
                       zipcode, elapsed_ms)
        raise ValueError(f"ZIP code '{zipcode}' not found. Verify and try again.")

    hit     = results[0]
    address = hit.get("address", {})
    city    = (address.get("city") or address.get("town")
               or address.get("village") or address.get("county") or zipcode)
    loc     = hit.get("display_name", city)

    logger.info("  [W2] Geocode OK .............. %s  (%.4f, %.4f)  took %.0fms",
                city, float(hit["lat"]), float(hit["lon"]), elapsed_ms)

    return float(hit["lat"]), float(hit["lon"]), city, loc


# ── Weather fetch + validation ────────────────────────────────────────────────

async def fetch_open_meteo(lat: float, lon: float) -> OpenMeteoResponse:
    logger.info("  [W3] Open-Meteo fetch ........ lat=%.4f  lon=%.4f", lat, lon)
    t0 = time.monotonic()

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(OPEN_METEO_URL, params={
            "latitude":           lat,
            "longitude":          lon,
            "current":            ("temperature_2m,wind_speed_10m,"
                                   "precipitation,weather_code,relative_humidity_2m"),
            "temperature_unit":   "fahrenheit",
            "wind_speed_unit":    "mph",
            "precipitation_unit": "inch",
            "forecast_days":      1,
        })
        resp.raise_for_status()
        raw = resp.json()

    elapsed_ms = (time.monotonic() - t0) * 1000
    body_kb    = len(resp.content) / 1024

    logger.info("  [W4] HTTP response ........... %d %s  %.1fKB  took %.0fms",
                resp.status_code, resp.reason_phrase, body_kb, elapsed_ms)

    # ── Pydantic response validation ──────────────────────────────────────────
    # This is the "outbound response validation" requirement:
    # We verify the Open-Meteo response matches our schema BEFORE sending to client.
    logger.info("  [W5] Pydantic validation ..... checking %d top-level fields...",
                len(raw))
    try:
        validated = OpenMeteoResponse(**raw)
    except ValidationError as exc:
        logger.error("  [W5] Pydantic validation ..... FAIL ✗  %d error(s)", exc.error_count())
        for err in exc.errors():
            logger.error("       field='%s'  error=%s  input=%s",
                         ".".join(str(l) for l in err["loc"]), err["msg"], err.get("input"))
        raise ValueError(
            f"Open-Meteo returned an unexpected response shape "
            f"({exc.error_count()} validation error(s)). "
            "Check server logs for field details."
        ) from exc

    logger.info("  [W5] Pydantic validation ..... PASS ✓  (all required fields present and typed correctly)")
    return validated


# ── Main entry point ──────────────────────────────────────────────────────────

async def get_weather_for_zipcode(zipcode: str) -> dict:
    lat, lon, city, full_location = await geocode_zipcode(zipcode)
    weather = await fetch_open_meteo(lat, lon)

    code               = weather.current.weather_code
    description, emoji = WMO_CODES.get(code, ("Unknown Conditions", "🌡️"))

    logger.info("  [W6] WMO code ................ %d → \"%s\" %s", code, description, emoji)
    logger.info("  [W7] Summary ................. temp=%.1f%s  humidity=%d%%  wind=%.1f%s  precip=%.2f%s",
                weather.current.temperature_2m, weather.current_units.temperature_2m,
                weather.current.relative_humidity_2m,
                weather.current.wind_speed_10m, weather.current_units.wind_speed_10m,
                weather.current.precipitation, weather.current_units.precipitation)

    return {
        "zipcode":  zipcode,
        "city":     city,
        "location": full_location,
        "coordinates": {"latitude": round(lat, 4), "longitude": round(lon, 4)},
        "condition": {"code": code, "description": description, "emoji": emoji},
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
