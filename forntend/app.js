// ============================================================
// KilimoClick — app.js
// Full interactivity: Map, Charts, Crop Checker, Forecast,
// Calendar, Safety Check, Scroll Animations, Counters
// ============================================================

// --- Crop Logic Matrix (mirrors Crop_Logic_Matrix.json) ---
const CROP_LOGIC = {
  Maize:          { min_pH: 5.5, max_pH: 7.0, max_slope: 10, water_need: 'Medium', irrigation_rule: 'Rainfed / Sprinkler' },
  Rice:           { min_pH: 5.5, max_pH: 6.5, max_slope: 2,  water_need: 'High',   irrigation_rule: 'Flooded' },
  Tomatoes:       { min_pH: 6.0, max_pH: 6.8, max_slope: 12, water_need: 'Medium', irrigation_rule: 'Drip Irrigation' },
  Cassava:        { min_pH: 5.0, max_pH: 6.0, max_slope: 15, water_need: 'Low',    irrigation_rule: 'Rainfed' },
  Sorghum:        { min_pH: 5.5, max_pH: 7.5, max_slope: 12, water_need: 'Low',    irrigation_rule: 'Rainfed / Supplementary' },
  Cowpeas:        { min_pH: 5.5, max_pH: 7.0, max_slope: 15, water_need: 'Low',    irrigation_rule: 'Rainfed' },
  'Sweet Potatoes':{ min_pH: 5.5, max_pH: 6.8, max_slope: 12, water_need: 'Low',    irrigation_rule: 'Rainfed / Ridging' },
};

// Simulated sub-location soil/slope data for Kisumu
const LOCATION_DATA = {
  'Kisumu Central': { avg_pH: 6.2, avg_slope: 3  },
  'Ahono':          { avg_pH: 5.8, avg_slope: 5  },
  'Kondele':        { avg_pH: 6.0, avg_slope: 4  },
  'Manyatta':       { avg_pH: 5.7, avg_slope: 6  },
  'Nyalenda':       { avg_pH: 6.3, avg_slope: 3  },
  'Migosi':         { avg_pH: 5.9, avg_slope: 7  },
  'Kolwa East':     { avg_pH: 5.5, avg_slope: 9  },
  'Winam':          { avg_pH: 6.1, avg_slope: 2  },
};

// Kisumu region boundary (simplified polygon, EPSG:4326)
const KISUMU_BOUNDARY = [
  [-0.340, 34.52], [-0.195, 34.47], [-0.048, 34.56],
  [ 0.058, 34.71], [ 0.008, 34.97], [-0.098, 35.06],
  [-0.248, 34.98], [-0.400, 34.89], [-0.475, 34.73],
  [-0.415, 34.58],
];

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initHeroEntrance();
  initMap();
  initForecast();
  initCharts();
  initCropChecker();
  initReports();
  initCalendar();
  initSafetyCheck();
  initScrollAnimations();
  initCounters();
  initBestPlantingModal();
});

// ============================================================
// NAVBAR
// ============================================================
function initNavbar() {
  const navbar    = document.getElementById('navbar');
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('nav-links');

  // Scroll-based styling
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 24);
  }, { passive: true });

  // Mobile hamburger
  hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));

  // Close on link click (mobile)
  navLinks.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => navLinks.classList.remove('open'));
  });

  // Active link tracking
  const sections = document.querySelectorAll('section[id], footer[id]');
  const links    = document.querySelectorAll('.nav-link');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        links.forEach(l => l.classList.remove('active'));
        const active = document.querySelector(`.nav-link[href="#${entry.target.id}"]`);
        if (active) active.classList.add('active');
      }
    });
  }, { threshold: 0.35 });
  sections.forEach(s => io.observe(s));
}

// ============================================================
// HERO ENTRANCE
// ============================================================
function initHeroEntrance() {
  const content = document.querySelector('.hero-content');
  content.style.cssText = 'opacity:0;transform:translateY(32px)';
  requestAnimationFrame(() => {
    setTimeout(() => {
      content.style.transition = 'opacity 0.9s ease, transform 0.9s ease';
      content.style.opacity    = '1';
      content.style.transform  = 'translateY(0)';
    }, 80);
  });
}

