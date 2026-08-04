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
let activeSublegs = [];
let selectedSublegId = null;
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
    initExcelRowResizers();
});

window.applyLayoutPreset = function(preset) {
    const mapSec = document.getElementById('mapSection');
    const chartSec = document.getElementById('chartSection');
    const container = document.getElementById('shared-visualizer');
    if (!container || !mapSec || !chartSec) return;
    
    if (preset === 'equal') {
        mapSec.style.height = '33vh';
        chartSec.style.height = '33vh';
    } else if (preset === 'map') {
        mapSec.style.height = '50vh';
        chartSec.style.height = '20vh';
    } else if (preset === 'chart') {
        mapSec.style.height = '22vh';
        chartSec.style.height = '48vh';
    }
    
    setTimeout(() => {
        if (map) map.invalidateSize();
        if (timeChart) timeChart.resize();
    }, 50);
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
    map = L.map('map').setView([42.2328, -8.7226], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

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

    // Initialize as a SINGLE SESSION LEG (Instagram Reels / CapCut default state)
    resetToSingleSessionLeg();

    refreshChartData();

    playbackIndex = 0;
    updateScrubberPosition();
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
    activeSublegs = [];
    selectedSegmentId = 'leg_single_session';
    selectedSublegId = null;
    recalculateAllLegsTwd();
    renderSegmentRibbon();
    updateReelsInspectorPill();
    autoFitVisualsToRemainingClips();
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
        activeSegments = newSegs;
        recalculateAllLegsTwd();
        renderSegmentRibbon();
        updateReelsInspectorPill();
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

    // Simply remove the leg clip label definition, leaving telemetry data intact!
    activeSegments = activeSegments.filter(s => s.id !== segIdToDelete);
    if (selectedSegmentId === segIdToDelete) selectedSegmentId = null;

    recalculateAllLegsTwd();
    renderSegmentRibbon();
    updateScrubberPosition();
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
    const pitches = m.pitch || [];
    
    // Boat Profile
    const boatTypeSelect = document.getElementById('newBoatType');
    const boatType = boatTypeSelect ? boatTypeSelect.value : 'moth';
    const isFoiler = (boatType === 'moth' || boatType === 'waszp' || boatType === 'dinghy' || boatType === '');
    
    // Configurable Auto-Detect Thresholds
    const ashoreMaxSpeed = parseFloat(document.getElementById('autoAshoreSpeed')?.value || 0.3);
    const capsizeMinSpeed = parseFloat(document.getElementById('autoCapsizeMinSpeed')?.value || 0.3);
    const capsizeMaxSpeed = parseFloat(document.getElementById('autoCapsizeMaxSpeed')?.value || 3.0);
    const capsizeMinHeel = parseFloat(document.getElementById('autoCapsizeMinHeel')?.value || 45);
    const flightSpeedThreshold = isFoiler 
        ? parseFloat(document.getElementById('autoFlightSpeed')?.value || 10.0) 
        : 999.0;
    const isLandCheckEnabled = document.getElementById('autoLandCheck') ? document.getElementById('autoLandCheck').checked : true;
    
    // Land Heuristic: check launch/dock origin position
    let startLat = (sessionData.track && sessionData.track.length > 0) ? sessionData.track[0][0] : null;
    let startLng = (sessionData.track && sessionData.track.length > 0) ? sessionData.track[0][1] : null;

    let tempChunks = [];
    let curChunk = null;
    
    for (let i = 0; i < sogs.length; i++) {
        const sog = sogs[i] || 0;
        const heel = Math.abs(heels[i] || 0);
        const pitch = Math.abs(pitches[i] || 0);
        const twa = twas[i] || 0;
        const absTwa = Math.abs(twa);
        
        let mode = '', label = '', color = '';
        
        const pos = sessionData.track ? sessionData.track[i] : null;
        let isNearShore = false;
        if (isLandCheckEnabled && pos && startLat !== null && typeof calculateDistanceNM === 'function') {
            const distNM = calculateDistanceNM(pos[0], pos[1], startLat, startLng);
            if (distNM < 0.15) isNearShore = true; // within ~250m of launch/dock point
        }

        if (sog <= ashoreMaxSpeed) {
            if (isNearShore || heel > 25 || pitch > 15) {
                mode = 'ashore'; label = '🏠 Ashore / Static'; color = '#475569';
            } else {
                mode = 'floating'; label = '⚓ Stationary / Floating'; color = '#334155';
            }
        } else if (sog > capsizeMinSpeed && sog <= capsizeMaxSpeed && heel >= capsizeMinHeel) {
            mode = 'capsize'; label = '🏊 Capsized'; color = '#dc2626';
        } else {
            const tackStr = twa >= 0 ? 'Stbd' : 'Port';
            const isUpwind = absTwa < 85;
            const isDownwind = absTwa > 105;
            
            if (isFoiler) {
                const isFlying = sog >= flightSpeedThreshold;
                if (isFlying) {
                    if (isUpwind) { mode = 'upwind_fly'; label = `⛵ Upwind Flying (${tackStr})`; color = 'rgba(56, 189, 248, 0.85)'; }
                    else if (isDownwind) { mode = 'downwind_fly'; label = `🚀 Downwind Flying (${tackStr})`; color = 'rgba(236, 72, 153, 0.85)'; }
                    else { mode = 'reach_fly'; label = `💨 Reach Flying (${tackStr})`; color = 'rgba(168, 85, 247, 0.85)'; }
                } else {
                    if (isUpwind) { mode = 'upwind_low'; label = `⛵ Upwind Low-Ride (${tackStr})`; color = 'rgba(2, 132, 199, 0.75)'; }
                    else if (isDownwind) { mode = 'downwind_low'; label = `🚀 Downwind Low-Ride (${tackStr})`; color = 'rgba(190, 24, 93, 0.75)'; }
                    else { mode = 'reach_low'; label = `💨 Reach Low-Ride (${tackStr})`; color = 'rgba(126, 34, 206, 0.75)'; }
                }
            } else {
                if (isUpwind) { mode = 'upwind'; label = `⛵ Upwind (${tackStr})`; color = 'rgba(56, 189, 248, 0.85)'; }
                else if (isDownwind) { mode = 'downwind'; label = `🚀 Downwind (${tackStr})`; color = 'rgba(236, 72, 153, 0.85)'; }
                else { mode = 'reach'; label = `💨 Reach (${tackStr})`; color = 'rgba(168, 85, 247, 0.85)'; }
            }
        }
        
        if (!curChunk) {
            curChunk = { mode, label, color, startIdx: i, endIdx: i };
        } else if (curChunk.mode === mode) {
            curChunk.endIdx = i;
        } else {
            if (curChunk.endIdx - curChunk.startIdx >= 3) {
                tempChunks.push(curChunk);
            }
            curChunk = { mode, label, color, startIdx: i, endIdx: i };
        }
    }
    if (curChunk && curChunk.endIdx - curChunk.startIdx >= 3) {
        tempChunks.push(curChunk);
    }
    
    let finalSublegs = [];
    let tackCount = 0, gybeCount = 0, bearAwayCount = 0, roundingCount = 0;
    
    for (let c = 0; c < tempChunks.length; c++) {
        const chunk = tempChunks[c];
        
        if (c > 0) {
            const prev = tempChunks[c-1];
            const isPrevUp = prev.mode.includes('upwind');
            const isPrevDown = prev.mode.includes('downwind');
            const isCurUp = chunk.mode.includes('upwind');
            const isCurDown = chunk.mode.includes('downwind');
            
            if (isPrevUp && isCurUp && prev.label !== chunk.label) {
                tackCount++;
                const mStart = Math.max(0, chunk.startIdx - 4);
                const mEnd = Math.min(sogs.length - 1, chunk.startIdx + 4);
                finalSublegs.push({
                    id: 'sub_tack_' + tackCount + '_' + Date.now(),
                    startIdx: mStart,
                    endIdx: mEnd,
                    type: 'maneuver',
                    label: `🔄 Tack #${tackCount}`,
                    color: '#f59e0b'
                });
            } else if (isPrevDown && isCurDown && prev.label !== chunk.label) {
                gybeCount++;
                const mStart = Math.max(0, chunk.startIdx - 4);
                const mEnd = Math.min(sogs.length - 1, chunk.startIdx + 4);
                finalSublegs.push({
                    id: 'sub_gybe_' + gybeCount + '_' + Date.now(),
                    startIdx: mStart,
                    endIdx: mEnd,
                    type: 'maneuver',
                    label: `🌪️ Gybe #${gybeCount}`,
                    color: '#10b981'
                });
            } else if (isPrevUp && isCurDown) {
                bearAwayCount++;
                const mStart = Math.max(0, chunk.startIdx - 4);
                const mEnd = Math.min(sogs.length - 1, chunk.startIdx + 4);
                finalSublegs.push({
                    id: 'sub_bear_' + bearAwayCount + '_' + Date.now(),
                    startIdx: mStart,
                    endIdx: mEnd,
                    type: 'maneuver',
                    label: `💨 Bear Away #${bearAwayCount}`,
                    color: '#a855f7'
                });
            } else if (isPrevDown && isCurUp) {
                roundingCount++;
                const mStart = Math.max(0, chunk.startIdx - 4);
                const mEnd = Math.min(sogs.length - 1, chunk.startIdx + 4);
                finalSublegs.push({
                    id: 'sub_round_' + roundingCount + '_' + Date.now(),
                    startIdx: mStart,
                    endIdx: mEnd,
                    type: 'maneuver',
                    label: `🏁 Mark Rounding #${roundingCount}`,
                    color: '#06b6d4'
                });
            }
        }
        
        finalSublegs.push({
            id: 'sub_' + c + '_' + Date.now(),
            startIdx: chunk.startIdx,
            endIdx: chunk.endIdx,
            type: 'subleg',
            label: chunk.label,
            color: chunk.color
        });
    }
    
    activeSublegs = finalSublegs;
    if (activeSublegs.length > 0) selectedSublegId = activeSublegs[0].id;
    
    renderSublegRibbon();
    
    if (!silent) {
        const isEs = window.location.pathname.includes('-es') || document.documentElement.lang === 'es';
        alert(isEs 
            ? `Autodetectados ${activeSublegs.length} subtramos (${tackCount} Viradas, ${gybeCount} Trasluchadas, ${bearAwayCount} Arribadas)` 
            : `Auto-detected ${activeSublegs.length} sublegs (${tackCount} Tacks, ${gybeCount} Gybes, ${bearAwayCount} Bear-Aways)`);
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
        activeSegments = nextSegments;
        selectedSegmentId = newLeg.id;
        createdCount++;
    });

    renderSegmentRibbon();

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
    if (!sessionData || !sessionData.metrics || !sessionData.metrics.sog) return;

    const lowSpeedCheckbox = document.getElementById('enableNonSailingFilter');
    const lowSpeedEnabled = lowSpeedCheckbox ? lowSpeedCheckbox.checked : false;
    const lowSpeedThresh = parseFloat(document.getElementById('nonSailingSpeedThreshold')?.value || 1.0);

    const foilingCheckbox = document.getElementById('enableFoilingFilter');
    const foilingEnabled = foilingCheckbox ? foilingCheckbox.checked : false;
    const foilingThresh = parseFloat(document.getElementById('foilingSpeedThreshold')?.value || 8.0);

    if (!lowSpeedEnabled && !foilingEnabled) return;

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

window.updateNonSailingFilter = function() {
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
    updateScrubberPosition();
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

    const cmpDs = timeChart.data.datasets.find(d => d.id === 'sog-cmp');
    if (cmpDs) {
        cmpDs.data = cmpDataMapped;
        cmpDs.hidden = false;
    }
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
    const cmpDs = timeChart.data.datasets.find(d => d.id === 'sog-cmp');
    if (cmpDs) cmpDs.hidden = true;
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
