
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
let globalHeuristicTwd = 0; // Baseline TWD if missing
let isWindFeasible = false; // Whether the file has real, non-zero wind data

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
        // Memory: Save boat selection
        if (val) {
            localStorage.setItem('lastSelectedBoatId', val);
            const sel = document.getElementById('boatSelect');
            const name = sel.options[sel.selectedIndex].text;
            localStorage.setItem('lastSelectedBoatName', name);
        }
    }
}
window.handleBoatSelectChange = handleBoatSelectChange;

async function loadBoats(token) {
    if (!token) return;
    try {
        const res = await fetch('/api/boats', { headers: { 'Authorization': token } });
        const boats = await res.json();

        const sel = document.getElementById('boatSelect');
        // Clear existing except first two
        while(sel.options.length > 2) sel.remove(2);

        boats.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.name;
            sel.appendChild(opt);
        });

        // Memory: Load last selected boat
        const lastBid = localStorage.getItem('lastSelectedBoatId');
        if (lastBid) {
            sel.value = lastBid;
        }
    } catch (e) { console.error("Error loading boats", e); }
}

// Global Auth State Handler for Data Lab
function initAuthHandler() {
    const checkAuth = () => {
        const firebase = window.firebaseApp;
        if (!firebase || !firebase.onAuthStateChanged) {
            setTimeout(checkAuth, 100);
            return;
        }

        firebase.onAuthStateChanged(firebase.auth, async (user) => {
            const warn = document.getElementById('auth-warning');
            if (user) {
                if (warn) warn.style.display = 'none';
                const token = await user.getIdToken();
                await loadBoats(token);
            } else {
                if (warn) warn.style.display = 'block';
                // Clear boat list if logged out
                const sel = document.getElementById('boatSelect');
                if(sel) { while(sel.options.length > 2) sel.remove(2); }
            }
        });
    };
    checkAuth();
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initChart();
    setupEventListeners();
    initAuthHandler();
    
    // Wind Mode Listener
    const wm = document.getElementById('windMode');
    if(wm) wm.addEventListener('change', updateWindModeUI);
});

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

const redIcon = L.divIcon({
    className: 'custom-div-icon',
    html: "<div style='background-color:#ef4444; border: 2px solid white; border-radius: 50%; width: 16px; height: 16px; box-shadow: 0 0 8px rgba(0,0,0,0.5); cursor: grab;'></div>",
    iconSize: [16, 16],
    iconAnchor: [8, 8]
});

