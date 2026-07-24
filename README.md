# KilimoClick 🌾

> "Plant Right, Water on Time" — A single-endpoint crop and irrigation advisory engine for smallholder farmers in the Lake Victoria Basin. Built for Challenge 6 at the KijaniSpace Talent Hackathon (LakeHub Kisumu).

## 🚀 The Feature Set
- **Crop Suitability Pipeline:** Reads ESA WorldCover, SoilGrids, and SRTM DEM rasters.
- **5-Day Moisture-Stress Forecast:** Converts live KijaniSpace climate streams into clean date targets.
- **Plant-Now Safety Check:** Deterministic rule flags preventing input loss and seed washout.
- **Data-Honesty Engine:** Fallback triggers if live satellite sensors face cloud-obscurity.
- **Dual-Channel Access:** Web map interface for smartphone users + USSD interface (`*384*9460#`) for GSM feature phones.

## 🛠️ Architecture
Stateless, database-less computation engine. Every query maps a single location vector, reads underlying rasters, fetches live forecasts, applies rules, and exits.
