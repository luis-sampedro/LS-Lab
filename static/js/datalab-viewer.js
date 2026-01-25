
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
            if (!token) return;

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
                {
                    label: 'Speed (SOG)',
                    data: [],
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    borderWidth: 2,
                    pointRadius: 0,
                    yAxisID: 'y',
                    tension: 0.1
                },
                {
                    label: 'Wind Angle (TWA)',
                    data: [],
                    borderColor: '#10b981', // Emerald
                    borderWidth: 1,
                    pointRadius: 0,
                    hidden: true, // Hidden by default, toggleable
                    yAxisID: 'y1',
                    tension: 0.1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { display: false },
                y: {
                    display: true,
                    position: 'left',
                    grid: { color: '#334155' },
                    ticks: { color: '#94a3b8' }
                },
                y1: {
                    display: false, // Only show if data exists
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#10b981' }
                }
            },
            plugins: {
                legend: { display: true, labels: { color: '#94a3b8' } },
                tooltip: { mode: 'index', intersect: false }
            }
        }
    });
}

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

// 2. Upload Handler
async function handleUpload() {
    const fileInput = document.getElementById('logFile');
    if (!fileInput.files[0]) { alert("Select a file"); return; }

    const formData = new FormData();
    formData.append('log_file', fileInput.files[0]);

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

// 3. Session Loading
function loadSession(data) {
    sessionData = data;

    // Clear Map
    if (trackPolyline) map.removeLayer(trackPolyline);
    if (boatMarker) map.removeLayer(boatMarker);

    // Draw Track
    if (data.track && data.track.length > 0) {
        trackPolyline = L.polyline(data.track, { color: '#f59e0b', weight: 4 }).addTo(map);
        map.fitBounds(trackPolyline.getBounds());

        // Boat Marker
        const startPos = data.track[0];
        // Create custom boat icon (rotated div maybe?)
        // For now, simple circle marker
        boatMarker = L.circleMarker(startPos, {
            radius: 8,
            fillColor: '#ef4444',
            color: '#fff',
            weight: 2,
            fillOpacity: 1
        }).addTo(map);
    }

    // Update Chart
    if (data.metrics) {
        timeChart.data.labels = data.time || [];

        // SOG
        timeChart.data.datasets[0].data = data.metrics.sog || [];

        // TWA
        if (data.metrics.twa) {
            timeChart.data.datasets[1].data = data.metrics.twa;
            timeChart.data.datasets[1].hidden = false;
            timeChart.options.scales.y1.display = true;
        } else {
            timeChart.data.datasets[1].hidden = true;
            timeChart.options.scales.y1.display = false;
        }

        timeChart.update();
    }

    // Reset Playback
    playbackIndex = 0;
    document.getElementById('timeSlider').value = 0;
    updateFrame(0);
}

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