// ============================================================
// MAP (Leaflet)
// ============================================================
function initMap() {
  // Base Maps
  const darkMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 19,
  });

  const satMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
  });

  const map = L.map('map', {
    center: [-0.092, 34.768],
    zoom: 10,
    zoomControl: false,
    attributionControl: false,
    layers: [satMap] // Default to satellite map
  });

  // Add a layer control to switch between basemaps
  L.control.layers({
    "Satellite": satMap,
    "Dark Map": darkMap
  }, null, { position: 'topleft' }).addTo(map);

  // Kisumu county boundary polygon
  const boundary = L.polygon(KISUMU_BOUNDARY, {
    color:       '#4ADE80',
    weight:      2,
    fillColor:   '#1B5E20',
    fillOpacity: 0.07,
    dashArray:   '6,5',
  }).addTo(map);

  boundary.bindPopup(`
    <div style="font-family:Inter,sans-serif;padding:4px;">
      <div style="font-weight:700;font-size:14px;color:#E8EDF3;margin-bottom:5px;">📍 Kisumu County</div>
      <div style="font-size:12px;color:#8FA3B1;line-height:1.6;">
        Lake Victoria Basin<br>
        6 active satellite layers<br>
        Area: ~2,085 km²
      </div>
    </div>
  `);

  // Farm marker points with crop data
  const farms = [
    { lat: -0.101, lng: 34.763, name: 'Ahono Farm',   crop: 'Maize',    pH: 5.8, slope: 5  },
    { lat: -0.175, lng: 34.718, name: 'Kondele Plot',  crop: 'Tomatoes', pH: 6.0, slope: 4  },
    { lat: -0.055, lng: 34.802, name: 'Migosi Fields', crop: 'Rice',     pH: 5.9, slope: 7  },
    { lat: -0.248, lng: 34.852, name: 'Kolwa East',    crop: 'Cassava',  pH: 5.5, slope: 9  },
    { lat: -0.298, lng: 34.650, name: 'Winam Delta',   crop: 'Rice',     pH: 6.1, slope: 2  },
    { lat: -0.080, lng: 34.730, name: 'Central Farm',  crop: 'Maize',    pH: 6.2, slope: 3  },
  ];
  const cropColors = { Maize:'#F59E0B', Rice:'#60A5FA', Tomatoes:'#F87171', Cassava:'#A78BFA' };

  farms.forEach(f => {
    L.circleMarker([f.lat, f.lng], {
      radius:      9,
      fillColor:   cropColors[f.crop] || '#4ADE80',
      color:       '#E8EDF3',
      weight:      1.8,
      fillOpacity: 0.9,
    })
    .addTo(map)
    .bindPopup(`
      <div style="font-family:Inter,sans-serif;padding:4px;min-width:148px;">
        <div style="font-weight:700;font-size:13px;color:#E8EDF3;margin-bottom:6px;">${f.name}</div>
        <div style="font-size:12px;color:#8FA3B1;line-height:1.7;">
          Crop: <strong style="color:${cropColors[f.crop]};">${f.crop}</strong><br>
          Soil pH: <strong style="color:#E8EDF3;">${f.pH}</strong><br>
          Slope: <strong style="color:#E8EDF3;">${f.slope}°</strong>
        </div>
      </div>
    `);
  });

  // Layer overlays (simulated colored fills for .tif layers)
  const overlayColors = {
    'layer-dem':      { color: '#F59E0B', opacity: 0.11 },
    'layer-landcover':{ color: '#4ADE80', opacity: 0.09 },
    'layer-slope':    { color: '#F87171', opacity: 0.09 },
    'layer-pH':       { color: '#60A5FA', opacity: 0.09 },
    'layer-clay':     { color: '#A78BFA', opacity: 0.09 },
    'layer-texture':  { color: '#FB923C', opacity: 0.09 },
  };
  const layerMap = {};

  function makeOverlay(c, o) {
    return L.polygon(KISUMU_BOUNDARY, {
      color: 'none', fillColor: c, fillOpacity: o,
    });
  }

  // DEM is on by default
  layerMap['layer-dem'] = makeOverlay('#F59E0B', 0.11).addTo(map);

  Object.entries(overlayColors).forEach(([id, { color, opacity }]) => {
    if (!layerMap[id]) layerMap[id] = makeOverlay(color, opacity);
  });

  document.querySelectorAll('.layer-toggle input').forEach(cb => {
    cb.addEventListener('change', function () {
      const overlay = layerMap[this.id];
      if (!overlay) return;
      this.checked ? overlay.addTo(map) : map.removeLayer(overlay);
    });
  });

  // Toolbar buttons
  document.getElementById('btn-zoom-in').addEventListener('click',  () => map.zoomIn());
  document.getElementById('btn-zoom-out').addEventListener('click', () => map.zoomOut());
  document.getElementById('btn-reset').addEventListener('click',    () => map.setView([-0.092, 34.768], 10));
  document.getElementById('btn-export').addEventListener('click',   () => {
    showToast('Map export will capture the current view as PNG. (Requires leaflet-image in production)', 'info');
  });
}

