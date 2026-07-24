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
    "KIJANISPACE_FORECAST_PATH", "/v1/agro_climate/land"
)
KIJANISPACE_WATER_PATH = os.getenv(
    "KIJANISPACE_WATER_PATH", "/v1/agro_climate/water"
)

KIJANISPACE_AUTH_TYPE = os.getenv("KIJANISPACE_AUTH_TYPE", "api_key_header")
KIJANISPACE_API_KEY = os.getenv("KIJANISPACE_API_KEY", "")
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
    params = {"lat": lat, "lon": lon}

    if KIJANISPACE_AUTH_TYPE == "bearer":
        headers["Authorization"] = f"Bearer {KIJANISPACE_API_KEY}"
    elif KIJANISPACE_AUTH_TYPE == "api_key_query":
        params["api_key"] = KIJANISPACE_API_KEY
    else:
        headers["X-API-Key"] = KIJANISPACE_API_KEY

    try:
        response = requests.get(
            url,
            params=params,
            headers=headers,
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

    Confirmed against a real /v1/agro_climate/land response (sample JSON):
      - The hourly series lives at payload["forecast_data"], and it's
        COLUMNAR, not a list of per-hour records: forecast_data["time"] is
        a list of "YYYY-MM-DD hh:mm" strings, and every other field
        (forecast_data["soilmoisture_0to10cm"], etc.) is a same-length list
        aligned to it by index. A sample response had 121 hourly points
        (5 days x 24h + 1).
      - soilmoisture_0to10cm and precipitation_probability are both integer
        percent values (e.g. 19, 20 / 0-50), matching their "percent" /
        "volumetric percent" labels in the top-level "units" dict — both
        get divided by 100 here so the rest of the backend works in 0-1
        fractions throughout.
      - payload["data"]["vegetation_indices"] (NDVI etc.) and
        payload["data"]["dataset"] (land-use) are also present but unused —
        out of scope for this app, which already has its own land-cover
        raster from Phase 1.

    Hourly values are aggregated into up to 5 daily buckets: soil_moisture
    -> minimum for the day (worst case for "will it drop below threshold"),
    precipitation_probability -> maximum for the day (worst case for
    wash-out risk).
    """
    forecast_data = payload.get("forecast_data")
    if not forecast_data or not forecast_data.get("time"):
        raise ValueError("Forecast response had no forecast_data.time series.")

    units = payload.get("units", {})
    daily = _aggregate_hourly_columns_to_daily(forecast_data, units)
    if not daily:
        raise ValueError("Forecast response's forecast_data produced no daily buckets.")

    return {"five_day_series": daily}


def _maybe_to_fraction(value: Optional[float], unit_label: str) -> Optional[float]:
    """Scale a percent-labelled value (0-100) down to a 0-1 fraction.

    The decision logic (compute_moisture_forecast / compute_plant_now_status)
    works in 0-1 fractions throughout. KijaniSpace's declared units mark
    soil moisture as "volumetric percent" and precipitation_probability as
    "percent" — both 0-100 scales, confirmed by real sample values like
    soilmoisture_0to10cm=19 and precipitation_probability=20 — so this
    converts based on the declared label rather than guessing from magnitude.
    """
    if value is None:
        return None
    if unit_label and "percent" in unit_label.lower():
        return value / 100.0
    return value


def _aggregate_hourly_columns_to_daily(forecast_data: dict, units: dict) -> list:
    from collections import defaultdict

    times = forecast_data.get("time") or []
    moisture_col = forecast_data.get("soilmoisture_0to10cm") or []
    rain_col = forecast_data.get("precipitation_probability") or []
    et_col = forecast_data.get("evapotranspiration") or []
    temp_col = forecast_data.get("soiltemperature_0to10cm") or []

    moisture_unit = units.get("soilmoisture_0to10cm", "")
    rain_unit = units.get("precipitation_probability", "")

    def col_value(column: list, i: int):
        return column[i] if i < len(column) else None

    buckets: dict = defaultdict(lambda: {"moisture": [], "rain": [], "et": [], "temp": []})

    for i, time_value in enumerate(times):
        if not time_value:
            continue
        day = str(time_value)[:10]
        bucket = buckets[day]

        moisture = _maybe_to_fraction(col_value(moisture_col, i), moisture_unit)
        if moisture is not None:
            bucket["moisture"].append(moisture)

        rain = _maybe_to_fraction(col_value(rain_col, i), rain_unit)
        if rain is not None:
            bucket["rain"].append(rain)

        et = col_value(et_col, i)
        if et is not None:
            bucket["et"].append(et)

        temp = col_value(temp_col, i)
        if temp is not None:
            bucket["temp"].append(temp)

    daily = []
    # Only keep full (or near-full) days, in case the first/last bucket is a
    # partial day at the edge of the forecast window (e.g. a lone 00:00 point).
    for day in sorted(buckets.keys()):
        bucket = buckets[day]
        if len(bucket["moisture"]) < 12 and len(bucket["rain"]) < 12:
            continue  # too few hourly points to trust this day's aggregate
        daily.append(
            {
                "date": day,
                "soil_moisture": min(bucket["moisture"]) if bucket["moisture"] else None,
                "precipitation_probability": max(bucket["rain"]) if bucket["rain"] else None,
                "evapotranspiration": sum(bucket["et"]) if bucket["et"] else None,
                "soil_temperature": (sum(bucket["temp"]) / len(bucket["temp"])) if bucket["temp"] else None,
            }
        )
        if len(daily) == 5:
            break

    return daily


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

# --------------------------------------------------------------------------
# Core recommendation logic — shared by /recommend and /ussd
# --------------------------------------------------------------------------


def build_recommendation(lat: float, lon: float) -> dict:
    error = validate_coordinates(lat, lon)
    if error:
        return {"error": error}

    landcover = get_pixel_value(RASTERS["landcover"], lat, lon)
    if landcover is None:
        return {"error": "No data available for this location. Try a point inside the Kisumu area."}
    if int(landcover) != CROPLAND_PIXEL_VALUE:
        return {"error": "This point is not mapped as cropland. Please select a farm plot."}

    ph = get_pixel_value(RASTERS["soil_ph"], lat, lon)
    clay = get_pixel_value(RASTERS["soil_clay"], lat, lon)
    slope = get_pixel_value(RASTERS["slope"], lat, lon)
    elevation = get_pixel_value(RASTERS["dem"], lat, lon)
    water_dist = get_pixel_value(RASTERS["water_distance"], lat, lon)
    texture_code = get_pixel_value(RASTERS["soil_texture"], lat, lon)

    if ph is None or slope is None:
        return {"error": "Soil or terrain data unavailable for this point."}

    ph = float(ph)
    clay = float(clay) if clay is not None else None
    slope = float(slope)
    elevation = float(elevation) if elevation is not None else None
    water_dist = float(water_dist) if water_dist is not None else None
    texture_name = CODES["soil_texture"].get(str(int(texture_code)) if texture_code is not None else "0", "Unknown")

    suitable_crops = []
    for crop, rules in CROP_LOGIC.items():
        if rules["min_pH"] <= ph <= rules["max_pH"] and slope <= rules["max_slope"]:
            irrigation_method = _resolve_irrigation_method(rules, slope, water_dist)
            suitable_crops.append(
                {
                    "name": crop,
                    "irrigation_method": irrigation_method,
                    "water_need": rules["water_need"],
                }
            )

    response = {
        "location": {"lat": lat, "lon": lon},
        "soil_data": {
            "pH": round(ph, 1),
            "clay_content_pct": round(clay, 1) if clay is not None else None,
            "texture": texture_name,
            "elevation_m": round(elevation, 1) if elevation is not None else None,
        },
        "terrain": {
            "slope_degrees": round(slope, 1),
            "distance_to_water_m": round(water_dist, 1) if water_dist is not None else None,
        },
        "recommendations": suitable_crops,
    }

    if not suitable_crops:
        response["moisture_forecast"] = {"data_available": False, "reason": "No suitable crop found for this soil/slope combination."}
        response["plant_now_check"] = {"status": "unknown", "message": "No crop recommendation to evaluate for this point."}
        return response

    primary_crop = suitable_crops[0]
    moisture_threshold = WATER_NEED_MOISTURE_THRESHOLD.get(
        primary_crop["water_need"], DEFAULT_MOISTURE_THRESHOLD
    )

    forecast = fetch_forecast(lat, lon)
    if forecast is None:
        response["moisture_forecast"] = {
            "data_available": False,
            "reason": "forecast unavailable — showing crop recommendation only",
        }
        response["plant_now_check"] = {
            "status": "unknown",
            "message": "Plant-now safety check unavailable without a live forecast.",
        }
    else:
        response["moisture_forecast"] = compute_moisture_forecast(forecast, moisture_threshold)
        response["plant_now_check"] = compute_plant_now_status(
            forecast, moisture_threshold, primary_crop["name"]
        )

    return response


def _resolve_irrigation_method(rules: dict, slope: float, water_dist: Optional[float]) -> str:
    """Turn a crop's free-text irrigation_rule + terrain into one method label."""
    rule_text = rules.get("irrigation_rule", "")

    if "Flood" in rule_text:
        # Flood irrigation isn't practical on steep ground regardless of the crop rule.
        if slope > 8:
            return "Sprinkler (flood irrigation not advised above 8° slope)"
        return "Flood"
    if "Drip" in rule_text:
        return "Drip"
    if "Sprinkler" in rule_text and "slope > 8" in rule_text:
        return "Sprinkler" if slope > 8 else "Rain-fed"
    if "Rainfed" in rule_text or "Rain-fed" in rule_text:
        return "Rain-fed"

    # Fallback: use water distance as a feasibility signal.
    if water_dist is not None and water_dist > 1000:
        return "Rain-fed"
    return "Rain-fed"

# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/recommend")
def recommend(lat: float = Query(...), lon: float = Query(...)):
    return build_recommendation(lat, lon)


@app.post("/ussd")
async def ussd(request: Request):
    """Africa's Talking-style USSD webhook.

    Africa's Talking posts application/x-www-form-urlencoded fields
    (sessionId, phoneNumber, networkCode, serviceCode, text). This handler
    also accepts a JSON body with the same field names, to match the sample
    payload in the design doc and make local testing easy via /docs or curl.
    """
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        payload = await request.json()
    else:
        form = await request.form()
        payload = dict(form)

    text = (payload.get("text") or "").strip()
    steps = [s for s in text.split("*") if s != ""]

    screen = _ussd_menu(steps)
    return Response(content=screen, media_type="text/plain")


def _ussd_menu(steps: list[str]) -> str:
    # Step 0: root menu
    if len(steps) == 0:
        return "CON Welcome to Agri-Node\n1. Get crop & irrigation advice\n2. Exit"

    if steps[0] == "2":
        return "END Thank you for using Agri-Node."

    if steps[0] != "1":
        return "END Invalid choice. Please dial in again."

    # Step 1: location menu
    if len(steps) == 1:
        lines = ["CON Select your area:"]
        for key in sorted(USSD_LOCATIONS, key=int):
            lines.append(f"{key}. {USSD_LOCATIONS[key]['name']}")
        lines.append(f"{len(USSD_LOCATIONS) + 1}. Type a landmark name")
        return "\n".join(lines)

    choice = steps[1]
    free_text_option = str(len(USSD_LOCATIONS) + 1)

    if choice == free_text_option:
        if len(steps) == 2:
            return "CON Enter the name of your nearest landmark:"
        # len(steps) >= 3: free-text landmark typed, but this build has no
        # geocoder wired up — fail clearly rather than guessing a location.
        return (
            "END Sorry, free-text landmark lookup isn't available yet. "
            "Please dial in again and choose a listed area."
        )

    location = USSD_LOCATIONS.get(choice)
    if not location:
        return "END Invalid area selected. Please dial in again."

    result = build_recommendation(location["lat"], location["lon"])
    return "END " + _format_ussd_result(result)


def _format_ussd_result(result: dict) -> str:
    if "error" in result:
        return result["error"]

    crops = result.get("recommendations") or []
    if not crops:
        return "No suitable crop found for this area right now."

    crop = crops[0]
    soil = result.get("soil_data", {})
    moisture = result.get("moisture_forecast", {})
    plant_now = result.get("plant_now_check", {})

    lines = [
        f"Recommended: {crop['name']} ({crop['irrigation_method']})",
        f"Soil: {soil.get('texture', 'Unknown')}, pH {soil.get('pH', '?')}",
    ]

    if moisture.get("data_available") and moisture.get("irrigate_by"):
        lines.append(f"Irrigate by: {_format_day_label(moisture['irrigate_by'])}")
    elif moisture.get("data_available"):
        lines.append("Irrigate by: not needed this week")
    else:
        lines.append("Forecast: unavailable")

    status = plant_now.get("status")
    status_label = {
        "safe": "OK TO PLANT NOW",
        "wait": "WAIT - irrigate first",
        "hold_off": "HOLD OFF - heavy rain risk",
        "unknown": "STATUS UNKNOWN - no forecast",
    }.get(status, "STATUS UNKNOWN")
    lines.append(f"Status: {status_label}")

    return "\n".join(lines)
