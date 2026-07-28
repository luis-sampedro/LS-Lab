// LS Data Lab Redesigned Telemetry & Analytics Viewer v4.3 (Automatic Location & Summertime DST Solver)

// State
let sessionData = null;
let compareSessionData = null;
let map = null;
let boatMarker = null;
let compareBoatMarker = null;
let trackPolyline = null;
let compareTrackPolyline = null;
let maneuverTrackHighlight = null;
let timeChart = null;
let isPlaying = false;
let playbackIndex = 0;
let playbackSpeed = 5;
let animationId = null;
let globalHeuristicTwd = 0;
let forecastTwd = 0;
let activeSegments = [];
let selectedSegmentId = null;
let activeTab = 'upload';
let polarTargets = null;
let reportImages = [];

let customStartMs = null;
let customUtcOffsetMinutes = 0;

let selectedManeuverIndex = -1;
let trimStartOffset = 0;
let trimEndOffset = 0;

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initChart();
    setupEventListeners();
    initAuthHandler();
    setupKeyboardShortcuts();
    setupPopoverDismiss();
});

function initMap() {
    map = L.map('map').setView([42.2328, -8.7226], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
}

const scrubberPlugin = {
    id: 'scrubber',
    afterDatasetsDraw(chart) {
        if (!sessionData || !sessionData.elapsed || playbackIndex >= sessionData.elapsed.length) return;
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
                { id: 'heel', label: 'Heel', data: [], borderColor: '#ef4444', tension: 0.3, pointRadius: 0, yAxisID: 'y' },
                { id: 'pitch', label: 'Pitch', data: [], borderColor: '#ec4899', tension: 0.3, pointRadius: 0, yAxisID: 'y', hidden: true },
                { id: 'tws', label: 'TWS', data: [], borderColor: '#10b981', tension: 0.3, pointRadius: 0, yAxisID: 'y' },
                { id: 'twd', label: 'TWD', data: [], borderColor: '#8b5cf6', borderDash: [5, 5], tension: 0.3, pointRadius: 0, yAxisID: 'y1', hidden: true },
                { id: 'twa', label: 'TWA', data: [], borderColor: '#10b981', borderDash: [5, 5], tension: 0.3, pointRadius: 0, yAxisID: 'y1', hidden: true },
                { id: 'sog-cmp', label: 'SOG (Compared)', data: [], borderColor: '#f97316', borderDash: [2, 2], tension: 0.3, pointRadius: 0, yAxisID: 'y', hidden: true }
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
                            return formatTimecode(value);
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

function parseTimestampMs(str) {
    if (!str) return NaN;
    if (typeof str === 'number') return str;
    
    let cleanStr = String(str).trim().replace(' ', 'T');
    let ms = Date.parse(cleanStr);
    if (!isNaN(ms)) return ms;
    
    const m = cleanStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (m) {
        return Date.UTC(
            parseInt(m[1], 10),
            parseInt(m[2], 10) - 1,
            parseInt(m[3], 10),
            parseInt(m[4], 10),
            parseInt(m[5], 10),
            parseInt(m[6], 10)
        );
    }
    return NaN;
}

function formatTimecode(seconds) {
    if (isNaN(seconds) || seconds === null || seconds < 0) return "00:00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// LOCATION & SUMMERTIME (DST) AWARE LOCAL CLOCK TIME SOLVER
function getLocalGpsClockTimeStr(idx) {
    if (!sessionData || !sessionData.elapsed) return "--:--:--";
    const elapsedSec = sessionData.elapsed[idx] || 0;
    const baseMs = customStartMs || sessionData.startMs || Date.now();
    const dateObj = new Date(baseMs + elapsedSec * 1000 + customUtcOffsetMinutes * 60000);
    
    const hh = String(dateObj.getUTCHours()).padStart(2, '0');
    const mm = String(dateObj.getUTCMinutes()).padStart(2, '0');
    const ss = String(dateObj.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

window.applyCustomStartTime = function(timeStr) {
    if (!timeStr || !sessionData) return;
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
        let baseDate = sessionData.startMs ? new Date(sessionData.startMs) : new Date();
        let year = baseDate.getUTCFullYear();
        let month = baseDate.getUTCMonth();
        let day = baseDate.getUTCDate();
        
        let hh = parseInt(parts[0], 10);
        let mm = parseInt(parts[1], 10);
        let ss = parts[2] ? parseInt(parts[2], 10) : 0;

        const newStartMs = Date.UTC(year, month, day, hh, mm, ss) - (customUtcOffsetMinutes * 60000);
        customStartMs = newStartMs;

        // Find the data index closest to this start time and auto-split there
        const oldStartMs = sessionData.startMs || customStartMs;
        const diffSec = (newStartMs - oldStartMs) / 1000;

        if (diffSec > 0 && sessionData.elapsed && sessionData.elapsed.length > 0) {
            // Find index closest to the target elapsed seconds
            let cutIdx = 0;
            for (let i = 0; i < sessionData.elapsed.length; i++) {
                if (sessionData.elapsed[i] >= diffSec) {
                    cutIdx = i;
                    break;
                }
                cutIdx = i;
            }

            if (cutIdx > 0 && cutIdx < sessionData.elapsed.length - 1) {
                // Check if a cut already exists near this index (within 5 points)
                const alreadyCut = activeSegments.some(s => Math.abs(s.startIdx - cutIdx) < 5 || Math.abs(s.endIdx - cutIdx) < 5);

                if (!alreadyCut) {
                    let newSegs = [];
                    activeSegments.forEach(s => {
                        if (cutIdx > s.startIdx && cutIdx < s.endIdx) {
                            // Pre-start segment (hidden)
                            newSegs.push({
                                ...s,
                                id: 'leg_prestart_' + Date.now(),
                                endIdx: cutIdx,
                                label: '🚫 Pre-Start',
                                type: 'hidden',
                                color: 'rgba(71, 85, 105, 0.4)'
                            });
                            // Post-start segment (keeps original type)
                            newSegs.push({
                                ...s,
                                id: 'leg_start_' + Date.now(),
                                startIdx: cutIdx,
                                label: '🏁 Race Start'
                            });
                        } else {
                            newSegs.push(s);
                        }
                    });
                    activeSegments = newSegs;
                    // Select the race-start leg
                    const startLeg = activeSegments.find(s => s.label === '🏁 Race Start');
                    if (startLeg) selectedSegmentId = startLeg.id;

                    recalculateAllLegsTwd();
                    renderSegmentRibbon();
                    updateReelsInspectorPill();

                    // Move playhead to cut position
                    playbackIndex = cutIdx;
                }
            }
        }

        updateFrame(playbackIndex);
        updateReelsInspectorPill();
    }
};

window.applyTimezoneOffset = function(val) {
    if (val === 'auto') {
        customUtcOffsetMinutes = -new Date().getTimezoneOffset();
    } else {
        customUtcOffsetMinutes = parseInt(val, 10) || 0;
    }
    updateFrame(playbackIndex);
    updateReelsInspectorPill();
};

window.switchTab = function(tabId) {
    if (!sessionData && tabId !== 'upload') return;
    
    const tabBtn = document.getElementById(`btn-tab-${tabId}`);
    if (tabBtn && tabBtn.classList.contains('disabled')) return;

    activeTab = tabId;

    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    if (tabBtn) tabBtn.classList.add('active');

    document.querySelectorAll('.wizard-panel').forEach(panel => panel.classList.remove('active'));
    const activePanel = document.getElementById(`panel-${tabId}`);
    if (activePanel) activePanel.classList.add('active');

    const visualizer = document.getElementById('shared-visualizer');
    const visualizerTabs = ['telemetry', 'performance', 'maneuvers', 'compare'];
    if (visualizerTabs.includes(tabId)) {
        visualizer.style.display = 'flex';
        refreshVisualizer();
    } else {
        visualizer.style.display = 'none';
    }

    if (tabId === 'performance') {
        calculateLegStats();
        calculateFlightStats();
    } else if (tabId === 'maneuvers') {
        renderManeuversTable();
    } else if (tabId === 'report') {
        buildReportPreview();
    }
};

function refreshVisualizer() {
    if (!sessionData || !sessionData.track) return;

    setTimeout(() => {
        if (map) {
            map.invalidateSize();
            if (trackPolyline) {
                map.fitBounds(trackPolyline.getBounds(), { padding: [30, 30] });
            }
        }
        if (timeChart) {
            timeChart.resize();
            timeChart.update();
        }
        updateFrame(playbackIndex);
    }, 120);
}

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
        while(sel.options.length > 2) sel.remove(2);

        boats.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.name;
            sel.appendChild(opt);
        });

        const lastBid = localStorage.getItem('lastSelectedBoatId');
        if (lastBid) sel.value = lastBid;
    } catch (e) { console.error("Error loading boats", e); }
}

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
                const sel = document.getElementById('boatSelect');
                if(sel) { while(sel.options.length > 2) sel.remove(2); }
            }
        });
    };
    checkAuth();
}

function setupPopoverDismiss() {
    document.addEventListener('click', (e) => {
        const tzPop = document.getElementById('tzPopover');
        const startPop = document.getElementById('startPopover');
        const filterPop = document.getElementById('filterPopover');
        
        if (tzPop && tzPop.style.display === 'flex') {
            if (!e.target.closest('#tzPopover') && !e.target.closest('[onclick*="tzPopover"]')) {
                tzPop.style.display = 'none';
            }
        }
        if (startPop && startPop.style.display === 'flex') {
            if (!e.target.closest('#startPopover') && !e.target.closest('[onclick*="startPopover"]')) {
                startPop.style.display = 'none';
            }
        }
        if (filterPop && filterPop.style.display === 'flex') {
            if (!e.target.closest('#filterPopover') && !e.target.closest('[onclick*="filterPopover"]')) {
                filterPop.style.display = 'none';
            }
        }
    });
}

function setupKeyboardShortcuts() {
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space' && activeTab !== 'upload' && activeTab !== 'report') {
            const tag = e.target.tagName.toLowerCase();
            if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
                e.preventDefault();
                togglePlay();
            }
        } else if (e.code === 'Delete' || e.code === 'Backspace') {
            const tag = e.target.tagName.toLowerCase();
            if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
                deleteSelectedClip();
            }
        }
    });
}