// ============================================================
// 5-DAY FORECAST
// ============================================================
function initForecast() {
  const today = new Date();
  const days  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const forecasts = [
    { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',  stress: 'low',      pct: '18%',  label: 'Dry'  },
    { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>',  stress: 'low',      pct: '24%',  label: 'Mild' },
    { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16.5 16.5 15 18"/><path d="M21.5 16.5 20 18"/><path d="M11.5 16.5 10 18"/><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>', stress: 'high',     pct: '79%',  label: 'Wet'  },
    { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/><path d="M16 20h.01"/><path d="M12 20h.01"/><path d="M8 20h.01"/></svg>', stress: 'moderate', pct: '52%',  label: 'Mod'  },
    { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',  stress: 'low',      pct: '21%',  label: 'Dry'  },
  ];

  const grid = document.getElementById('forecast-grid');
  grid.innerHTML = '';

  forecasts.forEach((f, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dayName = days[date.getDay()];

    const el = document.createElement('div');
    el.className = 'forecast-day';
    el.innerHTML = `
      <div class="fc-day-label">${dayName}</div>
      <div class="fc-icon">${f.icon}</div>
      <div class="fc-stress ${f.stress}"></div>
      <div class="fc-pct">${f.pct}</div>
      <div class="fc-label">${f.label}</div>
    `;
    grid.appendChild(el);
  });
}

// ============================================================
// CHARTS (Chart.js)
// ============================================================
function initCharts() {
  Chart.defaults.color         = '#8FA3B1';
  Chart.defaults.font.family   = "'Inter', sans-serif";
  Chart.defaults.font.size     = 12;

  const gridColor  = 'rgba(255,255,255,0.055)';
  const tipStyle   = {
    backgroundColor: '#192b42',
    borderColor:     'rgba(255,255,255,0.1)',
    borderWidth:     1,
    titleColor:      '#E8EDF3',
    bodyColor:       '#8FA3B1',
    padding:         10,
    cornerRadius:    6,
    displayColors:   false,
  };

  // --- 1. Soil pH Bar Chart ---
  new Chart(document.getElementById('ph-chart'), {
    type: 'bar',
    data: {
      labels: ['4.5–5.0', '5.0–5.5', '5.5–6.0', '6.0–6.5', '6.5–7.0', '7.0+'],
      datasets: [{
        label: '% Farmland',
        data: [7, 16, 34, 27, 11, 5],
        backgroundColor: [
          'rgba(248,113,113,0.72)',
          'rgba(251,146,60,0.72)',
          'rgba(74,222,128,0.76)',
          'rgba(74,222,128,0.88)',
          'rgba(96,165,250,0.72)',
          'rgba(167,139,250,0.72)',
        ],
        borderRadius: 5,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tipStyle },
      scales: {
        x: { grid: { color: gridColor }, ticks: { font: { size: 10 } } },
        y: {
          grid: { color: gridColor },
          ticks: { callback: v => v + '%', font: { size: 10 } },
          max: 42,
        },
      },
    },
  });

  // --- 2. Slope Donut Chart ---
  new Chart(document.getElementById('slope-chart'), {
    type: 'doughnut',
    data: {
      labels: ['Flat (0–5°)', 'Moderate (5–15°)', 'Steep (15°+)'],
      datasets: [{
        data: [57, 35, 8],
        backgroundColor: ['#4ADE80', '#F59E0B', '#F87171'],
        borderWidth: 0,
        hoverOffset: 10,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '66%',
      plugins: {
        legend: { display: false },
        tooltip: tipStyle,
      },
    },
  });

  // --- 3. Land Cover Horizontal Bar ---
  new Chart(document.getElementById('landcover-chart'), {
    type: 'bar',
    data: {
      labels: ['Cropland', 'Grassland', 'Water', 'Forest', 'Urban', 'Bare Land'],
      datasets: [{
        label: 'Coverage %',
        data: [43, 21, 15, 11, 7, 3],
        backgroundColor: ['#4ADE80','#86EFAC','#60A5FA','#22c55e','#F87171','#94A3B8'],
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...tipStyle, displayColors: true },
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { callback: v => v + '%', font: { size: 10 } },
          max: 52,
        },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

// ============================================================
// CROP SUITABILITY CHECKER
// ============================================================
function initCropChecker() {
  const btn = document.getElementById('check-suitability-btn');

  btn.addEventListener('click', () => {
    const cropName = document.getElementById('crop-select').value;
    const locName  = document.getElementById('location-select').value;

    if (!cropName || !locName) {
      showToast('Please select both a crop and a location.', 'warning');
      return;
    }

    const logic   = CROP_LOGIC[cropName];
    const locData = LOCATION_DATA[locName];
    if (!logic || !locData) return;

    // Calculate suitability score
    let score    = 100;
    let warnings = [];

    const { avg_pH: pH, avg_slope: slope } = locData;

    if (pH < logic.min_pH || pH > logic.max_pH) {
      score -= 36;
      warnings.push(`Soil pH (${pH}) is outside the optimal range ${logic.min_pH}–${logic.max_pH} for ${cropName}.`);
    } else if (pH < logic.min_pH + 0.25 || pH > logic.max_pH - 0.25) {
      score -= 12;
      warnings.push(`Soil pH (${pH}) is near the edge of the optimal range.`);
    }

    if (slope > logic.max_slope) {
      score -= 42;
      warnings.push(`Slope (${slope}°) exceeds the maximum (${logic.max_slope}°) recommended for ${cropName}.`);
    } else if (slope > logic.max_slope * 0.75) {
      score -= 14;
    }

    score = Math.max(0, Math.min(100, score));

    // Show result panel
    const resultPanel = document.getElementById('checker-result');
    resultPanel.classList.remove('visible');
    void resultPanel.offsetWidth; // reflow
    resultPanel.classList.add('visible');

    // Populate fields
    const phOk    = pH >= logic.min_pH && pH <= logic.max_pH;
    const slopeOk = slope <= logic.max_slope;
    document.getElementById('result-ph').textContent     = `${logic.min_pH} – ${logic.max_pH}  ${phOk ? '✓' : '✗'}`;
    document.getElementById('result-slope').textContent  = `Max ${logic.max_slope}°  ${slopeOk ? '✓' : '✗'}`;
    document.getElementById('result-water').textContent  = logic.water_need;
    document.getElementById('result-irrigation').textContent = logic.irrigation_rule;

    // Animate score counter + bar
    const scoreEl = document.getElementById('result-score');
    const barEl   = document.getElementById('score-bar');
    const dur     = 900;
    const t0      = performance.now();

    (function tick(ts) {
      const p  = Math.min((ts - t0) / dur, 1);
      const ep = 1 - Math.pow(1 - p, 3);
      const v  = Math.round(score * ep);
      scoreEl.textContent = v + '%';
      barEl.style.width   = v + '%';
      barEl.style.background =
        v >= 70 ? 'linear-gradient(90deg, #1B5E20, #4ADE80)'
                : v >= 40 ? 'linear-gradient(90deg, #78350f, #F59E0B)'
                           : 'linear-gradient(90deg, #7f1d1d, #F87171)';
      scoreEl.style.color =
        v >= 70 ? 'var(--green)' : v >= 40 ? 'var(--amber)' : 'var(--red)';
      if (p < 1) requestAnimationFrame(tick);
    })(performance.now());

    // Alert message
    const alertEl = document.getElementById('result-alert');
    if (warnings.length === 0) {
      alertEl.innerHTML = `<svg style="display:inline;vertical-align:middle;margin-right:6px;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Excellent! ${locName} is well-suited for ${cropName} cultivation.`;
      alertEl.className = 'result-alert success';
    } else if (score >= 40) {
      alertEl.innerHTML = `<svg style="display:inline;vertical-align:middle;margin-right:6px;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${warnings[0]}`;
      alertEl.className = 'result-alert warning';
    } else {
      alertEl.innerHTML = `<svg style="display:inline;vertical-align:middle;margin-right:6px;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> ${warnings.join(' ')} Consider a different crop or location.`;
      alertEl.className = 'result-alert danger';
    }

    showToast(`Suitability check complete for ${cropName} in ${locName}!`, score >= 70 ? 'success' : 'warning');
  });
}

// ============================================================
// FARMER REPORTS
// ============================================================
function initReports() {
  const reports = [
    {
      location: 'Ahono Konos',
      date: 'Jul 2025',
      text: 'Planted Maize last week after rains. Soil feels good — slight clay patches near the lower field but manageable with furrow irrigation.',
      crop: 'Maize',
    },
    {
      location: 'Kisumu Central',
      date: 'Jun 2025',
      text: 'Tomatoes doing well on drip irrigation. pH tested at 6.2 — right in the sweet spot. Yield estimate is very promising.',
      crop: 'Tomatoes',
    },
    {
      location: 'Migosi',
      date: 'Jun 2025',
      text: 'Rice fields flooded as planned. Lake Victoria water table is favorable this season. Flat terrain is perfect.',
      crop: 'Rice',
    },
  ];

  const list = document.getElementById('reports-list');
  list.innerHTML = '';

  reports.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = `report-card fade-in delay-${i + 1}`;
    el.innerHTML = `
      <div class="report-meta">
        <div class="report-location"><svg style="display:inline;vertical-align:middle;margin-right:2px;" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${r.location}</div>
        <div class="report-date">${r.date}</div>
      </div>
      <div class="report-text">${r.text}</div>
      <span class="report-tag">#${r.crop}</span>
    `;
    list.appendChild(el);
  });
}

// ============================================================
// PLANTING CALENDAR
// ============================================================
let CAL_MONTH = 6;  // July (0-indexed)
let CAL_YEAR  = 2025;

// Kisumu planting windows by month (0-indexed)
const PLANTING_WINDOWS = {
  2:  [{ range: [10, 28], type: 'marginal'  }],                                   // March
  3:  [{ range: [1,  30], type: 'optimal'   }],                                   // April (long rains)
  4:  [{ range: [1,  20], type: 'optimal'   }, { range: [21, 31], type: 'marginal' }], // May
  5:  [{ range: [1,  14], type: 'marginal'  }],                                   // June
  6:  [{ range: [1,  31], type: 'avoid'     }],                                   // July (dry)
  7:  [{ range: [1,  31], type: 'avoid'     }],                                   // August (dry)
  8:  [{ range: [15, 30], type: 'marginal'  }],                                   // September
  9:  [{ range: [1,  31], type: 'optimal'   }],                                   // October (short rains)
  10: [{ range: [1,  25], type: 'optimal'   }],                                   // November
  11: [{ range: [1,  15], type: 'marginal'  }],                                   // December
};

function getDayType(day, month) {
  const windows = PLANTING_WINDOWS[month];
  if (!windows) return 'marginal';
  for (const w of windows) {
    if (day >= w.range[0] && day <= w.range[1]) return w.type;
  }
  return 'marginal';
}

function renderCalendar() {
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  document.getElementById('cal-month-label').textContent = MONTHS[CAL_MONTH];

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  // Day-of-week headers
  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => {
    const h = document.createElement('div');
    h.className   = 'cal-day-header';
    h.textContent = d;
    grid.appendChild(h);
  });

  const firstDay    = new Date(CAL_YEAR, CAL_MONTH, 1).getDay();
  const daysInMonth = new Date(CAL_YEAR, CAL_MONTH + 1, 0).getDate();
  const today       = new Date();

  // Empty cells
  for (let i = 0; i < firstDay; i++) {
    const e = document.createElement('div');
    e.className = 'cal-day empty';
    grid.appendChild(e);
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const type = getDayType(d, CAL_MONTH);
    const cell = document.createElement('div');
    cell.className   = `cal-day ${type}`;
    cell.textContent = d;
    if (d === today.getDate() && CAL_MONTH === today.getMonth() && CAL_YEAR === today.getFullYear()) {
      cell.classList.add('today');
    }
    cell.title = `${type.charAt(0).toUpperCase() + type.slice(1)} planting window`;
    grid.appendChild(cell);
  }
}

function initCalendar() {
  renderCalendar();
  document.getElementById('cal-prev').addEventListener('click', () => {
    CAL_MONTH--;
    if (CAL_MONTH < 0) { CAL_MONTH = 11; CAL_YEAR--; }
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    CAL_MONTH++;
    if (CAL_MONTH > 11) { CAL_MONTH = 0; CAL_YEAR++; }
    renderCalendar();
  });
}

// ============================================================
// SAFETY CHECK
// ============================================================
function initSafetyCheck() {
  document.getElementById('run-safety-check').addEventListener('click', function () {
    const btn      = this;
    const icon     = document.getElementById('safety-icon');
    const badgeIds = ['badge-flood', 'badge-soil', 'badge-date'];

    // Loading state
    btn.disabled      = true;
    icon.style.animation = 'spin 0.8s linear infinite';
    btn.childNodes[btn.childNodes.length - 1].textContent = ' Checking...';

    badgeIds.forEach(id => {
      const el = document.getElementById(id);
      el.className   = 'check-badge warning';
      el.textContent = '...';
    });

    // Staggered results
    const results = [
      { id: 'badge-flood', delay: 550,  cls: 'safe',    text: 'LOW'       },
      { id: 'badge-soil',  delay: 1000, cls: 'safe',    text: 'READY'     },
      { id: 'badge-date',  delay: 1500, cls: 'safe',    text: 'CONFIRMED' },
    ];
    results.forEach(({ id, delay, cls, text }) => {
      setTimeout(() => {
        const el = document.getElementById(id);
        el.className   = `check-badge ${cls}`;
        el.textContent = text;
      }, delay);
    });

    setTimeout(() => {
      icon.style.animation = '';
      btn.childNodes[btn.childNodes.length - 1].textContent = ' Run New Check';
      btn.disabled = false;
      showToast('Safety check complete — All conditions are GO!', 'success');
    }, 1900);
  });
}

// ============================================================
// SCROLL ANIMATIONS (IntersectionObserver)
// ============================================================
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.fade-in, .stat-card, .card, .chart-card, .report-card').forEach(el => {
    observer.observe(el);
  });
}

// ============================================================
// COUNTER ANIMATIONS
// ============================================================
function initCounters() {
  const counterObs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        counterObs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.6 });

  document.querySelectorAll('[data-target]').forEach(el => counterObs.observe(el));
}

function animateCounter(el) {
  const target = parseInt(el.dataset.target, 10);
  const suffix = target > 100 ? '+' : '';
  const dur    = 1600;
  const t0     = performance.now();

  (function tick(ts) {
    const p  = Math.min((ts - t0) / dur, 1);
    const ep = 1 - Math.pow(1 - p, 4);
    const v  = Math.round(target * ep);
    el.textContent = v.toLocaleString() + (p >= 1 ? suffix : '');
    if (p < 1) requestAnimationFrame(tick);
  })(performance.now());
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type = 'info') {
  document.querySelector('.kc-toast')?.remove();

  const theme = {
    success: { bg: 'rgba(15,40,22,0.96)', border: 'rgba(74,222,128,0.35)',  color: '#4ADE80' },
    warning: { bg: 'rgba(38,27,4,0.96)',  border: 'rgba(245,158,11,0.35)',  color: '#F59E0B' },
    info:    { bg: 'rgba(12,26,54,0.96)', border: 'rgba(96,165,250,0.35)',  color: '#60A5FA' },
  };
  const { bg, border, color } = theme[type] || theme.info;

  const toast = document.createElement('div');
  toast.className = 'kc-toast';
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999;
    padding:13px 20px; background:${bg}; border:1px solid ${border};
    border-radius:9px; color:${color}; font-size:13.5px; font-weight:600;
    font-family:'Inter',sans-serif; backdrop-filter:blur(14px);
    box-shadow:0 8px 32px rgba(0,0,0,0.45); max-width:380px;
    transform:translateY(24px); opacity:0;
    transition:transform 0.3s ease, opacity 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.transform = 'translateY(0)';
      toast.style.opacity   = '1';
    });
  });

  setTimeout(() => {
    toast.style.transform = 'translateY(10px)';
    toast.style.opacity   = '0';
    setTimeout(() => toast.remove(), 320);
  }, 4200);
}

