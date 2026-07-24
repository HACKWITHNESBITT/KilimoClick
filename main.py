import json
import logging
import os
import time
from datetime import date, datetime, timedelta
from typing import Optional

import requests
import rasterio
from fastapi import FastAPI, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware

# --------------------------------------------------------------------------
# Configuration (environment variables)
# --------------------------------------------------------------------------

GIS_DATA_DIR = os.getenv("GIS_DATA_DIR", "AgriNode_GIS_Data")

KIJANISPACE_BASE_URL = os.getenv("KIJANISPACE_BASE_URL", "").rstrip("/")
KIJANISPACE_FORECAST_PATH = os.getenv(
    "KIJANISPACE_FORECAST_PATH", "/agro_climate/land"
)
KIJANISPACE_AUTH_TYPE = os.getenv("KIJANISPACE_AUTH_TYPE", "api_key")  # "api_key" | "basic"
KIJANISPACE_API_KEY = os.getenv("KIJANISPACE_API_KEY", "")
KIJANISPACE_API_KEY_HEADER = os.getenv("KIJANISPACE_API_KEY_HEADER", "X-API-Key")
KIJANISPACE_BASIC_USER = os.getenv("KIJANISPACE_BASIC_USER", "")
KIJANISPACE_BASIC_PASS = os.getenv("KIJANISPACE_BASIC_PASS", "")
KIJANISPACE_TIMEOUT_SECONDS = float(os.getenv("KIJANISPACE_TIMEOUT_SECONDS", "5"))

FORECAST_CACHE_TTL_SECONDS = int(os.getenv("FORECAST_CACHE_TTL_SECONDS", "3600"))
FORECAST_CACHE_PRECISION = int(os.getenv("FORECAST_CACHE_PRECISION", "3"))  # ~110m at the equator

HEAVY_RAIN_PROBABILITY_THRESHOLD = float(os.getenv("HEAVY_RAIN_PROBABILITY_THRESHOLD", "0.6"))
STALE_CLOUD_COVER_THRESHOLD = float(os.getenv("STALE_CLOUD_COVER_THRESHOLD", "80"))

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("agrinode")

# --------------------------------------------------------------------------
# App + CORS
# --------------------------------------------------------------------------