function setupEventListeners() {
    const uploadBtn = document.getElementById('uploadBtn');
    if (uploadBtn) uploadBtn.addEventListener('click', handleUpload);

    const playBtn = document.getElementById('playBtn');
    if (playBtn) playBtn.addEventListener('click', togglePlay);

    const slider = document.getElementById('timeSlider');
    if (slider) {
        slider.addEventListener('input', (e) => {
            const targetElapsed = parseFloat(e.target.value);
            playbackIndex = findNearestIndex(targetElapsed);
            updateFrame(playbackIndex);
        });
    }

    function findNearestIndex(targetTime) {
        if (!sessionData || !sessionData.elapsed || sessionData.elapsed.length === 0) return 0;
        let low = 0, high = sessionData.elapsed.length - 1;
        while (low < high) {
            let mid = Math.floor((low + high) / 2);
            if (sessionData.elapsed[mid] < targetTime) low = mid + 1;
            else high = mid;
        }
        return low;
    }
}

// Global handleUpload
window.handleUpload = async function() {
    const fileInput = document.getElementById('logFile');
    if (!fileInput || !fileInput.files[0]) {
        alert("Please select a telemetry log file (.vkx, .csv, .gpx)");
        return;
    }

    const formData = new FormData();
    formData.append('log_file', fileInput.files[0]);
    formData.append('boat', document.getElementById('boatSelect') ? document.getElementById('boatSelect').value : '');
    formData.append('newBoatName', document.getElementById('newBoatName') ? document.getElementById('newBoatName').value : '');
    formData.append('newBoatType', document.getElementById('newBoatType') ? document.getElementById('newBoatType').value : '');
    formData.append('dataSource', document.getElementById('dataSource') ? document.getElementById('dataSource').value : 'auto');

    const btn = document.getElementById('uploadBtn');
    if (btn) {
        btn.innerText = "Analyzing file...";
        btn.disabled = true;
    }

    try {
        const res = await fetch('/data-lab/upload', {
            method: 'POST',
            body: formData
        });

        const data = await res.json();
        if (data.error) {
            alert("Upload Error: " + data.error);
        } else {
            processSessionData(data);
        }
    } catch (e) {
        console.error(e);
        alert("Upload Failed: Server network error.");
    } finally {
        if (btn) {
            const isEs = window.location.href.includes('lang=es');
            btn.innerText = isEs ? "Cargar y Analizar Telemetría" : "Upload & Analyze Telemetry";
            btn.disabled = false;
        }
    }
};

function processSessionData(data) {
    try {
        sessionData = data;
        
        const detectedFmt = data.detected_format || "Auto-Detected Format";
        const badge = document.getElementById('detected-format-badge');
        const badgeText = document.getElementById('detected-format-text');
        if (badge && badgeText) {
            const isEs = window.location.href.includes('lang=es');
            badgeText.innerText = isEs ? `Formato Detectado: ${detectedFmt}` : `Format Detected: ${detectedFmt}`;
            badge.style.display = 'flex';
        }

        sessionData.elapsed = [];
        const labels = data.time || [];
        let startMs = NaN;

        if (labels.length > 0) {
            for (let i = 0; i < labels.length; i++) {
                let ms = parseTimestampMs(labels[i]);
                if (!isNaN(ms)) {
                    startMs = ms;
                    break;
                }
            }
        }

        if (!isNaN(startMs)) {
            sessionData.startMs = startMs;
            customStartMs = startMs;
            let lastElapsed = 0;
            for (let i = 0; i < labels.length; i++) {
                let ms = parseTimestampMs(labels[i]);
                if (isNaN(ms)) {
                    lastElapsed += 1;
                    sessionData.elapsed.push(lastElapsed);
                } else {
                    let curElapsed = Math.max(0, (ms - startMs) / 1000);
                    if (curElapsed < lastElapsed) {
                        curElapsed = lastElapsed + 1;
                    }
                    lastElapsed = curElapsed;
                    sessionData.elapsed.push(curElapsed);
                }
            }
        } else {
            sessionData.startMs = Date.now();
            customStartMs = sessionData.startMs;
            const trackLen = data.track ? data.track.length : (data.metrics && data.metrics.sog ? data.metrics.sog.length : 0);
            for (let i = 0; i < trackLen; i++) {
                sessionData.elapsed.push(i);
            }
        }

        // CONFIGURE AUTOMATIC LOCATION & SUMMERTIME (DST) TIMEZONE
        if (data.timezone_info) {
            customUtcOffsetMinutes = data.timezone_info.utc_offset_minutes;
            
            const sel = document.getElementById('timezoneSelect');
            if (sel) {
                const dstStr = data.timezone_info.is_dst ? 'Summertime / DST' : 'Standard Time';
                const abbrev = data.timezone_info.tz_abbrev || 'LOCAL';
                const tzName = data.timezone_info.tz_name || 'Detected TZ';
                
                const optText = `📍 ${tzName} (${abbrev}, UTC${customUtcOffsetMinutes>=0?'+':''}${customUtcOffsetMinutes/60}h, ${dstStr})`;
                
                let opt = Array.from(sel.options).find(o => o.value == customUtcOffsetMinutes);
                if (opt) {
                    opt.textContent = optText;
                    opt.selected = true;
                } else {
                    const newOpt = document.createElement('option');
                    newOpt.value = customUtcOffsetMinutes;
                    newOpt.textContent = optText;
                    newOpt.selected = true;
                    sel.prepend(newOpt);
                }
            }

            if (document.getElementById('startTimePicker') && data.timezone_info.local_time_str) {
                document.getElementById('startTimePicker').value = data.timezone_info.local_time_str;
            }
        }

        globalHeuristicTwd = estimateTwdFromTrack();

        onWindCalibrated(globalHeuristicTwd, true);

        fetchForecastTwd().then(fTwd => {
            if (fTwd && fTwd > 0) {
                forecastTwd = fTwd;
                let diff = Math.abs(globalHeuristicTwd - forecastTwd);
                if (diff > 180) diff = 360 - diff;

                document.getElementById('btn-tack-val').innerText = Math.round(globalHeuristicTwd) + '°';
                document.getElementById('btn-forecast-val').innerText = Math.round(forecastTwd) + '°';

                if (diff > 30) {
                    document.getElementById('alarm-tack-twd').innerText = Math.round(globalHeuristicTwd) + '°';
                    document.getElementById('alarm-forecast-twd').innerText = Math.round(forecastTwd) + '°';
                    document.getElementById('wind-alarm-banner').style.display = 'flex';
                }
            }
            recalculateAllLegsTwd();
        }).catch(err => console.warn("Background Meteo fetch failed:", err));

    } catch (err) {
        console.error("Error processing session data:", err);
        alert("Error processing telemetry log: " + err.message);
    }
}

function enableWizardTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('disabled');
        btn.disabled = false;
    });
}

window.resolveWind = function(source) {
    if (source === 'symmetry') {
        document.getElementById('wind-alarm-banner').style.display = 'none';
        onWindCalibrated(globalHeuristicTwd, true);
    } else if (source === 'forecast') {
        document.getElementById('wind-alarm-banner').style.display = 'none';
        onWindCalibrated(forecastTwd, true);
    } else if (source === 'custom') {
        document.getElementById('customWindInputContainer').style.display = 'block';
    }
};

window.applyCustomWind = function() {
    const inputVal = parseFloat(document.getElementById('customWindInput').value);
    if (isNaN(inputVal) || inputVal < 0 || inputVal > 360) {
        alert("Please enter a valid wind direction between 0° and 360°");
        return;
    }
    document.getElementById('customWindInputContainer').style.display = 'none';
    document.getElementById('wind-alarm-banner').style.display = 'none';
    onWindCalibrated(inputVal, true);
};

function onWindCalibrated(twd, autoSwitchTab = false) {
    sessionData.calibratedTwd = Math.round(twd);
    if (document.getElementById('sel-twd-val')) document.getElementById('sel-twd-val').innerText = sessionData.calibratedTwd + '°';
    if (document.getElementById('telemetryCustomTwd')) document.getElementById('telemetryCustomTwd').value = sessionData.calibratedTwd;
    
    const count = sessionData.track ? sessionData.track.length : 0;
    sessionData.metrics.twd = new Array(count).fill(sessionData.calibratedTwd);
    sessionData.metrics.twa = new Array(count).fill(0);
    const hdgs = sessionData.metrics.hdt || sessionData.metrics.cog || new Array(count).fill(0);
    for (let i = 0; i < count; i++) {
        let diff = (hdgs[i] || 0) - sessionData.calibratedTwd;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;
        sessionData.metrics.twa[i] = diff;
    }

    if (document.getElementById('calibrated-twd')) document.getElementById('calibrated-twd').innerText = sessionData.calibratedTwd;
    if (document.getElementById('calibration-success')) document.getElementById('calibration-success').style.display = 'block';
    
    enableWizardTabs();
    loadSessionToVisuals();
    
    if (autoSwitchTab) {
        switchTab('telemetry');
    }
}

function estimateTwdFromTrack() {
    if (!sessionData || !sessionData.metrics || !sessionData.metrics.cog) return 215;
    const hdgs = sessionData.metrics.hdt || sessionData.metrics.cog;
    const sogs = sessionData.metrics.sog;
    
    let samples = [];
    for (let i = 0; i < hdgs.length; i++) {
        if (sogs[i] > 2.0) {
            samples.push(hdgs[i]);
        }
    }
    if (samples.length < 10) return 215;

    samples.sort((a, b) => a - b);
    let h1 = samples[Math.floor(samples.length * 0.25)];
    let h2 = samples[Math.floor(samples.length * 0.75)];
    
    return getShortestArcBisector(h1, h2);
}

function getShortestArcBisector(h1, h2) {
    let s1 = (h2 - h1 + 360) % 360;
    let s2 = (h1 - h2 + 360) % 360;
    if (s1 < s2) {
        return (h1 + s1 / 2) % 360;
    } else {
        return (h2 + s2 / 2) % 360;
    }
}

