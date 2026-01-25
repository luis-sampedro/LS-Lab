
// LS Current App - Web Logic

const state = {
    isDrifting: false,
    startTime: null,
    startPos: null,
    currentPos: null,
    driftDuration: 60, // seconds
    timerInterval: null,
    marks: JSON.parse(localStorage.getItem('lsc_marks') || '[]'),
    lastVector: JSON.parse(localStorage.getItem('lsc_last_vector') || '{}')
};

// Math Helpers
function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }

function calcDistance(grid1, grid2) {
    // Haversine
    const R = 6371e3; // metres
    const φ1 = toRad(grid1.lat);
    const φ2 = toRad(grid2.lat);
    const Δφ = toRad(grid2.lat - grid1.lat);
    const Δλ = toRad(grid2.lon - grid1.lon);

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function calcBearing(grid1, grid2) {
    const y = Math.sin(toRad(grid2.lon - grid1.lon)) * Math.cos(toRad(grid2.lat));
    const x = Math.cos(toRad(grid1.lat)) * Math.sin(toRad(grid2.lat)) -
        Math.sin(toRad(grid1.lat)) * Math.cos(toRad(grid2.lat)) * Math.cos(toRad(grid2.lon - grid1.lon));
    const brng = toDeg(Math.atan2(y, x));
    return (brng + 360) % 360;
}

// App Logic
function toggleDrift() {
    if (state.isDrifting) {
        stopDrift();
    } else {
        startDrift();
    }
}

function startDrift() {
    if (!navigator.geolocation) { alert("Geolocation not supported"); return; }

    // Get high accuracy start
    navigator.geolocation.getCurrentPosition(pos => {
        state.isDrifting = true;
        state.startTime = Date.now();
        state.startPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };

        // Update UI
        document.getElementById('driftBtn').innerText = "Stop Drift";
        document.getElementById('driftBtn').classList.add('danger');

        // Start Timer
        state.timerInterval = setInterval(updateTimer, 1000);

    }, err => {
        alert("GPS Error: " + err.message);
    }, { enableHighAccuracy: true });
}

function stopDrift() {
    if (!state.isDrifting) return;

    navigator.geolocation.getCurrentPosition(pos => {
        const endPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const durationSec = (Date.now() - state.startTime) / 1000;

        // Calc Vector
        const distMeters = calcDistance(state.startPos, endPos);
        const speedKnots = (distMeters / durationSec) * 1.94384;
        const bearing = calcBearing(state.startPos, endPos);

        // Update State
        state.lastVector = { speed: speedKnots, direction: bearing, time: new Date().toISOString() };
        localStorage.setItem('lsc_last_vector', JSON.stringify(state.lastVector));

        // Reset
        clearInterval(state.timerInterval);
        state.isDrifting = false;

        // Update UI
        document.getElementById('driftBtn').innerText = "Start Drift";
        document.getElementById('driftBtn').classList.remove('danger');
        document.getElementById('timer').innerText = "00:00";

        renderResults();

    }, err => { alert("GPS Error on Stop: " + err.message); }, { enableHighAccuracy: true });
}

function updateTimer() {
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    const remaining = state.driftDuration - elapsed; // Count up or down? Traditionally fixed duration. 
    // Let's just show elapsed for flexibility or count towards 60
    document.getElementById('timer').innerText = `00:${elapsed.toString().padStart(2, '0')}`;
}

// Marks Logic
function addMark() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
        const newMark = {
            id: Date.now(),
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            time: new Date().toISOString()
        };
        state.marks.unshift(newMark); // Add to top
        localStorage.setItem('lsc_marks', JSON.stringify(state.marks));
        renderMarks();
    });
}

function deleteMark(id) {
    state.marks = state.marks.filter(m => m.id !== id);
    localStorage.setItem('lsc_marks', JSON.stringify(state.marks));
    renderMarks();
}

// Rendering
function renderResults() {
    const { speed, direction } = state.lastVector;
    if (speed !== undefined) {
        document.getElementById('val-drift-speed').innerText = speed.toFixed(2);
        document.getElementById('val-drift-dir').innerText = Math.round(direction).toString().padStart(3, '0');

        // Update Arrow
        const arrow = document.getElementById('currentArrow');
        if (arrow) arrow.style.transform = `rotate(${direction}deg)`;
    }
}

function renderMarks() {
    const list = document.getElementById('marksList');
    if (!list) return;
    list.innerHTML = '';

    state.marks.forEach(m => {
        const el = document.createElement('div');
        el.className = 'mark-item';
        el.innerHTML = `
            <div>
                <div style="font-weight:bold;">Mark ${new Date(m.time).toLocaleTimeString()}</div>
                <div style="font-size:0.8rem; color:#94a3b8;">${m.lat.toFixed(5)}, ${m.lon.toFixed(5)}</div>
            </div>
            <button class="btn-icon" onclick="deleteMark(${m.id})">×</button>
        `;
        list.appendChild(el);
    });
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('driftBtn').addEventListener('click', toggleDrift);
    document.getElementById('addMarkBtn').addEventListener('click', addMark);
    renderResults();
    renderMarks();
});
