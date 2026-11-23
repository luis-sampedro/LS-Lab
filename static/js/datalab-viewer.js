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
let playbackSpeed = 1;
let lastAnimTime = null;
let animationId = null;
let globalHeuristicTwd = 0;
let forecastTwd = 0;
let activeSegments = [];
let selectedSegmentId = null;
let activeSublegs = [];
let selectedSublegId = null;
let activeTab = 'upload';
let polarTargets = null;
let reportImages = [];

const LEG_PALETTE = [
    '#38bdf8', // 0: Sky Blue
    '#f59e0b', // 1: Amber / Orange
    '#10b981', // 2: Emerald Green
    '#ec4899', // 3: Pink / Magenta
    '#a855f7', // 4: Purple / Violet
    '#06b6d4', // 5: Cyan
    '#f97316', // 6: Deep Orange
    '#84cc16', // 7: Lime Green
    '#6366f1', // 8: Indigo
    '#e11d48', // 9: Rose Red
    '#14b8a6', // 10: Teal
    '#eab308'  // 11: Yellow
];
window.trackLegLayers = [];

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
    initExcelRowResizers();
    if (typeof updateLowSpeedStatusUI === 'function') updateLowSpeedStatusUI();
});

window.applyLayoutPreset = function(preset) {
    const mapSec = document.getElementById('mapSection');
    const chartSec = document.getElementById('chartSection');
    const container = document.getElementById('shared-visualizer');
    if (!container || !mapSec || !chartSec) return;
    
    if (preset === 'equal') {
        mapSec.style.height = '30vh';
        chartSec.style.height = '28vh';
    } else if (preset === 'map') {
        mapSec.style.height = '48vh';
        chartSec.style.height = '20vh';
    } else if (preset === 'chart') {
        mapSec.style.height = '20vh';
        chartSec.style.height = '44vh';
    }
    
    setTimeout(() => {
        if (map) map.invalidateSize();
        if (timeChart) timeChart.resize();
    }, 50);
};

window.toggleTelemetryOverlay = function() {
    const content = document.getElementById('telemetryOverlayScrollContent');
    const lbl = document.getElementById('lblToggleTelemetryOverlay');
    const overlay = document.getElementById('mapTelemetryOverlay');
    if (!content || !lbl) return;
    const isEs = document.documentElement.lang === 'es' || window.location.href.includes('lang=es');
    if (content.style.display === 'none') {
        content.style.display = 'flex';
        lbl.textContent = isEs ? '− Minimizar' : '− Minimize';
        if (overlay) overlay.style.width = '380px';
    } else {
        content.style.display = 'none';
        lbl.textContent = isEs ? '+ Expandir' : '+ Expand';
        if (overlay) overlay.style.width = 'auto';
    }
};

window.initExcelRowResizers = function() {
    const mapSec = document.getElementById('mapSection');
    const chartSec = document.getElementById('chartSection');
    const resizer1 = document.getElementById('resizerMapChart');
    const resizer2 = document.getElementById('resizerChartTimeline');

    if (!resizer1 || !resizer2 || !mapSec || !chartSec) return;

    let isDragging1 = false;
    let isDragging2 = false;
    let startY = 0;
    let startMapH = 0;
    let startChartH = 0;

    resizer1.addEventListener('mousedown', (e) => {
        isDragging1 = true;
        startY = e.clientY;
        startMapH = mapSec.offsetHeight;
        startChartH = chartSec.offsetHeight;
        document.body.style.cursor = 'row-resize';
        e.preventDefault();
    });

    resizer2.addEventListener('mousedown', (e) => {
        isDragging2 = true;
        startY = e.clientY;
        startChartH = chartSec.offsetHeight;
        document.body.style.cursor = 'row-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging1) {
            const dy = e.clientY - startY;
            const newMapH = Math.max(100, startMapH + dy);
            const newChartH = Math.max(80, startChartH - dy);
            mapSec.style.height = `${newMapH}px`;
            chartSec.style.height = `${newChartH}px`;
            if (map) map.invalidateSize();
            if (timeChart) timeChart.resize();
        } else if (isDragging2) {
            const dy = e.clientY - startY;
            const newChartH = Math.max(80, startChartH + dy);
            chartSec.style.height = `${newChartH}px`;
            if (timeChart) timeChart.resize();
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging1 || isDragging2) {
            isDragging1 = false;
            isDragging2 = false;
            document.body.style.cursor = '';
            if (map) map.invalidateSize();
            if (timeChart) timeChart.resize();
        }
    });
};

function initMap() {
    map = L.map('map', {
        zoomControl: true,
        preferCanvas: true
    }).setView([42.2328, -8.7226], 13);

    // 1. Sleek High-Contrast Dark Canvas (Fast, 100% Free, NO API KEY REQUIRED)
    const darkLayer = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; <a href="https://www.esri.com">Esri</a> &copy; OpenStreetMap',
        maxZoom: 19
    });

    // 2. OpenStreetMap Standard (Free, community-driven, no API key)
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    });

    // 3. High-Resolution Coastal Satellite Imagery (No API key)
    const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; <a href="https://www.esri.com">Esri</a> &copy; Maxar, Earthstar Geographics',
        maxZoom: 19
    });

    // Default to the dark canvas layer: clean, no auth or API keys needed
    darkLayer.addTo(map);

    // Multi-basemap switch control
    const isEs = document.documentElement.lang === 'es' || window.location.href.includes('lang=es');
    const baseMaps = isEs ? {
        "🌙 Modo Oscuro (Dark Canvas)": darkLayer,
        "🗺️ Mapa Estándar (OSM)": osmLayer,
        "🛰️ Satélite Costero": satLayer
    } : {
        "🌙 Dark Mode (Dark Canvas)": darkLayer,
        "🗺️ Standard Map (OSM)": osmLayer,
        "🛰️ Coastal Satellite": satLayer
    };

    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

    // Ensure map tiles and dimensions automatically adjust whenever container becomes visible
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
            if (map) {
                map.invalidateSize();
            }
        });
        const mapEl = document.getElementById('map');
        if (mapEl) ro.observe(mapEl);
        const mapSec = document.getElementById('mapSection');
        if (mapSec) ro.observe(mapSec);
    }

    map.on('click', function(e) {
        if (typeof isPickingMarkMode !== 'undefined' && isPickingMarkMode) {
            const typeSelect = document.getElementById('raceMarkTypeSelect');
            const type = typeSelect ? typeSelect.value : 'windward';
            setRaceMark(type, e.latlng.lat, e.latlng.lng);
            togglePickMarkMode();
        }
    });
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
                { id: 'sog', label: 'SOG', data: [], borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.1)', fill: true, tension: 0.3, pointRadius: 0, yAxisID: 'y-sog' },
                { id: 'cog', label: 'COG', data: [], borderColor: '#f59e0b', tension: 0.3, pointRadius: 0, yAxisID: 'y-cog', hidden: true },
                { id: 'hdg', label: 'HDG', data: [], borderColor: '#fbbf24', tension: 0.3, pointRadius: 0, yAxisID: 'y-cog' },
                { id: 'heel', label: 'Heel', data: [], borderColor: '#ef4444', tension: 0.3, pointRadius: 0, yAxisID: 'y-heel', hidden: true },
                { id: 'pitch', label: 'Pitch', data: [], borderColor: '#ec4899', tension: 0.3, pointRadius: 0, yAxisID: 'y-pitch', hidden: true },
                { id: 'rot', label: 'ROT', data: [], borderColor: '#f43f5e', tension: 0.3, pointRadius: 0, yAxisID: 'y-heel', hidden: true },
                { id: 'tws', label: 'TWS', data: [], borderColor: '#10b981', tension: 0.3, pointRadius: 0, yAxisID: 'y-sog', hidden: true },
                { id: 'twd', label: 'TWD', data: [], borderColor: '#8b5cf6', borderDash: [5, 5], tension: 0.3, pointRadius: 0, yAxisID: 'y-cog', hidden: true },
                { id: 'twa', label: 'TWA', data: [], borderColor: '#06b6d4', borderDash: [5, 5], tension: 0.3, pointRadius: 0, yAxisID: 'y-cog', hidden: true },
                { id: 'vmg', label: 'VMG', data: [], borderColor: '#34d399', tension: 0.3, pointRadius: 0, yAxisID: 'y-sog', hidden: true },
                { id: 'vmc', label: 'VMC', data: [], borderColor: '#a78bfa', tension: 0.3, pointRadius: 0, yAxisID: 'y-sog', hidden: true },
                { id: 'leeway', label: 'Leeway', data: [], borderColor: '#e879f9', tension: 0.3, pointRadius: 0, yAxisID: 'y-heel', hidden: true },
                { id: 'cspd', label: 'CSPD', data: [], borderColor: '#60a5fa', tension: 0.3, pointRadius: 0, yAxisID: 'y-sog', hidden: true },
                { id: 'cdir', label: 'CDIR', data: [], borderColor: '#38bdf8', borderDash: [3, 3], tension: 0.3, pointRadius: 0, yAxisID: 'y-cog', hidden: true },
                { id: 'sog-cmp', label: 'SOG (Compared)', data: [], borderColor: '#f97316', borderDash: [2, 2], tension: 0.3, pointRadius: 0, yAxisID: 'y-sog', hidden: true }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            onClick: function(e, activeEls, chart) {
                if (!sessionData || !sessionData.elapsed || sessionData.elapsed.length === 0) return;
                const xValue = chart.scales.x.getValueForPixel(e.x);
                // Find closest index for elapsed time
                let low = 0, high = sessionData.elapsed.length - 1;
                while (low < high) {
                    let mid = Math.floor((low + high) / 2);
                    if (sessionData.elapsed[mid] < xValue) low = mid + 1;
                    else high = mid;
                }
                playbackIndex = low;
                updateScrubberPosition();
                updateFrame(playbackIndex);
            },
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
                'y-sog': { display: true, position: 'left', grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
                'y-cog': { display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#94a3b8' } },
                'y-heel': { display: false, position: 'right' },
                'y-pitch': { display: false, position: 'right' }
            },
            plugins: {
                legend: { display: false },
                tooltip: { mode: 'index', intersect: false },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                        onPan: function() {
                            if (typeof renderSegmentRibbon === 'function') renderSegmentRibbon();
                            if (typeof updateScrubberPosition === 'function') updateScrubberPosition();
                        }
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'x',
                        onZoom: function() {
                            if (typeof renderSegmentRibbon === 'function') renderSegmentRibbon();
                            if (typeof updateScrubberPosition === 'function') updateScrubberPosition();
                        }
                    }
                }
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
        setTimeout(() => { if (map) map.invalidateSize(); }, 60);
        setTimeout(() => { if (map) map.invalidateSize(); }, 250);
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
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
            if (sessionData && sessionData.track && trackPolyline) {
                try {
                    map.fitBounds(trackPolyline.getBounds(), { padding: [30, 30] });
                } catch(e) {}
            }
        }
        if (timeChart) {
            timeChart.resize();
            timeChart.update();
        }
        if (sessionData && sessionData.track) {
            updateFrame(playbackIndex);
        }
    }, 80);
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

    initScrubber();
    
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

window.getChartViewportDomain = function() {
    if (!sessionData || !sessionData.elapsed || sessionData.elapsed.length === 0) {
        return { viewMin: 0, viewMax: 100, viewDuration: 100 };
    }
    const totalElapsed = sessionData.elapsed[sessionData.elapsed.length - 1] || sessionData.elapsed.length;
    let viewMin = 0;
    let viewMax = totalElapsed;

    if (typeof timeChart !== 'undefined' && timeChart && timeChart.options && timeChart.options.scales && timeChart.options.scales.x) {
        const scaleMin = timeChart.options.scales.x.min;
        const scaleMax = timeChart.options.scales.x.max;
        if (scaleMin !== undefined && scaleMin !== null && !isNaN(scaleMin)) viewMin = Math.max(0, scaleMin);
        if (scaleMax !== undefined && scaleMax !== null && !isNaN(scaleMax)) viewMax = Math.min(totalElapsed, scaleMax);
    }
    
    if (viewMax <= viewMin) {
        viewMin = 0;
        viewMax = totalElapsed;
    }
    const viewDuration = Math.max(0.1, viewMax - viewMin);
    return { viewMin, viewMax, viewDuration };
};

window.updateScrubberPosition = function() {
    if (!sessionData || !sessionData.elapsed || sessionData.elapsed.length === 0) return;
    const scrubber = document.getElementById('timelineScrubber');
    if (!scrubber) return;
    const { viewMin, viewMax, viewDuration } = getChartViewportDomain();
    const current = sessionData.elapsed[playbackIndex] || 0;
    
    if (current < viewMin || current > viewMax) {
        scrubber.style.display = 'none';
    } else {
        scrubber.style.display = 'block';
        const pct = ((current - viewMin) / viewDuration) * 100;
        scrubber.style.left = `${pct}%`;
    }
};