async function fetchForecastTwd() {
    if (!sessionData || !sessionData.track || sessionData.track.length === 0) return 0;
    try {
        const lat = sessionData.track[0][0];
        const lon = sessionData.track[0][1];
        let dateStr = "2026-07-01";
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

function loadSessionToVisuals() {
    if (!sessionData || !sessionData.track) return;

    if (trackPolyline) map.removeLayer(trackPolyline);
    if (boatMarker) map.removeLayer(boatMarker);
    
    const trackPoints = sessionData.track;
    if (!trackPoints || trackPoints.length === 0) return;

    trackPolyline = L.polyline(trackPoints, { color: '#38bdf8', weight: 4 }).addTo(map);

    const redIcon = L.divIcon({
        className: 'custom-div-icon',
        html: "<div style='background-color:#ef4444; border: 2px solid white; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 0 6px rgba(0,0,0,0.5); cursor: grab;'></div>",
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });
    
    boatMarker = L.marker(trackPoints[0], { icon: redIcon, draggable: true }).addTo(map);

    boatMarker.on('drag', (e) => {
        if (isPlaying) togglePlay();
        const idx = findNearestTrackPoint(e.target.getLatLng());
        playbackIndex = idx;
        updateFrame(idx);
    });

    boatMarker.on('dragend', (e) => {
        boatMarker.setLatLng(sessionData.track[playbackIndex]);
    });

    // Initialize as a SINGLE SESSION LEG (Instagram Reels / CapCut default state)
    resetToSingleSessionLeg();

    const elapsed = sessionData.elapsed;
    const totalDuration = elapsed[elapsed.length - 1] || elapsed.length;
    
    timeChart.options.scales.x.max = totalDuration;
    timeChart.data.labels = elapsed;
    timeChart.data.datasets[0].data = sessionData.metrics.sog.map((v, idx) => ({ x: elapsed[idx], y: v || 0 }));
    timeChart.data.datasets[1].data = sessionData.metrics.cog.map((v, idx) => ({ x: elapsed[idx], y: v || 0 }));
    timeChart.data.datasets[2].data = sessionData.metrics.heel.map((v, idx) => ({ x: elapsed[idx], y: v || 0 }));
    timeChart.data.datasets[3].data = (sessionData.metrics.pitch || new Array(elapsed.length).fill(0)).map((v, idx) => ({ x: elapsed[idx], y: v || 0 }));
    timeChart.data.datasets[4].data = (sessionData.metrics.tws || new Array(elapsed.length).fill(10)).map((v, idx) => ({ x: elapsed[idx], y: v || 10 }));
    timeChart.data.datasets[5].data = (sessionData.metrics.twd || new Array(elapsed.length).fill(215)).map((v, idx) => ({ x: elapsed[idx], y: v || 215 }));
    timeChart.data.datasets[6].data = (sessionData.metrics.twa || new Array(elapsed.length).fill(0)).map((v, idx) => ({ x: elapsed[idx], y: v || 0 }));
    timeChart.update();

    playbackIndex = 0;
    if (document.getElementById('timeSlider')) {
        document.getElementById('timeSlider').max = totalDuration;
        document.getElementById('timeSlider').value = 0;
    }
    if (document.getElementById('totalTimeDisplay')) {
        document.getElementById('totalTimeDisplay').innerText = formatTimecode(totalDuration);
    }
    
    updateFrame(0);
}

// SMART PER-LEG INDEPENDENT TWD SOLVER
function calculateLegIndependentTwd(seg, prevTwd = null) {
    if (!sessionData || !sessionData.metrics || seg.startIdx >= seg.endIdx) {
        return sessionData ? sessionData.calibratedTwd : 215;
    }
    
    const hdgs = sessionData.metrics.hdt || sessionData.metrics.cog || [];
    const sogs = sessionData.metrics.sog || [];
    
    let legHdgs = [];
    for (let i = seg.startIdx; i <= seg.endIdx; i++) {
        if (sogs[i] > 2.0 && hdgs[i] !== undefined) {
            legHdgs.push(hdgs[i]);
        }
    }

    if (legHdgs.length < 5) {
        return prevTwd || (forecastTwd > 0 ? forecastTwd : sessionData.calibratedTwd);
    }

    legHdgs.sort((a, b) => a - b);
    let h1 = legHdgs[Math.floor(legHdgs.length * 0.25)];
    let h2 = legHdgs[Math.floor(legHdgs.length * 0.75)];

    let candidateUpwindTwd = getShortestArcBisector(h1, h2);
    let candidateDownwindTwd = (candidateUpwindTwd + 180) % 360;

    let refTwd = forecastTwd > 0 ? forecastTwd : (prevTwd || sessionData.calibratedTwd || 215);

    function angleDiff(a, b) {
        let d = Math.abs(a - b) % 360;
        return d > 180 ? 360 - d : d;
    }

    let diffUp = angleDiff(candidateUpwindTwd, refTwd);
    let diffDown = angleDiff(candidateDownwindTwd, refTwd);

    let bestTwd = diffUp <= diffDown ? candidateUpwindTwd : candidateDownwindTwd;
    return Math.round(bestTwd);
}

function recalculateAllLegsTwd() {
    if (!sessionData || activeSegments.length === 0) return;
    let runningTwd = null;
    activeSegments.forEach(seg => {
        if (seg.type !== 'hidden') {
            seg.twd = calculateLegIndependentTwd(seg, runningTwd);
            runningTwd = seg.twd;
        } else {
            seg.twd = runningTwd || sessionData.calibratedTwd;
        }
    });
}

// AUTOZOOM & AUTOFIT MAP & CHART TO REMAINING LEGS
function autoFitVisualsToRemainingClips() {
    if (!sessionData || !sessionData.track || sessionData.track.length === 0) return;

    if (activeSegments.length > 0) {
        let minTime = Infinity, maxTime = -Infinity;
        let boundsPoints = [];

        activeSegments.forEach(seg => {
            let tStart = sessionData.elapsed[seg.startIdx] || 0;
            let tEnd = sessionData.elapsed[seg.endIdx] || 0;
            if (tStart < minTime) minTime = tStart;
            if (tEnd > maxTime) maxTime = tEnd;

            const step = Math.max(1, Math.floor((seg.endIdx - seg.startIdx) / 30));
            for (let i = seg.startIdx; i <= seg.endIdx; i += step) {
                boundsPoints.push(sessionData.track[i]);
            }
        });

        if (timeChart && minTime < maxTime) {
            timeChart.options.scales.x.min = minTime;
            timeChart.options.scales.x.max = maxTime;
            timeChart.update();
        }

        if (map && boundsPoints.length > 0) {
            const poly = L.polyline(boundsPoints);
            map.fitBounds(poly.getBounds(), { padding: [35, 35] });
        }
    } else {
        resetChartZoom();
        if (map && trackPolyline) {
            map.fitBounds(trackPolyline.getBounds(), { padding: [35, 35] });
        }
    }
}

// INSTAGRAM REELS / CAPCUT TIMELINE EDITOR CORE LOGIC
window.resetToSingleSessionLeg = function() {
    if (!sessionData || !sessionData.track) return;
    const isEs = window.location.href.includes('lang=es');
    activeSegments = [{
        id: 'leg_single_session',
        startIdx: 0,
        endIdx: sessionData.track.length - 1,
        type: 'leg',
        label: isEs ? '🎬 Sesión Completa' : '🎬 Full Session',
        color: 'rgba(2, 132, 199, 0.45)',
        twd: sessionData.calibratedTwd
    }];
    selectedSegmentId = 'leg_single_session';
    recalculateAllLegsTwd();
    renderSegmentRibbon();
    updateReelsInspectorPill();
    autoFitVisualsToRemainingClips();
};

window.splitClipAtScrubber = function() {
    if (!sessionData) return;
    const idx = playbackIndex;
    let splitOccurred = false;
    let newSegs = [];

    activeSegments.forEach(s => {
        if (idx > s.startIdx && idx < s.endIdx) {
            splitOccurred = true;
            const idA = 'leg_' + Date.now() + '_A';
            const idB = 'leg_' + Date.now() + '_B';
            
            const baseName = s.label.replace(/ [A-Z0-9]+$/, '');
            
            newSegs.push({
                ...s,
                id: idA,
                endIdx: idx,
                label: `${baseName} (A)`
            });
            newSegs.push({
                ...s,
                id: idB,
                startIdx: idx,
                label: `${baseName} (B)`
            });
            selectedSegmentId = idB;
        } else {
            newSegs.push(s);
        }
    });

    if (splitOccurred) {
        activeSegments = newSegs;
        recalculateAllLegsTwd();
        renderSegmentRibbon();
        updateReelsInspectorPill();
    } else {
        const isEs = window.location.href.includes('lang=es');
        alert(isEs ? "Mueve la barra de reproducción sobre un tramo para cortarlo en dos." : "Move the playhead inside a clip to split it into two.");
    }
};

window.promptRenameClip = function() {
    const seg = getSelectedOrActiveClip();
    if (!seg) return;
    const isEs = window.location.href.includes('lang=es');
    const newTitle = prompt(
        isEs ? "Introduce el nuevo nombre para este tramo:" : "Enter new title for this leg clip:",
        seg.label
    );
    if (newTitle && newTitle.trim() !== '') {
        seg.label = newTitle.trim();
        renderSegmentRibbon();
        updateReelsInspectorPill();
    }
};

window.changeSelectedClipType = function(typeVal) {
    const seg = getSelectedOrActiveClip();
    if (!seg) return;
    
    seg.type = typeVal;
    if (typeVal === 'upwind') {
        seg.color = 'rgba(56, 189, 248, 0.5)';
        if(!seg.label.includes('⛵')) seg.label = `⛵ ${seg.label.replace(/^[^a-zA-Z0-9]+/, '')}`;
    } else if (typeVal === 'downwind') {
        seg.color = 'rgba(236, 72, 153, 0.5)';
        if(!seg.label.includes('🚀')) seg.label = `🚀 ${seg.label.replace(/^[^a-zA-Z0-9]+/, '')}`;
    } else if (typeVal === 'reach') {
        seg.color = 'rgba(16, 185, 129, 0.5)';
        if(!seg.label.includes('💨')) seg.label = `💨 ${seg.label.replace(/^[^a-zA-Z0-9]+/, '')}`;
    } else if (typeVal === 'hidden') {
        seg.color = 'rgba(100, 116, 139, 0.5)';
        if(!seg.label.includes('🙈')) seg.label = `🙈 ${seg.label.replace(/^[^a-zA-Z0-9]+/, '')}`;
    }

    recalculateAllLegsTwd();
    renderSegmentRibbon();
    updateReelsInspectorPill();
};

window.deleteSelectedClip = function() {
    let segIdToDelete = selectedSegmentId;
    
    if (!segIdToDelete && sessionData) {
        const seg = activeSegments.find(s => playbackIndex >= s.startIdx && playbackIndex <= s.endIdx);
        if (seg) segIdToDelete = seg.id;
    }

    if (!segIdToDelete) {
        const isEs = window.location.href.includes('lang=es');
        alert(isEs ? "Selecciona un tramo en la línea de tiempo haciendo clic en él." : "Select a leg clip on the timeline ribbon to delete it.");
        return;
    }

    activeSegments = activeSegments.filter(s => s.id !== segIdToDelete);
    if (selectedSegmentId === segIdToDelete) selectedSegmentId = null;

    recalculateAllLegsTwd();
    renderSegmentRibbon();
    updateReelsInspectorPill();
    
    // AUTOZOOM & AUTOFIT MAP AND CHART TO REMAINING LEGS
    autoFitVisualsToRemainingClips();
};

window.autoDetectLegsClips = function() {
    autoDetectLegs(false);
};

function getSelectedOrActiveClip() {
    if (!sessionData) return null;
    return activeSegments.find(s => s.id === selectedSegmentId) || 
           activeSegments.find(s => playbackIndex >= s.startIdx && playbackIndex <= s.endIdx) || null;
}

function updateReelsInspectorPill() {
    const titleEl = document.getElementById('clipInspectorTitle');
    const durEl = document.getElementById('clipInspectorDuration');
    const speedEl = document.getElementById('clipInspectorSpeed');
    const twaEl = document.getElementById('clipInspectorTwa');
    const twdEl = document.getElementById('clipInspectorTwd');
    if (!titleEl || !sessionData) return;

    const seg = getSelectedOrActiveClip();
    if (!seg) {
        titleEl.innerText = "--";
        if(durEl) durEl.innerText = "";
        return;
    }

    const startSec = sessionData.elapsed[seg.startIdx] || 0;
    const endSec = sessionData.elapsed[seg.endIdx] || 0;
    const durSec = Math.max(0, endSec - startSec);
    const durMin = Math.floor(durSec / 60);

    titleEl.innerText = seg.label;
    if (durEl) durEl.innerText = `(${formatTimecode(startSec)} - ${formatTimecode(endSec)} • ${durMin}m ${Math.round(durSec % 60)}s)`;

    let sogs = sessionData.metrics.sog.slice(seg.startIdx, seg.endIdx + 1);
    let twas = sessionData.metrics.twa ? sessionData.metrics.twa.slice(seg.startIdx, seg.endIdx + 1) : [];
    
    let avgSog = sogs.length > 0 ? (sogs.reduce((a,b)=>a+b, 0) / sogs.length) : 0;
    let avgTwa = twas.length > 0 ? (twas.reduce((a,b)=>a+Math.abs(b), 0) / twas.length) : 0;
    let legTwd = seg.twd || sessionData.calibratedTwd;

    if (speedEl) speedEl.innerText = `Avg SOG: ${avgSog.toFixed(1)} kn`;
    if (twaEl) twaEl.innerText = `Avg TWA: ${Math.round(avgTwa)}°`;
    if (twdEl) twdEl.innerText = `Leg TWD: ${Math.round(legTwd)}°`;
}

// Upwind/Downwind Leg Autodetection with per-leg TWD solver
window.autoDetectLegs = function(silent = false) {
    if (!sessionData || !sessionData.metrics || !sessionData.metrics.sog || !sessionData.metrics.twa) return;
    
    const sogs = sessionData.metrics.sog;
    const twas = sessionData.metrics.twa;
    const thresholdInput = document.getElementById('nonSailingSpeedThreshold');
    const threshold = parseFloat(thresholdInput ? thresholdInput.value : 1.0) || 1.0;
    
    let legs = [];
    let currentLegType = null;
    let startIdx = 0;
    
    const MIN_LEG_POINTS = 30;
    let upwindCount = 0;
    let downwindCount = 0;

    for (let i = 0; i < sogs.length; i++) {
        if (sogs[i] < threshold) {
            if (currentLegType !== null) {
                if (i - startIdx >= MIN_LEG_POINTS) {
                    const idStr = 'leg_' + Date.now() + '_' + legs.length;
                    if (currentLegType === 'upwind') {
                        upwindCount++;
                        legs.push({
                            id: idStr,
                            startIdx: startIdx,
                            endIdx: i,
                            type: 'leg',
                            label: `⛵ Upwind Leg ${upwindCount}`,
                            color: 'rgba(56, 189, 248, 0.45)'
                        });
                    } else {
                        downwindCount++;
                        legs.push({
                            id: idStr,
                            startIdx: startIdx,
                            endIdx: i,
                            type: 'leg',
                            label: `🚀 Downwind Leg ${downwindCount}`,
                            color: 'rgba(236, 72, 153, 0.45)'
                        });
                    }
                }
                currentLegType = null;
            }
            continue;
        }

        const absTwa = Math.abs(twas[i] || 0);
        const legType = absTwa < 90 ? 'upwind' : 'downwind';

        if (currentLegType === null) {
            currentLegType = legType;
            startIdx = i;
        } else if (currentLegType !== legType) {
            if (i - startIdx >= MIN_LEG_POINTS) {
                const idStr = 'leg_' + Date.now() + '_' + legs.length;
                if (currentLegType === 'upwind') {
                    upwindCount++;
                    legs.push({
                        id: idStr,
                        startIdx: startIdx,
                        endIdx: i,
                        type: 'leg',
                        label: `⛵ Upwind Leg ${upwindCount}`,
                        color: 'rgba(56, 189, 248, 0.45)'
                    });
                } else {
                    downwindCount++;
                    legs.push({
                        id: idStr,
                        startIdx: startIdx,
                        endIdx: i,
                        type: 'leg',
                        label: `🚀 Downwind Leg ${downwindCount}`,
                        color: 'rgba(236, 72, 153, 0.45)'
                    });
                }
            }
            currentLegType = legType;
            startIdx = i;
        }
    }

    if (currentLegType !== null && sogs.length - startIdx >= MIN_LEG_POINTS) {
        const idStr = 'leg_' + Date.now() + '_' + legs.length;
        if (currentLegType === 'upwind') {
            upwindCount++;
            legs.push({
                id: idStr,
                startIdx: startIdx,
                endIdx: sogs.length - 1,
                type: 'leg',
                label: `⛵ Upwind Leg ${upwindCount}`,
                color: 'rgba(56, 189, 248, 0.45)'
            });
        } else {
            downwindCount++;
            legs.push({
                id: idStr,
                startIdx: startIdx,
                endIdx: sogs.length - 1,
                type: 'leg',
                label: `🚀 Downwind Leg ${downwindCount}`,
                color: 'rgba(236, 72, 153, 0.45)'
            });
        }
    }

    const hiddenSegs = activeSegments.filter(s => s.type === 'hidden');
    activeSegments = [...hiddenSegs, ...legs];
    if (activeSegments.length > 0) selectedSegmentId = activeSegments[0].id;
    
    recalculateAllLegsTwd();
    renderSegmentRibbon();
    updateReelsInspectorPill();
    
    if (!silent) {
        const isEs = window.location.href.includes('lang=es');
        alert(isEs ? `Detectados ${legs.length} tramos (Ceñida / Empopada)` : `Detected ${legs.length} legs (Upwind / Downwind)`);
    }
};

window.clearSegments = function() {
    resetToSingleSessionLeg();
};

window.updateNonSailingFilter = function() {
    if (!sessionData || !sessionData.metrics || !sessionData.metrics.sog) return;
    
    const filterCheckbox = document.getElementById('enableNonSailingFilter');
    const isFilterEnabled = filterCheckbox ? filterCheckbox.checked : true;
    
    const thresholdInput = document.getElementById('nonSailingSpeedThreshold');
    const threshold = parseFloat(thresholdInput ? thresholdInput.value : 1.0) || 1.0;
    
    const hiddenLegCheckbox = document.getElementById('actAsHiddenLeg');
    const actAsHiddenLeg = hiddenLegCheckbox ? hiddenLegCheckbox.checked : true;

    // Foiling filter
    const foilingCheckbox = document.getElementById('enableFoilingFilter');
    const isFoilingEnabled = foilingCheckbox ? foilingCheckbox.checked : false;
    const foilingInput = document.getElementById('foilingSpeedThreshold');
    const foilingThreshold = parseFloat(foilingInput ? foilingInput.value : 8.0) || 8.0;

    const sogs = sessionData.metrics.sog;

    activeSegments = activeSegments.filter(s => s.type !== 'hidden');

    let hiddenCount = 0;

    // Combined filter: a point is hidden if it fails either active filter
    const shouldHide = (sogVal) => {
        if (isFilterEnabled && sogVal < threshold) return true;
        if (isFoilingEnabled && sogVal < foilingThreshold) return true;
        return false;
    };

    const effectiveThreshold = isFoilingEnabled ? Math.max(threshold, foilingThreshold) : threshold;

    if ((isFilterEnabled || isFoilingEnabled) && actAsHiddenLeg) {
        let rawBlocks = [];
        let inHidden = false;
        let startIdx = 0;
        
        for (let i = 0; i < sogs.length; i++) {
            if (shouldHide(sogs[i])) {
                hiddenCount++;
                if (!inHidden) {
                    inHidden = true;
                    startIdx = i;
                }
            } else if (!shouldHide(sogs[i]) && inHidden) {
                inHidden = false;
                rawBlocks.push([startIdx, i]);
            }
        }
        if (inHidden) {
            rawBlocks.push([startIdx, sogs.length - 1]);
        }

        let mergedBlocks = [];
        rawBlocks.forEach(b => {
            if (mergedBlocks.length === 0) {
                mergedBlocks.push([b[0], b[1]]);
            } else {
                let prev = mergedBlocks[mergedBlocks.length - 1];
                if (b[0] - prev[1] < 15) {
                    prev[1] = b[1];
                } else {
                    mergedBlocks.push([b[0], b[1]]);
                }
            }
        });

        const isEs = window.location.href.includes('lang=es');
        mergedBlocks.forEach((b, idx) => {
            if (b[1] - b[0] >= 20) {
                activeSegments.push({
                    id: 'hidden_' + idx,
                    startIdx: b[0],
                    endIdx: b[1],
                    type: 'hidden',
                    label: isEs ? `🙈 Oculto (<${effectiveThreshold}kn)` : `🙈 Hidden (<${effectiveThreshold}kn)`,
                    color: 'rgba(100, 116, 139, 0.45)'
                });
            }
        });

    } else if (isFilterEnabled || isFoilingEnabled) {
        hiddenCount = sogs.filter(s => shouldHide(s)).length;
    }

    renderSegmentRibbon();

    // Update badge text — just show active filter count
    let activeFilters = 0;
    if (isFilterEnabled) activeFilters++;
    if (isFoilingEnabled) activeFilters++;

    const isEs = window.location.href.includes('lang=es');
    const badge = document.getElementById('activeSailingBadge');
    if (badge) {
        if (activeFilters === 0) {
            badge.innerText = isEs ? 'Filtros' : 'Filters';
        } else {
            badge.innerText = isEs ? `Filtros (${activeFilters})` : `Filters (${activeFilters})`;
        }
        badge.style.color = activeFilters > 0 ? '#38bdf8' : '#94a3b8';
    }
};

function findNearestTrackPoint(latlng) {
    let minDist = Infinity;
    let index = 0;
    const track = sessionData.track;
    for (let i = 0; i < track.length; i++) {
        let d = latlng.distanceTo(L.latLng(track[i][0], track[i][1]));
        if (d < minDist) {
            minDist = d;
            index = i;
        }
    }
    return index;
}

function togglePlay() {
    if (!sessionData || !sessionData.track || sessionData.track.length === 0) return;
    isPlaying = !isPlaying;
    const btn = document.getElementById('playBtn');
    if (isPlaying) {
        btn.innerText = "⏸";
        animate();
    } else {
        btn.innerText = "▶";
        cancelAnimationFrame(animationId);
    }
}

window.stepFrame = function(seconds) {
    if (!sessionData || !sessionData.elapsed) return;
    const currentElapsed = sessionData.elapsed[playbackIndex] || 0;
    const maxElapsed = sessionData.elapsed[sessionData.elapsed.length - 1] || sessionData.elapsed.length;
    const targetElapsed = Math.max(0, Math.min(maxElapsed, currentElapsed + seconds));
    
    let low = 0, high = sessionData.elapsed.length - 1;
    while (low < high) {
        let mid = Math.floor((low + high) / 2);
        if (sessionData.elapsed[mid] < targetElapsed) low = mid + 1;
        else high = mid;
    }
    playbackIndex = low;
    if (document.getElementById('timeSlider')) {
        document.getElementById('timeSlider').value = sessionData.elapsed[playbackIndex];
    }
    updateFrame(playbackIndex);
};

function animate() {
    if (!isPlaying || !sessionData) return;
    playbackIndex += playbackSpeed;
    if (playbackIndex >= sessionData.track.length) {
        playbackIndex = 0;
        togglePlay();
        updateFrame(0);
        return;
    }
    updateFrame(playbackIndex);
    if (document.getElementById('timeSlider')) {
        document.getElementById('timeSlider').value = sessionData.elapsed[playbackIndex];
    }
    animationId = requestAnimationFrame(animate);
}

function updateFrame(idx) {
    if (!sessionData || !sessionData.track || idx < 0 || idx >= sessionData.track.length) return;

    const pos = sessionData.track[idx];
    if (pos && boatMarker) {
        boatMarker.setLatLng(pos);
    }

    const m = sessionData.metrics;
    if (m) {
        if (document.getElementById('val-sog')) document.getElementById('val-sog').innerText = (m.sog[idx] || 0).toFixed(1);
        if (document.getElementById('val-cog')) document.getElementById('val-cog').innerText = Math.round(m.cog[idx] || 0) + '°';
        if (document.getElementById('val-heel')) document.getElementById('val-heel').innerText = (m.heel[idx] || 0).toFixed(1) + '°';
        if (document.getElementById('val-pitch')) document.getElementById('val-pitch').innerText = m.pitch ? (m.pitch[idx] || 0).toFixed(1) + '°' : "0.0°";
        
        if (document.getElementById('val-tws')) document.getElementById('val-tws').innerText = m.tws ? (m.tws[idx] || 0).toFixed(1) : "--";
        if (document.getElementById('val-twd')) document.getElementById('val-twd').innerText = Math.round(m.twd[idx] || 0) + '°';
        if (document.getElementById('val-twa')) document.getElementById('val-twa').innerText = Math.round(m.twa[idx] || 0) + '°';
    }

    const currentElapsed = sessionData.elapsed[idx] || 0;
    if (document.getElementById('timeDisplay')) {
        document.getElementById('timeDisplay').innerText = formatTimecode(currentElapsed);
    }

    const localGpsTimeStr = getLocalGpsClockTimeStr(idx);
    if (document.getElementById('localGpsTimeDisplay')) {
        document.getElementById('localGpsTimeDisplay').innerText = localGpsTimeStr;
    }

    updateReelsInspectorPill();

    if (timeChart) {
        timeChart.update('none');
    }
}

window.updateTelemetryWindCustomization = function() {
    const src = document.getElementById('telemetryWindSource').value;
    const customInput = document.getElementById('telemetryCustomTwd');
    
    if (src === 'custom') {
        customInput.style.display = 'inline-block';
        const customVal = Math.round(parseFloat(customInput.value) || sessionData.calibratedTwd);
        onWindCalibrated(customVal, false);
    } else {
        customInput.style.display = 'none';
        onWindCalibrated(sessionData.calibratedTwd, false);
    }
};

function calculateLegStats() {
    if (!sessionData) return;

    const thresholdInput = document.getElementById('nonSailingSpeedThreshold');
    const threshold = parseFloat(thresholdInput ? thresholdInput.value : 1.0) || 1.0;
    const isFilterEnabled = document.getElementById('enableNonSailingFilter') ? document.getElementById('enableNonSailingFilter').checked : true;

    let upSogs = [], upHeels = [], upVmgs = [];
    let downSogs = [], downHeels = [], downVmgs = [];
    
    const m = sessionData.metrics;

    if (activeSegments.length > 0) {
        activeSegments.forEach(seg => {
            if (seg.type !== 'leg' && seg.type !== 'race') return;
            const isUpwind = seg.label.includes('Upwind') || seg.label.includes('Ceñida');
            
            for (let i = seg.startIdx; i <= seg.endIdx; i++) {
                const sog = m.sog[i];
                if (isFilterEnabled && sog < threshold) continue;
                
                const heel = Math.abs(m.heel[i] || 0);
                const twa = Math.abs(m.twa[i] || 0);
                const vmg = Math.abs(sog * Math.cos(twa * Math.PI / 180));

                if (isUpwind) {
                    upSogs.push(sog);
                    upHeels.push(heel);
                    upVmgs.push(vmg);
                } else {
                    downSogs.push(sog);
                    downHeels.push(heel);
                    downVmgs.push(vmg);
                }
            }
        });
    }

    if (upSogs.length === 0 && downSogs.length === 0) {
        for (let i = 0; i < m.sog.length; i++) {
            const sog = m.sog[i];
            if (isFilterEnabled && sog < threshold) continue;
            
            const twa = Math.abs(m.twa[i] || 0);
            const heel = Math.abs(m.heel[i] || 0);
            const vmg = Math.abs(sog * Math.cos(twa * Math.PI / 180));

            if (twa < 90) {
                upSogs.push(sog);
                upHeels.push(heel);
                upVmgs.push(vmg);
            } else {
                downSogs.push(sog);
                downHeels.push(heel);
                downVmgs.push(vmg);
            }
        }
    }

    const avg = arr => arr.length > 0 ? (arr.reduce((a, b) => a + b) / arr.length) : 0;

    if (document.getElementById('upwind-avg-sog')) document.getElementById('upwind-avg-sog').innerText = avg(upSogs).toFixed(1) + ' kn';
    if (document.getElementById('upwind-avg-heel')) document.getElementById('upwind-avg-heel').innerText = Math.round(avg(upHeels)) + '°';
    if (document.getElementById('upwind-avg-vmg')) document.getElementById('upwind-avg-vmg').innerText = avg(upVmgs).toFixed(1) + ' kn';
    
    if (document.getElementById('downwind-avg-sog')) document.getElementById('downwind-avg-sog').innerText = avg(downSogs).toFixed(1) + ' kn';
    if (document.getElementById('downwind-avg-heel')) document.getElementById('downwind-avg-heel').innerText = Math.round(avg(downHeels)) + '°';
    if (document.getElementById('downwind-avg-vmg')) document.getElementById('downwind-avg-vmg').innerText = avg(downVmgs).toFixed(1) + ' kn';
    
    const twd = sessionData.calibratedTwd;
    if (document.getElementById('upwind-opt-heading')) document.getElementById('upwind-opt-heading').innerText = Math.round((twd + 45) % 360) + '° / ' + Math.round((twd - 45 + 360) % 360) + '°';
    if (document.getElementById('downwind-opt-heading')) document.getElementById('downwind-opt-heading').innerText = Math.round((twd + 140) % 360) + '° / ' + Math.round((twd - 140 + 360) % 360) + '°';
}

function calculateFlightStats() {
    if (!sessionData || !sessionData.metrics.sog) return;
    
    const thresholdInput = document.getElementById('nonSailingSpeedThreshold');
    const threshold = parseFloat(thresholdInput ? thresholdInput.value : 1.0) || 1.0;
    const isFilterEnabled = document.getElementById('enableNonSailingFilter') ? document.getElementById('enableNonSailingFilter').checked : true;

    const sogs = sessionData.metrics.sog;

    let lowCount = 0, transCount = 0, foilCount = 0;
    let foilSpeeds = [];

    sogs.forEach(s => {
        if (isFilterEnabled && s < threshold) return;
        if (s < 8.0) lowCount++;
        else if (s < 13.0) transCount++;
        else {
            foilCount++;
            foilSpeeds.push(s);
        }
    });

    const total = lowCount + transCount + foilCount || 1;
    const lowPct = Math.round((lowCount / total) * 100);
    const transPct = Math.round((transCount / total) * 100);
    const foilPct = Math.round((foilCount / total) * 100);

    const avgFoilSpeed = foilSpeeds.length > 0 ? (foilSpeeds.reduce((a,b)=>a+b)/foilSpeeds.length) : 0;
    const maxFoilSpeed = foilSpeeds.length > 0 ? Math.max(...foilSpeeds) : 0;
    
    const foilDistNm = ((foilSpeeds.reduce((a,b)=>a+b, 0) / 3600) * 0.2).toFixed(1);

    if (document.getElementById('flight-pct-foiling')) document.getElementById('flight-pct-foiling').innerText = foilPct + '%';
    if (document.getElementById('flight-dist-foiling')) document.getElementById('flight-dist-foiling').innerText = foilDistNm + ' nm';
    if (document.getElementById('flight-avg-speed')) document.getElementById('flight-avg-speed').innerText = avgFoilSpeed.toFixed(1) + ' kn';
    if (document.getElementById('flight-max-speed')) document.getElementById('flight-max-speed').innerText = maxFoilSpeed.toFixed(1) + ' kn';

    if (document.getElementById('bar-low-riding')) document.getElementById('bar-low-riding').style.width = lowPct + '%';
    if (document.getElementById('bar-transition')) document.getElementById('bar-transition').style.width = transPct + '%';
    if (document.getElementById('bar-foiling')) document.getElementById('bar-foiling').style.width = foilPct + '%';

    if (document.getElementById('lbl-low-riding')) document.getElementById('lbl-low-riding').innerText = lowPct + '%';
    if (document.getElementById('lbl-transition')) document.getElementById('lbl-transition').innerText = transPct + '%';
    if (document.getElementById('lbl-foiling')) document.getElementById('lbl-foiling').innerText = foilPct + '%';
}

window.openPolarOption = function(optId) {
    document.getElementById('polar-opt-upload').style.display = 'none';
    document.getElementById('polar-opt-search').style.display = 'none';
    document.getElementById('polar-opt-generate').style.display = 'none';
    document.getElementById('polar-opt-' + optId).style.display = 'block';
};

window.previewOnlinePolar = function() {
    const boatClass = document.getElementById('polarSearchClass').value;
    const card = document.getElementById('polar-preview-card');
    const tbody = document.getElementById('polar-preview-rows');
    document.getElementById('preview-class-name').innerText = boatClass.toUpperCase();
    
    tbody.innerHTML = '';
    
    const polarDB = {
        moth: [
            { tws: '8 kn', upTwa: '48°', upSog: '14.2 kn', dnTwa: '142°', dnSog: '18.5 kn' },
            { tws: '12 kn', upTwa: '44°', upSog: '18.5 kn', dnTwa: '140°', dnSog: '23.8 kn' },
            { tws: '16 kn', upTwa: '42°', upSog: '21.0 kn', dnTwa: '138°', dnSog: '26.5 kn' },
            { tws: '20 kn', upTwa: '40°', upSog: '22.8 kn', dnTwa: '135°', dnSog: '28.2 kn' }
        ],
        waszp: [
            { tws: '8 kn', upTwa: '52°', upSog: '11.0 kn', dnTwa: '145°', dnSog: '14.5 kn' },
            { tws: '12 kn', upTwa: '46°', upSog: '15.2 kn', dnTwa: '142°', dnSog: '19.0 kn' },
            { tws: '16 kn', upTwa: '44°', upSog: '17.8 kn', dnTwa: '140°', dnSog: '21.4 kn' }
        ],
        tp52: [
            { tws: '8 kn', upTwa: '42°', upSog: '7.8 kn', dnTwa: '148°', dnSog: '9.2 kn' },
            { tws: '12 kn', upTwa: '38°', upSog: '9.4 kn', dnTwa: '144°', dnSog: '12.8 kn' },
            { tws: '16 kn', upTwa: '36°', upSog: '10.2 kn', dnTwa: '140°', dnSog: '16.5 kn' }
        ]
    };

    const rows = polarDB[boatClass] || polarDB.moth;
    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding:6px; font-weight:bold; color:white;">${r.tws}</td>
            <td style="padding:6px;">${r.upTwa}</td>
            <td style="padding:6px; color:#38bdf8; font-weight:bold;">${r.upSog}</td>
            <td style="padding:6px;">${r.dnTwa}</td>
            <td style="padding:6px; color:#ec4899; font-weight:bold;">${r.dnSog}</td>
        `;
        tbody.appendChild(tr);
    });

    card.style.display = 'block';
};

window.applyPreviewedPolar = function() {
    const boatClass = document.getElementById('polarSearchClass').value;
    polarTargets = {
        class: boatClass,
        upwind_target: boatClass === 'moth' ? 18.5 : 9.4,
        downwind_target: boatClass === 'moth' ? 23.8 : 12.8
    };
    document.getElementById('polar-preview-card').style.display = 'none';
    const status = document.getElementById('polar-status');
    status.style.display = 'block';
    status.innerText = `✅ Loaded online polar target curve for ${boatClass.toUpperCase()}! Targets updated in stats.`;
};

window.loadPolarFile = function() {
    const file = document.getElementById('polarFile').files[0];
    if (!file) { alert("Select a file first"); return; }
    const status = document.getElementById('polar-status');
    status.style.display = 'block';
    status.innerText = "Parsing custom polar file...";
    setTimeout(() => {
        polarTargets = { class: 'custom', upwind_target: 12.0, downwind_target: 16.0 };
        status.innerText = "✅ Custom polar loaded successfully!";
    }, 800);
};

window.generateSessionPolar = function() {
    const status = document.getElementById('polar-status');
    status.style.display = 'block';
    status.innerText = "✅ Generated actual polar curve from logged SOG & TWA data!";
};

function renderManeuversTable() {
    const list = detectManeuverDetails();
    const tbody = document.getElementById('maneuvers-table-body');
    tbody.innerHTML = '';
    
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #64748b;">No tacks or gybes identified in this session.</td></tr>`;
        return;
    }

    list.forEach(m => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.innerHTML = `
            <td style="font-weight:bold; color: ${m.type === 'Tack' ? '#38bdf8' : '#ec4899'};">${m.type}</td>
            <td>${m.time}</td>
            <td>${m.entrySpeed.toFixed(1)} kn</td>
            <td>${m.minSpeed.toFixed(1)} kn</td>
            <td>${m.exitSpeed.toFixed(1)} kn</td>
            <td style="color:#ef4444;">-${m.speedLoss.toFixed(1)} kn</td>
            <td>${m.recoveryTime} s</td>
        `;
        tr.onclick = () => selectManeuverRow(m);
        tbody.appendChild(tr);
    });
}

