# 🌾 KilimoClick

> **"Plant Right, Water on Time"** — A single-endpoint crop suitability, irrigation timing, and planting safety advisory engine for smallholder farmers in the Lake Victoria Basin (Kisumu Region, Kenya). 

Built for **Challenge 6** at the **KijaniSpace Talent Hackathon** (LakeHub Kisumu).

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [GIS & Raster Datasets](#-gis--raster-datasets)
- [Technology Stack](#-technology-stack)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Running the Application](#running-the-application)
- [API Reference](#-api-reference)
  - [`GET /recommend`](#get-recommend)
  - [`POST /ussd`](#post-ussd)
  - [`GET /health`](#get-health)
- [USSD Interface (`*384*9460#`)](#-ussd-interface-3849460)
- [Decision Engine Logic](#-decision-engine-logic)
- [License & Acknowledgments](#-license--acknowledgments)

---

## 🌍 Overview

Smallholder farmers in the Lake Victoria basin face severe risks from climate variability, poor soil matching, and ill-timed planting that lead to seed washout or crop failure. 

**KilimoClick** addresses these challenges by combining high-resolution spatial GIS data (soil chemistry, texture, terrain slope, elevation, distance to water bodies, and land cover) with live 5-day agro-climate forecasts from the **KijaniSpace API**. 

The system delivers actionable advisory reports through two primary channels:
1. **Interactive Web GIS Map Interface**: For smartphone and desktop users, featuring real-time map pin sampling, dynamic terrain metrics, moisture trend graphs, and crop selection.
2. **USSD Menu Gateway (`*384*9460#`)**: For feature-phone users on GSM networks, operating over text-based interactive menus without internet requirements.

---

## ✨ Key Features

- 🎯 **Hyper-Local Crop Suitability Matching**: Real-time sampling of SoilGrids, ESA WorldCover, and SRTM DEM GeoTIFF rasters to match location parameters against crop agronomic windows (Maize, Rice, Tomatoes, Cassava, Sorghum, Cowpeas, Sweet Potatoes).
- 💧 **5-Day Moisture & Irrigation Advisor**: Integrates KijaniSpace soil moisture streams to compute volumetric thresholds and determine exact "Irrigate by" target dates.
- 🛡️ **Plant-Now Safety Check**: Deterministic rule flags preventing seed washout (triggered when 48-hour heavy rain probability exceeds 60%) or crop failure due to dry soil conditions.
- 📡 **Data-Honesty & Fault Resilience**: In-memory location-bound caching (`~110m` equatorial precision) with short-ttl failure caching. Gracefully falls back to spatial GIS suitability if live satellite endpoints are unreachable or obscured by clouds.
- 📱 **Dual-Channel Access**:
  - Web application with Leaflet.js interactive map and visual metrics cards.
  - Africa's Talking compliant USSD gateway with pre-mapped Kisumu landmarks (*Dunga Beach, Nyalenda, Kisumu Ndogo, Manyatta, Kondele, Mamboleo*).

---

## 🏗️ System Architecture

KilimoClick is engineered as a **stateless, high-performance computation engine**. Every query accepts a coordinate vector `(lat, lon)`, samples overlapping local raster bands, fetches/caches external weather streams, applies decision matrix rules, and returns an advisory payload.

```
                  ┌─────────────────────────────────────────┐
                  │          Farmer Client Request          │
                  └───────────────────┬─────────────────────┘
                                      │
               ┌──────────────────────┴──────────────────────┐
               ▼                                             ▼
    [ Web Map Interface ]                         [ GSM Feature Phone ]
    (Leaflet.js / Browser)                       (USSD Menu Gateway)
               │                                             │
               │  GET /recommend?lat=...&lon=...             │  POST /ussd
               └──────────────────────┬──────────────────────┘
                                      │
                                      ▼
                        ┌──────────────────────────┐
                        │ FastAPI Advisory Service │
                        └─────────────┬────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
┌─────────────────┐         ┌───────────────────┐        ┌───────────────────┐
│ GIS Raster Engine│         │ KijaniSpace API   │        │ Crop & Irrigation │
│ (Rasterio / DEM)│         │ (5-Day Agro-Climate│       │ Decision Matrix   │
└────────┬────────┘         └─────────┬─────────┘        └─────────┬─────────┘
         │                            │                            │
         └────────────────────────────┼────────────────────────────┘
                                      │
                                      ▼
                        ┌──────────────────────────┐
                        │ Unified Advisory Output  │
                        └──────────────────────────┘
```

---

## 📊 GIS & Raster Datasets

KilimoClick bundles high-resolution spatial datasets cropped to the Kisumu / Lake Victoria Area of Interest (AOI):

| Dataset Layer | Raster File | Source & Description |
| :--- | :--- | :--- |
| **Land Cover** | `Kisumu_LandCover.tif` | ESA WorldCover 10m Land Cover classification (Cropland, Trees, Shrubland, Water). |
| **Soil pH** | `Kisumu_Soil_pH_4326.tif` | SoilGrids 250m Topsoil pH (stored as $pH \times 10$). |
| **Soil Clay** | `Kisumu_Soil_Clay_4326.tif` | SoilGrids 250m Topsoil Clay Content (%). |
| **Soil Texture** | `Kisumu_Soil_Texture_4326.tif` | SoilGrids USDA Soil Texture Classification codes (Clay, Loam, Sandy Loam, etc.). |
| **Elevation** | `Kisumu_DEM_4326.tif` | SRTM 30m Digital Elevation Model (metres above sea level). |
| **Terrain Slope** | Calculated dynamically | Derived via 3×3 DEM window neighborhood algorithm to ensure physical topography accuracy. |
| **Water Distance** | `Kisumu_WaterDistance_4326.tif` | Euclidean distance (metres) to nearest surface water body raster pixel. |

---

## 🛠️ Technology Stack

- **Backend Framework**: [FastAPI](https://fastapi.tiangolo.com/) (Python 3.10+)
- **GIS / Spatial Processing**: [Rasterio](https://rasterio.readthedocs.io/), NumPy, Math
- **HTTP & Resilience**: Requests, In-memory TTL Caching with coordinate precision rounding (`~110m`)
- **Server**: [Uvicorn](https://www.uvicorn.org/)
- **Frontend**: HTML5, CSS3 (Modern Glassmorphism & Custom Properties), Vanilla JavaScript ES6+, Leaflet.js
- **Integrations**: KijaniSpace Agro-Climate REST API, Africa's Talking USSD Gateway Protocol

---

## 🚀 Getting Started

### Prerequisites

- Python **3.10** or higher
- `pip` package manager

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/KilimoClick.git
   cd KilimoClick
   ```

2. **Create and activate a virtual environment**:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

### Configuration

Create a `.env` file in the project root directory (or configure environment variables):

```env
# Server Configuration
LOG_LEVEL=INFO
GIS_DATA_DIR=.

# KijaniSpace Weather API Integration
KIJANISPACE_BASE_URL=https://api.kijanispace.example.com
KIJANISPACE_FORECAST_PATH=/v1/agro_climate/land
KIJANISPACE_AUTH_TYPE=api_key_header
KIJANISPACE_API_KEY=your_kijanispace_api_key_here
KIJANISPACE_TIMEOUT_SECONDS=5.0

# Cache & Threshold Settings
FORECAST_CACHE_TTL_SECONDS=3600
FORECAST_FAILURE_CACHE_TTL_SECONDS=45
HEAVY_RAIN_PROBABILITY_THRESHOLD=0.60
```

### Running the Application

Start the FastAPI unified server:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Open your browser and navigate to:
- **Web Application**: `http://127.0.0.1:8000`
- **Interactive API Documentation (Swagger)**: `http://127.0.0.1:8000/docs`

---

## 📡 API Reference

### `GET /recommend`

Retrieves crop suitability recommendations, soil metrics, terrain data, 5-day moisture forecasts, and plant-now safety status for a given coordinate pair.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `lat` | `float` | Yes | - | Latitude in WGS84 decimal degrees (e.g., `-0.1080`). |
| `lon` | `float` | Yes | - | Longitude in WGS84 decimal degrees (e.g., `34.7550`). |
| `crop` | `string` | No | `None` | Specific crop name to evaluate forecast/safety check against. |

#### Sample Request
```bash
curl -X GET "http://127.0.0.1:8000/recommend?lat=-0.1080&lon=34.7550&crop=Maize"
```

#### Sample Response Payload
```json
{
  "location": { "lat": -0.108, "lon": 34.755 },
  "landcover": {
    "code": 40,
    "label": "Cropland",
    "is_cropland": true
  },
  "soil_data": {
    "pH": 6.2,
    "clay_content_pct": 28.5,
    "texture": "Clay Loam",
    "elevation_m": 1145.0
  },
  "terrain": {
    "slope_degrees": 3.4,
    "distance_to_water_m": 420.0
  },
  "recommendations": [
    { "name": "Maize", "irrigation_method": "Rain-fed", "water_need": "Medium" },
    { "name": "Tomatoes", "irrigation_method": "Drip", "water_need": "Medium" },
    { "name": "Cowpeas", "irrigation_method": "Rain-fed", "water_need": "Low" }
  ],
  "advisory_crop": "Maize",
  "moisture_forecast": {
    "data_available": true,
    "irrigate_by": "2026-07-28",
    "daily_series": [
      {
        "date": "2026-07-25",
        "soil_moisture_pct": 24.0,
        "rain_probability_pct": 10.0,
        "evapotranspiration": 3.2
      }
    ]
  },
  "plant_now_check": {
    "status": "safe",
    "message": "Conditions look good for Maize — moisture is adequate and no heavy rain is imminent."
  }
}
```

---

### `POST /ussd`

Webhooks handler for Africa's Talking USSD service interactions. Accepts both `application/x-www-form-urlencoded` and `application/json`.

#### Parameters
- `sessionId`: Unique session ID generated by the network carrier.
- `phoneNumber`: Phone number of the subscriber dialing the USSD string.
- `text`: User navigation input string (e.g., `""`, `"1"`, `"1*2"`).

#### Sample Request
```bash
curl -X POST "http://127.0.0.1:8000/ussd" \
     -H "Content-Type": "application/json" \
     -d '{"sessionId": "test-123", "phoneNumber": "+254700000000", "text": "1*2"}'
```

#### Response Output (`text/plain`)
```text
END Recommended: Maize (Rain-fed)
Soil: Clay Loam, pH 6.2
Irrigate by: Tuesday 28 Jul
Status: OK TO PLANT NOW
```

---

### `GET /health`

Checks server status.

```json
{ "status": "ok" }
```

---

## 📱 USSD Interface (`*384*9460#`)

For farmers without smartphones or internet connectivity, KilimoClick offers instant USSD menu navigation:

```
[Dial *384*9460#]
      │
      ├──> "1. Get crop & irrigation advice"
      │         │
      │         ├──> "1. Dunga Beach"
      │         ├──> "2. Nyalenda"
      │         ├──> "3. Kisumu Ndogo"
      │         ├──> "4. Manyatta"
      │         ├──> "5. Kondele"
      │         └──> "6. Mamboleo"
      │                  │
      │                  └──> [Instant Advisory Text Response]
      │
      └──> "2. Exit"
```

---

## 🧠 Decision Engine Logic

### 1. Crop Agronomic Matrix (`Crop_Logic_Matrix.json`)

Crops are filtered based on strictly bound agronomic envelope limits:

$$\text{Suitable Crop} \iff (\text{min\_pH} \le \text{pH} \le \text{max\_pH}) \land (\text{Slope} \le \text{max\_slope})$$

### 2. Irrigation Method Recommendation

- **Flood**: Primary for Rice on flat ground ($\text{Slope} \le 8^\circ$). If $\text{Slope} > 8^\circ$, automatically converted to **Sprinkler**.
- **Drip**: Recommended for high-value sensitive crops like Tomatoes.
- **Rain-fed**: Recommended when distance to surface water $>1000\,\text{m}$ or slope is gentle for crops like Maize, Cassava, and Sorghum.

### 3. Plant-Now Safety Status Rules

| Status | Trigger Condition | Advisory Message |
| :--- | :--- | :--- |
| 🟢 `safe` | Soil moisture $\ge$ Threshold AND Max Rain Prob (48h) $\le 60\%$ | Conditions optimal for planting. |
| 🟡 `wait` | Current Soil moisture < Crop Volumetric Threshold | Low moisture — irrigate first or wait for expected rain. |
| 🔴 `hold_off` | Heavy Rain Probability (next 48h) $> 60\%$ | High seed washout / waterlogging risk. Hold off. |
| ⚪ `unknown` | Forecast service offline or coordinates outside raster bounds | Advisory limited to static soil suitability. |

---

## 📜 License & Acknowledgments

- Developed for **Challenge 6** at the **KijaniSpace Talent Hackathon** (LakeHub Kisumu).
- Spatial data sources powered by **ESA WorldCover**, **SoilGrids (ISRIC)**, and **NASA SRTM**.
- Agro-climate forecasts powered by the **KijaniSpace API**.

---
*Built with ❤️ for smallholder farmers in Kenya.*

