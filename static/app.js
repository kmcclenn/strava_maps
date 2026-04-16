// ===== ACTIVITY TYPE CONFIG =====
const TYPE_CONFIG = {
  Run:           { color: '#fc4c02', label: 'Run' },
  TrailRun:      { color: '#e8630a', label: 'Trail Run' },
  Ride:          { color: '#3b9eff', label: 'Ride' },
  VirtualRide:   { color: '#6d6dff', label: 'Virtual Ride' },
  MountainBikeRide: { color: '#2980b9', label: 'MTB' },
  GravelRide:    { color: '#5dade2', label: 'Gravel' },
  Swim:          { color: '#00c9b1', label: 'Swim' },
  Walk:          { color: '#2ecc71', label: 'Walk' },
  Hike:          { color: '#a0522d', label: 'Hike' },
  Skiing:        { color: '#aed6f1', label: 'Ski' },
  AlpineSki:     { color: '#aed6f1', label: 'Alpine Ski' },
  NordicSki:     { color: '#85c1e9', label: 'Nordic Ski' },
  Snowboard:     { color: '#d2f5ff', label: 'Snowboard' },
  WeightTraining:{ color: '#f39c12', label: 'Weights' },
  Workout:       { color: '#f39c12', label: 'Workout' },
  Yoga:          { color: '#c39bd3', label: 'Yoga' },
  Rowing:        { color: '#1abc9c', label: 'Rowing' },
  Kayaking:      { color: '#27ae60', label: 'Kayaking' },
  Surfing:       { color: '#16a085', label: 'Surfing' },
  Crossfit:      { color: '#e74c3c', label: 'CrossFit' },
  Soccer:        { color: '#27ae60', label: 'Soccer' },
  Tennis:        { color: '#f1c40f', label: 'Tennis' },
};
const DEFAULT_COLOR = '#8892a4';

function getTypeColor(type) {
  return (TYPE_CONFIG[type] || {}).color || DEFAULT_COLOR;
}
function getTypeLabel(type) {
  return (TYPE_CONFIG[type] || {}).label || type;
}

// ===== STATE =====
let map;
let allActivities = [];
let filteredActivities = [];
let selectedId = null;
let currentMode = 'paths';
let activeTypes = new Set();

let pathsLayerGroup;
let heatLayer;
let highlightLayer;
let polylineMap = {};   // id -> L.polyline