// ============================================================
// CLIMATE-ADAPTIVE BEST PLANTING ADVISOR MODAL
// ============================================================
const CLIMATE_SEASON_DATA = {
  'long-rains': {
    title: '🌧️ Long Rains Season (March – May)',
    prediction: 'Climate shift models project heavier, concentrated downpours (+18% moisture volume) with delayed onset. High flood risk in low-elevation basin zones.',
    rainfall: '450mm – 620mm',
    tempTrend: '+1.1°C vs Baseline',
    riskLevel: 'Moderate Flood / Soil Washout Risk',
    advice: 'Prioritize crops with sturdy root anchoring or flood resilience. Implement terracing and raised beds.',
    crops: [
      {
        name: 'Maize',
        variety: 'SC 419 (Early Hybrid)',
        categoryTags: ['Sturdy Stalk', 'Early Harvest (90 Days)', 'High Yield'],
        window: 'Early March – Mid April',
        waterNeed: 'Medium',
        irrigation: 'Rainfed / Sprinkler Backup',
        baseMatch: 96,
        climateBenefit: 'Bred specifically to withstand high wind velocity and heavy early seasonal downpours.'
      },
      {
        name: 'Rice',
        variety: 'NERICA Upland 4',
        categoryTags: ['Flood Tolerant', 'Clay Soil Friendly', 'High Moisture'],
        window: 'Late March – Early May',
        waterNeed: 'High',
        irrigation: 'Rainfed / Flooded Basin',
        baseMatch: 94,
        climateBenefit: 'Thrives in waterlogged clay soils, avoiding seed rot during heavy Lake Victoria rain surges.'
      },
      {
        name: 'Tomatoes',
        variety: 'Anna F1 (Raised Bed)',
        categoryTags: ['Bacterial Wilt Resistant', 'High Value', 'Drip Adaptable'],
        window: 'Mid March – April',
        waterNeed: 'Medium',
        irrigation: 'Drip Irrigation + Mulching',
        baseMatch: 88,
        climateBenefit: 'Resists fungal leaf blight during intense rain pulses when grown on elevated ridges.'
      },
      {
        name: 'Cowpeas',
        variety: 'K80 (Fast Canopy)',
        categoryTags: ['Ground Cover', 'Nitrogen-Fixing', '60-Day Crop'],
        window: 'Early March – April',
        waterNeed: 'Low',
        irrigation: 'Rainfed',
        baseMatch: 92,
        climateBenefit: 'Rapid canopy growth shields topsoil from heavy rain erosion and locks in nitrogen.'
      }
    ]
  },

  'short-rains': {
    title: '⛈️ Short Rains Season (October – December)',
    prediction: 'Predicted short rain windows with erratic rain pulses interspersed with heat spikes (+1.4°C). Short duration window requires fast-maturing crops.',
    rainfall: '280mm – 390mm',
    tempTrend: '+1.4°C Warming Pulses',
    riskLevel: 'Moisture Deficit / Rapid Evaporation',
    advice: 'Focus on short-duration, drought-tolerant varieties that complete grain-filling before early rain cessation.',
    crops: [
      {
        name: 'Sorghum',
        variety: 'IESV 92043 DL (Climate-Smart)',
        categoryTags: ['Extreme Heat Tolerance', 'Drought-Proof', 'High Biomass'],
        window: 'Early October – Mid Nov',
        waterNeed: 'Low',
        irrigation: 'Rainfed / Supplementary',
        baseMatch: 98,
        climateBenefit: 'Deep root architecture captures subsoil moisture even during 3-week dry inter-spells.'
      },
      {
        name: 'Maize',
        variety: 'DK 8031 (Drought Hybrid)',
        categoryTags: ['85-Day Maturity', 'Low Moisture Requirement', 'Pest Hardy'],
        window: 'October 1 – October 25',
        waterNeed: 'Medium-Low',
        irrigation: 'Rainfed',
        baseMatch: 90,
        climateBenefit: 'Matures 20 days faster than standard varieties, avoiding late-season moisture drop.'
      },
      {
        name: 'Sweet Potatoes',
        variety: 'VITA (Orange-Fleshed)',
        categoryTags: ['Heat Resilient', 'Nutritional Security', 'Ground Cover'],
        window: 'Mid October – November',
        waterNeed: 'Low',
        irrigation: 'Rainfed / Ridging',
        baseMatch: 95,
        climateBenefit: 'Thrives in thermal spikes; vine growth acts as natural living mulch protecting soil moisture.'
      },
      {
        name: 'Tomatoes',
        variety: 'Eden F1 (Heat Resistant)',
        categoryTags: ['Heat-Set Fruit', 'Drip Optimised', 'High Cash Yield'],
        window: 'October – Early November',
        waterNeed: 'Medium',
        irrigation: 'Precision Drip',
        baseMatch: 86,
        climateBenefit: 'Maintains flower set during high daytime heat stress (+32°C peak).'
      }
    ]
  },

  'dry-season': {
    title: '☀️ Dry & Drought-Risk Season (June – September)',
    prediction: 'Extended dry spell with intense solar radiation and high evapotranspiration rates. Surface water depletion expected across lowland zones.',
    rainfall: '< 150mm (Sparse)',
    tempTrend: '+1.8°C Peak Thermal Index',
    riskLevel: 'High Drought & Water Stress',
    advice: 'Plant root crops and minimal water consumers. Utilize drip irrigation, zero-tillage, and heavy organic mulching.',
    crops: [
      {
        name: 'Cassava',
        variety: 'Tajirika (Drought Hardy)',
        categoryTags: ['Zero Irrigation Needed', 'High Starch', 'Soil Adaptable'],
        window: 'June – July',
        waterNeed: 'Very Low',
        irrigation: 'Rainfed (Minimal)',
        baseMatch: 97,
        climateBenefit: 'Enters dormancy during peak heat and resumes growth without yield penalty.'
      },
      {
        name: 'Sorghum',
        variety: 'Serena (Red Grain)',
        categoryTags: ['Low Water Demand', 'Bird Resistant', 'Hardy Grain'],
        window: 'Early June – Mid July',
        waterNeed: 'Low',
        irrigation: 'Rainfed / Furrow',
        baseMatch: 94,
        climateBenefit: 'Requires 40% less water than maize, thriving in arid soil conditions.'
      },
      {
        name: 'Cowpeas',
        variety: 'K80 (Dual Purpose)',
        categoryTags: ['Drought Surviving', 'Fast Harvest', 'Soil Enricher'],
        window: 'June – July',
        waterNeed: 'Very Low',
        irrigation: 'Rainfed',
        baseMatch: 89,
        climateBenefit: 'Yields both edible leaves and pods under extreme soil moisture restriction.'
      },
      {
        name: 'Sweet Potatoes',
        variety: 'KABODE (Hardy Tuber)',
        categoryTags: ['Moisture Retentive', 'Long Storage', 'Drought Hardy'],
        window: 'June – August',
        waterNeed: 'Low',
        irrigation: 'Furrow / Rainfed',
        baseMatch: 91,
        climateBenefit: 'Tubers store safely underground during dry spells, insulating harvest from heat.'
      }
    ]
  },

  'warming-scenario': {
    title: '🌡️ +1.5°C Global Warming Climate Shift',
    prediction: 'Long-term climate scenario modeling persistent thermal shifts (+1.5°C), erratic monsoon shifts, and elevated evaporation baseline across Kisumu.',
    rainfall: 'Variable / Erratic Pulses',
    tempTrend: '+1.5°C Sustained Rise',
    riskLevel: 'Long-Term Ecosystem Shift',
    advice: 'Transition farm strategy to climate-resilient staple crops, agroforestry, and closed-loop drip systems.',
    crops: [
      {
        name: 'Sorghum',
        variety: 'IESV 92043 (Climate Baseline Standard)',
        categoryTags: ['Climate Change Proof', 'C4 Photosynthesis', 'High Security'],
        window: 'Flexible Planting Windows',
        waterNeed: 'Low',
        irrigation: 'Rainfed / Drip',
        baseMatch: 99,
        climateBenefit: 'C4 metabolic pathway utilizes elevated CO2 and heat with maximum water efficiency.'
      },
      {
        name: 'Cassava',
        variety: 'Tajirika (Climate Anchor)',
        categoryTags: ['Climate Anchor Crop', 'High Thermal Ceiling', 'Resilient'],
        window: 'Year-Round Flexibility',
        waterNeed: 'Very Low',
        irrigation: 'Rainfed',
        baseMatch: 96,
        climateBenefit: 'Serves as primary food security fallback against severe multi-year climate anomalies.'
      },
      {
        name: 'Sweet Potatoes',
        variety: 'VITA (Climate Smart)',
        categoryTags: ['Thermal Buffer', 'High Nutrient Yield', 'Soil Cover'],
        window: 'Bi-Annual Planting',
        waterNeed: 'Low',
        irrigation: 'Drip / Rainfed',
        baseMatch: 93,
        climateBenefit: 'Prevents soil temperature spikes by creating dense ground shading.'
      },
      {
        name: 'Rice',
        variety: 'NERICA Upland 4',
        categoryTags: ['Low-Water Paddy Alternative', 'Heat Tolerance', 'Staple'],
        window: 'Shifted Rainy Windows',
        waterNeed: 'Medium',
        irrigation: 'Rainfed / Controlled Drip',
        baseMatch: 91,
        climateBenefit: 'Replaces traditional flooded paddy rice, slashing water consumption by 65%.'
      }
    ]
  }
};