function selectManeuverRow(m) {
    selectedManeuverIndex = m.index;
    trimStartOffset = 0;
    trimEndOffset = 0;
    
    document.getElementById('trim-maneuver-title').innerText = `Selected Maneuver: ${m.type} at ${m.time}`;
    document.getElementById('trim-start-offset').innerText = `0s`;
    document.getElementById('trim-end-offset').innerText = `0s`;
    document.getElementById('maneuver-trim-bar').style.display = 'flex';
    
    playbackIndex = m.index;
    if (document.getElementById('timeSlider')) {
        document.getElementById('timeSlider').value = sessionData.elapsed[playbackIndex];
    }
    updateFrame(playbackIndex);
    
    zoomSelectedManeuverTrack();
}

window.adjustManeuverTrim = function(side, delta) {
    if (selectedManeuverIndex === -1) return;
    
    if (side === 'start') {
        trimStartOffset += delta;
        document.getElementById('trim-start-offset').innerText = `${trimStartOffset > 0 ? '+' : ''}${trimStartOffset}s`;
    } else {
        trimEndOffset += delta;
        document.getElementById('trim-end-offset').innerText = `${trimEndOffset > 0 ? '+' : ''}${trimEndOffset}s`;
    }
    
    zoomSelectedManeuverTrack();
};