// ===== POLYLINE DECODING =====
function decodePolyline(encoded) {
  if (!encoded) return [];
  const points = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;
  while (index < len) {
    let shift = 0, result = 0, b;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

// ===== MAP INIT =====
function initMap() {
  map = L.map('map', {
    center: [30, 0],
    zoom: 3,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  pathsLayerGroup = L.layerGroup().addTo(map);
  highlightLayer = L.layerGroup().addTo(map);

  // Click on map background → show area activity count
  map.on('click', onMapClick);
}

// ===== LOAD ACTIVITIES =====
async function loadActivities() {
  setLoading(true, 'Loading activities from Strava…', 'This may take a moment for large accounts');
  try {
    const resp = await fetch('/api/activities');
    if (resp.status === 401) { window.location.href = '/auth'; return; }
    if (!resp.ok) throw new Error(`Server error: ${resp.status}`);

    const data = await resp.json();
    allActivities = data.activities || [];

    // Update athlete info in topbar
    if (data.athlete) updateAthleteUI(data.athlete);

    // Decode polylines once and cache
    for (const a of allActivities) {
      a._coords = decodePolyline(a.polyline);
    }

    buildTypeFilters();
    activeTypes = new Set(allActivities.map(a => a.type));
    renderTypeFilters();

    applyFilters();
  } catch (err) {
    console.error(err);
    document.getElementById('loading-text').textContent = 'Failed to load activities';
    document.getElementById('loading-sub').textContent = err.message;
    return;
  }
  setLoading(false);
}

function setLoading(show, text, sub) {
  const el = document.getElementById('loading-overlay');
  if (show) {
    el.style.display = 'flex';
    if (text) document.getElementById('loading-text').textContent = text;
    if (sub !== undefined) document.getElementById('loading-sub').textContent = sub;
  } else {
    el.style.display = 'none';
  }
}

// ===== ATHLETE UI =====
function updateAthleteUI(athlete) {
  const avatar = document.getElementById('athlete-avatar');
  const name = document.getElementById('athlete-name');
  if (avatar && athlete.profile_medium) avatar.src = athlete.profile_medium;
  if (name) name.textContent = `${athlete.firstname || ''} ${athlete.lastname || ''}`.trim();
}

// ===== FILTERS =====
function buildTypeFilters() {
  const types = [...new Set(allActivities.map(a => a.type))].sort();
  const container = document.getElementById('type-filters');
  container.innerHTML = '';
  for (const t of types) {
    const chip = document.createElement('div');
    chip.className = 'type-chip active';
    chip.dataset.type = t;
    chip.innerHTML = `<span class="chip-dot" style="background:${getTypeColor(t)}"></span>${getTypeLabel(t)}`;
    chip.onclick = () => toggleTypeFilter(t);
    container.appendChild(chip);
  }
}

function renderTypeFilters() {
  for (const chip of document.querySelectorAll('.type-chip')) {
    const t = chip.dataset.type;
    chip.classList.toggle('active', activeTypes.has(t));
    chip.style.background = activeTypes.has(t) ? getTypeColor(t) + '33' : '';
    chip.style.color = activeTypes.has(t) ? getTypeColor(t) : '';
    chip.style.borderColor = activeTypes.has(t) ? getTypeColor(t) + '55' : '';
  }
}

function toggleTypeFilter(type) {
  if (activeTypes.has(type)) {
    if (activeTypes.size === 1) return; // keep at least one
    activeTypes.delete(type);
  } else {
    activeTypes.add(type);
  }
  renderTypeFilters();
  applyFilters();
}

function applyFilters() {
  const search = (document.getElementById('search-input')?.value || '').toLowerCase();
  const dateFrom = document.getElementById('date-from')?.value;
  const dateTo = document.getElementById('date-to')?.value;

  filteredActivities = allActivities.filter(a => {
    if (!activeTypes.has(a.type)) return false;
    if (search && !a.name.toLowerCase().includes(search)) return false;
    if (dateFrom && a.date < dateFrom) return false;
    if (dateTo && a.date > dateTo + 'T99') return false;
    return true;
  });

  document.getElementById('activity-count').textContent = filteredActivities.length;
  renderActivityList();
  renderMap();
}

function resetFilters() {
  activeTypes = new Set(allActivities.map(a => a.type));
  renderTypeFilters();
  document.getElementById('date-from').value = '';
  document.getElementById('date-to').value = '';
  document.getElementById('search-input').value = '';
  applyFilters();
}

// ===== ACTIVITY LIST =====
function renderActivityList() {
  const list = document.getElementById('activity-list');
  list.innerHTML = '';
  if (filteredActivities.length === 0) {
    list.innerHTML = '<div class="no-activities">No activities match your filters</div>';
    return;
  }
  // Show most recent first
  const sorted = [...filteredActivities].sort((a, b) => b.date.localeCompare(a.date));
  for (const a of sorted) {
    const item = document.createElement('div');
    item.className = 'activity-item' + (a.id === selectedId ? ' selected' : '');
    item.dataset.id = a.id;
    item.innerHTML = `
      <span class="activity-item-dot" style="background:${getTypeColor(a.type)}"></span>
      <div class="activity-item-info">
        <div class="activity-item-name">${escHtml(a.name)}</div>
        <div class="activity-item-meta">${getTypeLabel(a.type)} · ${formatDate(a.date)} · ${formatDistance(a.distance)}</div>
      </div>
    `;
    item.onclick = () => selectActivity(a.id);
    list.appendChild(item);
  }
}

// ===== MAP RENDERING =====
function renderMap() {
  if (currentMode === 'paths') {
    renderPaths();
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  } else {
    renderHeatmap();
    pathsLayerGroup.clearLayers();
    polylineMap = {};
  }
}

function renderPaths() {
  pathsLayerGroup.clearLayers();
  polylineMap = {};

  for (const a of filteredActivities) {
    if (!a._coords || a._coords.length < 2) continue;
    const color = getTypeColor(a.type);
    const pl = L.polyline(a._coords, {
      color,
      weight: 2,
      opacity: 0.65,
    });
    pl.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      selectActivity(a.id);
    });
    pl.on('mouseover', () => {
      pl.setStyle({ weight: 4, opacity: 1 });
      pl.bindTooltip(`<strong>${escHtml(a.name)}</strong><br>${getTypeLabel(a.type)} · ${formatDistance(a.distance)}`, {
        sticky: true, className: 'leaflet-dark-tooltip'
      }).openTooltip();
    });
    pl.on('mouseout', () => {
      if (a.id !== selectedId) {
        pl.setStyle({ weight: 2, opacity: 0.65 });
      }
      pl.closeTooltip();
    });
    pathsLayerGroup.addLayer(pl);
    polylineMap[a.id] = pl;
  }
}

function renderHeatmap() {
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }

  // Collect all points, downsample for performance
  const pts = [];
  for (const a of filteredActivities) {
    if (!a._coords) continue;
    // Take every 3rd point to keep it fast
    for (let i = 0; i < a._coords.length; i += 3) {
      pts.push([a._coords[i][0], a._coords[i][1], 0.5]);
    }
  }

  heatLayer = L.heatLayer(pts, {
    radius: 6,
    blur: 10,
    maxZoom: 17,
    gradient: { 0.2: '#3b9eff', 0.5: '#fc4c02', 0.8: '#ffcc00', 1.0: 'white' },
  }).addTo(map);
}

// ===== SELECT ACTIVITY =====
function selectActivity(id) {
  selectedId = id;

  // Highlight in sidebar list
  document.querySelectorAll('.activity-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id == id);
  });

  // Highlight on map (paths mode)
  if (currentMode === 'paths') {
    for (const [pid, pl] of Object.entries(polylineMap)) {
      if (parseInt(pid) === id) {
        pl.setStyle({ weight: 5, opacity: 1 });
        pl.bringToFront();
      } else {
        pl.setStyle({ weight: 2, opacity: 0.4 });
      }
    }
  }

  // Show detail panel
  const a = allActivities.find(x => x.id === id);
  if (a) {
    showDetail(a);
    // Fly to activity
    if (a._coords && a._coords.length > 0) {
      const bounds = L.latLngBounds(a._coords);
      map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 14, duration: 1.2 });
    }
  }
}