let currentSeasonKey = 'long-rains';

function initBestPlantingModal() {
  const modal       = document.getElementById('best-planting-modal');
  const heroCta     = document.getElementById('hero-cta-primary');
  const advisorBtn  = document.getElementById('open-best-planting-btn');
  const closeBtn    = document.getElementById('modal-close-btn');
  const doneBtn     = document.getElementById('modal-done-btn');
  const seasonPills = document.querySelectorAll('.season-pill');
  const locSelect   = document.getElementById('modal-location-select');

  if (!modal) return;

  function openModal() {
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    renderBestPlantingModal(currentSeasonKey, locSelect.value);
  }

  function closeModal() {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  // Hero CTA button event listener
  if (heroCta) {
    heroCta.addEventListener('click', (e) => {
      e.preventDefault();
      openModal();
    });
  }

  // Advisor Card CTA button
  if (advisorBtn) {
    advisorBtn.addEventListener('click', openModal);
  }

  // Close handlers
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (doneBtn)  doneBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
  });

  // Season Pill Selection
  seasonPills.forEach(pill => {
    pill.addEventListener('click', function () {
      seasonPills.forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      currentSeasonKey = this.dataset.season;
      renderBestPlantingModal(currentSeasonKey, locSelect.value);
    });
  });

  // Location Dropdown Change inside Modal
  if (locSelect) {
    locSelect.addEventListener('change', () => {
      renderBestPlantingModal(currentSeasonKey, locSelect.value);
    });
  }
}

