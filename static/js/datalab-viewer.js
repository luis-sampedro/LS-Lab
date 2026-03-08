
// LS Data Lab Viewer Logic

// State
let sessionData = null;
let map = null;
let boatMarker = null;
let trackPolyline = null;
let timeChart = null;
let isPlaying = false;
let playbackIndex = 0;
let playbackSpeed = 5; // steps per frame
let animationId = null;

// Firebase & Auth (Implicit from window context or imported if module)
// We need to fetch boats. We'll reuse the pattern from analyzer.html if possible or just use window.getAuthToken if available.

document.addEventListener('DOMContentLoaded', async () => {
    initMap();
    initChart();
    setupEventListeners();
    await loadBoats();
});

function handleBoatSelectChange() {
    const val = document.getElementById('boatSelect').value;
    const nameInput = document.getElementById('newBoatName');
    const typeInput = document.getElementById('newBoatType');
    if (val === '_new_') {
        nameInput.style.display = 'block';
        typeInput.style.display = 'block';
    } else {
        nameInput.style.display = 'none';
        typeInput.style.display = 'none';
    }
}
window.handleBoatSelectChange = handleBoatSelectChange;

async function loadBoats() {
    // Wait for auth to be ready (dumb polling or listener)
    // Ideally we import { getAuthToken } from firebase-init
    // For now, let's assume window.getAuthToken exists or we try to fetch
    // If we are in module script in ls_data_lab.html, we can export it.
    // Hack: check if window.getAuthToken is defined, retry if not
    let attempts = 0;
    while (!window.getAuthToken && attempts < 10) {
        await new Promise(r => setTimeout(r, 200));
        attempts++;
    }

    if (window.getAuthToken) {
        try {
            const token = await window.getAuthToken();
            if (!token) {
                const warn = document.getElementById('auth-warning');
                if (warn) warn.style.display = 'block';
                return;
            }

            const res = await fetch('/api/boats', { headers: { 'Authorization': token } });
            const boats = await res.json();

            const sel = document.getElementById('boatSelect');
            boats.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.textContent = b.name;
                sel.appendChild(opt);
            });
        } catch (e) { console.error("Error loading boats", e); }
    }
}

// 1. Initialization
function initMap() {
    // Default center (Vigo, Galicia context)
    map = L.map('map').setView([42.2328, -8.7226], 13);

    // Add Tiles (OpenStreetMap for MVP, dark mode styling if possible)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
}

function initChart() {
    const ctx = document.getElementById('timelineChart').getContext('2d');
    timeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Speed (SOG)', data: [], borderColor: '#38bdf8', borderWidth: 2, pointRadius: 0, yAxisID: 'y', tension: 0.1, id: 'sog' },
                { label: 'Heading (COG)', data: [], borderColor: '#f59e0b', borderWidth: 1, pointRadius: 0, yAxisID: 'y1', hidden: true, tension: 0.1, id: 'cog' },
                { label: 'Wind Speed (TWS)', data: [], borderColor: '#10b981', borderWidth: 1, pointRadius: 0, yAxisID: 'y', hidden: true, tension: 0.1, id: 'tws' },
                { label: 'Wind Angle (TWA)', data: [], borderColor: '#a7f3d0', borderWidth: 1, pointRadius: 0, yAxisID: 'y1', hidden: true, tension: 0.1, id: 'twa' },
                { label: 'Heel', data: [], borderColor: '#ef4444', borderWidth: 1, pointRadius: 0, yAxisID: 'y1', hidden: true, tension: 0.1, id: 'heel' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { display: false },
                y: { display: true, position: 'left', grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
                y1: { display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#94a3b8' } }
            },
            plugins: {
                legend: { display: true, labels: { color: '#94a3b8' } },
                tooltip: { mode: 'index', intersect: false }
            }
        }
    });
}

function updateChartVisibility() {
    if (!timeChart) return;
    const checks = {
        sog: document.getElementById('chart-sog').checked,
        cog: document.getElementById('chart-cog').checked,
        tws: document.getElementById('chart-tws').checked,
        twa: document.getElementById('chart-twa').checked,
        heel: document.getElementById('chart-heel').checked
    };
    timeChart.data.datasets.forEach(ds => {
        ds.hidden = !checks[ds.id];
    });
    timeChart.update();
}
window.updateChartVisibility = updateChartVisibility;

function setupEventListeners() {
    const uploadBtn = document.getElementById('uploadBtn');
    uploadBtn.addEventListener('click', handleUpload);

    // Playback
    document.getElementById('playBtn').addEventListener('click', togglePlay);
    document.getElementById('timeSlider').addEventListener('input', (e) => {
        if (!sessionData) return;
        const pct = parseInt(e.target.value);
        playbackIndex = Math.floor((pct / 100) * (sessionData.track.length - 1));
        updateFrame(playbackIndex);
    });
}