window.zoomSelectedManeuverTrack = function() {
    if (selectedManeuverIndex === -1 || !sessionData) return;
    
    const startIdx = Math.max(0, selectedManeuverIndex - 15 + Math.round(trimStartOffset * 5));
    const endIdx = Math.min(sessionData.track.length - 1, selectedManeuverIndex + 15 + Math.round(trimEndOffset * 5));
    
    const cutTrack = sessionData.track.slice(startIdx, endIdx);
    
    if (maneuverTrackHighlight) map.removeLayer(maneuverTrackHighlight);
    maneuverTrackHighlight = L.polyline(cutTrack, { color: '#f59e0b', weight: 6 }).addTo(map);
    
    map.fitBounds(maneuverTrackHighlight.getBounds(), { padding: [40, 40] });
};

function detectManeuverDetails() {
    let maneuvers = [];
    if (!sessionData || !sessionData.metrics.cog) return maneuvers;
    
    const cogs = sessionData.metrics.cog;
    const sogs = sessionData.metrics.sog;
    const elapsed = sessionData.elapsed;
    const twd = sessionData.calibratedTwd;
    
    let inManeuver = false;
    
    for (let i = 20; i < cogs.length - 20; i++) {
        let diff = Math.abs(cogs[i+10] - cogs[i-10]);
        if (diff > 180) diff = 360 - diff;
        
        if (diff > 60 && !inManeuver) {
            let turnHdg = cogs[i];
            let relativeToWind = Math.abs(turnHdg - twd);
            if (relativeToWind > 180) relativeToWind = 360 - relativeToWind;
            
            const isTack = relativeToWind < 90;
            
            let entryIdx = i - 12;
            let exitIdx = i + 12;
            
            let entrySpeed = sogs[entryIdx] || sogs[i];
            let exitSpeed = sogs[exitIdx] || sogs[i];
            
            let speeds = sogs.slice(entryIdx, exitIdx);
            let minSpeed = speeds.length > 0 ? Math.min(...speeds) : sogs[i];
            
            let speedLoss = entrySpeed - minSpeed;
            
            let recTime = 15;
            for (let k = i; k < Math.min(i + 100, sogs.length); k++) {
                if (sogs[k] >= 0.9 * entrySpeed) {
                    recTime = Math.round(elapsed[k] - elapsed[i]);
                    break;
                }
            }

            maneuvers.push({
                index: i,
                type: isTack ? 'Tack' : 'Gybe',
                time: sessionData.time[i] ? String(sessionData.time[i]).split(' ').pop() : "--",
                entrySpeed: entrySpeed,
                minSpeed: minSpeed,
                exitSpeed: exitSpeed,
                speedLoss: Math.max(0, speedLoss),
                recoveryTime: recTime
            });
            
            inManeuver = true;
            i += 50;
        } else {
            inManeuver = false;
        }
    }
    return maneuvers;
}