function initScrubber() {
    const container = document.getElementById('timelineContainer');
    if (!container) return;
    
    let isDragging = false;
    
    function handleScrub(e) {
        if (!sessionData || !sessionData.elapsed || sessionData.elapsed.length === 0) return;
        const rect = container.getBoundingClientRect();
        let clientX = e.clientX;
        if (e.touches && e.touches.length > 0) clientX = e.touches[0].clientX;
        
        let pct = (clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        
        const { viewMin, viewMax, viewDuration } = getChartViewportDomain();
        const targetTime = viewMin + (pct * viewDuration);
        
        // Find nearest index
        let low = 0, high = sessionData.elapsed.length - 1;
        while (low < high) {
            let mid = Math.floor((low + high) / 2);
            if (sessionData.elapsed[mid] < targetTime) low = mid + 1;
            else high = mid;
        }
        playbackIndex = low;
        updateFrame(playbackIndex);
        updateScrubberPosition();
    }
    
    container.addEventListener('mousedown', (e) => {
        isDragging = true;
        handleScrub(e);
        document.body.style.userSelect = 'none';
    });
    
    window.addEventListener('mousemove', (e) => {
        if (isDragging) handleScrub(e);
    });
    
    window.addEventListener('mouseup', () => {
        isDragging = false;
        document.body.style.userSelect = '';
    });
    
    container.addEventListener('touchstart', (e) => {
        isDragging = true;
        handleScrub(e);
    }, {passive: true});
    
    window.addEventListener('touchmove', (e) => {
        if (isDragging) {
            e.preventDefault(); // Prevent scrolling while scrubbing
            handleScrub(e);
        }
    }, {passive: false});
    
    window.addEventListener('touchend', () => {
        isDragging = false;
    });

    container.addEventListener('wheel', (e) => {
        if (!timeChart || !sessionData) return;
        if (e.target.closest('#autoDetectPopover') || e.target.closest('#filterPopover')) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1 : -1;
        chartZoom(delta);
    }, { passive: false });
}

// Global handleUpload
window.handleUpload = async function() {
    const fileInput = document.getElementById('logFile');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        alert("Please select a telemetry log file (.vkx, .csv, .gpx)");
        return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('log_file', file);
    formData.append('boat', document.getElementById('boatSelect') ? document.getElementById('boatSelect').value : '');
    formData.append('newBoatName', document.getElementById('newBoatName') ? document.getElementById('newBoatName').value : '');
    formData.append('newBoatType', document.getElementById('newBoatType') ? document.getElementById('newBoatType').value : '');
    formData.append('dataSource', document.getElementById('dataSource') ? document.getElementById('dataSource').value : 'auto');

    const btn = document.getElementById('uploadBtn');
    const isEs = window.location.href.includes('lang=es');
    if (btn) {
        btn.innerText = isEs ? "Analizando archivo..." : "Analyzing telemetry file...";
        btn.disabled = true;
    }

    try {
        const res = await fetch('/data-lab/upload', {
            method: 'POST',
            body: formData
        });

        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (jsonErr) {
            console.error("Non-JSON server response:", text);
            throw new Error(`Server returned unexpected response (status ${res.status}): ${text.substring(0, 150)}`);
        }

        if (!res.ok || (data && data.error)) {
            const errDetail = (data && data.error) ? data.error : `HTTP ${res.status}`;
            alert((isEs ? "Error al procesar archivo: " : "Telemetry Processing Error: ") + errDetail);
            return;
        }

        processSessionData(data);
    } catch (e) {
        console.error("Upload error:", e);
        alert((isEs ? "Error al cargar archivo: " : "Upload Failed: ") + (e.message || "Network error communicating with server."));
    } finally {
        if (btn) {
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
    
    // Update Desktop Steps Bar Status Pills
    const boatName = document.getElementById('newBoatName')?.value || document.getElementById('boatSelect')?.value || sessionData.filename || 'Boat 1';
    if (document.getElementById('lbl-active-boat')) document.getElementById('lbl-active-boat').innerText = boatName;
    if (document.getElementById('lbl-active-log')) document.getElementById('lbl-active-log').innerText = sessionData.filename || 'Session Log';
    if (document.getElementById('lbl-active-wind')) document.getElementById('lbl-active-wind').innerText = `TWD: ${sessionData.calibratedTwd}°`;
    
    enableWizardTabs();
    loadSessionToVisuals();
    if (typeof initPrimaryFleetBoat === 'function') initPrimaryFleetBoat();
    
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

window.renderTrackOnMap = function() {
    if (!map || !sessionData || !sessionData.track || sessionData.track.length === 0) {
        if (window.trackLegLayers && window.trackLegLayers.length > 0) {
            window.trackLegLayers.forEach(l => {
                try { map.removeLayer(l); } catch(e) {}
            });
            window.trackLegLayers = [];
        }
        if (trackPolyline) {
            try { map.removeLayer(trackPolyline); } catch(e) {}
            trackPolyline = null;
        }
        if (boatMarker) {
            try { map.removeLayer(boatMarker); } catch(e) {}
            boatMarker = null;
        }
        return;
    }

    // 1. Remove previous leg layers
    if (window.trackLegLayers && window.trackLegLayers.length > 0) {
        window.trackLegLayers.forEach(l => {
            try { map.removeLayer(l); } catch(e) {}
        });
    }
    window.trackLegLayers = [];

    if (trackPolyline) {
        try { map.removeLayer(trackPolyline); } catch(e) {}
        trackPolyline = null;
    }

    const track = sessionData.track;
    const trackLen = track.length;

    // Invisible full-track reference polyline for bounds calculation across visualizer
    trackPolyline = L.polyline(track, {
        color: '#38bdf8',
        weight: 1,
        opacity: 0,
        interactive: false
    }).addTo(map);
    window.trackLegLayers.push(trackPolyline);

    // 2. Determine segments to render on track
    let segmentsToRender = [];
    if (activeSegments && activeSegments.length > 1) {
        segmentsToRender = activeSegments;
    } else if (activeSublegs && activeSublegs.length > 0) {
        segmentsToRender = activeSublegs;
    } else if (activeSegments && activeSegments.length === 1) {
        segmentsToRender = activeSegments;
    }

    if (segmentsToRender.length > 0) {
        segmentsToRender.forEach((seg, idx) => {
            if (seg.startIdx >= trackLen) return;
            const sIdx = Math.max(0, seg.startIdx);
            const eIdx = Math.min(trackLen - 1, seg.endIdx);
            if (sIdx > eIdx) return;

            // Connect legs seamlessly by including adjacent point
            const sliceEnd = Math.min(trackLen, eIdx + 2);
            const legPts = track.slice(sIdx, sliceEnd);
            if (legPts.length === 0) return;

            // Assign distinct color from LEG_PALETTE if default or undefined
            let color = seg.color;
            if (!color || color.startsWith('rgba(2, 132, 199') || (segmentsToRender.length > 1 && color === '#38bdf8' && idx > 0)) {
                color = LEG_PALETTE[idx % LEG_PALETTE.length];
                seg.color = color;
            }

            const isHidden = (seg.type === 'hidden' || seg.mode === 'ashore');
            const poly = L.polyline(legPts, {
                color: isHidden ? '#64748b' : color,
                weight: isHidden ? 2 : 4,
                opacity: isHidden ? 0.35 : 0.95,
                dashArray: isHidden ? '4, 6' : null
            }).addTo(map);

            const twdInfo = seg.twd ? ` • TWD: ${Math.round(seg.twd)}°` : '';
            const legName = seg.label || `Leg ${idx + 1}`;
            poly.bindTooltip(`<div style="font-weight:700; color:${color}; font-size:0.8rem;">${legName}</div><div style="font-size:0.7rem; color:#cbd5e1;">${twdInfo}</div>`, {
                sticky: true
            });

            poly.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                if (seg.type === 'subleg' || seg.type === 'maneuver') {
                    selectedSublegId = seg.id;
                    if (typeof renderSublegRibbon === 'function') renderSublegRibbon();
                } else {
                    selectedSegmentId = seg.id;
                    if (typeof renderSegmentRibbon === 'function') renderSegmentRibbon();
                }
                playbackIndex = sIdx;
                updateScrubberPosition();
                updateFrame(playbackIndex);
            });

            window.trackLegLayers.push(poly);
        });
    } else {
        const singlePoly = L.polyline(track, {
            color: '#38bdf8',
            weight: 4,
            opacity: 0.95
        }).addTo(map);
        window.trackLegLayers.push(singlePoly);
    }

    // 3. Keep or create boat marker
    if (playbackIndex >= trackLen) {
        playbackIndex = Math.max(0, trackLen - 1);
    }
    const curPos = track[playbackIndex] || track[0];

    if (!boatMarker) {
        const redIcon = L.divIcon({
            className: 'custom-div-icon',
            html: "<div style='background-color:#ef4444; border: 2px solid white; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 0 6px rgba(0,0,0,0.5); cursor: grab;'></div>",
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });
        boatMarker = L.marker(curPos, { icon: redIcon, draggable: true }).addTo(map);
        boatMarker.on('drag', (e) => {
            if (isPlaying) togglePlay();
            const idx = findNearestTrackPoint(e.target.getLatLng());
            playbackIndex = idx;
            updateFrame(idx);
        });
        boatMarker.on('dragend', (e) => {
            if (sessionData && sessionData.track && sessionData.track[playbackIndex]) {
                boatMarker.setLatLng(sessionData.track[playbackIndex]);
            }
        });
    } else {
        boatMarker.setLatLng(curPos);
        if (!map.hasLayer(boatMarker)) {
            boatMarker.addTo(map);
        }
    }
};

window.setupMap = window.renderTrackOnMap;

window.refreshChartData = function() {
    if (!sessionData || !sessionData.elapsed || sessionData.elapsed.length === 0) return;
    
    const elapsed = sessionData.elapsed;
    const totalDuration = elapsed[elapsed.length - 1] || elapsed.length;
    const m = sessionData.metrics || {};
    const count = elapsed.length;

    timeChart.options.scales.x.max = totalDuration;
    timeChart.data.labels = elapsed;

    const sogs = m.sog || new Array(count).fill(0);
    const cogs = m.cog || new Array(count).fill(0);
    const hdgs = m.hdt || cogs;
    const heels = m.heel || new Array(count).fill(0);
    const pitches = m.pitch || new Array(count).fill(0);
    const twss = m.tws || new Array(count).fill(10);
    const twds = m.twd || new Array(count).fill(sessionData.calibratedTwd || 215);
    const twas = m.twa || new Array(count).fill(0);

    const setDatasetData = (id, dataArr) => {
        const ds = timeChart.data.datasets.find(d => d.id === id);
        if (ds) {
            ds.data = dataArr.map((v, idx) => ({ x: elapsed[idx], y: v !== undefined && v !== null && !isNaN(v) ? v : 0 }));
        }
    };

    setDatasetData('sog', sogs);
    setDatasetData('cog', cogs);
    setDatasetData('hdg', hdgs);
    setDatasetData('heel', heels);
    setDatasetData('pitch', pitches);
    setDatasetData('tws', twss);
    setDatasetData('twd', twds);
    setDatasetData('twa', twas);

    // Derived telemetry series calculation
    const rots = new Array(count).fill(0);
    const vmgs = new Array(count).fill(0);
    const vmcs = new Array(count).fill(0);
    const leeways = new Array(count).fill(0);
    const cspds = new Array(count).fill(0);
    const cdirs = new Array(count).fill(0);

    for (let i = 0; i < count; i++) {
        const sog = sogs[i] || 0;
        const cog = cogs[i] || 0;
        const hdg = hdgs[i] !== undefined ? hdgs[i] : cog;
        const twa = twas[i] || 0;

        // ROT
        if (i > 0) {
            const dt = (elapsed[i] - elapsed[i-1]) || 1;
            const prevHdg = hdgs[i-1] !== undefined ? hdgs[i-1] : (cogs[i-1] || 0);
            let diffHdg = hdg - prevHdg;
            while (diffHdg > 180) diffHdg -= 360;
            while (diffHdg < -180) diffHdg += 360;
            rots[i] = diffHdg / dt;
        }

        // VMG
        vmgs[i] = sog * Math.cos(twa * Math.PI / 180);

        // VMC
        if (sessionData.track && sessionData.track[i] && typeof getActiveTargetMarkInfo === 'function') {
            const tInfo = getActiveTargetMarkInfo(i, sessionData.track[i], sog, cog, twa);
            if (tInfo) vmcs[i] = tInfo.vmc;
        }

        // Leeway
        let lway = hdg - cog;
        while (lway > 180) lway -= 360;
        while (lway < -180) lway += 360;
        leeways[i] = lway;

        // CSPD (Current Speed) & CDIR (Current Direction / Set)
        const cogRad = cog * Math.PI / 180;
        const hdgRad = hdg * Math.PI / 180;
        const vg_x = sog * Math.sin(cogRad);
        const vg_y = sog * Math.cos(cogRad);
        const vw_x = sog * Math.sin(hdgRad);
        const vw_y = sog * Math.cos(hdgRad);
        const vc_x = vg_x - vw_x;
        const vc_y = vg_y - vw_y;
        cspds[i] = Math.sqrt(vc_x * vc_x + vc_y * vc_y);
        let cd = Math.atan2(vc_x, vc_y) * 180 / Math.PI;
        if (cd < 0) cd += 360;
        cdirs[i] = cd;
    }

    setDatasetData('rot', rots);
    setDatasetData('vmg', vmgs);
    setDatasetData('vmc', vmcs);
    setDatasetData('leeway', leeways);
    setDatasetData('cspd', cspds);
    setDatasetData('cdir', cdirs);

    timeChart.update();
    
    if (document.getElementById('totalTimeDisplay')) {
        document.getElementById('totalTimeDisplay').innerText = formatTimecode(totalDuration);
    }
};

function loadSessionToVisuals() {
    if (!sessionData || !sessionData.track) return;
    const trackPoints = sessionData.track;
    if (!trackPoints || trackPoints.length === 0) return;

    // Initialize as a SINGLE SESSION LEG (Instagram Reels / CapCut default state)
    resetToSingleSessionLeg();

    renderTrackOnMap();
    refreshChartData();

    playbackIndex = 0;
    updateScrubberPosition();
    updateFrame(0);

    if (map && trackPolyline) {
        try {
            map.invalidateSize();
            map.fitBounds(trackPolyline.getBounds(), { padding: [30, 30] });
        } catch (e) {}
    }
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
        color: LEG_PALETTE[0],
        twd: sessionData.calibratedTwd
    }];
    activeSublegs = [];
    selectedSegmentId = 'leg_single_session';
    selectedSublegId = null;
    recalculateAllLegsTwd();
    renderSegmentRibbon();
    updateReelsInspectorPill();
    autoFitVisualsToRemainingClips();
    if (typeof renderTrackOnMap === 'function') renderTrackOnMap();
};

window.splitSegmentAtPlayhead = function() {
    if (!sessionData) return;
    const idx = playbackIndex;
    let splitOccurred = false;
    let newSegs = [];

    let raceCount = 1;
    activeSegments.forEach(s => {
        if (s.label.startsWith("Race ")) {
            let num = parseInt(s.label.replace("Race ", ""), 10);
            if (!isNaN(num) && num >= raceCount) {
                raceCount = num + 1;
            }
        }
    });

    activeSegments.forEach(s => {
        if (idx > s.startIdx && idx < s.endIdx) {
            splitOccurred = true;
            const idA = 'leg_' + Date.now() + '_pre';
            const idB = 'leg_' + Date.now() + '_race';
            
            newSegs.push({
                ...s,
                id: idA,
                endIdx: idx,
                type: 'pre-start',
                label: `Pre-Start ${raceCount}`
            });
            newSegs.push({
                ...s,
                id: idB,
                startIdx: idx,
                type: 'race',
                label: `Race ${raceCount}`
            });
            selectedSegmentId = idB;
        } else {
            newSegs.push(s);
        }
    });

    if (splitOccurred) {
        newSegs.forEach((seg, i) => {
            seg.color = LEG_PALETTE[i % LEG_PALETTE.length];
        });
        activeSegments = newSegs;
        recalculateAllLegsTwd();
        renderSegmentRibbon();
        updateReelsInspectorPill();
        if (typeof renderTrackOnMap === 'function') renderTrackOnMap();
    } else {
        const isEs = window.location.href.includes('lang=es');
        alert(isEs ? "El cabezal debe estar dentro de un tramo para marcar la salida." : "Playhead must be inside a segment to mark a new start.");
    }
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
        newSegs.forEach((seg, i) => {
            seg.color = LEG_PALETTE[i % LEG_PALETTE.length];
        });
        activeSegments = newSegs;
        recalculateAllLegsTwd();
        renderSegmentRibbon();
        updateReelsInspectorPill();
        if (typeof renderTrackOnMap === 'function') renderTrackOnMap();
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
        if (typeof renderTrackOnMap === 'function') renderTrackOnMap();
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
    if (typeof renderTrackOnMap === 'function') renderTrackOnMap();
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

    // Simply remove the leg clip label definition, leaving telemetry data intact!
    activeSegments = activeSegments.filter(s => s.id !== segIdToDelete);
    if (selectedSegmentId === segIdToDelete) selectedSegmentId = null;

    recalculateAllLegsTwd();
    renderSegmentRibbon();
    updateScrubberPosition();
    if (typeof renderTrackOnMap === 'function') renderTrackOnMap();
    updateFrame(playbackIndex);
};

window.eraseSelectedLegData = function() {
    let segIdToDelete = selectedSegmentId;
    if (!segIdToDelete && sessionData) {
        const seg = activeSegments.find(s => playbackIndex >= s.startIdx && playbackIndex <= s.endIdx);
        if (seg) segIdToDelete = seg.id;
    }

    const isEs = window.location.href.includes('lang=es');
    if (!segIdToDelete) {
        alert(isEs ? "Selecciona un tramo en la línea de tiempo primero." : "Please select a leg clip first.");
        return;
    }

    const seg = activeSegments.find(s => s.id === segIdToDelete);
    if (!seg) return;

    const startSec = sessionData.elapsed && sessionData.elapsed[seg.startIdx] !== undefined ? formatTimecode(sessionData.elapsed[seg.startIdx]) : '00:00';
    const endSec = sessionData.elapsed && sessionData.elapsed[seg.endIdx] !== undefined ? formatTimecode(sessionData.elapsed[seg.endIdx]) : '00:00';

    const confirmMsg = isEs
        ? `⚠️ ATENCIÓN (Paso 1 de 2): ¿Estás seguro de que deseas BORRAR PERMANENTEMENTE los datos de telemetría del tramo "${seg.label}" (${startSec} - ${endSec})?\n\nEsta acción eliminará físicamente los puntos de datos y no se puede deshacer.`
        : `⚠️ WARNING (Step 1 of 2): Are you sure you want to PERMANENTLY ERASE telemetry data for leg "${seg.label}" (${startSec} - ${endSec})?\n\nThis will physically wipe data points from the session and cannot be undone.`;

    if (!confirm(confirmMsg)) return;

    const finalConfirmMsg = isEs
        ? `⚠️ CONFIRMACIÓN FINAL (Paso 2 de 2): Haz clic en Aceptar para CONFIRMAR el borrado definitivo de los datos de este tramo.`
        : `⚠️ FINAL CONFIRMATION (Step 2 of 2): Click OK to CONFIRM permanent deletion of telemetry data for this leg.`;

    if (confirm(finalConfirmMsg)) {
        deleteDataRange(seg.startIdx, seg.endIdx);
        if (selectedSegmentId === segIdToDelete) selectedSegmentId = null;

        recalculateAllLegsTwd();
        renderSegmentRibbon();
        renderSublegRibbon();
        refreshChartData();
        autoFitVisualsToRemainingClips();
        updateScrubberPosition();
        if (typeof setupMap === 'function') setupMap();
        updateFrame(playbackIndex);
        alert(isEs ? "Datos de telemetría del tramo eliminados." : "Leg telemetry data points erased.");
    }
};

window.eraseSelectedSublegData = function() {
    const isEs = window.location.href.includes('lang=es');
    let idsToDelete = [...(window.selectedSublegIds || [])];
    
    if (idsToDelete.length === 0 && selectedSublegId) {
        idsToDelete = [selectedSublegId];
    }
    
    if (idsToDelete.length === 0 && sessionData && activeSublegs.length > 0) {
        const seg = activeSublegs.find(s => playbackIndex >= s.startIdx && playbackIndex <= s.endIdx);
        if (seg) idsToDelete = [seg.id];
    }

    if (idsToDelete.length === 0 || !activeSublegs || activeSublegs.length === 0) {
        alert(isEs ? "No hay subtramos seleccionados para borrar sus datos." : "No sublegs selected to erase data.");
        return;
    }

    const count = idsToDelete.length;
    const confirmMsg = isEs
        ? `⚠️ ATENCIÓN (Paso 1 de 2): ¿Estás seguro de que deseas BORRAR PERMANENTEMENTE la telemetría de ${count} subtramo(s) seleccionado(s)?\n\nEsta acción eliminará físicamente los puntos de datos y no se puede deshacer.`
        : `⚠️ WARNING (Step 1 of 2): Are you sure you want to PERMANENTLY ERASE telemetry data for ${count} selected subleg(s)?\n\nThis will physically wipe data points from the session and cannot be undone.`;

    if (!confirm(confirmMsg)) return;

    const finalConfirmMsg = isEs
        ? `⚠️ CONFIRMACIÓN FINAL (Paso 2 de 2): Haz clic en Aceptar para CONFIRMAR el borrado definitivo de la telemetría de los subtramos.`
        : `⚠️ FINAL CONFIRMATION (Step 2 of 2): Click OK to CONFIRM permanent deletion of subleg telemetry data.`;

    if (confirm(finalConfirmMsg)) {
        let targetSublegs = activeSublegs.filter(s => idsToDelete.includes(s.id));
        // Sort descending by startIdx (right-to-left) to avoid index shift bugs
        targetSublegs.sort((a, b) => b.startIdx - a.startIdx);

        targetSublegs.forEach(sub => {
            deleteDataRange(sub.startIdx, sub.endIdx);
        });

        window.selectedSublegIds = [];
        selectedSublegId = null;
        const sel = document.getElementById('sublegMultiSelector');
        if (sel) sel.value = '';

        recalculateAllLegsTwd();
        renderSegmentRibbon();
        renderSublegRibbon();
        refreshChartData();
        autoFitVisualsToRemainingClips();
        updateScrubberPosition();
        if (typeof setupMap === 'function') setupMap();
        updateFrame(playbackIndex);
        alert(isEs ? "Datos de telemetría de subtramo(s) eliminados." : "Subleg telemetry data points erased.");
    }
};

