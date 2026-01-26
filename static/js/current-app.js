/**
 * LS Current PWA Logic
 * Structure: app { init, data, map, ui, logic, utils }
 */

const app = {
    init: function () {
        console.log("LS Current Initializing...");
        this.data.load();
        this.map.init();
        this.ui.renderHistory();
        this.ui.renderMarks();
        this.ui.applySettings();

        // Setup simple clock
        setInterval(() => {
            // update any real-time UI if needed
        }, 1000);
    },

    // --- DATA ---
    data: {
        store: {
            history: [],
            marks: [],
            settings: { lang: 'en', theme: 'dark', showLabels: true }
        },

        load: function () {
            const saved = localStorage.getItem('lsc_data');
            if (saved) {
                try {
                    this.store = JSON.parse(saved);
                    // Merge defaults/migrations if needed
                    if (!this.store.settings) this.store.settings = { lang: 'en', theme: 'dark', showLabels: true };
                } catch (e) { console.error("Load error", e); }
            }
        },

        save: function () {
            localStorage.setItem('lsc_data', JSON.stringify(this.store));
        },

        addHistory: function (item) {
            this.store.history.unshift(item); // Add to top
            this.save();
            app.ui.renderHistory();
        },

        addMark: function (item) {
            this.store.marks.push(item);
            this.save();
            app.ui.renderMarks();
            app.map.renderMark(item);
        },

        removeMark: function (id) {
            this.store.marks = this.store.marks.filter(m => m.id !== id);
            this.save();
            app.ui.renderMarks();
            app.map.removeLayer(id);
        },

        removeHistory: function (id) {
            this.store.history = this.store.history.filter(h => h.id !== id);
            this.save();
            app.ui.renderHistory();
            app.map.removeLayer("hist_" + id);
        },

        clearAll: function () {
            if (confirm("Delete all data? This cannot be undone.")) {
                this.store.history = [];
                this.store.marks = [];
                this.save();
                location.reload();
            }
        }
    },

    // --- MAP ---
    map: {
        instance: null,
        layers: {}, // Store reference to markers by ID
        userMarker: null,

        init: function () {
            // Default center (will update with GPS)
            this.instance = L.map('map', { zoomControl: false }).setView([0, 0], 2);

            // Satellite Tile Layer (Esri)
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Tiles &copy; Esri'
            }).addTo(this.instance);

            // Locate User
            this.instance.locate({ setView: true, maxZoom: 16 });

            this.instance.on('locationfound', (e) => {
                if (!this.userMarker) {
                    this.userMarker = L.circleMarker(e.latlng, {
                        radius: 8, fillColor: '#38bdf8', color: '#fff', weight: 2, fillOpacity: 1
                    }).addTo(this.instance);
                } else {
                    this.userMarker.setLatLng(e.latlng);
                }
            });

            // Reload existing map items
            app.data.store.marks.forEach(m => this.renderMark(m));
            // Maybe render history items? Usually history is just data, but current requires arrow.
            app.data.store.history.forEach(h => {
                if (h.type === 'current') this.renderCurrentArrow(h);
                if (h.type === 'wind') this.renderWindIcon(h);
            });
        },

        getCurrentLocation: function () {
            return new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                    err => reject(err),
                    { enableHighAccuracy: true }
                );
            });
        },

        renderMark: function (mark) {
            // Icons based on type
            let iconHtml = '<i class="fa-solid fa-location-dot" style="color:white; font-size:24px;"></i>';
            if (mark.type === 'boat') iconHtml = '<i class="fa-solid fa-sailboat" style="color:#facc15; font-size:20px;"></i>';
            if (mark.type === 'pin') iconHtml = '<i class="fa-solid fa-flag" style="color:#ef4444; font-size:20px;"></i>';

            const icon = L.divIcon({
                className: 'custom-div-icon',
                html: `<div style="text-shadow: 0 2px 4px rgba(0,0,0,0.8);">${iconHtml}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 30]
            });

            const marker = L.marker([mark.lat, mark.lng], { icon: icon });

            if (app.data.store.settings.showLabels) {
                marker.bindTooltip(mark.name, { permanent: true, direction: 'bottom', className: 'map-label' });
            }

            marker.bindPopup(`<b>${mark.name}</b><br>${mark.type.toUpperCase()}<br>${mark.lat.toFixed(5)}, ${mark.lng.toFixed(5)}`);
            marker.addTo(this.instance);
            this.layers[mark.id] = marker;

            // If racecourse line
            if (mark.racecourse) {
                // Draw line
                const line = L.polyline([
                    [mark.lat, mark.lng],
                    [mark.racecourse.dest.lat, mark.racecourse.dest.lng]
                ], { color: '#facc15', dashArray: '5, 10' }).addTo(this.instance);
                this.layers[mark.id + "_line"] = line;
            }
        },

        renderCurrentArrow: function (h) {
            const color = app.utils.getJetColor(h.speed, 0, 3); // 0-3 kts range
            const size = 40 + (h.speed * 5); // Scale size slightly

            // Arrow HTML
            // Transform rotate is handled by CSS or inline
            const html = `
                <div style="transform: rotate(${h.bearing}deg); width:${size}px; height:${size}px; display:flex; justify-content:center; align-items:center;">
                    <i class="fa-solid fa-arrow-up" style="color: rgb(${color.r},${color.g},${color.b}); font-size:${size}px; text-shadow:0 2px 5px black;"></i>
                </div>
             `;

            const icon = L.divIcon({
                className: 'arrow-icon',
                html: html,
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2]
            });

            const marker = L.marker([h.lat, h.lng], { icon: icon })
                .bindPopup(`Current: <b>${h.speed.toFixed(1)} kn</b> @ ${h.bearing.toFixed(0)}°<br>${new Date(h.timestamp).toLocaleTimeString()}`);

            marker.addTo(this.instance);
            this.layers["hist_" + h.id] = marker;
        },

        renderWindIcon: function (h) {
            const html = `
               <div style="transform: rotate(${h.direction + 180}deg); display:flex; justify-content:center;">
                   <i class="fa-solid fa-wind" style="color: #a8a29e; font-size:24px;"></i>
               </div>
            `;
            const icon = L.divIcon({ html: html, iconSize: [30, 30], iconAnchor: [15, 15] });
            const marker = L.marker([h.lat, h.lng], { icon: icon })
                .bindPopup(`Wind: <b>${h.speed} kn</b> @ ${h.direction}°`);
            marker.addTo(this.instance);
            this.layers["hist_" + h.id] = marker;
        },

        removeLayer: function (id) {
            if (this.layers[id]) {
                this.instance.removeLayer(this.layers[id]);
                delete this.layers[id];
            }
            // Check for associated lines (racecourse)
            if (this.layers[id + "_line"]) {
                this.instance.removeLayer(this.layers[id + "_line"]);
                delete this.layers[id + "_line"];
            }
        },

        flyTo: function (lat, lng) {
            this.instance.flyTo([lat, lng], 16);
            app.ui.switchTab('tab-map');
        }
    },

    // --- LOGIC ---
    logic: {
        measuring: false,
        measureStart: null,

        toggleMeasure: async function () {
            const btn = document.getElementById('btn-measure');

            if (!this.measuring) {
                // START
                try {
                    const pos = await app.map.getCurrentLocation();
                    this.measureStart = { pos, time: Date.now() };
                    this.measuring = true;

                    btn.classList.add('danger');
                    btn.classList.remove('primary');
                    btn.innerHTML = '<i class="fa-solid fa-stop"></i>';

                    // Visual feedback
                    document.getElementById('live-speed').innerText = "Measuring...";

                } catch (e) { alert("GPS Error: " + e.message); }
            } else {
                // STOP
                try {
                    const endPos = await app.map.getCurrentLocation();
                    const endTime = Date.now();

                    const distMeters = app.utils.getDistance(this.measureStart.pos, endPos);
                    const durationSec = (endTime - this.measureStart.time) / 1000;

                    // Avoid div by zero
                    if (durationSec < 1) return;

                    const speedKn = (distMeters / durationSec) * 1.94384;
                    const bearing = app.utils.getBearing(this.measureStart.pos, endPos);

                    const record = {
                        id: Date.now(), // timestamp as ID
                        type: 'current',
                        speed: speedKn,
                        bearing: bearing,
                        timestamp: endTime,
                        lat: this.measureStart.pos.lat,
                        lng: this.measureStart.pos.lng
                    };

                    app.data.addHistory(record);
                    app.map.renderCurrentArrow(record);

                    // Reset UI
                    this.measuring = false;
                    btn.classList.remove('danger');
                    btn.classList.add('primary');
                    btn.innerHTML = '<i class="fa-solid fa-play"></i>';

                    document.getElementById('live-speed').innerText = speedKn.toFixed(1) + " kn";
                    document.getElementById('live-bearing').innerText = bearing.toFixed(0) + "°";

                } catch (e) { alert("GPS Error: " + e.message); console.error(e); }
            }
        },

        saveWind: async function () {
            const spd = parseFloat(document.getElementById('wind-speed').value);
            const dir = parseFloat(document.getElementById('wind-dir').value);
            if (isNaN(spd) || isNaN(dir)) return alert("Invalid inputs");

            try {
                const pos = await app.map.getCurrentLocation();
                const record = {
                    id: Date.now(),
                    type: 'wind',
                    speed: spd,
                    direction: dir,
                    timestamp: Date.now(),
                    lat: pos.lat,
                    lng: pos.lng
                };
                app.data.addHistory(record);
                app.map.renderWindIcon(record);
                app.ui.closeModals();
            } catch (e) { alert("GPS unavailable for location tagging"); }
        },

        saveMark: async function () {
            const name = document.getElementById('mark-name').value || "Mark";
            const type = document.getElementById('mark-type').value;

            // Racecourse data
            let rcData = null;
            const inputDiv = document.getElementById('racecourse-inputs');
            if (inputDiv.style.display === 'block') {
                const dist = parseFloat(document.getElementById('rc-dist').value);
                const ang = parseFloat(document.getElementById('rc-bearing').value);
                if (dist && !isNaN(ang)) {
                    // Calculate destination
                    // We need current pos first
                }
            }

            try {
                const pos = await app.map.getCurrentLocation();

                // If Racecourse
                if (inputDiv.style.display === 'block') {
                    const dist = parseFloat(document.getElementById('rc-dist').value); // NM
                    const ang = parseFloat(document.getElementById('rc-bearing').value);
                    if (dist && !isNaN(ang)) {
                        const dest = app.utils.computeDestination(pos, dist, ang);
                        rcData = { dist, bearing: ang, dest };
                    }
                }

                const mark = {
                    id: Date.now(),
                    name: name,
                    type: type,
                    lat: pos.lat,
                    lng: pos.lng,
                    timestamp: Date.now(),
                    racecourse: rcData
                };

                app.data.addMark(mark);
                app.ui.closeModals();

            } catch (e) { alert("GPS Error"); }
        }
    },

    // --- UI ---
    ui: {
        switchTab: function (tabId) {
            document.querySelectorAll('.tab-page').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('#map-view').forEach(el => el.style.display = (tabId === 'tab-map' ? 'block' : 'none')); // Handle map visibility manually?
            // Actually, Map is special. 
            // My CSS structure: #tab-map is .active by default. Other tabs overlay it or replace it.

            // Let's just use the classes
            document.getElementById(tabId).classList.add('active');

            // Map visibility
            if (tabId === 'tab-map') {
                setTimeout(() => app.map.instance.invalidateSize(), 100);
            }

            // Nav Highlighting
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === tabId);
            });
        },

        renderHistory: function () {
            const list = document.getElementById('history-list');
            list.innerHTML = '';
            app.data.store.history.forEach(item => {
                const date = new Date(item.timestamp).toLocaleTimeString();

                let iconClass = item.type === 'current' ? 'fa-arrow-up' : 'fa-wind';
                let valText = item.type === 'current'
                    ? `<b>${item.speed.toFixed(1)} kn</b> ${item.bearing.toFixed(0)}°`
                    : `<b>${item.speed} kn</b> ${item.direction}° (Wind)`;

                const div = document.createElement('div');
                div.className = 'list-item';
                div.innerHTML = `
                    <div class="item-main" onclick="app.map.flyTo(${item.lat}, ${item.lng})">
                        <div class="item-icon"><i class="fa-solid ${iconClass}"></i></div>
                        <div>
                            <div>${valText}</div>
                            <small class="text-muted">${date}</small>
                        </div>
                    </div>
                    <button onclick="app.data.removeHistory(${item.id})" style="color:#ef4444; background:none; border:none;"><i class="fa-solid fa-trash"></i></button>
                `;
                list.appendChild(div);
            });
        },

        renderMarks: function () {
            const list = document.getElementById('marks-list');
            list.innerHTML = '';
            app.data.store.marks.forEach(item => {
                const div = document.createElement('div');
                div.className = 'list-item';
                div.innerHTML = `
                    <div class="item-main" onclick="app.map.flyTo(${item.lat}, ${item.lng})">
                        <div class="item-icon"><i class="fa-solid fa-location-dot"></i></div>
                        <div>
                            <div><b>${item.name}</b></div>
                            <small class="text-muted">${item.type}</small>
                        </div>
                    </div>
                    <button onclick="app.data.removeMark(${item.id})" style="color:#ef4444; background:none; border:none;"><i class="fa-solid fa-trash"></i></button>
                `;
                list.appendChild(div);
            });
        },

        openWindModal: function () {
            document.getElementById('modal-wind').classList.add('open');
        },
        openMarkModal: function () {
            document.getElementById('modal-mark').classList.add('open');
        },
        closeModals: function () {
            document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('open'));
        },
        toggleRacecourseInputs: function () {
            const el = document.getElementById('racecourse-inputs');
            el.style.display = el.style.display === 'none' ? 'block' : 'none';
        },

        applySettings: function () {
            // Theme handling if needed. Currently hardcoded dark.
            // Labels
            if (app.map.instance) {
                // Iterate layers and update tooltip options if possible
                // Or just simpler: reload map
            }
        }
    },

    // --- UTILS ---
    settings: {
        setLang: function (l) {
            app.data.store.settings.lang = l;
            app.data.save();
            location.reload(); // Lazy translation: reload page and let server handle template (if server side)
            // But we are SPA mostly now. 
            // For MVP, just reload.
            // Wait, query param 'lang' controls server-side.
            const url = new URL(window.location);
            url.searchParams.set('lang', l);
            window.location = url;
        },
        toggleLabels: function () {
            app.data.store.settings.showLabels = !app.data.store.settings.showLabels;
            app.data.save();
            // Simple reload to re-render map labels
            location.reload();
        }
    },

    utils: {
        // Haversine
        getDistance: function (p1, p2) {
            const R = 6371e3; // metres
            const φ1 = p1.lat * Math.PI / 180;
            const φ2 = p2.lat * Math.PI / 180;
            const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
            const Δλ = (p2.lng - p1.lng) * Math.PI / 180;

            const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

            return R * c;
        },

        getBearing: function (start, end) {
            const startLat = start.lat * Math.PI / 180;
            const startLng = start.lng * Math.PI / 180;
            const endLat = end.lat * Math.PI / 180;
            const endLng = end.lng * Math.PI / 180;

            const y = Math.sin(endLng - startLng) * Math.cos(endLat);
            const x = Math.cos(startLat) * Math.sin(endLat) -
                Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLng - startLng);
            const brng = Math.atan2(y, x) * 180 / Math.PI;
            return (brng + 360) % 360;
        },

        // Destination point given distance (NM) and bearing
        computeDestination: function (start, distNM, bearing) {
            const distMeters = distNM * 1852;
            const R = 6371e3;
            const brng = bearing * Math.PI / 180;
            const lat1 = start.lat * Math.PI / 180;
            const lon1 = start.lng * Math.PI / 180;

            const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distMeters / R) +
                Math.cos(lat1) * Math.sin(distMeters / R) * Math.cos(brng));
            const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(distMeters / R) * Math.cos(lat1),
                Math.cos(distMeters / R) - Math.sin(lat1) * Math.sin(lat2));

            return {
                lat: lat2 * 180 / Math.PI,
                lng: lon2 * 180 / Math.PI
            };
        },

        getJetColor: function (v, vmin, vmax) {
            let c = { r: 255, g: 255, b: 255 };
            let dv;

            if (v < vmin) v = vmin;
            if (v > vmax) v = vmax;
            dv = vmax - vmin;

            if (v < (vmin + 0.25 * dv)) {
                c.r = 0;
                c.g = 4 * (v - vmin) / dv * 255;
                c.b = 255;
            } else if (v < (vmin + 0.5 * dv)) {
                c.r = 0;
                c.g = 255;
                c.b = (1 + 4 * (vmin + 0.25 * dv - v) / dv) * 255;
            } else if (v < (vmin + 0.75 * dv)) {
                c.r = 4 * (v - vmin - 0.5 * dv) / dv * 255;
                c.g = 255;
                c.b = 0;
            } else {
                c.r = 255;
                c.g = (1 + 4 * (vmin + 0.75 * dv - v) / dv) * 255;
                c.b = 0;
            }

            // rounding
            c.r = Math.round(c.r);
            c.g = Math.round(c.g);
            c.b = Math.round(c.b);
            return c;
        }
    }
};

// Start
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
