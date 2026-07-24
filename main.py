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
# Configuration (environment variables — see .env.example)
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