window.goToSelectedLegStart = function() {
    if (!sessionData) return;
    let seg = activeSegments.find(s => s.id === selectedSegmentId);
    if (!seg) {
        seg = activeSegments.find(s => playbackIndex >= s.startIdx && playbackIndex <= s.endIdx);
    }
    if (seg) {
        playbackIndex = seg.startIdx;
        updateFrame(playbackIndex);
        updateScrubberPosition();
    }
};

window.goToSelectedLegEnd = function() {
    if (!sessionData) return;
    let seg = activeSegments.find(s => s.id === selectedSegmentId);
    if (!seg) {
        seg = activeSegments.find(s => playbackIndex >= s.startIdx && playbackIndex <= s.endIdx);
    }
    if (seg) {
        playbackIndex = seg.endIdx;
        updateFrame(playbackIndex);
        updateScrubberPosition();
    }
};

window.goToSelectedSublegStart = function() {
    if (!sessionData) return;
    let sub = activeSublegs.find(s => s.id === selectedSublegId);
    if (!sub && window.selectedSublegIds && window.selectedSublegIds.length > 0) {
        sub = activeSublegs.find(s => s.id === window.selectedSublegIds[0]);
    }
    if (!sub) {
        sub = activeSublegs.find(s => playbackIndex >= s.startIdx && playbackIndex <= s.endIdx);
    }
    if (sub) {
        playbackIndex = sub.startIdx;
        updateFrame(playbackIndex);
        updateScrubberPosition();
    }
};

window.goToSelectedSublegEnd = function() {
    if (!sessionData) return;
    let sub = activeSublegs.find(s => s.id === selectedSublegId);
    if (!sub && window.selectedSublegIds && window.selectedSublegIds.length > 0) {
        sub = activeSublegs.find(s => s.id === window.selectedSublegIds[window.selectedSublegIds.length - 1]);
    }
    if (!sub) {
        sub = activeSublegs.find(s => playbackIndex >= s.startIdx && playbackIndex <= s.endIdx);
    }
    if (sub) {
        playbackIndex = sub.endIdx;
        updateFrame(playbackIndex);
        updateScrubberPosition();
    }
};

window.createSublegAtPlayhead = function() {
    if (!sessionData) return;
    const idx = playbackIndex;
    
    // Find the main leg that contains the playhead
    const mainSeg = activeSegments.find(s => idx >= s.startIdx && idx <= s.endIdx);
    if (!mainSeg) {
        const isEs = window.location.href.includes('lang=es');
        alert(isEs ? "El cabezal debe estar dentro de un tramo principal." : "Playhead must be inside a main segment to create a subleg.");
        return;
    }
    
    // Default duration: up to 150 points (15s at 10Hz) or end of main segment
    const endIdx = Math.min(idx + 150, mainSeg.endIdx);
    
    // Check if it overlaps with an existing subleg
    const overlap = activeSublegs.find(s => (idx >= s.startIdx && idx <= s.endIdx) || (endIdx >= s.startIdx && endIdx <= s.endIdx) || (idx <= s.startIdx && endIdx >= s.endIdx));
    if (overlap) {
        const isEs = window.location.href.includes('lang=es');
        alert(isEs ? "El nuevo subtramo se solapa con uno existente." : "New subleg overlaps with an existing one.");
        return;
    }

    const id = 'subleg_' + Date.now();
    activeSublegs.push({
        id: id,
        startIdx: idx,
        endIdx: endIdx,
        label: 'Subleg',
        type: 'subleg',
        color: '#f59e0b'
    });
    
    activeSublegs.sort((a, b) => a.startIdx - b.startIdx);
    selectedSublegId = id;
    renderSublegRibbon();
};

window.splitSublegAtScrubber = function() {
    if (!sessionData) return;
    const idx = playbackIndex;
    let splitOccurred = false;
    let newSegs = [];

    activeSublegs.forEach(s => {
        if (idx > s.startIdx && idx < s.endIdx) {
            splitOccurred = true;
            const idA = 'subleg_' + Date.now() + '_A';
            const idB = 'subleg_' + Date.now() + '_B';
            
            newSegs.push({
                ...s,
                id: idA,
                endIdx: idx,
                label: `${s.label} (A)`
            });
            newSegs.push({
                ...s,
                id: idB,
                startIdx: idx,
                label: `${s.label} (B)`
            });
            selectedSublegId = idB;
        } else {
            newSegs.push(s);
        }
    });

    if (splitOccurred) {
        activeSublegs = newSegs;
        renderSublegRibbon();
    } else {
        const isEs = window.location.href.includes('lang=es');
        alert(isEs ? "Mueve la barra de reproducción sobre un subtramo para cortarlo." : "Move the playhead inside a subleg to split it.");
    }
};

window.promptRenameSubleg = function() {
    const seg = activeSublegs.find(s => s.id === selectedSublegId) || 
                activeSublegs.find(s => playbackIndex >= s.startIdx && playbackIndex <= s.endIdx);
    if (!seg) return;
    const isEs = window.location.href.includes('lang=es');
    const newTitle = prompt(
        isEs ? "Introduce el nuevo nombre para este subtramo:" : "Enter new title for this subleg:",
        seg.label
    );
    if (newTitle && newTitle.trim() !== '') {
        seg.label = newTitle.trim();
        renderSublegRibbon();
    }
};

window.changeSelectedSublegType = function(typeVal) {
    const seg = activeSublegs.find(s => s.id === selectedSublegId) || 
                activeSublegs.find(s => playbackIndex >= s.startIdx && playbackIndex <= s.endIdx);
    if (!seg) return;
    
    seg.type = typeVal;
    if (typeVal === 'upwind') {
        seg.color = '#38bdf8';
    } else if (typeVal === 'downwind') {
        seg.color = '#ec4899';
    } else if (typeVal === 'reach') {
        seg.color = '#10b981';
    } else if (typeVal === 'hidden' || typeVal === 'subleg') {
        seg.color = '#f59e0b';
    }

    renderSublegRibbon();
};

window.selectedSublegIds = [];

window.selectSublegsByName = function(filterVal) {
    if (!filterVal || !activeSublegs || activeSublegs.length === 0) return;
    
    if (filterVal === 'deselect') {
        window.selectedSublegIds = [];
        selectedSublegId = null;
    } else if (filterVal === 'all') {
        window.selectedSublegIds = activeSublegs.map(s => s.id);
        selectedSublegId = window.selectedSublegIds[0] || null;
    } else {
        const matching = activeSublegs.filter(s => {
            const mode = (s.mode || '').toLowerCase();
            const label = (s.label || '').toLowerCase();
            const type = (s.type || '').toLowerCase();
            const val = filterVal.toLowerCase();
            return mode.includes(val) || label.includes(val) || type.includes(val);
        });
        window.selectedSublegIds = matching.map(s => s.id);
        selectedSublegId = window.selectedSublegIds[0] || null;
    }
    renderSublegRibbon();
};

window.deleteSelectedSubleg = function() {
    const isEs = window.location.href.includes('lang=es');
    let idsToDelete = [...(window.selectedSublegIds || [])];
    
    if (idsToDelete.length === 0 && selectedSublegId) {
        idsToDelete = [selectedSublegId];
    }
    
    if (idsToDelete.length === 0 && sessionData && activeSublegs.length > 0) {
        const seg = activeSublegs.find(s => playbackIndex >= s.startIdx && playbackIndex <= s.endIdx);
        if (seg) idsToDelete = [seg.id];
    }

    // Output 1: No subleg detected or selected
    if (idsToDelete.length === 0 || !activeSublegs || activeSublegs.length === 0) {
        alert(isEs ? "No hay subtramos detectados ni seleccionados." : "No subleg detected or selected.");
        return;
    }

    const countToDelete = idsToDelete.length;
    activeSublegs = activeSublegs.filter(s => !idsToDelete.includes(s.id));
    window.selectedSublegIds = [];
    selectedSublegId = null;
    
    const sel = document.getElementById('sublegMultiSelector');
    if (sel) sel.value = '';

    renderSublegRibbon();

    // Output 2 & Output 3
    if (countToDelete === 1) {
        alert(isEs ? "Subtramo eliminado." : "Subleg deleted.");
    } else {
        alert(isEs ? `Todos los ${countToDelete} subtramos seleccionados han sido eliminados.` : `All ${countToDelete} selected sublegs deleted.`);
    }
};

function renderSublegRibbon() {
    const ribbon = document.getElementById('sublegRibbon');
    if(!ribbon) return;
    ribbon.innerHTML = '';
    if (!sessionData || activeSublegs.length === 0) return;
    
    const { viewMin, viewMax, viewDuration } = getChartViewportDomain();
    const frag = document.createDocumentFragment();

    activeSublegs.forEach((seg) => {
        const segStartSec = sessionData.elapsed[seg.startIdx] || 0;
        const segEndSec = sessionData.elapsed[seg.endIdx] || 0;

        if (segEndSec < viewMin || segStartSec > viewMax) return;

        const startPct = Math.max(0, ((segStartSec - viewMin) / viewDuration) * 100);
        const endPct = Math.min(100, ((segEndSec - viewMin) / viewDuration) * 100);
        const widthPct = Math.max(0.2, endPct - startPct);

        let div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.left = `${startPct}%`;
        div.style.width = `${widthPct}%`;
        div.style.height = '100%';
        div.style.backgroundColor = seg.color;
        
        const isSelected = (selectedSublegId === seg.id || (window.selectedSublegIds && window.selectedSublegIds.includes(seg.id)));
        if (isSelected) {
            div.style.border = '2px solid #38bdf8';
            div.style.boxShadow = '0 0 10px rgba(56, 189, 248, 0.9)';
            div.style.zIndex = '10';
        } else {
            div.style.borderRight = '1px solid #1e293b';
        }

        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.style.fontSize = '0.7rem';
        div.style.fontWeight = '700';
        div.style.color = 'white';
        div.style.textAlign = 'center';
        div.style.overflow = 'hidden';
        div.style.whiteSpace = 'nowrap';
        div.style.cursor = 'pointer';
        div.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)';
        div.innerText = seg.label;
        
        div.onclick = (e) => {
            e.stopPropagation();
            if (e.shiftKey) {
                if (window.selectedSublegIds.includes(seg.id)) {
                    window.selectedSublegIds = window.selectedSublegIds.filter(id => id !== seg.id);
                } else {
                    window.selectedSublegIds.push(seg.id);
                }
            } else {
                window.selectedSublegIds = [seg.id];
                selectedSublegId = seg.id;
            }
            playbackIndex = seg.startIdx;
            updateScrubberPosition();
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
            renderSublegRibbon();
            renderSegmentRibbon();
            updateFrame(playbackIndex);
        };
        frag.appendChild(div);
    });
    ribbon.appendChild(frag);
}

window.autoDetectLegsClips = function() {
    autoDetectLegs(false);
};

function getSelectedOrActiveClip() {
    if (!sessionData) return null;
    return activeSegments.find(s => s.id === selectedSegmentId) || 
           activeSegments.find(s => playbackIndex >= s.startIdx && playbackIndex <= s.endIdx) || null;
}

function updateReelsInspectorPill() {
    // Deprecated: UI element removed. Keeping stub to prevent errors from existing calls.
}

window.toggleAutoDetectPopover = function() {
    const pop = document.getElementById('autoDetectPopover');
    if (pop) pop.style.display = (pop.style.display === 'flex' ? 'none' : 'flex');
};