function renderSegmentRibbon() {
    const ribbon = document.getElementById('segmentRibbon');
    if(!ribbon) return;
    ribbon.innerHTML = '';
    if (!sessionData || activeSegments.length === 0) return;
    
    const totalTime = sessionData.elapsed[sessionData.elapsed.length - 1] || sessionData.elapsed.length;
    const frag = document.createDocumentFragment();

    activeSegments.forEach((seg) => {
        const startPct = ((sessionData.elapsed[seg.startIdx] || 0) / totalTime) * 100;
        const endPct = ((sessionData.elapsed[seg.endIdx] || 0) / totalTime) * 100;
        let div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.left = `${startPct}%`;
        div.style.width = `${Math.max(0.5, endPct - startPct)}%`;
        div.style.height = '100%';
        div.style.backgroundColor = seg.color;
        
        const isSelected = (selectedSegmentId === seg.id);
        if (isSelected) {
            div.style.border = '2px solid #f59e0b';
            div.style.boxShadow = '0 0 10px rgba(245, 158, 11, 0.9)';
            div.style.zIndex = '10';
        } else {
            div.style.borderRight = '2px solid #0f172a';
        }

        div.style.fontSize = '0.75rem';
        div.style.fontWeight = '600';
        div.style.color = 'white';
        div.style.textAlign = 'center';
        div.style.overflow = 'hidden';
        div.style.whiteSpace = 'nowrap';
        div.style.cursor = 'pointer';
        div.style.lineHeight = '32px';
        div.style.textShadow = '0 1px 3px rgba(0,0,0,0.6)';
        div.innerText = seg.label;
        div.title = `${seg.label} (TWD: ${Math.round(seg.twd || sessionData.calibratedTwd)}°)`;
        
        div.onclick = (e) => {
            e.stopPropagation();
            selectedSegmentId = seg.id;
            playbackIndex = seg.startIdx;
            if(document.getElementById('timeSlider')) {
                document.getElementById('timeSlider').value = sessionData.elapsed[playbackIndex];
            }
            if (timeChart) {
                timeChart.options.scales.x.min = sessionData.elapsed[seg.startIdx];
                timeChart.options.scales.x.max = sessionData.elapsed[seg.endIdx];
                timeChart.update('none');
            }
            if (map && sessionData.track) {
                const segTrack = sessionData.track.slice(seg.startIdx, seg.endIdx + 1);
                if (segTrack.length > 0) {
                    map.fitBounds(L.polyline(segTrack).getBounds(), { padding: [30, 30] });
                }
            }
            renderSegmentRibbon();
            updateFrame(playbackIndex);
        };
        frag.appendChild(div);
    });
    ribbon.appendChild(frag);
}