function renderBestPlantingModal(seasonKey, locationName) {
  const data = CLIMATE_SEASON_DATA[seasonKey];
  if (!data) return;

  const locData = LOCATION_DATA[locationName] || { avg_pH: 6.0, avg_slope: 4 };

  // 1. Update Climate Summary Card
  const summaryCard = document.getElementById('climate-summary-card');
  summaryCard.innerHTML = `
    <div class="climate-summary-title">
      ${data.title}
    </div>
    <div class="climate-summary-text">
      ${data.prediction}
    </div>
    <div class="climate-meta-grid">
      <div class="climate-meta-item">
        <div class="climate-meta-label">Expected Rainfall</div>
        <div class="climate-meta-val">${data.rainfall}</div>
      </div>
      <div class="climate-meta-item">
        <div class="climate-meta-label">Temp Anomaly</div>
        <div class="climate-meta-val" style="color:var(--amber);">${data.tempTrend}</div>
      </div>
      <div class="climate-meta-item">
        <div class="climate-meta-label">Climate Risk</div>
        <div class="climate-meta-val" style="color:var(--green);">${data.riskLevel}</div>
      </div>
      <div class="climate-meta-item">
        <div class="climate-meta-label">Location Soil/Slope</div>
        <div class="climate-meta-val">${locationName} (pH ${locData.avg_pH}, ${locData.avg_slope}°)</div>
      </div>
    </div>
  `;

  // 2. Render Crop Cards Grid
  const countBadge = document.getElementById('recommended-count');
  countBadge.textContent = `${data.crops.length} Suitable Varieties Recommended`;

  const cropsGrid = document.getElementById('crops-grid');
  cropsGrid.innerHTML = '';

  data.crops.forEach(crop => {
    const logic = CROP_LOGIC[crop.name] || { min_pH: 5.5, max_pH: 7.0, max_slope: 12 };
    
    // Adjust match percentage according to location soil pH and slope suitability
    let match = crop.baseMatch;
    if (locData.avg_pH < logic.min_pH || locData.avg_pH > logic.max_pH) match -= 8;
    if (locData.avg_slope > logic.max_slope) match -= 12;
    match = Math.max(70, Math.min(99, match));

    const card = document.createElement('div');
    card.className = 'crop-card';
    card.innerHTML = `
      <div class="crop-card-top">
        <div class="crop-card-header">
          <div>
            <div class="crop-name">${crop.name}</div>
            <div class="crop-variety">${crop.variety}</div>
          </div>
          <span class="crop-match-badge ${match >= 90 ? 'high' : 'mod'}">${match}% Match</span>
        </div>
        <div class="crop-tags">
          ${crop.categoryTags.map(t => `<span class="crop-tag">${t}</span>`).join('')}
        </div>
        <div class="crop-details-list">
          <div class="crop-detail-row">
            <span class="crop-detail-key">Planting Window:</span>
            <span class="crop-detail-val">${crop.window}</span>
          </div>
          <div class="crop-detail-row">
            <span class="crop-detail-key">Water Need:</span>
            <span class="crop-detail-val">${crop.waterNeed}</span>
          </div>
          <div class="crop-detail-row">
            <span class="crop-detail-key">Irrigation:</span>
            <span class="crop-detail-val">${crop.irrigation}</span>
          </div>
        </div>
        <div class="climate-benefit-box">
          <strong>💡 Climate Advantage:</strong> ${crop.climateBenefit}
        </div>
      </div>
      <button class="crop-select-btn" data-crop="${crop.name}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        Select for Field Suitability Test
      </button>
    `;

    // Attach click handler on "Select for Field Suitability Test" button inside card
    card.querySelector('.crop-select-btn').addEventListener('click', function () {
      const selectedCropName = this.dataset.crop;
      const modal = document.getElementById('best-planting-modal');
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';

      // Scroll to Crop Advisor Section
      const advisorSection = document.getElementById('crop-advisor');
      if (advisorSection) {
        advisorSection.scrollIntoView({ behavior: 'smooth' });
      }

      // Pre-select crop and location in the main advisor card
      const cropSelect = document.getElementById('crop-select');
      const locSelect  = document.getElementById('location-select');
      if (cropSelect) cropSelect.value = selectedCropName;
      if (locSelect)  locSelect.value  = locationName;

      // Trigger suitability check automatically
      setTimeout(() => {
        const checkBtn = document.getElementById('check-suitability-btn');
        if (checkBtn) checkBtn.click();
      }, 500);
    });

    cropsGrid.appendChild(card);
  });
}