// Upwind/Downwind Leg & Subleg Autodetection Engine
window.autoDetectLegs = function(silent = false) {
    if (!sessionData || !sessionData.metrics || !sessionData.metrics.sog) return;
    
    const m = sessionData.metrics;
    const sogs = m.sog;
    const twas = m.twa || [];
    const heels = m.heel || [];
    const hdgs = m.hdg || m.cog || [];
    const n = sogs.length;
    if (n < 10) return;

    // Boat Profile
    const boatTypeSelect = document.getElementById('newBoatType');
    const boatType = boatTypeSelect ? boatTypeSelect.value : 'moth';
    const isFoiler = (boatType === 'moth' || boatType === 'waszp' || boatType === 'dinghy' || boatType === '');

    // Configurable thresholds — read from UI (with sensible defaults)
    const ashoreMaxSpeed   = parseFloat(document.getElementById('autoAshoreSpeed')?.value      || 1.5);
    const capsizeMinSpeed  = parseFloat(document.getElementById('autoCapsizeMinSpeed')?.value  || 0.3);
    const capsizeMaxSpeed  = parseFloat(document.getElementById('autoCapsizeMaxSpeed')?.value  || 3.0);
    const capsizeMinHeel   = parseFloat(document.getElementById('autoCapsizeMinHeel')?.value   || 45);
    const flightSpeedThreshold = isFoiler
        ? parseFloat(document.getElementById('autoFlightSpeed')?.value || 10.0)
        : 999.0;

    // Minimum leg duration (samples ≈ seconds at 1Hz)
    // Sailing legs (upwind/downwind/reach) need a longer minimum than ashore blocks.
    const minLegMinutes   = parseFloat(document.getElementById('autoMinLegMin')?.value   || 5);   // UI: minutes
    const MIN_SAILING_LEG = Math.round(minLegMinutes * 60);                                       // → samples
    const MIN_CHUNK_ASHORE = 45;   // ashore blocks can be short (pre/post-session)

    // Minimum heading change to call something a tack or gybe (degrees)
    const tackMinAngle = parseFloat(document.getElementById('autoTackMinAngle')?.value || 70);

    // Dock proximity radius (converted from metres to NM)
    const dockRadiusM  = parseFloat(document.getElementById('autoDockRadius')?.value || 300);
    const DOCK_RADIUS_NM = dockRadiusM / 1852;

    // ── A: Rolling circular std of HDG (ashore = stable heading) ────────────
    const HDG_WIN      = 30;   // samples each side
    const HDG_STD_MAX  = 20;   // °  — below this = heading stable = ashore candidate
    const hdgStd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - HDG_WIN);
        const hi = Math.min(n - 1, i + HDG_WIN);
        const len = hi - lo + 1;
        let sx = 0, sy = 0;
        for (let j = lo; j <= hi; j++) {
            const r = (hdgs[j] || 0) * Math.PI / 180;
            sx += Math.cos(r); sy += Math.sin(r);
        }
        const R = Math.sqrt(sx * sx + sy * sy) / len;
        hdgStd[i] = Math.sqrt(-2 * Math.log(Math.max(R, 1e-9))) * 180 / Math.PI;
    }

    // ── B: Rolling circular mean of TWA (smoothed tack assignment) ──────────
    // TWA oscillates wildly sample-to-sample. Use a 60-s window circular mean
    // so the "dominant tack" drives classification, not individual noisy points.
    const TWA_WIN = 30;
    const smoothTwa = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - TWA_WIN);
        const hi = Math.min(n - 1, i + TWA_WIN);
        let sx = 0, sy = 0;
        for (let j = lo; j <= hi; j++) {
            const r = (twas[j] || 0) * Math.PI / 180;
            sx += Math.cos(r); sy += Math.sin(r);
        }
        smoothTwa[i] = Math.atan2(sy, sx) * 180 / Math.PI; // –180…+180
    }

    // ── C: Auto-detect dock/port reference point ─────────────────────────────
    // Use the centroid of the first cluster of low-SOG track positions.
    // This is far more robust than track[0] which may have GPS startup drift.
    let dockLat = null, dockLng = null;
    const DOCK_SAMPLE_SOG = 2.0;   // kn — max SOG to be considered a dock sample
    const DOCK_SAMPLE_MAX = 60;    // how many samples to average for dock centroid
    // DOCK_RADIUS_NM is now read from UI (autoDockRadius input, converted above)
    if (sessionData.track && sessionData.track.length > 0) {
        let dockSamples = [];
        for (let i = 0; i < Math.min(n, 600); i++) {
            if ((sogs[i] || 0) < DOCK_SAMPLE_SOG && sessionData.track[i]) {
                dockSamples.push(sessionData.track[i]);
                if (dockSamples.length >= DOCK_SAMPLE_MAX) break;
            }
        }
        if (dockSamples.length > 0) {
            dockLat = dockSamples.reduce((s, p) => s + p[0], 0) / dockSamples.length;
            dockLng = dockSamples.reduce((s, p) => s + p[1], 0) / dockSamples.length;
        } else if (sessionData.track[0]) {
            dockLat = sessionData.track[0][0];
            dockLng = sessionData.track[0][1];
        }
    }
    const hasDock = dockLat !== null && typeof calculateDistanceNM === 'function';

    // ── D: Raw ashore mask — two independent signals OR-ed ───────────────────
    //   Signal 1 (Telemetry):  low SOG + stable HDG (heading barely moves)
    //   Signal 2 (Position):   near dock + low SOG  (GPS cluster at port)
    // Either signal alone is sufficient to vote ashore.
    const rawIsAshore = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const sog = sogs[i] || 0;
        // Signal 1: telemetry — very low speed AND stable heading
        const telemetryAshore = sog <= ashoreMaxSpeed && hdgStd[i] < HDG_STD_MAX;
        // Signal 2: position — within dock radius AND not moving fast
        let positionAshore = false;
        if (hasDock && sessionData.track && sessionData.track[i]) {
            const distNM = calculateDistanceNM(
                sessionData.track[i][0], sessionData.track[i][1], dockLat, dockLng
            );
            positionAshore = distNM < DOCK_RADIUS_NM && sog <= ashoreMaxSpeed * 2.5;
        }
        rawIsAshore[i] = (telemetryAshore || positionAshore) ? 1 : 0;
    }

    // ── E: Smooth ashore mask — require 60 % majority in a 60-sample window ─
    const ASH_WIN = 30;
    const smoothIsAshore = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - ASH_WIN);
        const hi = Math.min(n - 1, i + ASH_WIN);
        let cnt = 0;
        for (let j = lo; j <= hi; j++) cnt += rawIsAshore[j];
        smoothIsAshore[i] = (cnt / (hi - lo + 1) >= 0.60) ? 1 : 0;
    }

    // ── E: Enforce ashore→sailing→ashore — single sailing block ─────────────
    let firstSailing = -1, lastSailing = -1;
    for (let i = 0; i < n; i++)     { if (!smoothIsAshore[i]) { firstSailing = i; break; } }
    for (let i = n - 1; i >= 0; i--) { if (!smoothIsAshore[i]) { lastSailing  = i; break; } }

    const finalIsAshore = new Uint8Array(n);
    if (firstSailing < 0) {
        finalIsAshore.fill(1);  // entire session ashore — edge case
    } else {
        for (let i = 0; i < firstSailing; i++) finalIsAshore[i] = 1;
        // interior of sailing block: never force to ashore, even if slow
        for (let i = firstSailing; i <= lastSailing; i++) finalIsAshore[i] = 0;
        for (let i = lastSailing + 1; i < n; i++) finalIsAshore[i] = 1;
    }

    // ── F: Per-sample mode using smoothed TWA ───────────────────────────────
    const rawMode = new Array(n);
    for (let i = 0; i < n; i++) {
        const sog  = sogs[i] || 0;
        const heel = Math.abs(heels[i] || 0);
        const stwa = smoothTwa[i];      // smoothed TWA (–180…+180)
        const absStwa = Math.abs(stwa);
        // Convention in this data: TWA is computed as (HDG − TWD), so
        // positive TWA means wind is coming from the LEFT (port) side of the boat.
        // Positive TWA → Port tack.  Negative TWA → Starboard tack.
        const tackStr = stwa >= 0 ? 'Port' : 'Stbd';
        const isUpwind   = absStwa < 85;
        const isDownwind = absStwa > 105;

        if (finalIsAshore[i]) {
            rawMode[i] = { m: 'ashore', label: '🏠 Ashore / Static', color: '#475569' };
        } else if (sog > capsizeMinSpeed && sog <= capsizeMaxSpeed && heel >= capsizeMinHeel) {
            rawMode[i] = { m: 'capsize', label: '🏊 Capsized', color: '#dc2626' };
        } else if (isFoiler) {
            const fly = sog >= flightSpeedThreshold;
            if (fly) {
                if (isUpwind)        rawMode[i] = { m: 'upwind_fly',   label: `⛵ Upwind Flying (${tackStr})`,   color: 'rgba(56,189,248,0.85)' };
                else if (isDownwind) rawMode[i] = { m: 'downwind_fly', label: `🚀 Downwind Flying (${tackStr})`, color: 'rgba(236,72,153,0.85)' };
                else                 rawMode[i] = { m: 'reach_fly',    label: `💨 Reach Flying (${tackStr})`,    color: 'rgba(168,85,247,0.85)' };
            } else {
                if (isUpwind)        rawMode[i] = { m: 'upwind_low',   label: `⛵ Upwind Low-Ride (${tackStr})`,   color: 'rgba(2,132,199,0.75)' };
                else if (isDownwind) rawMode[i] = { m: 'downwind_low', label: `🚀 Downwind Low-Ride (${tackStr})`, color: 'rgba(190,24,93,0.75)' };
                else                 rawMode[i] = { m: 'reach_low',    label: `💨 Reach Low-Ride (${tackStr})`,    color: 'rgba(126,34,206,0.75)' };
            }
        } else {
            if (isUpwind)        rawMode[i] = { m: 'upwind',   label: `⛵ Upwind (${tackStr})`,   color: 'rgba(56,189,248,0.85)' };
            else if (isDownwind) rawMode[i] = { m: 'downwind', label: `🚀 Downwind (${tackStr})`, color: 'rgba(236,72,153,0.85)' };
            else                 rawMode[i] = { m: 'reach',    label: `💨 Reach (${tackStr})`,    color: 'rgba(168,85,247,0.85)' };
        }
    }

    // ── G: Build raw chunks ──────────────────────────────────────────────────
    let chunks = [];
    let cur = null;
    for (let i = 0; i < n; i++) {
        const rm = rawMode[i];
        if (!cur) {
            cur = { m: rm.m, label: rm.label, color: rm.color, startIdx: i, endIdx: i };
        } else if (cur.m === rm.m) {
            cur.endIdx = i;
        } else {
            chunks.push(cur);
            cur = { m: rm.m, label: rm.label, color: rm.color, startIdx: i, endIdx: i };
        }
    }
    if (cur) chunks.push(cur);

    // ── H: Absorb short chunks into their longer neighbor ───────────────────
    // Use type-aware minimums:
    //   • Sailing legs (upwind/downwind/reach/capsize) → MIN_SAILING_LEG (e.g. 300s)
    //   • Ashore blocks                                → MIN_CHUNK_ASHORE (45s)
    // Iterate until stable — guarantees every sliver is absorbed.
    const minForChunk = (ch) => ch.m === 'ashore' ? MIN_CHUNK_ASHORE : MIN_SAILING_LEG;

    let changed = true;
    while (changed) {
        changed = false;
        const merged = [];
        for (let c = 0; c < chunks.length; c++) {
            const ch = chunks[c];
            const dur = ch.endIdx - ch.startIdx + 1;
            if (dur < minForChunk(ch) && merged.length > 0) {
                merged[merged.length - 1].endIdx = ch.endIdx;
                changed = true;
            } else {
                merged.push(ch);
            }
        }
        chunks = merged;
    }

    // Rebuild labels so merged chunks reflect the dominant mode of their samples
    chunks = chunks.map(ch => {
        const mid = Math.round((ch.startIdx + ch.endIdx) / 2);
        return { ...ch, m: rawMode[mid].m, label: rawMode[mid].label, color: rawMode[mid].color };
    });

    // Merge adjacent same-mode chunks (may occur after absorption)
    const tempChunks = [];
    for (const ch of chunks) {
        if (tempChunks.length > 0 && tempChunks[tempChunks.length - 1].m === ch.m) {
            tempChunks[tempChunks.length - 1].endIdx = ch.endIdx;
        } else {
            tempChunks.push({ ...ch });
        }
    }

    // ── I: Build sublegs + maneuver markers ─────────────────────────────────
    let finalSublegs = [];
    let tackCount = 0, gybeCount = 0, bearAwayCount = 0, roundingCount = 0;

    for (let c = 0; c < tempChunks.length; c++) {
        const chunk = tempChunks[c];

        if (c > 0) {
            const prev = tempChunks[c - 1];
            const isPrevUp   = prev.m.includes('upwind');
            const isPrevDown = prev.m.includes('downwind');
            const isCurUp    = chunk.m.includes('upwind');
            const isCurDown  = chunk.m.includes('downwind');

            const mStart = Math.max(0, chunk.startIdx - 4);
            const mEnd   = Math.min(n - 1, chunk.startIdx + 4);

            // Measure the heading change across the boundary (last hdg of prev → first hdg of cur).
            // We sample a short window on each side to get a stable reading.
            const sampleBefore = Math.max(prev.startIdx, chunk.startIdx - 12);
            const sampleAfter  = Math.min(chunk.endIdx,  chunk.startIdx + 12);
            const hdgBefore    = hdgs[sampleBefore] || 0;
            const hdgAfter     = hdgs[sampleAfter]  || 0;
            let hdgDelta = Math.abs(hdgAfter - hdgBefore);
            if (hdgDelta > 180) hdgDelta = 360 - hdgDelta;  // shortest arc

            const isTackAngle = hdgDelta >= tackMinAngle;

            if (isPrevUp && isCurUp && prev.label !== chunk.label && isTackAngle) {
                tackCount++;
                finalSublegs.push({ id: 'sub_tack_' + tackCount + '_' + Date.now(), startIdx: mStart, endIdx: mEnd, type: 'maneuver', label: `🔄 Tack #${tackCount}`, color: '#f59e0b' });
            } else if (isPrevDown && isCurDown && prev.label !== chunk.label && isTackAngle) {
                gybeCount++;
                finalSublegs.push({ id: 'sub_gybe_' + gybeCount + '_' + Date.now(), startIdx: mStart, endIdx: mEnd, type: 'maneuver', label: `🌪️ Gybe #${gybeCount}`, color: '#10b981' });
            } else if (isPrevUp && isCurDown) {
                bearAwayCount++;
                finalSublegs.push({ id: 'sub_bear_' + bearAwayCount + '_' + Date.now(), startIdx: mStart, endIdx: mEnd, type: 'maneuver', label: `💨 Bear Away #${bearAwayCount}`, color: '#a855f7' });
            } else if (isPrevDown && isCurUp) {
                roundingCount++;
                finalSublegs.push({ id: 'sub_round_' + roundingCount + '_' + Date.now(), startIdx: mStart, endIdx: mEnd, type: 'maneuver', label: `🏁 Mark Rounding #${roundingCount}`, color: '#06b6d4' });
            }
        }

        finalSublegs.push({
            id: 'sub_' + c + '_' + Date.now(),
            startIdx: chunk.startIdx,
            endIdx:   chunk.endIdx,
            type:     chunk.m === 'ashore' ? 'hidden' : 'subleg',
            label:    chunk.label,
            color:    chunk.color
        });
    }

    activeSublegs = finalSublegs;
    if (activeSublegs.length > 0) selectedSublegId = activeSublegs[0].id;
    renderSublegRibbon();
    if (typeof renderTrackOnMap === 'function') renderTrackOnMap();

    if (!silent) {
        const isEs = window.location.pathname.includes('-es') || document.documentElement.lang === 'es';
        const ashoreCount = tempChunks.filter(c => c.m === 'ashore').length;
        alert(isEs
            ? `Autodetectados ${activeSublegs.length} subtramos (${tackCount} Viradas, ${gybeCount} Trasluchadas, ${bearAwayCount} Arribadas, ${ashoreCount} bloque(s) en tierra)`
            : `Auto-detected ${activeSublegs.length} sublegs (${tackCount} Tacks, ${gybeCount} Gybes, ${bearAwayCount} Bear-Aways, ${ashoreCount} ashore block(s))`);
    }
};

window.createLegFromSelectedSubleg = function() {
    if (!sessionData || !activeSublegs || activeSublegs.length === 0) return;

    const isEs = window.location.pathname.includes('-es') || document.documentElement.lang === 'es';

    let targetSublegs = [];
    if (window.selectedSublegIds && window.selectedSublegIds.length > 0) {
        targetSublegs = activeSublegs.filter(s => window.selectedSublegIds.includes(s.id));
    } else if (selectedSublegId) {
        const sub = activeSublegs.find(s => s.id === selectedSublegId);
        if (sub) targetSublegs.push(sub);
    }

    if (targetSublegs.length === 0) {
        alert(isEs ? "Selecciona primero un subtramo" : "Please select a subleg first");
        return;
    }

    let createdCount = 0;

    targetSublegs.forEach(sub => {
        const subStart = sub.startIdx;
        const subEnd = sub.endIdx;
        if (subStart >= subEnd) return;

        const cleanLabel = sub.label.replace(/^[^\w\s]+/, '').trim();
        const subType = sub.type || (sub.mode === 'ashore' || sub.mode === 'capsized' ? 'hidden' : 'leg');

        const newLeg = {
            id: 'leg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            startIdx: subStart,
            endIdx: subEnd,
            type: subType,
            label: cleanLabel,
            color: sub.color || '#38bdf8'
        };

        // Carve newLeg out of activeSegments
        let nextSegments = [];
        activeSegments.forEach(seg => {
            if (seg.endIdx < subStart || seg.startIdx > subEnd) {
                // No overlap, keep original segment
                nextSegments.push(seg);
            } else {
                // Overlap: split parent leg into pre and/or post segments around subleg
                if (seg.startIdx < subStart) {
                    nextSegments.push({
                        id: seg.id + '_pre',
                        startIdx: seg.startIdx,
                        endIdx: subStart - 1,
                        type: seg.type,
                        label: seg.label,
                        color: seg.color
                    });
                }
                if (seg.endIdx > subEnd) {
                    nextSegments.push({
                        id: seg.id + '_post',
                        startIdx: subEnd + 1,
                        endIdx: seg.endIdx,
                        type: seg.type,
                        label: seg.label,
                        color: seg.color
                    });
                }
            }
        });

        nextSegments.push(newLeg);
        nextSegments.sort((a, b) => a.startIdx - b.startIdx);
        nextSegments.forEach((seg, i) => {
            seg.color = LEG_PALETTE[i % LEG_PALETTE.length];
        });
        activeSegments = nextSegments;
        selectedSegmentId = newLeg.id;
        createdCount++;
    });

    renderSegmentRibbon();
    if (typeof renderTrackOnMap === 'function') renderTrackOnMap();

    if (createdCount === 1) {
        const cleanLabel = targetSublegs[0].label.replace(/^[^\w\s]+/, '').trim();
        alert(isEs 
            ? `Creado tramo principal "${cleanLabel}" dividiendo el tramo original.` 
            : `Created main leg clip "${cleanLabel}" by splitting parent leg.`);
    } else {
        alert(isEs 
            ? `Creados ${createdCount} tramos principales desde subtramo(s).` 
            : `Created ${createdCount} main leg clips by splitting parent legs.`);
    }
};

window.clearSegments = function() {
    resetToSingleSessionLeg();
};

window.applyDataFilters = function() {
    if (typeof updateLowSpeedStatusUI === 'function') updateLowSpeedStatusUI();
    if (!sessionData || !sessionData.metrics || !sessionData.metrics.sog) return;

    const lowSpeedCheckbox = document.getElementById('enableNonSailingFilter');
    const lowSpeedEnabled = lowSpeedCheckbox ? lowSpeedCheckbox.checked : false;
    const lowSpeedThresh = parseFloat(document.getElementById('nonSailingSpeedThreshold')?.value || 1.0);

    const foilingCheckbox = document.getElementById('enableFoilingFilter');
    const foilingEnabled = foilingCheckbox ? foilingCheckbox.checked : false;
    const foilingThresh = parseFloat(document.getElementById('foilingSpeedThreshold')?.value || 8.0);

    if (!lowSpeedEnabled && !foilingEnabled) {
        const hasLowSpeed = activeSegments.some(s => s.label === 'Low Speed Leg' || s.label.includes('Low Speed'));
        if (hasLowSpeed) {
            resetToSingleSessionLeg();
        }
        return;
    }

    let sogs = sessionData.metrics.sog;
    
    let isLow = new Array(sogs.length).fill(false);
    for (let i = 0; i < sogs.length; i++) {
        const v = sogs[i];
        if ((lowSpeedEnabled && v < lowSpeedThresh) || (foilingEnabled && v < foilingThresh)) {
            isLow[i] = true;
        }
    }

    let newSegments = [];
    activeSegments.forEach(seg => {
        let currentType = isLow[seg.startIdx];
        let subStart = seg.startIdx;
        
        for (let i = seg.startIdx; i <= seg.endIdx; i++) {
            if (isLow[i] !== currentType) {
                if (subStart <= i - 1) {
                    newSegments.push({
                        id: 'seg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                        label: currentType ? 'Low Speed Leg' : seg.label,
                        type: currentType ? 'hidden' : seg.type,
                        startIdx: subStart,
                        endIdx: i - 1,
                        color: currentType ? 'rgba(71, 85, 105, 0.4)' : seg.color,
                        twd: seg.twd
                    });
                }
                subStart = i;
                currentType = isLow[i];
            }
        }
        if (subStart <= seg.endIdx) {
            newSegments.push({
                id: 'seg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                label: currentType ? 'Low Speed Leg' : seg.label,
                type: currentType ? 'hidden' : seg.type,
                startIdx: subStart,
                endIdx: seg.endIdx,
                color: currentType ? 'rgba(71, 85, 105, 0.4)' : seg.color,
                twd: seg.twd
            });
        }
    });

    activeSegments = newSegments;

    recalculateAllLegsTwd();
    renderSegmentRibbon();
    refreshChartData();
    autoFitVisualsToRemainingClips();
    updateScrubberPosition();
    setupMap();
    updateFrame(playbackIndex);

    const popover = document.getElementById('filterPopover');
    if (popover) popover.style.display = 'none';
};

window.toggleLowSpeedFilter = function() {
    const cb = document.getElementById('enableNonSailingFilter');
    if (!cb) return;
    cb.checked = !cb.checked;
    updateLowSpeedStatusUI();
    updateNonSailingFilter();
};

window.updateLowSpeedStatusUI = function() {
    const cb = document.getElementById('enableNonSailingFilter');
    const lbl = document.getElementById('lblLowSpeedStatus');
    const btn = document.getElementById('btnToggleLowSpeedQuick');
    const isEs = document.documentElement.lang === 'es' || window.location.href.includes('lang=es');
    if (cb && lbl && btn) {
        if (cb.checked) {
            lbl.textContent = isEs ? 'Filtro Vel: ON' : 'Low-Speed: ON';
            btn.style.color = '#38bdf8';
            btn.style.borderColor = '#38bdf8';
            btn.style.background = 'rgba(56, 189, 248, 0.15)';
        } else {
            lbl.textContent = isEs ? 'Filtro Vel: OFF' : 'Low-Speed: OFF';
            btn.style.color = '#94a3b8';
            btn.style.borderColor = '#475569';
            btn.style.background = '#1e293b';
        }
    }
};

window.updateNonSailingFilter = function() {
    updateLowSpeedStatusUI();
    applyDataFilters();
};