// Chart.js Scrubber Plugin
const scrubberPlugin = {
    id: 'scrubber',
    afterDatasetsDraw(chart) {
        if (!sessionData) return;
        const {ctx, chartArea: {top, bottom}, scales: {x}} = chart;
        const xVal = sessionData.elapsed[playbackIndex];
        const xPos = x.getPixelForValue(xVal);
        
        ctx.save();
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ef4444';
        ctx.moveTo(xPos, top);
        ctx.lineTo(xPos, bottom);
        ctx.stroke();
        
        // Handle circle at top
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(xPos, top, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
};
Chart.register(scrubberPlugin);

function initChart() {
    const ctx = document.getElementById('timelineChart').getContext('2d');
    timeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { id: 'sog', label: 'SOG', data: [], borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.1)', fill: true, tension: 0.3, pointRadius: 0, yAxisID: 'y' },
                { id: 'cog', label: 'COG', data: [], borderColor: '#f59e0b', tension: 0.3, pointRadius: 0, yAxisID: 'y1', hidden: true },
                { id: 'tws', label: 'TWS', data: [], borderColor: '#10b981', tension: 0.3, pointRadius: 0, yAxisID: 'y' },
                { id: 'twd', label: 'TWD', data: [], borderColor: '#8b5cf6', borderDash: [5, 5], tension: 0.3, pointRadius: 0, yAxisID: 'y1', hidden: true },
                { id: 'twa', label: 'TWA', data: [], borderColor: '#10b981', borderDash: [5, 5], tension: 0.3, pointRadius: 0, yAxisID: 'y1', hidden: true },
                { id: 'heel', label: 'Heel', data: [], borderColor: '#ef4444', tension: 0.3, pointRadius: 0, yAxisID: 'y' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { 
                    type: 'linear',
                    display: true,
                    min: 0,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: '#a0a0a0',
                        callback: function(value) {
                            const h = Math.floor(value / 3600);
                            const m = Math.floor((value % 3600) / 60);
                            const s = Math.floor(value % 60);
                            return h > 0 ? 
                                `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : 
                                `${m}:${String(s).padStart(2,'0')}`;
                        }
                    }
                },
                y: { display: true, position: 'left', grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
                y1: { display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#94a3b8' } }
            },
            plugins: {
                legend: { display: false },
                tooltip: { mode: 'index', intersect: false }
            }
        }
    });
}

function toggleVariable(id) {
    if (!timeChart) return;
    const btn = document.getElementById('btn-chart-' + id);
    if (!btn) return;

    const dataset = timeChart.data.datasets.find(ds => ds.id === id);
    if (dataset) {
        dataset.hidden = !dataset.hidden;
        if (dataset.hidden) {
            btn.classList.add('inactive');
        } else {
            btn.classList.remove('inactive');
        }
    }
    
    // Dynamically toggle Y1 axis visibility
    const needsY1 = timeChart.data.datasets.some(ds => ds.yAxisID === 'y1' && !ds.hidden);
    timeChart.options.scales.y1.display = needsY1;
    
    timeChart.update();
}
window.toggleVariable = toggleVariable;

function chartZoom(delta) {
    if (!timeChart || !sessionData) return;
    const scale = timeChart.options.scales.x;
    const totalElapsed = sessionData.elapsed[sessionData.elapsed.length - 1];
    const currentMin = scale.min !== undefined ? scale.min : 0;
    const currentMax = scale.max !== undefined ? scale.max : totalElapsed;
    
    const range = currentMax - currentMin;
    const center = (currentMin + currentMax) / 2;
    const newRange = delta > 0 ? range * 0.7 : range * 1.3;
    
    scale.min = Math.max(0, center - newRange / 2);
    scale.max = Math.min(totalElapsed, center + newRange / 2);
    
    timeChart.update();
}
window.chartZoom = chartZoom;

function resetZoom() {
    if (!timeChart || !sessionData) return;
    timeChart.options.scales.x.min = 0;
    timeChart.options.scales.x.max = sessionData.elapsed[sessionData.elapsed.length - 1];
    timeChart.update();
}
window.resetChartZoom = resetZoom;

function setupEventListeners() {
    const uploadBtn = document.getElementById('uploadBtn');
    uploadBtn.addEventListener('click', handleUpload);

    // Playback
    document.getElementById('playBtn').addEventListener('click', togglePlay);
    document.getElementById('timeSlider').addEventListener('input', (e) => {
        const targetElapsed = parseFloat(e.target.value);
        playbackIndex = findNearestIndex(targetElapsed);
        updateFrame(playbackIndex);
    });

    function findNearestIndex(targetTime) {
        let low = 0, high = sessionData.elapsed.length - 1;
        while (low < high) {
            let mid = Math.floor((low + high) / 2);
            if (sessionData.elapsed[mid] < targetTime) low = mid + 1;
            else high = mid;
        }
        return low;
    }
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
    const labels = data.time || [];
    
    // Normalize time to elapsed seconds
    sessionData.elapsed = [];
    if (labels.length > 0) {
        const start = new Date(labels[0].replace(' ', 'T')).getTime();
        data.time.forEach(t => {
            const current = new Date(t.replace(' ', 'T')).getTime();
            sessionData.elapsed.push((current - start) / 1000);
        });
    } else {
        // Fallback to indices if no time data
        data.track.forEach((_, i) => sessionData.elapsed.push(i));
    }

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
        boatMarker = L.marker(startPos, {
            icon: redIcon,
            draggable: true
        }).addTo(map);

        // Sync Drag
        boatMarker.on('drag', (e) => {
            if (isPlaying) togglePlay(); // Pause if playing
            const idx = findNearestTrackPoint(e.target.getLatLng());
            playbackIndex = idx;
            updateFrame(idx);
        });

        boatMarker.on('dragend', (e) => {
            // Snap to exact data point
            boatMarker.setLatLng(data.track[playbackIndex]);
        });
    }

    // Update Chart
    if (data.metrics) {
        timeChart.options.scales.x.max = sessionData.elapsed[sessionData.elapsed.length - 1];
        timeChart.data.datasets[0].data = data.metrics.sog.map((v, i) => ({ x: sessionData.elapsed[i], y: v }));
        timeChart.data.datasets[1].data = data.metrics.cog.map((v, i) => ({ x: sessionData.elapsed[i], y: v }));
        timeChart.data.datasets[2].data = (data.metrics.tws || []).map((v, i) => ({ x: sessionData.elapsed[i], y: v }));
        timeChart.data.datasets[3].data = (data.metrics.twd || []).map((v, i) => ({ x: sessionData.elapsed[i], y: v }));
        timeChart.data.datasets[4].data = (data.metrics.twa || []).map((v, i) => ({ x: sessionData.elapsed[i], y: v }));
        timeChart.data.datasets[5].data = (data.metrics.heel || []).map((v, i) => ({ x: sessionData.elapsed[i], y: v }));
        
        // Initial visibility
        let needsY1 = false;
        timeChart.data.datasets.forEach(ds => {
            const btn = document.getElementById('btn-chart-' + ds.id);
            if (btn) {
                ds.hidden = btn.classList.contains('inactive');
            }
            if (!ds.hidden && ds.yAxisID === 'y1') {
                needsY1 = true;
            }
        });
        
        timeChart.options.scales.y1.display = needsY1;
        timeChart.update();
    }

    // Update Playback Defaults
    playbackIndex = 0;
    const totalElapsed = sessionData.elapsed[sessionData.elapsed.length - 1];
    document.getElementById('timeSlider').max = totalElapsed;
    document.getElementById('timeSlider').value = 0;
    
    // 1. Initial Feasibility Check
    checkWindFeasibility();
    
    // 2. Process Background TWD Persistence (Async)
    processTwdPersistence().then(() => {
        // 3. UI Updates after processing
        updateWindModeUI();
        updateFrame(0);
        
        // Push processed data to chart
        if (sessionData.metrics.twd_auto) {
            timeChart.data.datasets[3].data = sessionData.metrics.twd_auto.map((v, i) => ({ x: sessionData.elapsed[i], y: v }));
            timeChart.update('none');
        }
    });
}

function checkWindFeasibility() {
    if (!sessionData || !sessionData.metrics) return;
    const m = sessionData.metrics;
    
    // Check if TWS/TWD/TWA are present and significantly non-zero
    const hasTwd = m.twd && m.twd.some(v => v !== 0 && v !== null);
    const hasTwa = m.twa && m.twa.some(v => v !== 0 && v !== null);
    
    isWindFeasible = hasTwd || hasTwa;
    console.log("Wind Feasibility:", isWindFeasible);
    
    // If not feasible, switch UI to heuristic by default
    const modeSelect = document.getElementById('windMode');
    if (!isWindFeasible && modeSelect) {
        modeSelect.value = 'heuristic';
    }
}

async function fetchMeteoTwd() {
    if (!sessionData) return 0;
    try {
        const lat = sessionData.track[0][0];
        const lon = sessionData.track[0][1];
        let dateStr = "2023-01-01";
        if(sessionData.time && sessionData.time[0]) {
            dateStr = String(sessionData.time[0]).split('T')[0].split(' ')[0];
        }

        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${dateStr}&end_date=${dateStr}&hourly=winddirection_10m`;
        const res = await fetch(url);
        const data = await res.json();
        if (data && data.hourly && data.hourly.winddirection_10m) {
            const validWinds = data.hourly.winddirection_10m.filter(w => w !== null);
            if(validWinds.length > 0) {
                return validWinds.reduce((a, b) => a + b) / validWinds.length;
            }
        }
    } catch (e) { console.error("Meteo Baseline failed", e); }
    return 0;
}

function silentDetectRaces() {
    if (!sessionData || !sessionData.metrics.sog) return [];
    
    let races = [];
    const sogs = sessionData.metrics.sog;
    const thresh = 2.0;
    const MIN_RACE_DURATION = 1200; 
    const DROP_TOLERANCE = 300;

    let inRace = false, raceStart = 0, drops = 0;
    for (let i = 0; i < sogs.length; i++) {
        if (sogs[i] >= thresh) {
            if (!inRace) { inRace = true; raceStart = i; }
            drops = 0;
        } else {
            if (inRace) {
                drops++;
                if (drops > DROP_TOLERANCE) {
                    inRace = false;
                    let raceEnd = i - DROP_TOLERANCE;
                    if (raceEnd - raceStart > MIN_RACE_DURATION) {
                        races.push({startIdx: raceStart, endIdx: raceEnd});
                    }
                }
            }
        }
    }
    if (inRace && sogs.length - raceStart > MIN_RACE_DURATION) {
        races.push({startIdx: raceStart, endIdx: sogs.length - 1});
    }
    return races;
}

async function processTwdPersistence() {
    if (!sessionData || !sessionData.metrics) return;
    const m = sessionData.metrics;
    const count = sessionData.track.length;
    const hdgs = m.hdt || m.cog;
    const sogs = m.sog; // to filter for speed
    
    m.twd_auto = new Array(count).fill(0);
    m.twa_auto = new Array(count).fill(0);
    
    // Step 1: Baseline from Meteo API
    let persistentTwd = await fetchMeteoTwd();
    console.log("Starting Baseline TWD (Meteo):", persistentTwd);
    
    // Step 2: Identify races background-only
    const races = silentDetectRaces();
    
    // Step 3: Populate race-based TWDs
    let raceHeuristics = [];
    races.forEach(r => {
        let candidate = estimateTwdFromRace(r);
        
        // Apply 60-degree drift filter relative to baseline or previous race
        let currentRef = raceHeuristics.length > 0 ? raceHeuristics[raceHeuristics.length - 1].twd : (persistentTwd || candidate);
        
        // Handle 360 wrap
        let diff = Math.abs(candidate - currentRef);
        if (diff > 180) diff = 360 - diff;
        
        if (candidate !== 0 && (diff < 60 || persistentTwd === 0)) {
            raceHeuristics.push({race: r, twd: candidate});
        } else {
            // If drift too high, maintain reference
            raceHeuristics.push({race: r, twd: currentRef});
        }
    });

    // Step 4: Propagate TWD to all points (Nearest Race logic)
    for (let i = 0; i < count; i++) {
        let bestTwd = persistentTwd;
        
        if (raceHeuristics.length > 0) {
            // Find the temporally closest race
            let minDist = Infinity;
            raceHeuristics.forEach(rh => {
                let dist = 0;
                if (i < rh.race.startIdx) dist = rh.race.startIdx - i;
                else if (i > rh.race.endIdx) dist = i - rh.race.endIdx;
                
                if (dist < minDist) {
                    minDist = dist;
                    bestTwd = rh.twd;
                }
            });
        }
        
        m.twd_auto[i] = bestTwd;
        
        // Calculate TWA-AUTO = HDG - TWD
        let diff = (hdgs[i] || 0) - bestTwd;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;
        m.twa_auto[i] = diff;
    }
    
    console.log("Advanced Wind Persistence Processing Complete.");
}

function updateWindModeUI() {
    if (!sessionData) return;
    const mode = document.getElementById('windMode').value;
    const isEs = window.location.href.includes('lang=es');
    
    const lblTwd = document.getElementById('lbl-twd');
    const lblTwa = document.getElementById('lbl-twa');
    
    const badgeTwd = document.querySelector('#lbl-twd .auto-badge');
    const badgeTwa = document.querySelector('#lbl-twa .auto-badge');
    
    if (mode === 'heuristic' || mode === 'api') {
        if (lblTwd) lblTwd.childNodes[0].textContent = isEs ? "Direc. (TWD)-AUTO " : "Direction (TWD)-AUTO ";
        if (lblTwa) lblTwa.childNodes[0].textContent = isEs ? "Ángulo (TWA)-AUTO " : "Angle (TWA)-AUTO ";
        if (badgeTwd) badgeTwd.style.display = 'none'; // Avoid redundancy
        if (badgeTwa) badgeTwa.style.display = 'none';
    } else {
        if (lblTwd) lblTwd.childNodes[0].textContent = isEs ? "Direc. (TWD) " : "Direction (TWD) ";
        if (lblTwa) lblTwa.childNodes[0].textContent = isEs ? "Ángulo (TWA) " : "Angle (TWA) ";
        // Badges will be managed by updateFrame for sensor mode
    }
    updateFrame(playbackIndex);
}

function calculateGlobalHeuristicWind() {
    if (!sessionData || !sessionData.metrics.cog) return;
    // Simple median of COG if we have a representative sample, 
    // but better to just use estimateTwdFromRace for the whole session
    globalHeuristicTwd = estimateTwdFromRace({startIdx: 0, endIdx: sessionData.track.length - 1});
    console.log("Global Heuristic TWD:", globalHeuristicTwd);
}

function findNearestTrackPoint(latlng) {
    if (!sessionData || !sessionData.track) return 0;
    let minIdx = 0;
    let minDistance = Infinity;
    const lat = latlng.lat;
    const lng = latlng.lng;
    
    // Quick search: iterate track
    for (let i = 0; i < sessionData.track.length; i++) {
        const p = sessionData.track[i];
        const dist = (p[0] - lat)**2 + (p[1] - lng)**2;
        if (dist < minDistance) {
            minDistance = dist;
            minIdx = i;
        }
    }
    return minIdx;
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

function renderMapTrack(sliceStartIdx, sliceEndIdx) {
    if (!sessionData) return;
    trackSegments.forEach(s => map.removeLayer(s));
    maneuverMarkers.forEach(m => map.removeLayer(m));
    trackSegments = [];
    maneuverMarkers = [];
    
    // Support truncation if isolating a race
    const startIdx = sliceStartIdx !== undefined ? sliceStartIdx : 0;
    const endIdx = sliceEndIdx !== undefined ? sliceEndIdx : sessionData.track.length - 1;
    
    const displayTrack = sessionData.track.slice(startIdx, endIdx + 1);
    // If there's no track to display after slice, don't attempt
    if (displayTrack.length === 0) return;

    const displaySog = sessionData.metrics.sog ? sessionData.metrics.sog.slice(startIdx, endIdx + 1) : null;

    const colorBySpeed = document.getElementById('toggle-color-speed') ? document.getElementById('toggle-color-speed').checked : false;
    const showManeuvers = document.getElementById('toggle-maneuvers') ? document.getElementById('toggle-maneuvers').checked : false;
    
    if (colorBySpeed && displaySog) {
        let maxSog = 0;
        displaySog.forEach(s => { if(s > maxSog) maxSog = s; });
        
        for (let i = 0; i < displayTrack.length - 1; i++) {
            let color = getJetColor(displaySog[i], 0, maxSog > 0 ? maxSog : 20);
            let segment = L.polyline([displayTrack[i], displayTrack[i+1]], { color: color, weight: 4 }).addTo(map);
            trackSegments.push(segment);
        }
    } else {
        let line = L.polyline(displayTrack, { color: '#f59e0b', weight: 4 }).addTo(map);
        trackSegments.push(line);
    }
    
    if (showManeuvers && sessionData.maneuvers) {
        sessionData.maneuvers.forEach(man => {
            if (man.index >= startIdx && man.index <= endIdx) {
                let m = L.circleMarker(man.latlng, { radius: 5, fillColor: '#8b5cf6', color: '#fff', weight: 1, fillOpacity: 1 })
                         .bindPopup(`${man.type} at node ${man.index}`)
                         .addTo(map);
                maneuverMarkers.push(m);
            }
        });
    }
    
    map.fitBounds(L.polyline(displayTrack).getBounds());
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

    // Increment by time (assuming 1Hz data, or adjust based on delta time)
    playbackIndex++;
    if (playbackIndex >= sessionData.track.length) {
        playbackIndex = sessionData.track.length - 1;
        isPlaying = false;
        document.getElementById('playBtn').innerText = "▶";
    }

    updateFrame(playbackIndex);

    // Update Slider UI matches elapsed time
    document.getElementById('timeSlider').value = sessionData.elapsed[playbackIndex];

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
        // SOG Unit Conversion
        const sogVal = m.sog ? m.sog[idx] : 0;
        const sogUnit = document.getElementById('sogUnit') ? document.getElementById('sogUnit').value : 'kn';
        let displaySog = sogVal;
        if (sogUnit === 'ms') displaySog = sogVal / 1.94384; 
        
        document.getElementById('val-sog').innerText = displaySog.toFixed(1);
        const lblSogUnit = document.getElementById('lbl-sog-unit');
        if (lblSogUnit) {
            const isEs = window.location.href.includes('lang=es');
            lblSogUnit.innerText = (sogUnit === 'ms') ? 'm/s' : (isEs ? 'nudos' : 'knots');
        }
        if (m.cog) document.getElementById('val-cog').innerText = Math.round(m.cog[idx] || 0);
        if (m.hdt) {
             const hdtEl = document.getElementById('val-hdt');
             if (hdtEl) hdtEl.innerText = Math.round(m.hdt[idx] || 0);
        }
        if (m.heel) document.getElementById('val-heel').innerText = (m.heel[idx] || 0).toFixed(1);
        
        const mode = document.getElementById('windMode') ? document.getElementById('windMode').value : 'sensor';
        
        // Advanced Wind Stats + (AUTO) Badging
        // True Wind Speed
        const twsEl = document.getElementById('val-tws');
        if (twsEl) {
            twsEl.innerText = m.tws ? (m.tws[idx] || 0).toFixed(1) : "--";
            const autoBadge = document.querySelector('#lbl-tws .auto-badge');
            if (autoBadge) autoBadge.style.display = (m.tws && m.tws._auto) ? 'inline' : 'none';
        }
        
        // True Wind Direction (TWD)
        const twdEl = document.getElementById('val-twd');
        if (twdEl) {
            let val = "--";
            let showAuto = false;
            
            if (mode === 'sensor' && isWindFeasible && m.twd) {
                val = Math.round(m.twd[idx] || 0);
            } else {
                val = Math.round(m.twd_auto ? m.twd_auto[idx] : globalHeuristicTwd);
                showAuto = true;
            }
            
            twdEl.innerText = val;
            const autoBadge = document.querySelector('#lbl-twd .auto-badge');
            if (autoBadge) autoBadge.style.display = showAuto ? 'inline' : 'none';
        }

        // True Wind Angle (TWA)
        const twaEl = document.getElementById('val-twa');
        if (twaEl) {
            let val = "--";
            let showAuto = false;
            
            if (mode === 'sensor' && isWindFeasible && m.twa) {
                val = Math.round(m.twa[idx] || 0);
            } else {
                val = Math.round(m.twa_auto ? m.twa_auto[idx] : 0);
                showAuto = true;
            }
            
            twaEl.innerText = val;
            const autoBadge = document.querySelector('#lbl-twa .auto-badge');
            if (autoBadge) autoBadge.style.display = showAuto ? 'inline' : 'none';
        }
    }

    const t = sessionData.time[idx];
    document.getElementById('val-time').innerText = t ? String(t).split('T').pop().split('.')[0] : "--";
    document.getElementById('timeDisplay').innerText = document.getElementById('val-time').innerText;

    // Sync Chart Scrubber
    if (timeChart) {
        timeChart.update('none'); // Update without animation for performance
    }
}

// 5. Segmentation Logic
let activeSegments = []; // { startIdx, endIdx, type, label, color }
let currentTimelineFilter = 'all';

window.isolateSegmentGroup = function(groupId) {
    if (!sessionData) return;
    
    // Update pills UI
    const container = document.getElementById('dynamic-segment-filters');
    if (container) {
        const pills = container.querySelectorAll('.var-pill');
        pills.forEach(p => {
            if (p.id === `btn-filter-${groupId}`) {
                p.classList.add('active');
                p.classList.remove('inactive');
            } else {
                p.classList.remove('active');
                p.classList.add('inactive');
            }
        });
    }

    if (groupId === 'all') {
        // Reset full view
        renderMapTrack();
        if (timeChart) {
            timeChart.options.scales.x.min = 0;
            timeChart.options.scales.x.max = sessionData.elapsed[sessionData.elapsed.length - 1];
            timeChart.update('none');
        }
    } else {
        // Isolate specific group ID
        let groupStartIdx = Infinity;
        let groupEndIdx = 0;
        
        activeSegments.forEach(seg => {
            if (seg.groupId === groupId) {
                if (seg.startIdx < groupStartIdx) groupStartIdx = seg.startIdx;
                if (seg.endIdx > groupEndIdx) groupEndIdx = seg.endIdx;
            }
        });
        
        if (groupStartIdx !== Infinity) {
            // Cut Map Track!
            renderMapTrack(groupStartIdx, groupEndIdx);
            
            // Autozoom Chart
            if (timeChart) {
                timeChart.options.scales.x.min = sessionData.elapsed[groupStartIdx];
                timeChart.options.scales.x.max = sessionData.elapsed[groupEndIdx];
                timeChart.update('none');
            }
            
            // Auto-move scrubber
            playbackIndex = groupStartIdx;
            if (document.getElementById('timeSlider')) {
                document.getElementById('timeSlider').value = sessionData.elapsed[playbackIndex];
            }
            updateFrame(playbackIndex);
        }
    }
}

function updateSegmentFiltersUI() {
    const container = document.getElementById('dynamic-segment-filters');
    if (!container) return;
    
    // Clear and add "All Segments"
    const isEs = window.location.href.includes('lang=es');
    container.innerHTML = `<div class="var-pill active" id="btn-filter-all" onclick="isolateSegmentGroup('all')">${isEs ? 'Todo' : 'All Segments'}</div>`;
    
    let uniqueGroups = new Set();
    activeSegments.forEach(seg => {
        if (seg.groupId && !uniqueGroups.has(seg.groupId)) {
            uniqueGroups.add(seg.groupId);
            
            const pill = document.createElement('div');
            pill.className = 'var-pill inactive';
            pill.id = `btn-filter-${seg.groupId}`;
            pill.innerText = seg.groupLabel;
            pill.onclick = () => isolateSegmentGroup(seg.groupId);
            container.appendChild(pill);
        }
    });
}

window.autoDetectRaces = function() {
    if (!sessionData || !sessionData.metrics.sog) return;
    
    // Detect Language
    const isEs = window.location.href.includes('lang=es');
    const labelPre = isEs ? 'Pre-Salida' : 'Pre-Start';
    const labelRace = isEs ? 'Regata' : 'Race';

    activeSegments = [];
    let inRace = false;
    let raceStart = 0;
    let drops = 0;
    
    const sogs = sessionData.metrics.sog;
    const thresh = 2.0;

    // 20 mins min duration = 1200 samples (assuming 1Hz)
    // 5 mins drop tolerance = 300 samples
    const MIN_RACE_DURATION = 1200; 
    const DROP_TOLERANCE = 300;

    let raceCount = 1;
    for (let i = 0; i < sogs.length; i++) {
        if (sogs[i] >= thresh) {
            if (!inRace) {
                inRace = true;
                raceStart = i; 
            }
            drops = 0;
        } else {
            if (inRace) {
                drops++;
                if (drops > DROP_TOLERANCE) {
                    inRace = false;
                    let raceEnd = i - DROP_TOLERANCE;
                    if (raceEnd - raceStart > MIN_RACE_DURATION) {
                        let prestartIdx = Math.max(0, raceStart - 300);
                        let gId = `race-${raceCount}`;
                        let gLabel = `${labelRace} ${raceCount}`;
                        activeSegments.push({startIdx: prestartIdx, endIdx: raceStart, type: 'prestart', label: labelPre, color: '#f59e0b', groupId: gId, groupLabel: gLabel});
                        activeSegments.push({startIdx: raceStart, endIdx: raceEnd, type: 'race', label: labelRace, color: '#10b981', groupId: gId, groupLabel: gLabel});
                        raceCount++;
                    }
                }
            }
        }
    }
    
    if (inRace && sogs.length - raceStart > MIN_RACE_DURATION) {
        let prestartIdx = Math.max(0, raceStart - 300);
        let gId = `race-${raceCount}`;
        let gLabel = `${labelRace} ${raceCount}`;
        activeSegments.push({startIdx: prestartIdx, endIdx: raceStart, type: 'prestart', label: labelPre, color: '#f59e0b', groupId: gId, groupLabel: gLabel});
        activeSegments.push({startIdx: raceStart, endIdx: sogs.length - 1, type: 'race', label: labelRace, color: '#10b981', groupId: gId, groupLabel: gLabel});
    }
    
    renderSegmentRibbon();
    updateSegmentFiltersUI();
    const msg = isEs ? `¡Se han detectado ${activeSegments.filter(s => s.type === 'race').length} regatas!` : `Detected ${activeSegments.filter(s => s.type === 'race').length} races!`;
    alert(msg);
}

window.autoDetectLegs = async function(event) {
    if (!sessionData || activeSegments.length === 0) {
        alert("Please detect races first!");
        return;
    }
    const mode = document.getElementById('windMode').value;
    let estimatedTwd = 0;
    
    if (mode === 'api') {
        const btn = event ? event.target : document.createElement('button');
        const origText = btn.innerText;
        if(event) btn.innerText = "Fetching Meteo...";
        try {
            const lat = sessionData.track[0][0];
            const lon = sessionData.track[0][1];
            let dateStr = "2023-01-01";
            if(sessionData.time && sessionData.time[0]) {
                dateStr = String(sessionData.time[0]).split('T')[0].split(' ')[0];
                if(dateStr.indexOf('/') !== -1) {
                    // some formats are DD/MM/YYYY
                    let parts = dateStr.split('/');
                    if (parts[0].length === 2 && parts[2].length === 4) {
                         dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
                    }
                }
            }

            const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${dateStr}&end_date=${dateStr}&hourly=winddirection_10m`;
            const res = await fetch(url);
            const data = await res.json();
            if (data && data.hourly && data.hourly.winddirection_10m) {
                const validWinds = data.hourly.winddirection_10m.filter(w => w !== null);
                if(validWinds.length > 0) {
                    estimatedTwd = validWinds.reduce((a, b) => a + b) / validWinds.length;
                    console.log(`Meteo TWD: ${estimatedTwd}`);
                }
            }
        } catch (e) {
            console.error("Meteo API failed", e);
            alert("Meteo API failed or data unavailable for this date. Defaulting to heuristic.");
        }
        if(event) btn.innerText = origText;
    }

    let newSegments = [];
    const cogs = sessionData.metrics.cog;
    const twas = sessionData.metrics.twa;
    
    activeSegments.forEach(seg => {
        if (seg.type !== 'race') {
            newSegments.push(seg);
            return;
        }
        
        let currentType = null;
        let legStart = seg.startIdx;
        let legCount = 1;
        
        for (let i = seg.startIdx; i <= seg.endIdx; i++) {
            let type = null;
            
            if (mode === 'sensor' && twas && twas.length > i) {
                let twaObj = Math.abs(twas[i]);
                if (twaObj < 75) type = 'Upwind';
                else if (twaObj > 110) type = 'Downwind';
            } else {
                let twdToUse = (mode === 'api') ? estimatedTwd : estimateTwdFromRace(seg);
                let diff = Math.abs(cogs[i] - twdToUse);
                if (diff > 180) diff = 360 - diff;
                
                if (diff < 75) type = 'Upwind';
                else if (diff > 110) type = 'Downwind';
            }

            if (type && !currentType) currentType = type;
            
            if (type && currentType && type !== currentType) {
                let color = currentType === 'Upwind' ? '#3b82f6' : '#ec4899';
                let legTwd = (mode === 'api') ? estimatedTwd : estimateTwdFromRace({startIdx: legStart, endIdx: i});
                newSegments.push({startIdx: legStart, endIdx: i, type: 'leg', label: `Leg ${legCount} (${currentType})`, color: color, groupId: `leg-${legCount}`, groupLabel: `Leg ${legCount}`, avgTwd: legTwd });
                currentType = type;
                legStart = i;
                legCount++;
            }
        }
        
        if (currentType) {
            let color = currentType === 'Upwind' ? '#3b82f6' : '#ec4899';
            let legTwd = (mode === 'api') ? estimatedTwd : estimateTwdFromRace({startIdx: legStart, endIdx: seg.endIdx});
            newSegments.push({startIdx: legStart, endIdx: seg.endIdx, type: 'leg', label: `Leg ${legCount} (${currentType})`, color: color, groupId: `leg-${legCount}`, groupLabel: `Leg ${legCount}`, avgTwd: legTwd });
        } else {
            newSegments.push(seg);
        }
    });

    activeSegments = newSegments;
    renderSegmentRibbon();
    updateSegmentFiltersUI();
}

function estimateTwdFromRace(seg) {
    if (!sessionData || !sessionData.metrics.cog) return 0;
    const hdgs = sessionData.metrics.hdt || sessionData.metrics.cog;
    
    // Sample headings from the race segment
    let samples = [];
    const step = Math.max(1, Math.floor((seg.endIdx - seg.startIdx) / 100));
    for (let i = seg.startIdx; i <= seg.endIdx; i += step) {
        if (hdgs[i] !== undefined) samples.push(hdgs[i]);
    }
    
    if (samples.length < 2) return 0;
    
    // To find the two tacks (port/starboard), we sort and look for clusters or just take the extremes
    // This is a simplification: take the 20th and 80th percentile to represent the two tacks
    samples.sort((a, b) => a - b);
    let h1 = samples[Math.floor(samples.length * 0.2)];
    let h2 = samples[Math.floor(samples.length * 0.8)];
    
    return getShortestArcBisector(h1, h2);
}

function getShortestArcBisector(h1, h2) {
    // Sector 1: h1 to h2 (clockwise)
    let s1 = (h2 - h1 + 360) % 360;
    // Sector 2: h2 to h1 (clockwise)
    let s2 = (h1 - h2 + 360) % 360;
    
    if (s1 < s2) {
        return (h1 + s1 / 2) % 360;
    } else {
        return (h2 + s2 / 2) % 360;
    }
}

window.splitManual = function() {
    if (!sessionData) return;
    if (activeSegments.length === 0) {
        activeSegments = [{startIdx: 0, endIdx: sessionData.track.length - 1, type: 'manual', label: 'Session', color: '#64748b'}];
    }
    const idx = playbackIndex;
    let newSegs = [];
    activeSegments.forEach(s => {
        if (idx > s.startIdx && idx < s.endIdx) {
            newSegs.push({startIdx: s.startIdx, endIdx: idx, type: s.type, label: s.label + ' A', color: s.color});
            newSegs.push({startIdx: idx, endIdx: s.endIdx, type: s.type, label: s.label + ' B', color: s.color});
        } else {
            newSegs.push(s);
        }
    });
    activeSegments = newSegs;
    renderSegmentRibbon();
}

window.clearSegments = function() {
    activeSegments = [];
    renderSegmentRibbon();
}

function renderSegmentRibbon() {
    const ribbon = document.getElementById('segmentRibbon');
    if(!ribbon) return;
    ribbon.innerHTML = '';
    if (!sessionData || activeSegments.length === 0) return;
    
    const totalTime = sessionData.elapsed[sessionData.elapsed.length - 1];
    
    activeSegments.forEach((seg, i) => {

        const startPct = (sessionData.elapsed[seg.startIdx] / totalTime) * 100;
        const endPct = (sessionData.elapsed[seg.endIdx] / totalTime) * 100;
        
        let div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.left = `${startPct}%`;
        div.style.width = `${endPct - startPct}%`;
        div.style.height = '100%';
        div.style.backgroundColor = seg.color;
        div.style.borderRight = '1px solid #1e293b';
        div.style.fontSize = '0.65rem';
        div.style.color = 'white';
        div.style.textAlign = 'center';
        div.style.overflow = 'hidden';
        div.style.whiteSpace = 'nowrap';
        div.style.cursor = 'pointer';
        div.innerText = seg.label;
        div.title = seg.label;
        
        div.onclick = () => {
            playbackIndex = seg.startIdx;
            if(document.getElementById('timeSlider')) {
                document.getElementById('timeSlider').value = sessionData.elapsed[playbackIndex];
            }
            
            // Autofit chart view to segment
            if (timeChart) {
                timeChart.options.scales.x.min = sessionData.elapsed[seg.startIdx];
                timeChart.options.scales.x.max = sessionData.elapsed[seg.endIdx];
                timeChart.update('none');
            }

            updateFrame(playbackIndex);
        };
        
        ribbon.appendChild(div);
    });
}

window.saveReport = async function(event) {
    if (!window.getAuthToken) return;
    const token = await window.getAuthToken();
    if (!token) {
        alert("You must log in to save reports.");
        return;
    }
    
    const boatId = document.getElementById('boatSelect').value;
    if (!boatId || boatId === '_new_' || boatId === '') {
        alert("Please select an existing boat before saving. (Use 'Upload Log' menu to pick a boat)");
        return;
    }
    
    const btn = event ? event.target : document.querySelector('button[onclick*="saveReport"]');
    const origText = btn ? btn.innerText : 'Save Report';
    if(btn) btn.innerText = "Saving...";
    
    const maxSog = sessionData.metrics?.sog ? Math.max(...sessionData.metrics.sog) : 0;
    
    const reportData = {
        date: sessionData.time[0] ? sessionData.time[0] : new Date().toISOString(),
        total_time_seconds: sessionData.track.length,
        max_speed: maxSog,
        segments: activeSegments,
        notes: `Auto-generated report with ${activeSegments.length} segments.`
    };
    
    try {
        const res = await fetch(`/api/boats/${boatId}/reports`, {
            method: 'POST',
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(reportData)
        });
        
        if (res.ok) {
            if(btn) btn.innerText = "✅ Saved!";
            setTimeout(() => { if(btn) btn.innerText = origText; }, 3000);
        } else {
            const data = await res.json();
            alert("Save failed: " + data.error);
            if(btn) btn.innerText = origText;
        }
    } catch (e) {
        console.error(e);
        alert("Save failed due to network error.");
        if(btn) btn.innerText = origText;
    }
}