function showDetail(a) {
  const panel = document.getElementById('detail-panel');
  const content = document.getElementById('detail-content');
  const color = getTypeColor(a.type);

  const stats = [
    { label: 'Distance', value: formatDistance(a.distance), raw: null },
    { label: 'Moving Time', value: formatDuration(a.moving_time), raw: null },
    { label: 'Elevation', value: a.elevation_gain > 0 ? formatElevation(a.elevation_gain) : '—', raw: null },
    { label: 'Avg Pace/Speed', value: formatPace(a), raw: null },
  ];
  if (a.avg_hr) stats.push({ label: 'Avg Heart Rate', value: `${Math.round(a.avg_hr)} bpm`, raw: null });
  if (a.max_hr) stats.push({ label: 'Max Heart Rate', value: `${a.max_hr} bpm`, raw: null });
  if (a.max_speed > 0) stats.push({ label: 'Max Speed', value: formatSpeed(a.max_speed), raw: null });

  content.innerHTML = `
    <div class="detail-header">
      <div class="detail-type-badge" style="background:${color}22;color:${color}">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block"></span>
        ${getTypeLabel(a.type)}
      </div>
      <div class="detail-name">${escHtml(a.name)}</div>
      <div class="detail-date">${formatDateFull(a.date)}</div>
    </div>
    <div class="stats-grid">
      ${stats.map(s => `
        <div class="stat-card">
          <div class="stat-label">${s.label}</div>
          <div class="stat-value">${s.value}</div>
        </div>
      `).join('')}
    </div>
    ${a.kudos > 0 ? `<div class="detail-kudos"><span class="kudos-heart">♥</span> ${a.kudos} kudos</div>` : ''}
    <div style="margin-top:16px">
      <a href="https://www.strava.com/activities/${a.id}" target="_blank" rel="noopener"
         style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:${color};text-decoration:none;">
        View on Strava ↗
      </a>
    </div>
  `;

  panel.classList.remove('closed');
}

