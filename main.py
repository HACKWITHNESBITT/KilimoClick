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