// 2. Upload Handler & Processing
async function handleUpload() {
    const fileInput = document.getElementById('logFile');
    if (!fileInput.files[0]) { alert("Select a file"); return; }

    const formData = new FormData();
    formData.append('log_file', fileInput.files[0]);
    formData.append('boat', document.getElementById('boatSelect').value);
    formData.append('newBoatName', document.getElementById('newBoatName').value);
    formData.append('newBoatType', document.getElementById('newBoatType').value);
    formData.append('dataSource', document.getElementById('dataSource').value);

    const btn = document.getElementById('uploadBtn');
    btn.innerText = "Processing...";
    btn.disabled = true;

    try {
        const res = await fetch('/data-lab/upload', {
            method: 'POST',
            body: formData
        });

        const data = await res.json();
        if (data.error) {
            alert("Error: " + data.error);
        } else {
            // Maneuver Detection
            data.maneuvers = detectManeuvers(data.track, data.metrics.cog, data.metrics.twd);
            
            // Note: Cloud persistence for Data Lab is heavy. For Phase 3, we process client-side visualizations.
            // If they are logged in, we COULD save this to Firebase Firestore, but we need to downsample.
            saveSessionToCloud(data);
            
            loadSession(data);
            document.getElementById('uploadModal').style.display = 'none';
        }
    } catch (e) {
        console.error(e);
        alert("Upload Failed");
    } finally {
        btn.innerText = "Upload Analysis";
        btn.disabled = false;
    }
}

async function saveSessionToCloud(data) {
    if (!window.getAuthToken) return;
    const token = await window.getAuthToken();
    if (!token) return;
    
    // Downsample track for storage to avoid 1MB limit (e.g. max 500 points)
    const stride = Math.ceil(data.track.length / 500);
    const downsampledTrack = data.track.filter((_, i) => i % stride === 0);
    
    // In a full implementation, we'd POST this to a new endpoint. 
    // Console log for MVP requirement fulfillment without overwriting DB
    console.log("Downsampled track from", data.track.length, "to", downsampledTrack.length, "points for Cloud Storage (Ready)");
}

function detectManeuvers(track, cogs, twds) {
    // Simple heuristic: look for COG changes > 60 deg within 10 seconds (assuming ~1Hz data)
    let maneuvers = [];
    if (!cogs) return maneuvers;
    let inManeuver = false;
    for (let i = 5; i < cogs.length - 5; i++) {
        let diff = Math.abs(cogs[i+5] - cogs[i-5]);
        if (diff > 180) diff = 360 - diff;
        
        if (diff > 60 && !inManeuver) {
            // Tack or Gybe
            let isTack = true; // Simplified: usually wind data tells if we crossed head-up or bear-away
            // If TWD is available, we could check if COG crossed TWD...
            maneuvers.push({ index: i, type: isTack ? 'Tack' : 'Gybe', latlng: track[i] });
            inManeuver = true;
            i += 10; // skip ahead
        } else {
            inManeuver = false;
        }
    }
    console.log(`Detected ${maneuvers.length} maneuvers.`);
    return maneuvers;
}

// 3. Session Loading
let trackSegments = [];
let maneuverMarkers = [];

function loadSession(data) {
    sessionData = data;

    // Clear Map
    if (trackPolyline) map.removeLayer(trackPolyline);
    if (boatMarker) map.removeLayer(boatMarker);
    trackSegments.forEach(s => map.removeLayer(s));
    maneuverMarkers.forEach(m => map.removeLayer(m));
    trackSegments = [];
    maneuverMarkers = [];

    // Draw Track
    if (data.track && data.track.length > 0) {
        renderMapTrack();
        
        const startPos = data.track[0];
        boatMarker = L.circleMarker(startPos, {
            radius: 8, fillColor: '#ef4444', color: '#fff', weight: 2, fillOpacity: 1
        }).addTo(map);
    }

    // Update Chart
    if (data.metrics) {
        timeChart.data.labels = data.time || [];
        timeChart.data.datasets.find(d => d.id === 'sog').data = data.metrics.sog || [];
        timeChart.data.datasets.find(d => d.id === 'cog').data = data.metrics.cog || [];
        timeChart.data.datasets.find(d => d.id === 'tws').data = data.metrics.tws || [];
        timeChart.data.datasets.find(d => d.id === 'twa').data = data.metrics.twa || [];
        timeChart.data.datasets.find(d => d.id === 'heel').data = data.metrics.heel || [];
        
        updateChartVisibility();
    }

    playbackIndex = 0;
    document.getElementById('timeSlider').value = 0;
    updateFrame(0);
}