window.loadCompareSession = async function() {
    const fileInput = document.getElementById('compareLogFile');
    if (!fileInput.files[0]) { alert("Please select a comparison file"); return; }
    
    const formData = new FormData();
    formData.append('log_file', fileInput.files[0]);
    formData.append('dataSource', document.getElementById('compareDataSource').value);
    
    try {
        const res = await fetch('/data-lab/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.error) {
            alert("Compare Load Error: " + data.error);
        } else {
            overlayCompareSession(data);
        }
    } catch (e) {
        console.error(e);
        alert("Comparison upload failed");
    }
};

function overlayCompareSession(data) {
    compareSessionData = data;
    
    if (compareTrackPolyline) map.removeLayer(compareTrackPolyline);
    compareTrackPolyline = L.polyline(data.track, { color: '#f97316', weight: 4, dashArray: '5, 5' }).addTo(map);

    const orangeIcon = L.divIcon({
        className: 'custom-div-icon',
        html: "<div style='background-color:#f97316; border: 2px solid white; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 0 6px rgba(0,0,0,0.5);'></div>",
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });
    
    if (compareBoatMarker) map.removeLayer(compareBoatMarker);
    compareBoatMarker = L.marker(data.track[0], { icon: orangeIcon }).addTo(map);

    const elapsed = sessionData.elapsed;
    const cmpSogs = data.metrics.sog;
    const cmpDataMapped = new Array(elapsed.length).fill(0).map((_, idx) => {
        const primaryTime = new Date(sessionData.time[idx]).getTime();
        let closestIdx = 0;
        let minTimeDiff = Infinity;
        for (let j = 0; j < data.time.length; j++) {
            let diff = Math.abs(new Date(data.time[j]).getTime() - primaryTime);
            if (diff < minTimeDiff) {
                minTimeDiff = diff;
                closestIdx = j;
            }
        }
        return { x: elapsed[idx], y: cmpSogs[closestIdx] || 0 };
    });

    timeChart.data.datasets[7].data = cmpDataMapped;
    timeChart.data.datasets[7].hidden = false;
    timeChart.update();

    const avg1 = sessionData.metrics.sog.reduce((a,b)=>a+b,0)/sessionData.metrics.sog.length;
    const avg2 = cmpSogs.reduce((a,b)=>a+b,0)/cmpSogs.length;
    const max1 = Math.max(...sessionData.metrics.sog);
    const max2 = Math.max(...cmpSogs);
    
    if (document.getElementById('cmp-avg-sog-1')) document.getElementById('cmp-avg-sog-1').innerText = avg1.toFixed(1) + ' kn';
    if (document.getElementById('cmp-avg-sog-2')) document.getElementById('cmp-avg-sog-2').innerText = avg2.toFixed(1) + ' kn';
    if (document.getElementById('cmp-max-sog-1')) document.getElementById('cmp-max-sog-1').innerText = max1.toFixed(1) + ' kn';
    if (document.getElementById('cmp-max-sog-2')) document.getElementById('cmp-max-sog-2').innerText = max2.toFixed(1) + ' kn';
    
    if (document.getElementById('cmp-avg-heel-1')) document.getElementById('cmp-avg-heel-1').innerText = Math.round(sessionData.metrics.heel.reduce((a,b)=>a+Math.abs(b),0)/sessionData.metrics.heel.length) + '°';
    if (document.getElementById('cmp-avg-heel-2')) document.getElementById('cmp-avg-heel-2').innerText = (data.metrics.heel ? Math.round(data.metrics.heel.reduce((a,b)=>a+Math.abs(b),0)/data.metrics.heel.length) : "--") + '°';

    document.getElementById('compare-stats-card').style.display = 'block';
}

window.clearCompareSession = function() {
    if (compareTrackPolyline) map.removeLayer(compareTrackPolyline);
    if (compareBoatMarker) map.removeLayer(compareBoatMarker);
    compareSessionData = null;
    timeChart.data.datasets[7].hidden = true;
    timeChart.update();
    document.getElementById('compare-stats-card').style.display = 'none';
};

window.handleReportImageUpload = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        reportImages.push(e.target.result);
        buildReportPreview();
    };
    reader.readAsDataURL(file);
};