app = FastAPI(
    title="Agri-Node Advisor",
    description="Plant Right, Water on Time — crop, irrigation-timing and "
    "plant-now safety advisory for smallholder farmers in the Lake Victoria basin.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------------------------------
# Static reference data
# --------------------------------------------------------------------------

with open(os.path.join(GIS_DATA_DIR, "Crop_Logic_Matrix.json")) as f:
    CROP_LOGIC = json.load(f)

with open(os.path.join(GIS_DATA_DIR, "Texture_Codes.json")) as f:
    CODES = json.load(f)

RASTERS = {
    "landcover": os.path.join(GIS_DATA_DIR, "Kisumu_LandCover.tif"),
    "soil_ph": os.path.join(GIS_DATA_DIR, "Kisumu_Soil_pH_4326.tif"),
    "soil_clay": os.path.join(GIS_DATA_DIR, "Kisumu_Soil_Clay_4326.tif"),
    "soil_texture": os.path.join(GIS_DATA_DIR, "Kisumu_Soil_Texture_4326.tif"),
    "dem": os.path.join(GIS_DATA_DIR, "Kisumu_DEM_4326.tif"),
    "slope": os.path.join(GIS_DATA_DIR, "Kisumu_Slope_4326.tif"),
    "water_distance": os.path.join(GIS_DATA_DIR, "Kisumu_WaterDistance_4326.tif"),
}

CROPLAND_PIXEL_VALUE = 40  # ESA WorldCover: 40 == Cropland

# A crop's minimum usable volumetric soil-moisture fraction, approximated from
# its water_need label in Crop_Logic_Matrix.json. The matrix hand-off file
# doesn't carry a numeric moisture threshold, so this mapping is the one
WATER_NEED_MOISTURE_THRESHOLD = {
    "Low": 0.15,
    "Medium": 0.20,
    "High": 0.30,
}
DEFAULT_MOISTURE_THRESHOLD = 0.20

# Pre-mapped villages/landmarks for the USSD "no map, no smartphone" flow.
# Coordinates are approximate placeholders inside the Kisumu AOI — replace
# with surveyed points before a real deployment.
USSD_LOCATIONS = {
    "1": {"name": "Dunga Beach", "lat": -0.1180, "lon": 34.7340},
    "2": {"name": "Nyalenda", "lat": -0.1080, "lon": 34.7550},
    "3": {"name": "Kisumu Ndogo", "lat": -0.0950, "lon": 34.7600},
    "4": {"name": "Manyatta", "lat": -0.0830, "lon": 34.7500},
    "5": {"name": "Kondele", "lat": -0.0860, "lon": 34.7600},
    "6": {"name": "Mamboleo", "lat": -0.0610, "lon": 34.7750},
}

# --------------------------------------------------------------------------
# In-memory forecast cache
# --------------------------------------------------------------------------

_forecast_cache: dict[str, tuple[float, Optional[dict]]] = {}


def _cache_key(lat: float, lon: float) -> str:
    return f"{round(lat, FORECAST_CACHE_PRECISION)}:{round(lon, FORECAST_CACHE_PRECISION)}"


def _cache_get(lat: float, lon: float) -> Optional[dict]:
    entry = _forecast_cache.get(_cache_key(lat, lon))
    if not entry:
        return None
    expires_at, value = entry
    if time.time() > expires_at:
        return None
    return value


def _cache_set(lat: float, lon: float, value: Optional[dict]) -> None:
    _forecast_cache[_cache_key(lat, lon)] = (
        time.time() + FORECAST_CACHE_TTL_SECONDS,
        value,
    )


# --------------------------------------------------------------------------
# Raster helpers
# --------------------------------------------------------------------------


def get_pixel_value(tif_path: str, lat: float, lon: float):
    """Read a single pixel value at (lat, lon) from a WGS84 GeoTIFF.

    Returns None if the point falls outside the raster's extent or the file
    can't be read — callers treat that as "no data at this point".
    """
    try:
        with rasterio.open(tif_path) as src:
            row, col = src.index(lon, lat)
            if row < 0 or col < 0 or row >= src.height or col >= src.width:
                return None
            value = src.read(1)[row, col]
            nodata = src.nodata
            if nodata is not None and value == nodata:
                return None
            return value
    except Exception as exc:  # pragma: no cover - defensive, matches Phase 2 style
        logger.warning("Raster read failed for %s at (%s, %s): %s", tif_path, lat, lon, exc)
        return None


def validate_coordinates(lat: float, lon: float) -> Optional[str]:
    if lat is None or lon is None:
        return "lat and lon are required."
    if not (-90 <= lat <= 90):
        return "lat must be between -90 and 90."
    if not (-180 <= lon <= 180):
        return "lon must be between -180 and 180."
    return None

# --------------------------------------------------------------------------
# KijaniSpace forecast adapter — the one new external integration
# --------------------------------------------------------------------------


def fetch_forecast(lat: float, lon: float) -> Optional[dict]:
    """Fetch the 5-day agro-climate forecast for (lat, lon).

    Returns a dict with a "five_day_series" list of
    {date, soil_moisture, precipitation_probability, evapotranspiration,
    soil_temperature} and an optional "cloud_cover_percentage", or None if
    the forecast can't be retrieved (missing config, network error, bad
    response). Callers must treat None as "show crop recommendation only".
    """
    cached = _cache_get(lat, lon)
    if cached is not None:
        return cached

    if not KIJANISPACE_BASE_URL:
        logger.info("KIJANISPACE_BASE_URL not configured — forecast unavailable.")
        return None

    url = f"{KIJANISPACE_BASE_URL}{KIJANISPACE_FORECAST_PATH}"
    headers = {}
    auth = None

    if KIJANISPACE_AUTH_TYPE == "basic":
        auth = (KIJANISPACE_BASIC_USER, KIJANISPACE_BASIC_PASS)
    else:
        headers[KIJANISPACE_API_KEY_HEADER] = KIJANISPACE_API_KEY

    try:
        response = requests.get(
            url,
            params={"lat": lat, "lon": lon, "days": 5},
            headers=headers,
            auth=auth,
            timeout=KIJANISPACE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
        forecast = _normalize_forecast(payload)
        _cache_set(lat, lon, forecast)
        return forecast
    except Exception as exc:
        logger.warning("KijaniSpace forecast fetch failed for (%s, %s): %s", lat, lon, exc)
        _cache_set(lat, lon, None)  # cache the miss too, so a flaky API doesn't get hammered
        return None


def _normalize_forecast(payload: dict) -> dict:
    """Map the raw KijaniSpace response into the shape this backend expects.

    KijaniSpace's exact response schema isn't in the hand-off docs, so this
    normalizer accepts a couple of reasonable shapes (a top-level "series" or
    "forecast" list of daily records) and fails loudly (raises) on anything
    else, which fetch_forecast() turns into a clean "forecast unavailable".
    Adjust the field-name candidates below once the live schema is confirmed.
    """
    series_raw = payload.get("series") or payload.get("forecast") or payload.get("daily") or []
    if not series_raw:
        raise ValueError("Forecast response had no recognizable daily series.")

    def pick(record: dict, *keys, default=None):
        for key in keys:
            if key in record:
                return record[key]
        return default

    series = []
    for record in series_raw[:5]:
        series.append(
            {
                "date": pick(record, "date", "day", "valid_date"),
                "soil_moisture": pick(record, "soil_moisture", "soilMoisture"),
                "precipitation_probability": pick(
                    record, "precipitation_probability", "precipitationProbability"
                ),
                "evapotranspiration": pick(record, "evapotranspiration", "et0"),
                "soil_temperature": pick(record, "soil_temperature", "soilTemperature"),
            }
        )

    cloud_cover = payload.get("cloud_cover_percentage") or payload.get("cloudCoverPercentage")

    return {"five_day_series": series, "cloud_cover_percentage": cloud_cover}

# --------------------------------------------------------------------------
# Deterministic decision logic (design doc, section 7)
# --------------------------------------------------------------------------


def _parse_date(value) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def compute_moisture_forecast(forecast: dict, moisture_threshold: float) -> dict:
    series = forecast.get("five_day_series", [])

    irrigate_by = None
    reason = "Soil moisture is projected to stay above the crop's minimum threshold this week."

    for day in series:
        moisture = day.get("soil_moisture")
        if moisture is None:
            continue
        if moisture < moisture_threshold:
            irrigate_by = day.get("date")
            day_label = _format_day_label(day.get("date"))
            reason = (
                f"Soil moisture is projected to drop below the crop's threshold by {day_label}."
            )
            break

    result = {
        "data_available": True,
        "irrigate_by": irrigate_by,
        "reason": reason,
        "five_day_series": series,
    }

    cloud_cover = forecast.get("cloud_cover_percentage")
    if cloud_cover is not None and cloud_cover >= STALE_CLOUD_COVER_THRESHOLD:
        result["confidence"] = "low"
        result["confidence_note"] = (
            f"Underlying observation is {cloud_cover:.0f}% cloud-covered — "
            "treat this forecast as indicative only."
        )
    else:
        result["confidence"] = "high"

    return result


def compute_plant_now_status(
    forecast: dict, moisture_threshold: float, crop_name: str
) -> dict:
    series = forecast.get("five_day_series", [])
    if not series:
        return {"status": "unknown", "message": "Not enough forecast data to judge planting safety."}

    today = series[0]
    next_two_days = series[:2]

    max_rain_prob = 0.0
    for day in next_two_days:
        prob = day.get("precipitation_probability")
        if prob is not None:
            max_rain_prob = max(max_rain_prob, prob)

    today_moisture = today.get("soil_moisture")

    if max_rain_prob > HEAVY_RAIN_PROBABILITY_THRESHOLD:
        return {
            "status": "hold_off",
            "message": (
                "Heavy rain is likely in the next 48 hours — planting now risks "
                "seed washout or waterlogging. Wait for the rain to pass."
            ),
        }

    if today_moisture is not None and today_moisture < moisture_threshold:
        next_good_day = None
        for day in series[1:]:
            moisture = day.get("soil_moisture")
            rain = day.get("precipitation_probability") or 0.0
            if moisture is not None and moisture >= moisture_threshold and rain <= HEAVY_RAIN_PROBABILITY_THRESHOLD:
                next_good_day = day.get("date")
                break
        if next_good_day:
            when = _format_day_label(next_good_day)
            message = (
                f"Soil moisture is currently low for {crop_name}. Irrigate first, "
                f"or wait until conditions improve around {when}."
            )
        else:
            message = (
                f"Soil moisture is currently low for {crop_name}. Irrigate before planting."
            )
        return {"status": "wait", "message": message}

    return {
        "status": "safe",
        "message": f"Conditions look good for {crop_name} — moisture is adequate and no heavy rain is imminent.",
    }


def _format_day_label(value) -> str:
    d = _parse_date(value)
    if not d:
        return str(value)
    return d.strftime("%A %d %b")