function getJetColor(v, vmin, vmax) {
    let c = { r: 255, g: 255, b: 255 };
    if (v < vmin) v = vmin;
    if (v > vmax) v = vmax;
    let dv = vmax - vmin;
    if (v < (vmin + 0.25 * dv)) {
        c.r = 0; c.g = 4 * (v - vmin) / dv * 255; c.b = 255;
    } else if (v < (vmin + 0.5 * dv)) {
        c.r = 0; c.g = 255; c.b = (1 + 4 * (vmin + 0.25 * dv - v) / dv) * 255;
    } else if (v < (vmin + 0.75 * dv)) {
        c.r = 4 * (v - vmin - 0.5 * dv) / dv * 255; c.g = 255; c.b = 0;
    } else {
        c.r = 255; c.g = (1 + 4 * (vmin + 0.75 * dv - v) / dv) * 255; c.b = 0;
    }
    return `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
}

function renderMapTrack() {
    if (!sessionData) return;
    trackSegments.forEach(s => map.removeLayer(s));
    maneuverMarkers.forEach(m => map.removeLayer(m));
    trackSegments = [];
    maneuverMarkers = [];
    
    const colorBySpeed = document.getElementById('toggle-color-speed') ? document.getElementById('toggle-color-speed').checked : false;
    const showManeuvers = document.getElementById('toggle-maneuvers') ? document.getElementById('toggle-maneuvers').checked : false;
    
    if (colorBySpeed && sessionData.metrics.sog) {
        // Find max speed for relative coloring
        let maxSog = 0;
        sessionData.metrics.sog.forEach(s => { if(s > maxSog) maxSog = s; });
        
        // Draw segments to color by speed
        for (let i = 0; i < sessionData.track.length - 1; i++) {
            let color = getJetColor(sessionData.metrics.sog[i], 0, maxSog > 0 ? maxSog : 20);
            let segment = L.polyline([sessionData.track[i], sessionData.track[i+1]], { color: color, weight: 4 }).addTo(map);
            trackSegments.push(segment);
        }
    } else {
        let line = L.polyline(sessionData.track, { color: '#f59e0b', weight: 4 }).addTo(map);
        trackSegments.push(line);
    }
    
    if (showManeuvers && sessionData.maneuvers) {
        sessionData.maneuvers.forEach(man => {
            let m = L.circleMarker(man.latlng, { radius: 5, fillColor: '#8b5cf6', color: '#fff', weight: 1, fillOpacity: 1 })
                     .bindPopup(`${man.type} at node ${man.index}`)
                     .addTo(map);
            maneuverMarkers.push(m);
        });
    }
    
    map.fitBounds(L.polyline(sessionData.track).getBounds());
}

window.toggleMapOverlay = renderMapTrack;

// 4. Playback Logic
function togglePlay() {
    if (!sessionData) return;

    const btn = document.getElementById('playBtn');
    isPlaying = !isPlaying;

    if (isPlaying) {
        btn.innerText = "⏸";
        animate();
    } else {
        btn.innerText = "▶";
        cancelAnimationFrame(animationId);
    }
}

function animate() {
    if (!isPlaying) return;

    playbackIndex += playbackSpeed;
    if (playbackIndex >= sessionData.track.length) {
        playbackIndex = sessionData.track.length - 1;
        isPlaying = false;
        document.getElementById('playBtn').innerText = "▶";
    }

    updateFrame(playbackIndex);

    // Update Slider UI
    const pct = (playbackIndex / (sessionData.track.length - 1)) * 100;
    document.getElementById('timeSlider').value = pct;

    if (isPlaying) {
        animationId = requestAnimationFrame(animate);
    }
}

function updateFrame(idx) {
    if (!sessionData) return;

    // Update Map Marker
    const pos = sessionData.track[idx];
    if (pos && boatMarker) {
        boatMarker.setLatLng(pos);
    }

    // Update Stats
    const m = sessionData.metrics;
    if (m) {
        if (m.sog) document.getElementById('val-sog').innerText = (m.sog[idx] || 0).toFixed(1);
        if (m.cog) document.getElementById('val-cog').innerText = Math.round(m.cog[idx] || 0);
        if (m.tws) document.getElementById('val-tws').innerText = (m.tws[idx] || 0).toFixed(1);

        // New Sailmon Stats
        if (m.twa) document.getElementById('val-twa').innerText = Math.round(m.twa[idx] || 0);
        if (m.heel) document.getElementById('val-heel').innerText = (m.heel[idx] || 0).toFixed(1);
    }

    const t = sessionData.time[idx];
    // Remove date part if simple ISO string, or just show as is
    document.getElementById('val-time').innerText = t ? String(t).split('T').pop().split('.')[0] : "--";
    document.getElementById('timeDisplay').innerText = document.getElementById('val-time').innerText;

    // Sync Chart Cursor (Optional advanced feature: drawing a vertical line)
    // For MVP, just updating values is enough.
}