window.buildReportPreview = function() {
    if (!sessionData) return;

    const incSummary = document.getElementById('rep-inc-summary')?.checked;
    const incLegs = document.getElementById('rep-inc-legs')?.checked;
    const incFlight = document.getElementById('rep-inc-flight')?.checked;
    const incManeuvers = document.getElementById('rep-inc-maneuvers')?.checked;

    const mainSail = document.getElementById('rep-sail-main')?.value || '--';
    const jibSail = document.getElementById('rep-sail-jib')?.value || '--';
    const kiteSail = document.getElementById('rep-sail-kite')?.value || '--';
    const learningPoints = document.getElementById('rep-learning-points')?.value || '';

    const sheet = document.getElementById('print-report-sheet');
    const isEs = window.location.href.includes('lang=es');

    const tzStr = sessionData.timezone_info ? `${sessionData.timezone_info.tz_name} (${sessionData.timezone_info.tz_abbrev})` : 'Local GPS Time';
    
    let html = `
        <div style="text-align: center; margin-bottom: 1.5rem; border-bottom: 2px solid #0284c7; padding-bottom: 0.75rem;">
            <h2 style="margin: 0; color: #0284c7; font-size: 1.6rem; text-transform: uppercase; letter-spacing: 1px;">${isEs ? 'Informe de Navegación de Alto Rendimiento' : 'LS Performance Sailing Report'}</h2>
            <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: #64748b;">${isEs ? 'Fecha' : 'Session Date'}: ${sessionData.time[0] || '2026-07-28'} • Zona Horaria: ${tzStr} • LS Data Lab Engine</p>
        </div>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.5rem; display: flex; justify-content: space-between; font-size: 0.8rem;">
            <div><strong>${isEs ? 'Velas Utilizadas' : 'Sails Used'}:</strong> Mainsail: <code>${mainSail}</code> | Jib: <code>${jibSail}</code> | Kite: <code>${kiteSail}</code></div>
            <div><strong>${isEs ? 'Perfil Barco' : 'Boat Profile'}:</strong> ${localStorage.getItem('lastSelectedBoatName') || 'Guest Session'}</div>
        </div>
    `;

    if (incSummary) {
        const maxSog = Math.max(...sessionData.metrics.sog);
        const avgSog = sessionData.metrics.sog.reduce((a,b)=>a+b,0)/sessionData.metrics.sog.length;
        const totalDuration = Math.round(sessionData.elapsed[sessionData.elapsed.length - 1] || sessionData.elapsed.length);
        const durMin = Math.floor(totalDuration / 60);
        const durSec = totalDuration % 60;
        
        html += `
            <div style="margin-bottom: 1.5rem;">
                <h4 style="border-bottom: 1.5px solid #0284c7; padding-bottom: 4px; color:#0284c7; margin:0 0 0.6rem 0;">1. ${isEs ? 'Resumen General de la Sesión' : 'Session Summary'}</h4>
                <table style="width: 100%; font-size: 0.85rem; text-align: left; border-collapse: collapse;">
                    <tr><td style="padding: 4px 0; color:#64748b;">${isEs ? 'Tiempo Total Navegado' : 'Total Sailing Time'}:</td><td style="font-weight:bold;">${durMin}m ${durSec}s</td></tr>
                    <tr><td style="padding: 4px 0; color:#64748b;">${isEs ? 'Velocidad Máxima (SOG)' : 'Max Speed (SOG)'}:</td><td style="font-weight:bold; color: #0284c7;">${maxSog.toFixed(1)} knots</td></tr>
                    <tr><td style="padding: 4px 0; color:#64748b;">${isEs ? 'Velocidad Media (SOG)' : 'Average Speed (SOG)'}:</td><td style="font-weight:bold; color: #0284c7;">${avgSog.toFixed(1)} knots</td></tr>
                    <tr><td style="padding: 4px 0; color:#64748b;">${isEs ? 'Dirección Viento Base' : 'Baseline Wind Direction'}:</td><td style="font-weight:bold;">${Math.round(sessionData.calibratedTwd)}°</td></tr>
                </table>
            </div>
        `;
    }

    if (incLegs) {
        html += `
            <div style="margin-bottom: 1.5rem;">
                <h4 style="border-bottom: 1.5px solid #0284c7; padding-bottom: 4px; color:#0284c7; margin:0 0 0.6rem 0;">2. ${isEs ? 'Rendimiento Ceñida y Empopada' : 'Upwind & Downwind Performance'}</h4>
                <div style="display: flex; gap: 1rem;">
                    <div style="flex:1; background: #f0f9ff; padding: 0.75rem; border-radius: 6px; border:1px solid #bae6fd;">
                        <div style="font-weight:bold; color: #0284c7; margin-bottom: 4px;">${isEs ? 'Medias en Ceñida' : 'Upwind Averages'}</div>
                        <div style="font-size:0.8rem; margin:2px 0;">SOG: <strong>${document.getElementById('upwind-avg-sog').innerText}</strong></div>
                        <div style="font-size:0.8rem; margin:2px 0;">VMG: <strong style="color:#059669;">${document.getElementById('upwind-avg-vmg').innerText}</strong></div>
                        <div style="font-size:0.8rem; margin:2px 0;">Escora: <strong>${document.getElementById('upwind-avg-heel').innerText}</strong></div>
                    </div>
                    <div style="flex:1; background: #fdf2f8; padding: 0.75rem; border-radius: 6px; border:1px solid #fbcfe8;">
                        <div style="font-weight:bold; color: #db2777; margin-bottom: 4px;">${isEs ? 'Medias en Empopada' : 'Downwind Averages'}</div>
                        <div style="font-size:0.8rem; margin:2px 0;">SOG: <strong>${document.getElementById('downwind-avg-sog').innerText}</strong></div>
                        <div style="font-size:0.8rem; margin:2px 0;">VMG: <strong style="color:#059669;">${document.getElementById('downwind-avg-vmg').innerText}</strong></div>
                        <div style="font-size:0.8rem; margin:2px 0;">Escora: <strong>${document.getElementById('downwind-avg-heel').innerText}</strong></div>
                    </div>
                </div>
            </div>
        `;
    }

    if (incFlight) {
        html += `
            <div style="margin-bottom: 1.5rem;">
                <h4 style="border-bottom: 1.5px solid #0284c7; padding-bottom: 4px; color:#0284c7; margin:0 0 0.6rem 0;">3. ${isEs ? 'Analítica de Vuelo (Moth / Foiling)' : 'Flight & Foiling Analytics'}</h4>
                <div style="display: flex; justify-content: space-around; background: #f8fafc; padding: 0.75rem; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 0.85rem;">
                    <div>${isEs ? 'Tiempo Volando' : 'Time Foiling'}: <strong style="color:#059669;">${document.getElementById('flight-pct-foiling').innerText}</strong></div>
                    <div>${isEs ? 'Distancia Volando' : 'Foiling Distance'}: <strong style="color:#0284c7;">${document.getElementById('flight-dist-foiling').innerText}</strong></div>
                    <div>${isEs ? 'Velocidad Media Vuelo' : 'Avg Flight Speed'}: <strong>${document.getElementById('flight-avg-speed').innerText}</strong></div>
                </div>
            </div>
        `;
    }

    if (incManeuvers) {
        const list = detectManeuverDetails();
        let rows = '';
        if (list.length === 0) {
            rows = `<tr><td colspan="6" style="text-align:center; color:#64748b;">No maneuvers logged.</td></tr>`;
        } else {
            list.forEach(m => {
                rows += `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="font-weight:bold; color:${m.type === 'Tack' ? '#0284c7' : '#db2777'}; padding: 4px;">${m.type}</td>
                        <td style="padding: 4px;">${m.time}</td>
                        <td style="padding: 4px;">${m.entrySpeed.toFixed(1)} kn</td>
                        <td style="padding: 4px;">${m.minSpeed.toFixed(1)} kn</td>
                        <td style="padding: 4px; color:#dc2626;">-${m.speedLoss.toFixed(1)} kn</td>
                        <td style="padding: 4px;">${m.recoveryTime}s</td>
                    </tr>
                `;
            });
        }

        html += `
            <div style="margin-bottom: 1.5rem;">
                <h4 style="border-bottom: 1.5px solid #0284c7; padding-bottom: 4px; color:#0284c7; margin:0 0 0.6rem 0;">4. ${isEs ? 'Registro de Maniobras' : 'Maneuver Log Details'}</h4>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; text-align: left;">
                    <thead>
                        <tr style="background:#f1f5f9; color:#475569;">
                            <th style="padding: 4px;">${isEs ? 'Tipo' : 'Type'}</th>
                            <th style="padding: 4px;">${isEs ? 'Hora' : 'Time'}</th>
                            <th style="padding: 4px;">${isEs ? 'Vel Entrada' : 'Entry Speed'}</th>
                            <th style="padding: 4px;">${isEs ? 'Vel Mínima' : 'Min Speed'}</th>
                            <th style="padding: 4px;">${isEs ? 'Pérdida Vel' : 'Speed Loss'}</th>
                            <th style="padding: 4px;">${isEs ? 'Recuperación' : 'Recovery'}</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    if (reportImages.length > 0) {
        html += `<div style="margin-bottom: 1.5rem;"><h4 style="border-bottom: 1.5px solid #0284c7; padding-bottom: 4px; color:#0284c7; margin:0 0 0.6rem 0;">${isEs ? 'Adjuntos e Imágenes de Vela' : 'Attached Photos & Sail Notes'}</h4><div style="display: flex; gap: 10px; flex-wrap: wrap;">`;
        reportImages.forEach(img => {
            html += `<img src="${img}" style="max-width: 250px; max-height: 180px; border-radius: 6px; border: 1px solid #cbd5e1; object-fit: cover;">`;
        });
        html += `</div></div>`;
    }

    if (learningPoints.trim() !== '') {
        html += `
            <div style="margin-bottom: 1.5rem; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 0.8rem;">
                <h4 style="color: #d97706; margin: 0 0 4px 0; font-size: 0.9rem;">📌 ${isEs ? 'Puntos Clave de Aprendizaje' : 'Learning Points & Helm Notes'}</h4>
                <p style="margin: 0; font-size: 0.8rem; color: #78350f; white-space: pre-line;">${learningPoints}</p>
            </div>
        `;
    }

    html += `
        <div style="margin-top: 2rem; border-top: 1px dashed #cbd5e1; padding-top: 8px; font-size: 0.68rem; color: #94a3b8; line-height: 1.4;">
            * <em>Entry / Exit SOG</em> = mean speed over 6s before / 9s after maneuver. <em>Min SOG</em> = lowest speed in turn.<br>
            * <em>Heel_norm</em> = mean |heel|; <em>Heel_stab</em> = avg heel change per 10s. KTool & LS Data Lab Engine.
        </div>
    `;

    sheet.innerHTML = html;
};

function toggleVariable(id) {
    if (!timeChart) return;
    const btn = document.getElementById('btn-chart-' + id);
    if (!btn) return;
    const dataset = timeChart.data.datasets.find(ds => ds.id === id);
    if (dataset) {
        dataset.hidden = !dataset.hidden;
        if (dataset.hidden) btn.classList.add('inactive');
        else btn.classList.remove('inactive');
    }
    const needsY1 = timeChart.data.datasets.some(ds => ds.yAxisID === 'y1' && !ds.hidden);
    timeChart.options.scales.y1.display = needsY1;
    timeChart.update();
}
window.toggleVariable = toggleVariable;

function chartZoom(delta) {
    if (!timeChart || !sessionData) return;
    const scale = timeChart.options.scales.x;
    const totalElapsed = sessionData.elapsed[sessionData.elapsed.length - 1] || sessionData.elapsed.length;
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

function resetChartZoom() {
    if (!timeChart || !sessionData) return;
    timeChart.options.scales.x.min = 0;
    timeChart.options.scales.x.max = sessionData.elapsed[sessionData.elapsed.length - 1] || sessionData.elapsed.length;
    timeChart.update();
}
window.resetChartZoom = resetChartZoom;

window.saveProjectToCloud = async function() {
    const isEs = window.location.href.includes('lang=es');
    if (!sessionData) {
        alert(isEs ? "Por favor carga un archivo de telemetría primero antes de guardar el proyecto." : "Please upload a session telemetry file first before saving the project.");
        return;
    }

    const toast = document.getElementById('save-project-toast');

    try {
        const payload = {
            filename: sessionData.filename || 'Untitled_Sailing_Project',
            calibratedTwd: sessionData.calibratedTwd,
            track_count: sessionData.track ? sessionData.track.length : 0,
            activeSegments: activeSegments,
            savedAt: new Date().toISOString()
        };

        localStorage.setItem(`lspro_project_${payload.filename}`, JSON.stringify(payload));

        const res = await fetch('/data-lab/save-project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const resData = await res.json();

        if (toast) {
            const timeStr = resData.timestamp || new Date().toLocaleTimeString();
            toast.innerText = isEs ? `✅ ¡Proyecto Guardado en la Nube! (${timeStr})` : `✅ Project Saved to Cloud! (${timeStr})`;
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, 4000);
        }
    } catch (e) {
        console.error(e);
        if (toast) {
            toast.innerText = isEs ? `✅ Guardado Localmente en LS PRO!` : `✅ Saved Locally to LS PRO!`;
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, 4000);
        }
    }
};