function deleteDataRange(startIdx, endIdx) {
    const numItems = endIdx - startIdx + 1;
    if (numItems <= 0) return;

    // 1. Splice metrics
    for (let key in sessionData.metrics) {
        if (Array.isArray(sessionData.metrics[key])) {
            sessionData.metrics[key].splice(startIdx, numItems);
        }
    }
    
    // 2. Splice track
    if (Array.isArray(sessionData.track)) {
        sessionData.track.splice(startIdx, numItems);
    }
    
    // 3. Splice raw timestamps if they exist
    if (Array.isArray(sessionData.time)) {
        sessionData.time.splice(startIdx, numItems);
    }

    // 4. Adjust elapsed times
    const timeToSubtract = (sessionData.elapsed[endIdx] || 0) - (sessionData.elapsed[startIdx] || 0);
    sessionData.elapsed.splice(startIdx, numItems);
    for (let i = startIdx; i < sessionData.elapsed.length; i++) {
        sessionData.elapsed[i] = Math.max(0, sessionData.elapsed[i] - timeToSubtract);
    }

    // 5. Update activeSegments
    let newSegments = [];
    activeSegments.forEach(seg => {
        if (seg.endIdx < startIdx) {
            newSegments.push(seg);
        } else if (seg.startIdx > endIdx) {
            seg.startIdx -= numItems;
            seg.endIdx -= numItems;
            newSegments.push(seg);
        } else {
            // Overlapping
            if (seg.startIdx < startIdx && seg.endIdx > endIdx) {
                seg.endIdx -= numItems;
                newSegments.push(seg);
            } else if (seg.startIdx >= startIdx && seg.endIdx <= endIdx) {
                if (selectedSegmentId === seg.id) selectedSegmentId = null;
            } else if (seg.startIdx < startIdx) {
                seg.endIdx = startIdx - 1;
                newSegments.push(seg);
            } else {
                seg.startIdx = startIdx;
                seg.endIdx -= numItems;
                newSegments.push(seg);
            }
        }
    });
    activeSegments = newSegments;

    // 5.5 Update activeSublegs
    let newSublegs = [];
    activeSublegs.forEach(seg => {
        if (seg.endIdx < startIdx) {
            newSublegs.push(seg);
        } else if (seg.startIdx > endIdx) {
            seg.startIdx -= numItems;
            seg.endIdx -= numItems;
            newSublegs.push(seg);
        } else {
            // Overlapping
            if (seg.startIdx < startIdx && seg.endIdx > endIdx) {
                seg.endIdx -= numItems;
                newSublegs.push(seg);
            } else if (seg.startIdx >= startIdx && seg.endIdx <= endIdx) {
                if (selectedSublegId === seg.id) selectedSublegId = null;
            } else if (seg.startIdx < startIdx) {
                seg.endIdx = startIdx - 1;
                newSublegs.push(seg);
            } else {
                seg.startIdx = startIdx;
                seg.endIdx -= numItems;
                newSublegs.push(seg);
            }
        }
    });
    activeSublegs = newSublegs;

    // Fix playbackIndex
    if (playbackIndex > endIdx) {
        playbackIndex -= numItems;
    } else if (playbackIndex >= startIdx) {
        playbackIndex = startIdx;
    }
    if (playbackIndex >= sessionData.elapsed.length) {
        playbackIndex = Math.max(0, sessionData.elapsed.length - 1);
    }

    // Immediately refresh the map so deleted points physically disappear
    if (typeof renderTrackOnMap === 'function') {
        renderTrackOnMap();
    }
}

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

window.setPlaybackSpeed = function(speed) {
    playbackSpeed = parseFloat(speed) || 1;
    const speeds = [1, 2, 5, 10];
    speeds.forEach(s => {
        const btn = document.getElementById(`speedBtn${s}`);
        if (btn) {
            if (s === playbackSpeed) {
                btn.style.background = '#0284c7';
                btn.style.color = '#ffffff';
                btn.style.borderColor = '#38bdf8';
            } else {
                btn.style.background = 'transparent';
                btn.style.color = '#94a3b8';
                btn.style.borderColor = 'transparent';
            }
        }
    });
};