function closeDetail() {
  document.getElementById('detail-panel').classList.add('closed');
  selectedId = null;
  // Reset path styles
  for (const pl of Object.values(polylineMap)) {
    pl.setStyle({ weight: 2, opacity: 0.65 });
  }
  document.querySelectorAll('.activity-item').forEach(el => el.classList.remove('selected'));
}

// ===== MAP CLICK (area count) =====
function onMapClick(e) {
  if (currentMode !== 'paths') return;

  const clickPt = e.latlng;
  const radiusDeg = 0.05 * Math.pow(2, 10 - map.getZoom()); // scale with zoom

  const nearby = filteredActivities.filter(a => {
    if (!a._coords || a._coords.length === 0) return false;
    return a._coords.some(([lat, lng]) =>
      Math.abs(lat - clickPt.lat) < radiusDeg &&
      Math.abs(lng - clickPt.lng) < radiusDeg
    );
  });

  if (nearby.length === 0) return;

  const popup = document.getElementById('area-popup');
  const content = document.getElementById('area-popup-content');
  const topTypes = topN(nearby.map(a => a.type), 3);
  content.innerHTML = `
    <strong>${nearby.length} activit${nearby.length === 1 ? 'y' : 'ies'}</strong> near this area
    <span style="margin-left:8px;color:#8892a4;font-size:11px">${topTypes.map(([t, n]) => `${n} ${getTypeLabel(t)}`).join(', ')}</span>
  `;
  popup.classList.remove('hidden');
}

function topN(arr, n) {
  const counts = {};
  for (const x of arr) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ===== MODE TOGGLE =====
function setMode(mode) {
  currentMode = mode;
  document.getElementById('btn-paths').classList.toggle('active', mode === 'paths');
  document.getElementById('btn-heat').classList.toggle('active', mode === 'heatmap');
  closeDetail();
  renderMap();
}

// ===== SIDEBAR TOGGLE =====
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('closed');
}

// ===== FORMATTING HELPERS =====
function formatDistance(m) {
  if (!m) return '—';
  if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
  return m + ' m';
}

function formatDuration(s) {
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatElevation(m) {
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : m + ' m';
}

function formatSpeed(mps) {
  return (mps * 3.6).toFixed(1) + ' km/h';
}

function formatPace(a) {
  const type = a.type.toLowerCase();
  if (type.includes('run') || type.includes('walk') || type.includes('hike')) {
    // pace in min/km
    if (!a.avg_speed || a.avg_speed === 0) return '—';
    const secPerKm = 1000 / a.avg_speed;
    const min = Math.floor(secPerKm / 60);
    const sec = Math.round(secPerKm % 60);
    return `${min}:${String(sec).padStart(2, '0')}/km`;
  }
  // speed in km/h
  return a.avg_speed ? (a.avg_speed * 3.6).toFixed(1) + ' km/h' : '—';
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateFull(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