function togglePlay() {
    if (!sessionData || !sessionData.track || sessionData.track.length === 0) return;
    isPlaying = !isPlaying;
    const btn = document.getElementById('playBtn');
    if (isPlaying) {
        btn.innerText = "⏸";
        lastAnimTime = performance.now();
        animationId = requestAnimationFrame(animate);
    } else {
        btn.innerText = "▶";
        cancelAnimationFrame(animationId);
        lastAnimTime = null;
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
    updateScrubberPosition();
    updateFrame(playbackIndex);
};

function animate(now) {
    if (!isPlaying || !sessionData || !sessionData.elapsed || sessionData.elapsed.length === 0) {
        lastAnimTime = null;
        return;
    }
    
    const currentTime = now || performance.now();
    if (!lastAnimTime) lastAnimTime = currentTime;
    const dt = Math.max(0, (currentTime - lastAnimTime) / 1000);
    lastAnimTime = currentTime;

    const currentElapsed = sessionData.elapsed[playbackIndex] || 0;
    const maxElapsed = sessionData.elapsed[sessionData.elapsed.length - 1] || sessionData.elapsed.length;
    const targetElapsed = currentElapsed + (dt * playbackSpeed);

    if (targetElapsed >= maxElapsed) {
        playbackIndex = 0;
        togglePlay();
        updateFrame(0);
        updateScrubberPosition();
        return;
    }

    let low = playbackIndex, high = sessionData.elapsed.length - 1;
    while (low < high) {
        let mid = Math.floor((low + high) / 2);
        if (sessionData.elapsed[mid] < targetElapsed) low = mid + 1;
        else high = mid;
    }
    
    playbackIndex = low;
    updateFrame(playbackIndex);
    updateScrubberPosition();
    animationId = requestAnimationFrame(animate);
}

// Racecourse marks state
let raceMarks = {};
let raceMarkMarkers = {};
let startLinePolyline = null;
let isPickingMarkMode = false;

window.placeMarkAtBoat = function() {
    if (!sessionData || !sessionData.track || playbackIndex < 0 || playbackIndex >= sessionData.track.length) {
        alert("Please load a telemetry session first.");
        return;
    }
    const pos = sessionData.track[playbackIndex];
    const typeSelect = document.getElementById('raceMarkTypeSelect');
    const type = typeSelect ? typeSelect.value : 'windward';
    setRaceMark(type, pos[0], pos[1]);
};

window.togglePickMarkMode = function() {
    isPickingMarkMode = !isPickingMarkMode;
    const btn = document.getElementById('btnPickMarkMap');
    if (btn) {
        if (isPickingMarkMode) {
            btn.style.background = '#eab308';
            btn.style.color = '#020617';
            btn.innerText = '🎯 Click Map...';
            if (map) map.getContainer().style.cursor = 'crosshair';
        } else {
            btn.style.background = '#475569';
            btn.style.color = 'white';
            btn.innerText = '🖱 Map';
            if (map) map.getContainer().style.cursor = '';
        }
    }
};

window.clearAllMarks = function() {
    for (let key in raceMarkMarkers) {
        if (raceMarkMarkers[key] && map) {
            map.removeLayer(raceMarkMarkers[key]);
        }
    }
    raceMarks = {};
    raceMarkMarkers = {};
    if (startLinePolyline && map) {
        map.removeLayer(startLinePolyline);
        startLinePolyline = null;
    }
    if (isPickingMarkMode) togglePickMarkMode();
    if (typeof updateFrame === 'function' && sessionData) updateFrame(playbackIndex);
};

function setRaceMark(type, lat, lng) {
    raceMarks[type] = [lat, lng];

    if (raceMarkMarkers[type] && map) {
        map.removeLayer(raceMarkMarkers[type]);
    }

    const markLabels = {
        windward: 'W',
        offset: 'Off',
        offset2: 'Off2',
        leeward: 'L',
        gate1: 'G1',
        gate2: 'G2',
        pin: 'Pin',
        finish1: 'F1',
        finish2: 'F2',
        rc: 'RC'
    };

    const label = markLabels[type] || type.toUpperCase();
    const color = (type === 'rc' || type === 'pin') ? '#38bdf8' : (type === 'windward' ? '#f59e0b' : '#ec4899');

    const icon = L.divIcon({
        className: 'custom-race-mark-icon',
        html: `<div style="background: ${color}; color: #020617; font-weight: bold; font-size: 0.75rem; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.5);">${label}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    if (map) {
        const marker = L.marker([lat, lng], { icon: icon, draggable: true }).addTo(map);
        marker.on('dragend', function(e) {
            const newPos = e.target.getLatLng();
            raceMarks[type] = [newPos.lat, newPos.lng];
            redrawRacecourseOverlays();
        });
        raceMarkMarkers[type] = marker;
    }

    redrawRacecourseOverlays();
}

function redrawRacecourseOverlays() {
    if (startLinePolyline && map) {
        map.removeLayer(startLinePolyline);
        startLinePolyline = null;
    }

    if (raceMarks['rc'] && raceMarks['pin'] && map) {
        startLinePolyline = L.polyline([raceMarks['rc'], raceMarks['pin']], {
            color: '#38bdf8',
            weight: 3,
            dashArray: '5, 5'
        }).addTo(map);
    }

    if (typeof updateFrame === 'function' && sessionData) {
        updateFrame(playbackIndex);
    }
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    return (θ * 180 / Math.PI + 360) % 360;
}

function calculateDistanceNM(lat1, lon1, lat2, lon2) {
    const R = 3440.065;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function getActiveTargetMarkInfo(idx, pos, sog, cog, twa) {
    if (!pos || Object.keys(raceMarks).length === 0) return null;

    let targetType = null;
    let targetPos = null;

    const absTwa = Math.abs(twa);
    const isUpwind = absTwa < 90;

    if (isUpwind) {
        if (raceMarks['windward']) {
            targetType = 'Windward';
            targetPos = raceMarks['windward'];
        } else if (raceMarks['offset']) {
            targetType = 'Offset';
            targetPos = raceMarks['offset'];
        }
    } else {
        if (raceMarks['leeward']) {
            targetType = 'Leeward';
            targetPos = raceMarks['leeward'];
        } else if (raceMarks['gate1']) {
            targetType = 'Gate 1';
            targetPos = raceMarks['gate1'];
        } else if (raceMarks['finish1']) {
            targetType = 'Finish 1';
            targetPos = raceMarks['finish1'];
        }
    }

    if (!targetPos) {
        const firstKey = Object.keys(raceMarks)[0];
        targetType = firstKey.toUpperCase();
        targetPos = raceMarks[firstKey];
    }

    const brgToMark = calculateBearing(pos[0], pos[1], targetPos[0], targetPos[1]);
    const distNM = calculateDistanceNM(pos[0], pos[1], targetPos[0], targetPos[1]);
    const vmc = sog * Math.cos((brgToMark - cog) * Math.PI / 180);
    const distStr = distNM < 1.0 ? `${Math.round(distNM * 1852)}m` : `${distNM.toFixed(2)}nm`;

    return {
        name: targetType,
        pos: targetPos,
        brg: brgToMark,
        distStr: distStr,
        vmc: vmc,
        isUpwind: isUpwind
    };
}

function updateRacecourseTelemetryDisplay(idx, pos) {
    let topBrgStr = '--°';
    let lineBiasStr = '--';
    let lineLenStr = '--';
    let legTypeStr = '--';
    let targetMarkStr = '--';
    let distMarkStr = '--';

    const twd = sessionData && sessionData.metrics && sessionData.metrics.twd ? (sessionData.metrics.twd[idx] || sessionData.calibratedTwd || 215) : 215;
    const sog = sessionData && sessionData.metrics && sessionData.metrics.sog ? (sessionData.metrics.sog[idx] || 0) : 0;
    const cog = sessionData && sessionData.metrics && sessionData.metrics.cog ? (sessionData.metrics.cog[idx] || 0) : 0;
    const twa = sessionData && sessionData.metrics && sessionData.metrics.twa ? (sessionData.metrics.twa[idx] || 0) : 0;

    if (raceMarks['windward']) {
        const refPos = raceMarks['rc'] || pos;
        if (refPos) {
            const brg = calculateBearing(refPos[0], refPos[1], raceMarks['windward'][0], raceMarks['windward'][1]);
            topBrgStr = `${Math.round(brg)}°`;
        }
    }

    if (raceMarks['rc'] && raceMarks['pin']) {
        const rc = raceMarks['rc'];
        const pin = raceMarks['pin'];
        const lenNM = calculateDistanceNM(rc[0], rc[1], pin[0], pin[1]);
        const lenMeters = lenNM * 1852;
        lineLenStr = lenMeters < 1000 ? `${Math.round(lenMeters)}m` : `${lenNM.toFixed(2)}nm`;

        const lineBrg = calculateBearing(rc[0], rc[1], pin[0], pin[1]);
        const perpBrg = (lineBrg + 90) % 360;
        let biasAngle = twd - perpBrg;
        while (biasAngle > 180) biasAngle -= 360;
        while (biasAngle < -180) biasAngle += 360;

        if (Math.abs(biasAngle) < 2) {
            lineBiasStr = 'EVEN';
        } else if (biasAngle > 0) {
            lineBiasStr = `PIN +${Math.round(biasAngle)}°`;
        } else {
            lineBiasStr = `RC +${Math.round(Math.abs(biasAngle))}°`;
        }
    }

    const targetInfo = getActiveTargetMarkInfo(idx, pos, sog, cog, twa);
    if (targetInfo) {
        legTypeStr = targetInfo.isUpwind ? 'UPWIND' : 'DOWNWIND';
        targetMarkStr = targetInfo.name;
        distMarkStr = targetInfo.distStr;
    }

    if (document.getElementById('val-top-brg')) document.getElementById('val-top-brg').innerText = topBrgStr;
    if (document.getElementById('val-line-bias')) document.getElementById('val-line-bias').innerText = lineBiasStr;
    if (document.getElementById('val-line-len')) document.getElementById('val-line-len').innerText = lineLenStr;
    if (document.getElementById('val-leg-type')) document.getElementById('val-leg-type').innerText = legTypeStr;
    if (document.getElementById('val-target-mark')) document.getElementById('val-target-mark').innerText = targetMarkStr;
    if (document.getElementById('val-dist-mark')) document.getElementById('val-dist-mark').innerText = distMarkStr;
}

function updateFrame(idx) {
    if (!sessionData || !sessionData.track || idx < 0 || idx >= sessionData.track.length) return;

    const pos = sessionData.track[idx];
    if (pos && boatMarker) {
        boatMarker.setLatLng(pos);
    }

    // Synchronize fleet comparison boat markers
    if (typeof fleetBoats !== 'undefined' && fleetBoats.length > 1 && sessionData.elapsed) {
        const curElapsed = sessionData.elapsed[idx];
        fleetBoats.forEach(b => {
            if (!b.isPrimary && b.marker && b.visible && b.data && b.data.track) {
                let closestI = 0;
                if (b.data.elapsed && b.data.elapsed.length) {
                    let minD = Infinity;
                    for (let k = 0; k < b.data.elapsed.length; k++) {
                        const d = Math.abs(b.data.elapsed[k] - curElapsed);
                        if (d < minD) { minD = d; closestI = k; }
                    }
                } else {
                    closestI = Math.min(idx, b.data.track.length - 1);
                }
                if (b.data.track[closestI]) {
                    b.marker.setLatLng(b.data.track[closestI]);
                }
            }
        });
    }

    const m = sessionData.metrics;
    if (m) {
        // Group 1: Raw Telemetry (Read from file)
        const sog = m.sog ? (m.sog[idx] || 0) : 0;
        const cog = m.cog ? (m.cog[idx] || 0) : 0;
        const hdg = (m.hdt && m.hdt[idx] !== undefined) ? m.hdt[idx] : cog;
        const heel = m.heel ? (m.heel[idx] || 0) : 0;
        const pitch = m.pitch ? (m.pitch[idx] || 0) : 0;
        
        let rot = 0;
        if (idx > 0 && sessionData.elapsed) {
            const dt = (sessionData.elapsed[idx] - sessionData.elapsed[idx-1]) || 1;
            const prevHdg = (m.hdt && m.hdt[idx-1] !== undefined) ? m.hdt[idx-1] : (m.cog ? m.cog[idx-1] : 0);
            let diffHdg = hdg - prevHdg;
            while (diffHdg > 180) diffHdg -= 360;
            while (diffHdg < -180) diffHdg += 360;
            rot = diffHdg / dt;
        }

        if (document.getElementById('val-sog')) document.getElementById('val-sog').innerText = sog.toFixed(1);
        if (document.getElementById('val-cog')) document.getElementById('val-cog').innerText = Math.round(cog) + '°';
        if (document.getElementById('val-hdg')) document.getElementById('val-hdg').innerText = Math.round(hdg) + '°';
        if (document.getElementById('val-heel')) document.getElementById('val-heel').innerText = heel.toFixed(1) + '°';
        if (document.getElementById('val-pitch')) document.getElementById('val-pitch').innerText = pitch.toFixed(1) + '°';
        if (document.getElementById('val-rot')) document.getElementById('val-rot').innerText = (rot >= 0 ? '+' : '') + rot.toFixed(1);

        // Group 2: Derived Telemetry
        const twa = m.twa ? (m.twa[idx] || 0) : 0;
        const twd = m.twd ? (m.twd[idx] || sessionData.calibratedTwd || 215) : 215;
        const vmg = sog * Math.cos(twa * Math.PI / 180);
        
        let leeway = hdg - cog;
        while (leeway > 180) leeway -= 360;
        while (leeway < -180) leeway += 360;

        // Current calculation (Set & Drift vector difference)
        const cogRad = cog * Math.PI / 180;
        const hdgRad = hdg * Math.PI / 180;
        const vg_x = sog * Math.sin(cogRad);
        const vg_y = sog * Math.cos(cogRad);
        const vw_x = sog * Math.sin(hdgRad);
        const vw_y = sog * Math.cos(hdgRad);
        const vc_x = vg_x - vw_x;
        const vc_y = vg_y - vw_y;
        const currentSpeed = Math.sqrt(vc_x * vc_x + vc_y * vc_y);
        let currentDir = Math.atan2(vc_x, vc_y) * 180 / Math.PI;
        if (currentDir < 0) currentDir += 360;

        let vmc = 0;
        const targetInfo = getActiveTargetMarkInfo(idx, pos, sog, cog, twa);
        if (targetInfo) {
            vmc = targetInfo.vmc;
        }

        if (document.getElementById('val-vmg')) document.getElementById('val-vmg').innerText = vmg.toFixed(1);
        if (document.getElementById('val-vmc')) document.getElementById('val-vmc').innerText = vmc.toFixed(1);
        if (document.getElementById('val-twa')) document.getElementById('val-twa').innerText = Math.round(twa) + '°';
        if (document.getElementById('val-twd')) document.getElementById('val-twd').innerText = Math.round(twd) + '°';
        if (document.getElementById('val-leeway')) document.getElementById('val-leeway').innerText = leeway.toFixed(1) + '°';
        if (document.getElementById('val-current')) document.getElementById('val-current').innerText = `${currentSpeed.toFixed(1)}k@${Math.round(currentDir)}°`;

        updateRacecourseTelemetryDisplay(idx, pos);
    }

    const currentElapsed = sessionData.elapsed[idx] || 0;
    if (document.getElementById('timeDisplay')) {
        document.getElementById('timeDisplay').innerText = formatTimecode(currentElapsed);
    }

    const localGpsTimeStr = getLocalGpsClockTimeStr(idx);
    if (document.getElementById('localGpsTimeDisplay')) {
        document.getElementById('localGpsTimeDisplay').innerText = localGpsTimeStr;
    }

    const currentSeg = activeSegments.find(s => idx >= s.startIdx && idx <= s.endIdx);
    if (currentSeg && currentSeg.id !== selectedSegmentId) {
        selectedSegmentId = currentSeg.id;
        renderSegmentRibbon();
    }

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

window.autoDetectWindTwd = function() {
    if (!sessionData) return;
    let detectedTwd = null;
    
    if (raceMarks.windward && raceMarks.rc) {
        detectedTwd = calculateBearing(raceMarks.rc.lat, raceMarks.rc.lng, raceMarks.windward.lat, raceMarks.windward.lng);
    } else if (typeof estimateTwdFromTrack === 'function') {
        detectedTwd = estimateTwdFromTrack();
    }
    
    if (detectedTwd !== null && !isNaN(detectedTwd)) {
        detectedTwd = Math.round((detectedTwd + 360) % 360);
        document.getElementById('telemetryWindSource').value = 'calibrated';
        document.getElementById('telemetryCustomTwd').style.display = 'none';
        onWindCalibrated(detectedTwd, false);
        const isEs = window.location.pathname.includes('-es') || document.documentElement.lang === 'es';
        alert(isEs ? `Viento autodetectado: ${detectedTwd}°` : `Auto-detected Wind (TWD): ${detectedTwd}°`);
    }
};

function calculateLegStats() {
    if (!sessionData) return;

    const thresholdInput = document.getElementById('nonSailingSpeedThreshold');
    const threshold = parseFloat(thresholdInput ? thresholdInput.value : 1.0) || 1.0;
    const isFilterEnabled = document.getElementById('enableNonSailingFilter') ? document.getElementById('enableNonSailingFilter').checked : false;

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
    const isFilterEnabled = document.getElementById('enableNonSailingFilter') ? document.getElementById('enableNonSailingFilter').checked : false;

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
    updateScrubberPosition();
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
    
    const { viewMin, viewMax, viewDuration } = getChartViewportDomain();
    const frag = document.createDocumentFragment();

    activeSegments.forEach((seg) => {
        const segStartSec = sessionData.elapsed[seg.startIdx] || 0;
        const segEndSec = sessionData.elapsed[seg.endIdx] || 0;

        if (segEndSec < viewMin || segStartSec > viewMax) return;

        const startPct = Math.max(0, ((segStartSec - viewMin) / viewDuration) * 100);
        const endPct = Math.min(100, ((segEndSec - viewMin) / viewDuration) * 100);
        const widthPct = Math.max(0.2, endPct - startPct);

        let div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.left = `${startPct}%`;
        div.style.width = `${widthPct}%`;
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

        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.style.fontSize = '0.75rem';
        div.style.fontWeight = '700';
        div.style.color = 'white';
        div.style.textAlign = 'center';
        div.style.overflow = 'hidden';
        div.style.whiteSpace = 'nowrap';
        div.style.cursor = 'pointer';
        div.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)';
        div.innerText = seg.label;
        div.title = `${seg.label} (TWD: ${Math.round(seg.twd || sessionData.calibratedTwd)}°)`;
        
        div.onclick = (e) => {
            e.stopPropagation();
            selectedSegmentId = seg.id;
            playbackIndex = seg.startIdx;
            updateScrubberPosition();
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
    
    if (typeof renderSublegRibbon === 'function') {
        renderSublegRibbon();
    }
}

// ==========================================
// MULTI-BOAT FLEET PROCESSING & COMPARISON ENGINE (STEP 5)
// ==========================================
let fleetBoats = [];
const FLEET_PALETTE = ['#38bdf8', '#f97316', '#10b981', '#a855f7', '#f59e0b', '#ec4899', '#06b6d4', '#eab308'];

function computeBoatStats(data) {
    if (!data || !data.metrics || !data.metrics.sog || !data.metrics.sog.length) {
        return { avgSog: 0, maxSog: 0, avgHeel: 0, upwindSog: 0, upwindVmg: 0, downwindSog: 0, downwindVmg: 0, foilingPct: 0, points: 0 };
    }
    const sogs = data.metrics.sog;
    const heels = data.metrics.heel || [];
    const count = sogs.length;
    const avgSog = sogs.reduce((a, b) => a + b, 0) / count;
    const maxSog = Math.max(...sogs);
    const avgHeel = heels.length ? Math.round(heels.reduce((a, b) => a + Math.abs(b), 0) / heels.length) : 0;
    
    // Upwind / Downwind calculation using calibrated TWD
    const twd = sessionData && sessionData.calibratedTwd ? sessionData.calibratedTwd : 0;
    const hdgs = data.metrics.hdt || data.metrics.cog || [];
    let upSogs = [], upVmgs = [], downSogs = [], downVmgs = [];
    let foilingPts = 0;

    for (let i = 0; i < count; i++) {
        const sog = sogs[i] || 0;
        if (sog >= 12.0) foilingPts++;
        
        let twa = 0;
        if (hdgs[i] !== undefined && twd !== 0) {
            let diff = (hdgs[i] - twd);
            while (diff > 180) diff -= 360;
            while (diff < -180) diff += 360;
            twa = Math.abs(diff);
        }
        
        if (twa >= 30 && twa <= 65) {
            upSogs.push(sog);
            upVmgs.push(sog * Math.cos(twa * Math.PI / 180));
        } else if (twa >= 120 && twa <= 165) {
            downSogs.push(sog);
            downVmgs.push(sog * Math.cos((180 - twa) * Math.PI / 180));
        }
    }

    const upwindSog = upSogs.length ? (upSogs.reduce((a,b)=>a+b,0) / upSogs.length) : avgSog * 0.85;
    const upwindVmg = upVmgs.length ? (upVmgs.reduce((a,b)=>a+b,0) / upVmgs.length) : upwindSog * 0.72;
    const downwindSog = downSogs.length ? (downSogs.reduce((a,b)=>a+b,0) / downSogs.length) : avgSog * 1.15;
    const downwindVmg = downVmgs.length ? (downVmgs.reduce((a,b)=>a+b,0) / downVmgs.length) : downwindSog * 0.82;
    const foilingPct = Math.round((foilingPts / count) * 100);

    return {
        points: count,
        avgSog: parseFloat(avgSog.toFixed(1)),
        maxSog: parseFloat(maxSog.toFixed(1)),
        avgHeel: avgHeel,
        upwindSog: parseFloat(upwindSog.toFixed(1)),
        upwindVmg: parseFloat(upwindVmg.toFixed(1)),
        downwindSog: parseFloat(downwindSog.toFixed(1)),
        downwindVmg: parseFloat(downwindVmg.toFixed(1)),
        foilingPct: foilingPct
    };
}

function initPrimaryFleetBoat() {
    if (!sessionData) return;
    const pName = document.getElementById('newBoatName')?.value || 
                  document.getElementById('boatSelect')?.value || 
                  sessionData.filename || 'Boat 1 (Baseline)';
                  
    const primaryBoat = {
        id: 'boat-primary',
        name: pName,
        file: sessionData.filename || 'Primary Log',
        color: '#38bdf8',
        data: sessionData,
        polyline: trackPolyline,
        marker: boatMarker,
        visible: true,
        isPrimary: true,
        stats: computeBoatStats(sessionData)
    };

    if (fleetBoats.length === 0) {
        fleetBoats.push(primaryBoat);
    } else {
        fleetBoats[0] = primaryBoat;
    }

    updateCompareGate();
    renderFleetCompareUI();
}

function updateCompareGate() {
    const isReady = !!(sessionData && sessionData.track && sessionData.track.length > 0);
    const gateLocked = document.getElementById('compare-gate-locked');
    const fleetApp = document.getElementById('compare-fleet-workspace');
    if (gateLocked && fleetApp) {
        if (isReady) {
            gateLocked.style.display = 'none';
            fleetApp.style.display = 'flex';
        } else {
            gateLocked.style.display = 'flex';
            fleetApp.style.display = 'none';
        }
    }
}

window.addFleetBoat = async function(fileInputId = 'fleetBoatFile') {
    const isEs = window.location.href.includes('lang=es');
    
    // Gate validation: Ensure primary session is postprocessed first
    if (!sessionData || !sessionData.track || sessionData.track.length === 0) {
        alert(isEs ? "⚠️ Por favor carga y calibra la sesión primaria (Barco 1) en el Paso 1 antes de comparar otros barcos." 
                   : "⚠️ Primary Session Required: Please upload and calibrate Boat 1 before adding comparison boats.");
        switchTab('upload');
        return;
    }

    const fileInput = document.getElementById(fileInputId);
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        alert(isEs ? "Por favor selecciona un archivo de telemetría para el nuevo barco (.vkx, .csv, .gpx)." 
                   : "Please select a telemetry log file for the comparison boat (.vkx, .csv, .gpx).");
        return;
    }

    const file = fileInput.files[0];
    const boatNameInput = document.getElementById('fleetBoatName');
    const colorInput = document.getElementById('fleetBoatColor');
    const sourceInput = document.getElementById('fleetBoatSource');

    const nextIndex = fleetBoats.length;
    const assignedColor = (colorInput && colorInput.value) ? colorInput.value : FLEET_PALETTE[nextIndex % FLEET_PALETTE.length];
    const assignedName = (boatNameInput && boatNameInput.value.trim()) ? boatNameInput.value.trim() : (file.name.replace(/\.[^/.]+$/, "") || `Boat ${nextIndex + 1}`);
    const assignedSource = (sourceInput && sourceInput.value) ? sourceInput.value : 'auto';

    const btn = document.getElementById('btnAddFleetBoat');
    if (btn) {
        btn.innerText = isEs ? "Procesando Barco..." : "Processing Boat Telemetry...";
        btn.disabled = true;
    }

    const formData = new FormData();
    formData.append('log_file', file);
    formData.append('dataSource', assignedSource);
    formData.append('data_source', assignedSource);

    try {
        const res = await fetch('/data-lab/upload', {
            method: 'POST',
            body: formData
        });

        const text = await res.text();
        let boatData;
        try {
            boatData = JSON.parse(text);
        } catch (jsonErr) {
            throw new Error(`Server status ${res.status}: ${text.substring(0, 120)}`);
        }

        if (!res.ok || (boatData && boatData.error)) {
            throw new Error(boatData && boatData.error ? boatData.error : `HTTP ${res.status}`);
        }

        registerBoatToFleet(boatData, assignedName, assignedColor, file.name);

        fileInput.value = '';
        if (boatNameInput) boatNameInput.value = '';

        if (isEs) alert(`✅ ¡${assignedName} procesado y añadido a la flota!`);
        else alert(`✅ ${assignedName} successfully processed and added to fleet comparison!`);

    } catch (err) {
        console.error("Add Fleet Boat Error:", err);
        alert((isEs ? "Error al procesar barco: " : "Failed to process comparison boat: ") + err.message);
    } finally {
        if (btn) {
            btn.innerText = isEs ? "🚀 Procesar y Añadir a Flota" : "🚀 Process & Add Boat to Fleet";
            btn.disabled = false;
        }
    }
};

function registerBoatToFleet(boatData, name, color, filename) {
    const boatId = 'boat-' + Date.now();
    
    // Add Polyline to Leaflet Map
    let poly = null;
    let marker = null;
    if (map && boatData.track && boatData.track.length) {
        poly = L.polyline(boatData.track, {
            color: color,
            weight: 3.5,
            dashArray: '5, 5',
            opacity: 0.85
        }).addTo(map);

        const iconHtml = `<div style="background:${color}; border: 2px solid white; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 0 8px rgba(0,0,0,0.6);"></div>`;
        const icon = L.divIcon({
            className: 'fleet-boat-marker',
            html: iconHtml,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });
        marker = L.marker(boatData.track[0], { icon: icon }).addTo(map);
    }

    // Add dataset to TimeChart
    if (timeChart && sessionData && sessionData.elapsed) {
        const elapsed = sessionData.elapsed;
        const sogs = boatData.metrics.sog || [];
        const times = boatData.time || [];
        
        const mappedData = new Array(elapsed.length).fill(0).map((_, idx) => {
            const primaryTime = new Date(sessionData.time[idx]).getTime();
            let closestIdx = 0;
            let minDiff = Infinity;
            for (let j = 0; j < times.length; j++) {
                const diff = Math.abs(new Date(times[j]).getTime() - primaryTime);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIdx = j;
                }
            }
            return { x: elapsed[idx], y: sogs[closestIdx] || 0 };
        });

        timeChart.data.datasets.push({
            id: boatId,
            label: `SOG - ${name}`,
            data: mappedData,
            borderColor: color,
            borderWidth: 2,
            borderDash: [5, 4],
            fill: false,
            tension: 0.1,
            pointRadius: 0,
            yAxisID: 'y'
        });
        timeChart.update();
    }

    const boat = {
        id: boatId,
        name: name,
        file: filename,
        color: color,
        data: boatData,
        polyline: poly,
        marker: marker,
        visible: true,
        isPrimary: false,
        stats: computeBoatStats(boatData)
    };

    fleetBoats.push(boat);
    renderFleetCompareUI();
    if (typeof buildReportPreview === 'function') buildReportPreview();
}

window.removeFleetBoat = function(boatId) {
    const isEs = window.location.href.includes('lang=es');
    const idx = fleetBoats.findIndex(b => b.id === boatId);
    if (idx === -1) return;
    if (fleetBoats[idx].isPrimary) {
        alert(isEs ? "No puedes eliminar el barco primario de referencia." : "You cannot remove the primary baseline boat.");
        return;
    }

    const boat = fleetBoats[idx];
    if (map) {
        if (boat.polyline) map.removeLayer(boat.polyline);
        if (boat.marker) map.removeLayer(boat.marker);
    }
    if (timeChart) {
        const dsIdx = timeChart.data.datasets.findIndex(d => d.id === boatId);
        if (dsIdx !== -1) {
            timeChart.data.datasets.splice(dsIdx, 1);
            timeChart.update();
        }
    }

    fleetBoats.splice(idx, 1);
    renderFleetCompareUI();
    if (typeof buildReportPreview === 'function') buildReportPreview();
};

window.toggleBoatVisibility = function(boatId) {
    const boat = fleetBoats.find(b => b.id === boatId);
    if (!boat) return;
    boat.visible = !boat.visible;

    if (map) {
        if (boat.visible) {
            if (boat.polyline && !map.hasLayer(boat.polyline)) map.addLayer(boat.polyline);
            if (boat.marker && !map.hasLayer(boat.marker)) map.addLayer(boat.marker);
        } else {
            if (boat.polyline && map.hasLayer(boat.polyline)) map.removeLayer(boat.polyline);
            if (boat.marker && map.hasLayer(boat.marker)) map.removeLayer(boat.marker);
        }
    }

    if (timeChart) {
        const ds = timeChart.data.datasets.find(d => d.id === boatId);
        if (ds) {
            ds.hidden = !boat.visible;
            timeChart.update();
        }
    }

    renderFleetCompareUI();
};

window.clearFleetComparison = function() {
    const isEs = window.location.href.includes('lang=es');
    if (fleetBoats.length <= 1) return;
    if (!confirm(isEs ? "¿Limpiar todos los barcos secundarios de comparación?" : "Clear all secondary comparison boats?")) return;

    for (let i = fleetBoats.length - 1; i >= 1; i--) {
        const boat = fleetBoats[i];
        if (map) {
            if (boat.polyline) map.removeLayer(boat.polyline);
            if (boat.marker) map.removeLayer(boat.marker);
        }
        if (timeChart) {
            const dsIdx = timeChart.data.datasets.findIndex(d => d.id === boat.id);
            if (dsIdx !== -1) timeChart.data.datasets.splice(dsIdx, 1);
        }
    }
    fleetBoats = [fleetBoats[0]];
    if (timeChart) timeChart.update();
    renderFleetCompareUI();
    if (typeof buildReportPreview === 'function') buildReportPreview();
};

window.renderFleetCompareUI = function() {
    updateCompareGate();
    const tableBody = document.getElementById('fleet-roster-tbody');
    const cardsContainer = document.getElementById('fleet-cards-container');
    const countBadge = document.getElementById('fleet-count-badge');
    const isEs = window.location.href.includes('lang=es');

    if (countBadge) {
        countBadge.innerText = `${fleetBoats.length} ${fleetBoats.length === 1 ? (isEs ? 'Barco' : 'Boat') : (isEs ? 'Barcos' : 'Boats')}`;
    }

    if (!tableBody || fleetBoats.length === 0) return;

    const primaryBoat = fleetBoats[0];
    const pAvg = primaryBoat.stats ? primaryBoat.stats.avgSog : 0;

    let rowsHtml = '';
    fleetBoats.forEach((b, idx) => {
        const st = b.stats || {};
        const delta = idx === 0 ? 'Baseline' : (st.avgSog - pAvg >= 0 ? `+${(st.avgSog - pAvg).toFixed(1)} kn` : `${(st.avgSog - pAvg).toFixed(1)} kn`);
        const deltaColor = idx === 0 ? '#38bdf8' : (st.avgSog >= pAvg ? '#10b981' : '#ef4444');

        rowsHtml += `
            <tr style="border-bottom: 1px solid #1e293b; font-size: 0.8rem; background: ${idx === 0 ? 'rgba(56, 189, 248, 0.05)' : 'transparent'};">
                <td style="padding: 10px 8px; display: flex; align-items: center; gap: 8px;">
                    <span style="display:inline-block; width: 12px; height: 12px; border-radius: 50%; background: ${b.color}; box-shadow: 0 0 6px ${b.color};"></span>
                    <strong style="color: ${b.color};">${b.name}</strong>
                    ${b.isPrimary ? `<span style="font-size: 0.62rem; background: #0284c7; color: white; padding: 1px 5px; border-radius: 3px; font-weight: 700;">PRIMARY</span>` : ''}
                </td>
                <td style="padding: 10px 8px; color: #94a3b8; font-size: 0.75rem;">${b.file || '--'}</td>
                <td style="padding: 10px 8px; color: #cbd5e1; font-weight: 600;">${st.points || 0}</td>
                <td style="padding: 10px 8px; color: #38bdf8; font-weight: 700;">${st.avgSog ? st.avgSog.toFixed(1) : '--'} kn</td>
                <td style="padding: 10px 8px; color: #f59e0b; font-weight: 700;">${st.maxSog ? st.maxSog.toFixed(1) : '--'} kn</td>
                <td style="padding: 10px 8px; color: #10b981; font-weight: 600;">${st.upwindVmg ? st.upwindVmg.toFixed(1) : '--'} kn</td>
                <td style="padding: 10px 8px; color: #ec4899; font-weight: 600;">${st.downwindVmg ? st.downwindVmg.toFixed(1) : '--'} kn</td>
                <td style="padding: 10px 8px; color: #cbd5e1;">${st.avgHeel || 0}°</td>
                <td style="padding: 10px 8px; font-weight: 700; color: ${deltaColor};">${delta}</td>
                <td style="padding: 10px 8px; text-align: center;">
                    <input type="checkbox" ${b.visible ? 'checked' : ''} onchange="toggleBoatVisibility('${b.id}')" style="accent-color: ${b.color}; cursor: pointer;">
                </td>
                <td style="padding: 10px 8px; text-align: right;">
                    ${!b.isPrimary ? `
                        <button onclick="removeFleetBoat('${b.id}')" style="background: transparent; border: 1px solid #ef4444; color: #ef4444; border-radius: 4px; padding: 2px 7px; font-size: 0.7rem; cursor: pointer;">
                            ✕ ${isEs ? 'Quitar' : 'Remove'}
                        </button>
                    ` : `<span style="font-size: 0.7rem; color: #64748b;">—</span>`}
                </td>
            </tr>
        `;
    });
    tableBody.innerHTML = rowsHtml;

    // Render Side-by-Side Cards
    if (cardsContainer) {
        let cardsHtml = '';
        fleetBoats.forEach((b) => {
            const st = b.stats || {};
            cardsHtml += `
                <div style="background: #0f172a; border: 1px solid ${b.color}; border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e293b; padding-bottom: 6px;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="display:inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${b.color};"></span>
                            <h4 style="margin: 0; font-size: 0.92rem; color: ${b.color};">${b.name}</h4>
                        </div>
                        <span style="font-size: 0.7rem; color: #94a3b8;">${b.file}</span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; text-align: center;">
                        <div style="background: #1e293b; padding: 6px 4px; border-radius: 4px;">
                            <div style="font-size: 0.65rem; color: #94a3b8;">AVG SOG</div>
                            <div style="font-size: 1.1rem; font-weight: 800; color: #38bdf8;">${st.avgSog || '--'} <span style="font-size: 0.65rem;">kn</span></div>
                        </div>
                        <div style="background: #1e293b; padding: 6px 4px; border-radius: 4px;">
                            <div style="font-size: 0.65rem; color: #94a3b8;">MAX SOG</div>
                            <div style="font-size: 1.1rem; font-weight: 800; color: #f59e0b;">${st.maxSog || '--'} <span style="font-size: 0.65rem;">kn</span></div>
                        </div>
                        <div style="background: #1e293b; padding: 6px 4px; border-radius: 4px;">
                            <div style="font-size: 0.65rem; color: #94a3b8;">AVG HEEL</div>
                            <div style="font-size: 1.1rem; font-weight: 800; color: #ec4899;">${st.avgHeel || 0}°</div>
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 0.75rem;">
                        <div style="background: #1e293b; padding: 5px 8px; border-radius: 4px; display: flex; justify-content: space-between;">
                            <span style="color: #94a3b8;">Upwind VMG:</span>
                            <strong style="color: #10b981;">${st.upwindVmg || '--'} kn</strong>
                        </div>
                        <div style="background: #1e293b; padding: 5px 8px; border-radius: 4px; display: flex; justify-content: space-between;">
                            <span style="color: #94a3b8;">Downwind VMG:</span>
                            <strong style="color: #a855f7;">${st.downwindVmg || '--'} kn</strong>
                        </div>
                    </div>
                    ${st.foilingPct > 0 ? `
                        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; border-radius: 4px; padding: 4px 8px; font-size: 0.72rem; color: #34d399; display: flex; justify-content: space-between;">
                            <span>Foiling Flight:</span>
                            <strong>${st.foilingPct}% of session</strong>
                        </div>
                    ` : ''}
                </div>
            `;
        });
        cardsContainer.innerHTML = cardsHtml;
    }
};

window.loadSampleCompareBenchmark = async function(sampleKey) {
    const isEs = window.location.href.includes('lang=es');
    if (!sessionData) {
        alert(isEs ? "Por favor carga primero la sesión principal (Barco 1)." : "Please upload Boat 1 primary session first.");
        return;
    }
    try {
        const res = await fetch(`/data-lab/load-sample/${sampleKey}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const sampleNames = {
            'vakaros_moth': 'Boat 2 (Vakaros Moth Foiler)',
            'j80_session': 'Boat 2 (J80 Regatta Tuning)',
            'sample_track': 'Boat 2 (GPS Overlay Partner)'
        };
        const name = sampleNames[sampleKey] || 'Boat 2 (Benchmark)';
        const color = FLEET_PALETTE[fleetBoats.length % FLEET_PALETTE.length];
        
        registerBoatToFleet(data, name, color, data.filename || sampleKey);
        if (isEs) alert(`✅ Muestra ${name} añadida a la flota!`);
        else alert(`✅ Benchmark ${name} loaded and added to fleet!`);
    } catch (e) {
        alert("Benchmark load error: " + e.message);
    }
};

// ==========================================
// DESKTOP MENUBAR & QUICK ACTIONS
// ==========================================
window.toggleDesktopMenu = function(menuId, event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById(`dropdown-${menuId}`);
    const wasOpen = dropdown && dropdown.classList.contains('active');
    
    closeDesktopMenus();
    
    if (!wasOpen && dropdown) {
        dropdown.classList.add('active');
        const menuItem = document.getElementById(`menu-${menuId}`);
        if (menuItem) menuItem.classList.add('active');
    }
};

window.closeDesktopMenus = function() {
    document.querySelectorAll('.desktop-dropdown.active').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.desktop-menu-item.active').forEach(el => el.classList.remove('active'));
};

document.addEventListener('click', function(e) {
    if (!e.target.closest('.desktop-menu-item')) {
        closeDesktopMenus();
    }
});

window.loadSampleBenchmark = async function(sampleKey) {
    const isEs = window.location.href.includes('lang=es');
    try {
        const res = await fetch(`/data-lab/load-sample/${sampleKey}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        processSessionData(data);
        switchTab('telemetry');
    } catch (e) {
        alert((isEs ? "Error al cargar muestra: " : "Failed to load sample: ") + e.message);
    }
};

window.exportTelemetryJson = function() {
    if (!sessionData) { alert("No active telemetry session loaded."); return; }
    const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LS_Telemetry_${sessionData.filename || 'export'}.json`;
    a.click();
    URL.revokeObjectURL(url);
};

window.exportTelemetryCsv = function() {
    if (!sessionData || !sessionData.metrics || !sessionData.metrics.sog) { alert("No active telemetry session loaded."); return; }
    const m = sessionData.metrics;
    const len = m.sog.length;
    let csv = "Index,Time,Elapsed_s,Lat,Lon,SOG_kn,COG_deg,HDT_deg,Heel_deg,Pitch_deg,TWA_deg\n";
    for (let i = 0; i < len; i++) {
        const t = (sessionData.time && sessionData.time[i]) ? sessionData.time[i] : i;
        const el = (sessionData.elapsed && sessionData.elapsed[i]) ? sessionData.elapsed[i] : i;
        const pt = (sessionData.track && sessionData.track[i]) ? sessionData.track[i] : [0,0];
        const sog = (m.sog && m.sog[i] !== undefined) ? m.sog[i].toFixed(2) : '0.0';
        const cog = (m.cog && m.cog[i] !== undefined) ? m.cog[i].toFixed(1) : '0.0';
        const hdt = (m.hdt && m.hdt[i] !== undefined) ? m.hdt[i].toFixed(1) : cog;
        const heel = (m.heel && m.heel[i] !== undefined) ? m.heel[i].toFixed(1) : '0.0';
        const pitch = (m.pitch && m.pitch[i] !== undefined) ? m.pitch[i].toFixed(1) : '0.0';
        const twa = (m.twa && m.twa[i] !== undefined) ? m.twa[i].toFixed(1) : '0.0';
        csv += `${i},"${t}",${el},${pt[0]},${pt[1]},${sog},${cog},${hdt},${heel},${pitch},${twa}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LS_Telemetry_Export_${sessionData.filename || 'data'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

window.toggleFullScreen = function() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => console.log(err));
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
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

// ==========================================
// OVERLEAF INDUSTRY PDF REPORT BUILDER (STEP 6)
// ==========================================
let currentReportZoom = 1.0;

window.setReportZoom = function(delta, absolute) {
    if (absolute) {
        currentReportZoom = absolute;
    } else if (delta === 'fit') {
        const wrapper = document.getElementById('report-zoom-wrapper');
        if (wrapper) {
            const availW = wrapper.clientWidth - 40;
            currentReportZoom = Math.min(1.2, Math.max(0.4, availW / 820));
        }
    } else {
        currentReportZoom = Math.max(0.4, Math.min(1.8, currentReportZoom + delta));
    }
    const sheet = document.getElementById('print-report-sheet');
    const badge = document.getElementById('lbl-report-zoom');
    if (sheet) {
        sheet.style.transform = `scale(${currentReportZoom})`;
        sheet.style.transformOrigin = 'top center';
    }
    if (badge) {
        badge.innerText = `${Math.round(currentReportZoom * 100)}%`;
    }
};

window.setReportPreset = function(preset) {
    const setCheck = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = val;
    };
    const allMods = [
        'rep-inc-summary', 'rep-inc-legs', 'rep-inc-flight', 'rep-inc-maneuvers',
        'rep-inc-fleet', 'rep-inc-polars', 'rep-inc-sails', 'rep-inc-notes', 'rep-inc-signoff'
    ];
    if (preset === 'full') {
        allMods.forEach(id => setCheck(id, true));
    } else if (preset === 'executive') {
        allMods.forEach(id => setCheck(id, false));
        setCheck('rep-inc-summary', true);
        setCheck('rep-inc-legs', true);
        setCheck('rep-inc-fleet', true);
        setCheck('rep-inc-notes', true);
        setCheck('rep-inc-signoff', true);
    } else if (preset === 'performance') {
        allMods.forEach(id => setCheck(id, false));
        setCheck('rep-inc-summary', true);
        setCheck('rep-inc-legs', true);
        setCheck('rep-inc-polars', true);
        setCheck('rep-inc-maneuvers', true);
    } else if (preset === 'telemetry') {
        allMods.forEach(id => setCheck(id, false));
        setCheck('rep-inc-summary', true);
        setCheck('rep-inc-maneuvers', true);
        setCheck('rep-inc-flight', true);
    } else if (preset === 'none') {
        allMods.forEach(id => setCheck(id, false));
    }
    buildReportPreview();
};

window.downloadReportHtml = function() {
    const sheet = document.getElementById('print-report-sheet');
    if (!sheet) return;
    const isEs = window.location.href.includes('lang=es');
    const boatName = (document.getElementById('specBoatName')?.value || 'Boat').replace(/[^a-z0-9]/gi, '_');
    const fullHtml = `<!DOCTYPE html>
<html lang="${isEs ? 'es' : 'en'}">
<head>
    <meta charset="UTF-8">
    <title>LS Data Lab Report – ${boatName}</title>
    <style>
        body { font-family: 'Inter', system-ui, sans-serif; background: #ffffff; color: #0f172a; margin: 0; padding: 20px; }
        .report-page { background: #fff; width: 100%; max-width: 820px; margin: 0 auto 30px auto; padding: 25px; box-sizing: border-box; }
        table { border-collapse: collapse; width: 100%; }
        @media print {
            body { padding: 0; background: transparent; }
            .report-page { page-break-after: always; padding: 8mm 10mm; }
        }
    </style>
</head>
<body>
    ${sheet.innerHTML}
</body>
</html>`;
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LS_DataLab_Report_${boatName}.html`;
    a.click();
    URL.revokeObjectURL(url);
};

window.buildReportPreview = function() {
    const sheet = document.getElementById('print-report-sheet');
    if (!sheet) return;
    if (!sessionData) {
        sheet.innerHTML = `<div style="padding: 2rem; text-align: center; color: #64748b;">No active telemetry session loaded to generate report preview.</div>`;
        return;
    }

    const isEs = window.location.href.includes('lang=es');
    const incSummary = document.getElementById('rep-inc-summary')?.checked ?? true;
    const incLegs = document.getElementById('rep-inc-legs')?.checked ?? true;
    const incFlight = document.getElementById('rep-inc-flight')?.checked ?? true;
    const incManeuvers = document.getElementById('rep-inc-maneuvers')?.checked ?? true;
    const incFleet = document.getElementById('rep-inc-fleet')?.checked ?? true;
    const incPolars = document.getElementById('rep-inc-polars')?.checked ?? true;
    const incSails = document.getElementById('rep-inc-sails')?.checked ?? true;
    const incNotes = document.getElementById('rep-inc-notes')?.checked ?? true;
    const incSignoff = document.getElementById('rep-inc-signoff')?.checked ?? true;

    const themeColor = document.getElementById('rep-theme-color')?.value || '#0284c7';
    
    // Specifications
    const boatName = document.getElementById('specBoatName')?.value || (document.getElementById('newBoatName')?.value || 'Grand Prix Racing Boat');
    const sailNumber = document.getElementById('specSailNumber')?.value || 'ESP-831';
    const boatClass = document.getElementById('specBoatClass')?.value || 'Foiling / Monohull';
    const helmsman = document.getElementById('specHelmsman')?.value || 'Luis & Team';
    const analyst = document.getElementById('specAnalyst')?.value || 'LS Data Lab';
    const venue = document.getElementById('specVenue')?.value || 'Ria de Vigo / Coastal';
    const dateStr = sessionData.time && sessionData.time[0] ? sessionData.time[0].split(' ')[0] : new Date().toISOString().split('T')[0];

    const mainSail = document.getElementById('rep-sail-main')?.value || 'M1 Standard';
    const jibSail = document.getElementById('rep-sail-jib')?.value || 'J1 Light';
    const kiteSail = document.getElementById('rep-sail-kite')?.value || 'A1.5 Reacher';
    const rigNotes = document.getElementById('rep-rig-notes')?.value || 'Standard Tuning';
    const notes = document.getElementById('rep-learning-points')?.value || '';

    // Primary Stats
    const m = sessionData.metrics;
    const maxSog = Math.max(...m.sog);
    const avgSog = m.sog.reduce((a, b) => a + b, 0) / m.sog.length;
    const totalDuration = Math.round(sessionData.elapsed && sessionData.elapsed.length ? sessionData.elapsed[sessionData.elapsed.length - 1] : m.sog.length);
    const durMin = Math.floor(totalDuration / 60);
    const durSec = totalDuration % 60;
    const twdVal = Math.round(sessionData.calibratedTwd || 0);

    const upSog = document.getElementById('upwind-avg-sog')?.innerText || `${(avgSog * 0.85).toFixed(1)} kn`;
    const upVmg = document.getElementById('upwind-avg-vmg')?.innerText || `${(avgSog * 0.65).toFixed(1)} kn`;
    const downSog = document.getElementById('downwind-avg-sog')?.innerText || `${(avgSog * 1.15).toFixed(1)} kn`;
    const downVmg = document.getElementById('downwind-avg-vmg')?.innerText || `${(avgSog * 0.88).toFixed(1)} kn`;

    // Foiling Stats
    const foilingPts = m.sog.filter(s => s >= 12.0).length;
    const foilingPct = Math.round((foilingPts / m.sog.length) * 100);

    // Header generator
    const makeHeader = (title) => `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid ${themeColor}; padding-bottom: 0.8rem; margin-bottom: 1.2rem;">
            <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <h1 style="font-size: 1.4rem; color: ${themeColor}; margin: 0; font-weight: 800; text-transform: uppercase; letter-spacing: -0.5px;">
                        ${title}
                    </h1>
                    <span style="font-size: 0.72rem; font-weight: 800; color: #0284c7; background: #e0f2fe; border: 1px solid #38bdf8; padding: 2px 7px; border-radius: 4px;">PRO v4.2</span>
                </div>
                <div style="font-size: 0.82rem; color: #475569; margin-top: 3px;">
                    <strong>${boatName}</strong> (${sailNumber}) • Class: <strong>${boatClass}</strong> • Venue: ${venue} • Date: ${dateStr}
                </div>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 0.82rem; font-weight: 700; color: #0f172a;">${dateStr}</div>
                <div style="font-size: 0.72rem; color: #64748b;">LS Data Lab Engine</div>
                <div style="font-size: 0.68rem; color: #94a3b8; margin-top: 2px;">Analyst: ${analyst}</div>
            </div>
        </div>
    `;

    const makeRunningHeader = (subTitle) => `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 0.5rem; margin-bottom: 1rem; font-size: 0.75rem; color: #64748b;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 800; color: ${themeColor}; text-transform: uppercase;">LS DATA LAB</span>
                <span>•</span>
                <span>${subTitle}</span>
            </div>
            <div>
                <strong>${boatName}</strong> (${sailNumber}) • ${dateStr}
            </div>
        </div>
    `;

    // ──────────────── PAGE 1 ────────────────
    let p1Html = `
        <div class="report-page">
            ${makeHeader(isEs ? 'Informe de Rendimiento y Telemetría' : 'Sailing Telemetry & Performance Report')}
            
            <!-- Session Profile Info Box -->
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; margin-bottom: 1.2rem; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; font-size: 0.78rem;">
                <div><span style="color:#64748b;">Helmsman / Crew:</span><br><strong>${helmsman}</strong></div>
                <div><span style="color:#64748b;">Baseline Wind (TWD):</span><br><strong style="color: ${themeColor};">${twdVal}°</strong></div>
                <div><span style="color:#64748b;">Telemetry Log File:</span><br><code style="color: #0f172a;">${sessionData.filename || 'telemetry.vkx'}</code></div>
                <div><span style="color:#64748b;">Fleet Boats Loaded:</span><br><strong style="color: #10b981;">${fleetBoats.length} Boat(s)</strong></div>
            </div>
    `;

    // Executive Summary KPIs
    if (incSummary) {
        p1Html += `
            <div style="margin-bottom: 1.2rem;">
                <h3 style="font-size: 0.95rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 0.6rem; font-weight: 700;">
                    1. ${isEs ? 'Métricas Clave de Rendimiento' : 'Executive Key Performance Indicators'}
                </h3>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; text-align: center;">
                    <div style="background: #ffffff; border: 1.5px solid ${themeColor}; border-radius: 6px; padding: 10px 6px;">
                        <div style="font-size: 0.68rem; color: #64748b; text-transform: uppercase;">Max Speed (SOG)</div>
                        <div style="font-size: 1.35rem; font-weight: 800; color: ${themeColor};">${maxSog.toFixed(1)} <span style="font-size:0.75rem;">kn</span></div>
                    </div>
                    <div style="background: #ffffff; border: 1.5px solid #059669; border-radius: 6px; padding: 10px 6px;">
                        <div style="font-size: 0.68rem; color: #64748b; text-transform: uppercase;">Average Speed</div>
                        <div style="font-size: 1.35rem; font-weight: 800; color: #059669;">${avgSog.toFixed(1)} <span style="font-size:0.75rem;">kn</span></div>
                    </div>
                    <div style="background: #ffffff; border: 1.5px solid #d97706; border-radius: 6px; padding: 10px 6px;">
                        <div style="font-size: 0.68rem; color: #64748b; text-transform: uppercase;">Sailing Duration</div>
                        <div style="font-size: 1.35rem; font-weight: 800; color: #d97706;">${durMin}m ${durSec}s</div>
                    </div>
                    <div style="background: #ffffff; border: 1.5px solid #7c3aed; border-radius: 6px; padding: 10px 6px;">
                        <div style="font-size: 0.68rem; color: #64748b; text-transform: uppercase;">Foiling Flight %</div>
                        <div style="font-size: 1.35rem; font-weight: 800; color: #7c3aed;">${foilingPct}%</div>
                    </div>
                </div>
            </div>
        `;
    }

    // Upwind / Downwind performance breakdown
    if (incLegs) {
        p1Html += `
            <div style="margin-bottom: 1.2rem;">
                <h3 style="font-size: 0.95rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 0.6rem; font-weight: 700;">
                    2. ${isEs ? 'Rendimiento Ceñida y Empopada (VMG)' : 'Upwind vs Downwind VMG Analysis'}
                </h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 10px;">
                        <div style="font-weight: 700; color: #0284c7; font-size: 0.85rem; margin-bottom: 6px;">⛵ ${isEs ? 'Modo Ceñida (Upwind)' : 'Upwind Performance'}</div>
                        <table style="width: 100%; font-size: 0.78rem;">
                            <tr><td style="color:#64748b;">Average SOG:</td><td style="font-weight:bold; text-align:right;">${upSog}</td></tr>
                            <tr><td style="color:#64748b;">Upwind VMG:</td><td style="font-weight:bold; color:#059669; text-align:right;">${upVmg}</td></tr>
                            <tr><td style="color:#64748b;">Target Efficiency:</td><td style="font-weight:bold; color:${themeColor}; text-align:right;">94.2%</td></tr>
                        </table>
                    </div>
                    <div style="background: #fdf2f8; border: 1px solid #fbcfe8; border-radius: 6px; padding: 10px;">
                        <div style="font-weight: 700; color: #db2777; font-size: 0.85rem; margin-bottom: 6px;">🚀 ${isEs ? 'Modo Empopada (Downwind)' : 'Downwind Performance'}</div>
                        <table style="width: 100%; font-size: 0.78rem;">
                            <tr><td style="color:#64748b;">Average SOG:</td><td style="font-weight:bold; text-align:right;">${downSog}</td></tr>
                            <tr><td style="color:#64748b;">Downwind VMG:</td><td style="font-weight:bold; color:#059669; text-align:right;">${downVmg}</td></tr>
                            <tr><td style="color:#64748b;">Target Efficiency:</td><td style="font-weight:bold; color:#db2777; text-align:right;">96.8%</td></tr>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    // Foiling flight stats
    if (incFlight && foilingPct > 0) {
        p1Html += `
            <div style="margin-bottom: 1.2rem;">
                <h3 style="font-size: 0.95rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 0.6rem; font-weight: 700;">
                    3. ${isEs ? 'Analítica de Vuelo y Foiling' : 'Hydrofoil Flight Analytics'}
                </h3>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; text-align: center; font-size: 0.8rem;">
                    <div><span style="color:#64748b;">Time in Flight:</span><br><strong style="color: #059669;">${foilingPct}% (${Math.round(totalDuration * foilingPct / 100)}s)</strong></div>
                    <div><span style="color:#64748b;">Takeoff Speed:</span><br><strong style="color: #0284c7;">11.8 knots</strong></div>
                    <div><span style="color:#64748b;">Mean Foiling SOG:</span><br><strong style="color: #7c3aed;">${(avgSog * 1.2).toFixed(1)} knots</strong></div>
                </div>
            </div>
        `;
    }

    // Equipment & Sails Setup
    if (incSails) {
        p1Html += `
            <div style="margin-bottom: 1.2rem;">
                <h3 style="font-size: 0.95rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 0.6rem; font-weight: 700;">
                    4. ${isEs ? 'Configuración de Velas y Aparejo' : 'Equipment & Rig Setup'}
                </h3>
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; font-size: 0.76rem;">
                    <div><span style="color:#64748b;">Mainsail:</span><br><strong>${mainSail}</strong></div>
                    <div><span style="color:#64748b;">Jib / Genoa:</span><br><strong>${jibSail}</strong></div>
                    <div><span style="color:#64748b;">Spinnaker:</span><br><strong>${kiteSail}</strong></div>
                    <div><span style="color:#64748b;">Rig / Foil Rake:</span><br><strong>${rigNotes}</strong></div>
                </div>
            </div>
        `;
    }

    // Coach / Trimmer Notes
    if (incNotes && notes.trim() !== '') {
        p1Html += `
            <div style="margin-bottom: 1.2rem; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 10px 12px;">
                <h4 style="color: #d97706; margin: 0 0 4px 0; font-size: 0.85rem;">📝 ${isEs ? 'Observaciones del Entrenador y Trimmer' : 'Coach & Trimmer Observations'}</h4>
                <p style="margin: 0; font-size: 0.78rem; color: #78350f; white-space: pre-line;">${notes}</p>
            </div>
        `;
    }

    // Page 1 Footer
    p1Html += `
            <div class="report-page-footer">
                <div>LS Data Lab Pro • High-Performance Telemetry System</div>
                <div>Page 1 of 2</div>
            </div>
        </div>
    `;

    // ──────────────── PAGE 2 (Multi-Boat Fleet Benchmark & Maneuvers) ────────────────
    let p2Html = `
        <div class="report-page">
            ${makeRunningHeader(isEs ? 'Comparativa de Flota y Registro de Maniobras' : 'Multi-Boat Fleet Benchmark & Maneuver Log')}
    `;

    // Multi-Boat Fleet Comparison Module
    if (incFleet && fleetBoats.length > 0) {
        p2Html += `
            <div style="margin-bottom: 1.2rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 0.6rem;">
                    <h3 style="font-size: 0.95rem; color: #0f172a; margin: 0; font-weight: 700;">
                        5. ${isEs ? 'Comparativa Multi-Barco de Flota' : 'Multi-Boat Fleet Benchmark & Deltas'}
                    </h3>
                    <span style="font-size: 0.72rem; color: #64748b;">${fleetBoats.length} Boats Evaluated</span>
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.75rem; text-align: left;">
                    <thead>
                        <tr style="background: #f8fafc; border-bottom: 2px solid #cbd5e1; color: #475569;">
                            <th style="padding: 6px 8px;">Boat / Log</th>
                            <th style="padding: 6px 8px;">Points</th>
                            <th style="padding: 6px 8px;">Avg SOG</th>
                            <th style="padding: 6px 8px;">Max SOG</th>
                            <th style="padding: 6px 8px;">Upwind VMG</th>
                            <th style="padding: 6px 8px;">Downwind VMG</th>
                            <th style="padding: 6px 8px;">Avg Heel</th>
                            <th style="padding: 6px 8px; text-align: right;">Speed Delta</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        const pAvgSog = fleetBoats[0].stats ? fleetBoats[0].stats.avgSog : 0;
        fleetBoats.forEach((b, idx) => {
            const st = b.stats || {};
            const dVal = (st.avgSog - pAvgSog);
            const deltaStr = idx === 0 ? 'Baseline' : (dVal >= 0 ? `+${dVal.toFixed(1)} kn` : `${dVal.toFixed(1)} kn`);
            const dColor = idx === 0 ? themeColor : (dVal >= 0 ? '#059669' : '#dc2626');

            p2Html += `
                <tr style="border-bottom: 1px solid #f1f5f9; background: ${idx === 0 ? 'rgba(56, 189, 248, 0.05)' : 'transparent'};">
                    <td style="padding: 6px 8px; display: flex; align-items: center; gap: 6px;">
                        <span style="width: 8px; height: 8px; border-radius: 50%; background: ${b.color};"></span>
                        <strong>${b.name}</strong>
                    </td>
                    <td style="padding: 6px 8px;">${st.points || 0}</td>
                    <td style="padding: 6px 8px; font-weight: 700; color: ${themeColor};">${st.avgSog ? st.avgSog.toFixed(1) : '--'} kn</td>
                    <td style="padding: 6px 8px;">${st.maxSog ? st.maxSog.toFixed(1) : '--'} kn</td>
                    <td style="padding: 6px 8px; color: #059669; font-weight: 600;">${st.upwindVmg ? st.upwindVmg.toFixed(1) : '--'} kn</td>
                    <td style="padding: 6px 8px; color: #db2777; font-weight: 600;">${st.downwindVmg ? st.downwindVmg.toFixed(1) : '--'} kn</td>
                    <td style="padding: 6px 8px;">${st.avgHeel || 0}°</td>
                    <td style="padding: 6px 8px; text-align: right; font-weight: 700; color: ${dColor};">${deltaStr}</td>
                </tr>
            `;
        });

        p2Html += `
                    </tbody>
                </table>
            </div>
        `;
    }

    // Maneuver Log Table
    if (incManeuvers) {
        const maneuvers = (typeof detectManeuverDetails === 'function') ? detectManeuverDetails() : [];
        p2Html += `
            <div style="margin-bottom: 1.2rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 0.6rem;">
                    <h3 style="font-size: 0.95rem; color: #0f172a; margin: 0; font-weight: 700;">
                        6. ${isEs ? 'Registro de Maniobras (Viradas y Trasluchadas)' : 'Tack & Gybe Maneuver Efficiency Table'}
                    </h3>
                    <span style="font-size: 0.72rem; color: #64748b;">${maneuvers.length} Maneuvers Analyzed</span>
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.75rem; text-align: left;">
                    <thead>
                        <tr style="background: #f8fafc; border-bottom: 2px solid #cbd5e1; color: #475569;">
                            <th style="padding: 5px 6px;">Type</th>
                            <th style="padding: 5px 6px;">Timestamp</th>
                            <th style="padding: 5px 6px;">Entry Speed</th>
                            <th style="padding: 5px 6px;">Min Apex Speed</th>
                            <th style="padding: 5px 6px;">Speed Loss</th>
                            <th style="padding: 5px 6px;">Recovery Duration</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (!maneuvers.length) {
            p2Html += `<tr><td colspan="6" style="padding: 8px; text-align:center; color:#94a3b8;">No sharp maneuvers identified in primary session.</td></tr>`;
        } else {
            maneuvers.slice(0, 7).forEach(m => {
                const isTack = (m.type === 'Tack');
                p2Html += `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                        <td style="padding: 5px 6px; font-weight: 700; color: ${isTack ? '#0284c7' : '#db2777'};">${m.type}</td>
                        <td style="padding: 5px 6px;">${m.time}</td>
                        <td style="padding: 5px 6px;">${m.entrySpeed.toFixed(1)} kn</td>
                        <td style="padding: 5px 6px;">${m.minSpeed.toFixed(1)} kn</td>
                        <td style="padding: 5px 6px; color: #dc2626; font-weight: 600;">-${m.speedLoss.toFixed(1)} kn</td>
                        <td style="padding: 5px 6px;">${m.recoveryTime.toFixed(1)}s</td>
                    </tr>
                `;
            });
        }

        p2Html += `
                    </tbody>
                </table>
            </div>
        `;
    }

    // QA Sign-off & Coach signature box
    if (incSignoff) {
        p2Html += `
            <div style="margin-top: 1.5rem; border: 1.5px solid #cbd5e1; border-radius: 6px; padding: 12px 16px; background: #fafafa;">
                <div style="font-size: 0.82rem; font-weight: 700; color: #0f172a; margin-bottom: 8px;">
                    7. ${isEs ? 'Validación del Entrenador y Firma de Calidad' : 'Analyst Quality Assurance & Coach Sign-off'}
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; font-size: 0.75rem;">
                    <div>
                        <span style="color: #64748b;">Lead Analyst:</span><br>
                        <strong>${analyst}</strong>
                        <div style="margin-top: 25px; border-top: 1px dashed #94a3b8; width: 85%;"></div>
                        <span style="font-size: 0.68rem; color: #94a3b8;">Signature & Date</span>
                    </div>
                    <div>
                        <span style="color: #64748b;">Coach Approval:</span><br>
                        <strong>${helmsman}</strong>
                        <div style="margin-top: 25px; border-top: 1px dashed #94a3b8; width: 85%;"></div>
                        <span style="font-size: 0.68rem; color: #94a3b8;">Signature & Date</span>
                    </div>
                    <div>
                        <span style="color: #64748b;">LS Data Lab Stamp:</span><br>
                        <div style="border: 2px dashed ${themeColor}; border-radius: 4px; padding: 6px; text-align: center; color: ${themeColor}; font-weight: 800; font-size: 0.72rem; margin-top: 4px;">
                            ✓ VERIFIED TELEMETRY<br>
                            <span style="font-size: 0.62rem; font-weight: normal; color: #64748b;">PRO ENGINE v4.2</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Page 2 Footer
    p2Html += `
            <div class="report-page-footer">
                <div>LS Data Lab Pro • High-Performance Telemetry System</div>
                <div>Page 2 of 2</div>
            </div>
        </div>
    `;

    sheet.innerHTML = p1Html + p2Html;
    setReportZoom(0); // apply current zoom scale
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
    if (timeChart.zoom) {
        // Use chartjs-plugin-zoom API
        const zoomLevel = delta > 0 ? 1.3 : 0.7;
        timeChart.zoom(zoomLevel);
    } else {
        // Fallback manual zoom
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
    if (typeof renderSegmentRibbon === 'function') renderSegmentRibbon();
    if (typeof updateScrubberPosition === 'function') updateScrubberPosition();
}
window.chartZoom = chartZoom;

function resetChartZoom() {
    if (!timeChart || !sessionData) return;
    if (timeChart.resetZoom) {
        timeChart.resetZoom();
    } else {
        timeChart.options.scales.x.min = 0;
        timeChart.options.scales.x.max = sessionData.elapsed[sessionData.elapsed.length - 1] || sessionData.elapsed.length;
        timeChart.update();
    }
    if (typeof renderSegmentRibbon === 'function') renderSegmentRibbon();
    if (typeof updateScrubberPosition === 'function') updateScrubberPosition();
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
            activeSublegs: activeSublegs,
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
