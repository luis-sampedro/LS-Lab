/**
 * LS Nav PWA Logic
 * Structure: lsnav { init, data, map, ui, logic, utils }
 */

const lsnav = {
    init: function () {
        console.log("LS Nav Initializing...");
        
        // Detect lang
        this.data.lang = document.documentElement.lang || 'en';

        const setupAuth = () => {
             if (window.firebaseApp && window.firebaseApp.auth) {
                 window.firebaseApp.onAuthStateChanged(window.firebaseApp.auth, (user) => {
                     this.data.user = user;
                     this.data.load(); 
                 });
             }
        };

        if (window.firebaseApp) {
             setupAuth();
        } else {
             this.data.load(); 
             window.addEventListener('firebaseReady', setupAuth);
        }

        this.map.init();
        this.ui.renderMarks();
        this.ui.renderRoutes();
    },

    // --- DATA ---
    data: {
        user: null,
        lang: 'en',
        store: {
            waypoints: [], // Temporary/local waypoints
            rocks: [],     // Permanent hazards (synced)
            routes: [],    // Routes
            settings: {
                bg: 'satellite',
                showIsobaths: true,
                isoOpacity: 0.7,
                isoZoom: 8,
                isoDetail: 'standard'
            }
        },

        load: async function () {
            // Local load
            const saved = localStorage.getItem('lsnav_data');
            let localStore = { waypoints: [], rocks: [], routes: [], settings: { bg: 'satellite', showIsobaths: true, isoOpacity: 0.7, isoZoom: 8, isoDetail: 'standard' } };
            if (saved) {
                try { 
                    localStore = JSON.parse(saved); 
                    if (!localStore.settings) localStore.settings = { bg: 'satellite', showIsobaths: true, isoOpacity: 0.7, isoZoom: 8, isoDetail: 'standard' };
                    if (!localStore.settings.isoDetail) localStore.settings.isoDetail = 'standard';
                } 
                catch (e) { console.error("Local Load error", e); }
            }
            this.store = localStore;

            // Cloud load (for Rocks)
            if (this.user) {
                try {
                    const { db, doc, getDoc } = window.firebaseApp;
                    // Changed from lsc_app_data to ls_nav_data
                    const docRef = doc(db, "users", this.user.uid, "ls_nav_data", "main");
                    const docSnap = await getDoc(docRef);

                    if (docSnap.exists()) {
                        const cloudData = docSnap.data();
                        
                        // Merge rocks
                        const mergedRocks = [...localStore.rocks];
                        (cloudData.rocks || []).forEach(cRock => {
                            if (!mergedRocks.find(r => r.id === cRock.id)) mergedRocks.push(cRock);
                        });
                        this.store.rocks = mergedRocks;
                        
                        // Save back local
                        localStorage.setItem('lsnav_data', JSON.stringify(this.store));
                        this.save();
                    }
                } catch (e) { console.error("Cloud Load Error", e); }
            }

            // Render
            if (lsnav.map.instance) {
                lsnav.map.clearAllLayers();
                this.store.waypoints.forEach(w => lsnav.map.renderMark(w, 'waypoint'));
                this.store.rocks.forEach(r => lsnav.map.renderMark(r, 'rock'));
                this.store.routes.forEach(rt => lsnav.map.renderRoute(rt));
            }

            lsnav.ui.renderMarks();
            lsnav.ui.renderRoutes();
            lsnav.settings.syncUI();
        },

        save: async function () {
            // Local
            localStorage.setItem('lsnav_data', JSON.stringify(this.store));
            
            // Cloud (Rocks only to save space, but we can save all)
            if (this.user) {
                try {
                    const { db, doc, setDoc } = window.firebaseApp;
                    const docRef = doc(db, "users", this.user.uid, "ls_nav_data", "main");
                    // We sync only rocks to cloud for persistence across devices, waypoints/routes stay local for now.
                    // Or sync everything. Let's sync everything to mimic LSCurrent.
                    await setDoc(docRef, this.store);
                } catch (e) { console.error("Cloud Save Error", e); }
            }
        },

        addWaypoint: function (wp) {
            this.store.waypoints.push(wp);
            this.save();
            lsnav.ui.renderMarks();
            lsnav.map.renderMark(wp, 'waypoint');
        },

        addRock: function (rk) {
            this.store.rocks.push(rk);
            this.save();
            lsnav.ui.renderMarks();
            lsnav.map.renderMark(rk, 'rock');
        },

        addRoute: function (rt) {
            this.store.routes.push(rt);
            this.save();
            lsnav.ui.renderRoutes();
            lsnav.map.renderRoute(rt);
        },

        removeMark: function (id, type) {
            if (type === 'rock') {
                this.store.rocks = this.store.rocks.filter(r => r.id !== id);
            } else {
                this.store.waypoints = this.store.waypoints.filter(w => w.id !== id);
            }
            this.save();
            lsnav.ui.renderMarks();
            lsnav.map.removeLayer("mark_" + id);
        },

        removeRoute: function (id) {
            this.store.routes = this.store.routes.filter(r => r.id !== id);
            this.save();
            lsnav.ui.renderRoutes();
            lsnav.map.removeLayer("route_" + id);
        }
    },

    // --- MAP ---
    map: {
        instance: null,
        layers: {}, 
        userMarker: null,
        watchId: null,
        bgLayer: null,
        isobathLayer: null,
        openseamapLayer: null,

        init: function () {
            // Center near Vigo / Rias Baixas (NW Spain)
            this.instance = L.map('map', { zoomControl: false }).setView([42.2328, -8.7226], 10);

            this.updateBackground(lsnav.data.store.settings.bg);

            // OpenSeaMap Overlay (always on for the marks)
            this.openseamapLayer = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
                attribution: 'Map data: &copy; <a href="http://www.openseamap.org">OpenSeaMap</a> contributors',
                maxZoom: 18
            }).addTo(this.instance);

            this.updateIsobaths();

            // Start GPS Watch for live speed
            this.startGPSWatch();

            // Load existing
            lsnav.data.store.waypoints.forEach(w => this.renderMark(w, 'waypoint'));
            lsnav.data.store.rocks.forEach(r => this.renderMark(r, 'rock'));
            lsnav.data.store.routes.forEach(rt => this.renderRoute(rt));

            // Context Menu (Long Press)
            this.instance.on('contextmenu', (e) => {
                if (lsnav.logic.pickingMode) {
                    lsnav.logic.handleMapPick(e.latlng);
                } else if (lsnav.logic.routingMode) {
                    lsnav.logic.addRoutePoint(e.latlng);
                }
            });
            
            // Normal click also for routing
            this.instance.on('click', (e) => {
                if (lsnav.logic.pickingMode) {
                    lsnav.logic.handleMapPick(e.latlng);
                } else if (lsnav.logic.routingMode) {
                    lsnav.logic.addRoutePoint(e.latlng);
                }
            });
        },

        startGPSWatch: function() {
            if (navigator.geolocation) {
                this.watchId = navigator.geolocation.watchPosition(
                    (pos) => {
                        const lat = pos.coords.latitude;
                        const lng = pos.coords.longitude;
                        const speedMps = pos.coords.speed; // meters per second, can be null
                        
                        if (speedMps !== null) {
                            const speedKn = speedMps * 1.94384;
                            document.getElementById('live-speed').innerText = speedKn.toFixed(1) + " kn";
                        }

                        if (!this.userMarker) {
                            this.userMarker = L.circleMarker([lat, lng], {
                                radius: 8, fillColor: '#0ea5e9', color: '#fff', weight: 2, fillOpacity: 1
                            }).addTo(this.instance);
                        } else {
                            this.userMarker.setLatLng([lat, lng]);
                        }
                    },
                    (err) => console.log("GPS Error: ", err),
                    { enableHighAccuracy: true, maximumAge: 0 }
                );
            }
        },

        centerOnUser: function() {
            if (this.userMarker) {
                this.instance.flyTo(this.userMarker.getLatLng(), 14);
            } else {
                this.instance.locate({setView: true, maxZoom: 14});
            }
        },

        renderMark: function (mark, type) {
            // Icon config based on type
            let iconHtml = type === 'rock' 
                ? `<svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                     <circle cx="12" cy="12" r="11" fill="#93c5fd" stroke="black" stroke-width="1.5" stroke-dasharray="3,2"/>
                     <line x1="12" y1="5" x2="12" y2="19" stroke="black" stroke-width="2.5" stroke-linecap="round"/>
                     <line x1="5.9" y1="8.5" x2="18.1" y2="15.5" stroke="black" stroke-width="2.5" stroke-linecap="round"/>
                     <line x1="5.9" y1="15.5" x2="18.1" y2="8.5" stroke="black" stroke-width="2.5" stroke-linecap="round"/>
                   </svg>`
                : '<i class="fa-solid fa-location-dot" style="color:#0ea5e9; font-size:24px; text-shadow:0 0 5px black;"></i>';
                
            const icon = L.divIcon({
                className: 'custom-div-icon',
                html: iconHtml,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });

            const marker = L.marker([mark.lat, mark.lng], { icon: icon });
            
            // Popups
            let popupText = `<b>${mark.name}</b><br>${mark.lat.toFixed(4)}, ${mark.lng.toFixed(4)}`;
            if (mark.desc) popupText += `<br><i>${mark.desc}</i>`;
            marker.bindPopup(popupText);
            
            marker.addTo(this.instance);
            this.layers["mark_" + mark.id] = marker;
        },

        renderRoute: function (rt) {
            if (!rt.points || rt.points.length < 2) return;
            
            const line = L.polyline(rt.points, { color: '#facc15', weight: 3, dashArray: '5, 10' }).addTo(this.instance);
            
            // Tooltip showing name and distance
            line.bindTooltip(`${rt.name} (${rt.distance.toFixed(1)} NM)`, { permanent: false, direction: 'center' });
            this.layers["route_" + rt.id] = line;
            
            // Draw small circles at waypoints
            const group = L.layerGroup().addTo(this.instance);
            rt.points.forEach((p, idx) => {
                L.circleMarker(p, {radius: 4, color: '#facc15', fillOpacity: 1}).addTo(group);
            });
            this.layers["route_pts_" + rt.id] = group;
        },

        removeLayer: function (id) {
            if (this.layers[id]) {
                this.instance.removeLayer(this.layers[id]);
                delete this.layers[id];
            }
            if (this.layers[id.replace("route_", "route_pts_")]) {
                this.instance.removeLayer(this.layers[id.replace("route_", "route_pts_")]);
                delete this.layers[id.replace("route_", "route_pts_")];
            }
        },

        clearAllLayers: function () {
            for (let id in this.layers) {
                if (this.layers.hasOwnProperty(id)) {
                    this.instance.removeLayer(this.layers[id]);
                }
            }
            this.layers = {};
        },

        updateBackground: function(type) {
            if (this.bgLayer) this.instance.removeLayer(this.bgLayer);
            
            if (type === 'satellite') {
                this.bgLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    attribution: 'Tiles &copy; Esri', maxZoom: 18
                });
            } else if (type === 'ocean') {
                this.bgLayer = L.layerGroup([
                    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}', {
                        maxZoom: 18,
                        maxNativeZoom: 13,
                        attribution: '&copy; Esri'
                    }),
                    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}', {
                        maxZoom: 18,
                        maxNativeZoom: 13
                    })
                ]);
            } else if (type === 'street') {
                this.bgLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 18,
                    attribution: '&copy; OpenStreetMap contributors'
                });
            } else if (type === 'dark') {
                this.bgLayer = L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png', {
                    maxZoom: 18,
                    attribution: '&copy; CartoDB'
                });
            }
            
            if (this.bgLayer) {
                this.bgLayer.addTo(this.instance);
                // Ensure bg is at the bottom
                this.bgLayer.bringToBack();
            }
        },

        updateIsobaths: function() {
            if (this.isobathLayer) {
                this.instance.removeLayer(this.isobathLayer);
                this.isobathLayer = null;
            }

            const s = lsnav.data.store.settings;
            if (s.showIsobaths) {
                if (s.isoDetail === 'high') {
                    // Spanish Official Hydrographic Institute (IHM) WMS - High Detail
                    this.isobathLayer = L.layerGroup([
                        L.tileLayer.wms('https://ideihm.covam.es/wms/cartaENCp3', { layers: 'ENC_ES3', format: 'image/png', transparent: true, opacity: parseFloat(s.isoOpacity), minZoom: parseInt(s.isoZoom) }),
                        L.tileLayer.wms('https://ideihm.covam.es/wms/cartaENCp4', { layers: 'ENC_ES4', format: 'image/png', transparent: true, opacity: parseFloat(s.isoOpacity), minZoom: Math.max(11, parseInt(s.isoZoom)) }),
                        L.tileLayer.wms('https://ideihm.covam.es/wms/cartaENCp5', { layers: 'ENC_ES5', format: 'image/png', transparent: true, opacity: parseFloat(s.isoOpacity), minZoom: Math.max(13, parseInt(s.isoZoom)) }),
                        L.tileLayer.wms('https://ideihm.covam.es/wms/cartaENCp6', { layers: 'ENC_ES6', format: 'image/png', transparent: true, opacity: parseFloat(s.isoOpacity), minZoom: Math.max(15, parseInt(s.isoZoom)) })
                    ]);
                } else {
                    // EMODnet Bathymetry WMS - Standard
                    this.isobathLayer = L.tileLayer.wms('https://ows.emodnet-bathymetry.eu/wms', {
                        layers: 'emodnet:contours',
                        format: 'image/png',
                        transparent: true,
                        opacity: parseFloat(s.isoOpacity),
                        minZoom: parseInt(s.isoZoom),
                        attribution: 'EMODnet Bathymetry'
                    });
                }
                
                this.isobathLayer.addTo(this.instance);
                if (this.openseamapLayer) this.openseamapLayer.bringToFront();
            }
        }
    },

    // --- LOGIC ---
    logic: {
        pickingMode: false,
        pickingType: null, // 'waypoint' or 'rock'
        
        routingMode: false,
        currentRouteData: null,
        routingPolyline: null,

        saveWaypoint: function () {
            const name = document.getElementById('wp-name').value || "Waypoint";
            if (!this.tempLat) return alert("Please pick a location on the chart.");
            
            lsnav.data.addWaypoint({
                id: Date.now(),
                name: name,
                lat: this.tempLat,
                lng: this.tempLng
            });
            
            lsnav.ui.closeModals();
            this.tempLat = null; this.tempLng = null;
        },

        saveRock: function () {
            if (!lsnav.data.user) {
                const msg = lsnav.data.lang === 'es' ? "Inicia sesión para guardar rocas permanentes." : "Log in to save permanent rocks.";
                alert(msg);
                return;
            }

            const desc = document.getElementById('rock-desc').value || "";
            if (!this.tempLat) return alert("Please pick a location on the chart.");
            
            lsnav.data.addRock({
                id: Date.now(),
                name: "Hazard / Rock",
                desc: desc,
                lat: this.tempLat,
                lng: this.tempLng
            });
            
            lsnav.ui.closeModals();
            this.tempLat = null; this.tempLng = null;
        },

        startRouteBuilder: function() {
            const name = document.getElementById('route-name').value || "Route";
            const method = document.getElementById('route-method').value;
            
            if (method === 'auto') {
                const msg = lsnav.data.lang === 'es' 
                    ? "El auto-enrutamiento marítimo complejo requiere APIs premium. Se utilizará enrutamiento directo (A -> B)."
                    : "Complex maritime auto-routing requires premium APIs. Direct line routing (A -> B) will be used.";
                alert(msg);
            }

            this.currentRouteData = {
                id: Date.now(),
                name: name,
                method: method,
                points: [],
                distance: 0
            };
            
            this.routingMode = true;
            lsnav.ui.closeModals();
            const startMsg = lsnav.data.lang === 'es' ? "Toca el mapa para añadir puntos. Pulsa el botón flotante ✅ para finalizar." : "Tap the map to add points. Tap the floating ✅ button to finish.";
            alert(startMsg);

            // Add finish button to map controls
            const controls = document.querySelector('.map-controls');
            const finishBtn = document.createElement('button');
            finishBtn.id = "btn-finish-route";
            finishBtn.className = "fab fab-success";
            finishBtn.style.backgroundColor = "var(--success)";
            finishBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
            finishBtn.onclick = () => lsnav.logic.finishRoute();
            controls.prepend(finishBtn);
            
            // Create temporary polyline
            this.routingPolyline = L.polyline([], {color: '#ef4444', weight: 4, dashArray: '5,5'}).addTo(lsnav.map.instance);
        },

        addRoutePoint: function(latlng) {
            if (!this.routingMode) return;
            this.currentRouteData.points.push([latlng.lat, latlng.lng]);
            this.routingPolyline.setLatLngs(this.currentRouteData.points);
            
            // Recalculate distance
            let distNM = 0;
            const pts = this.currentRouteData.points;
            for(let i = 1; i < pts.length; i++) {
                const p1 = {lat: pts[i-1][0], lng: pts[i-1][1]};
                const p2 = {lat: pts[i][0], lng: pts[i][1]};
                const dm = lsnav.utils.getDistance(p1, p2);
                distNM += (dm / 1852);
            }
            this.currentRouteData.distance = distNM;
        },

        finishRoute: function() {
            if (this.currentRouteData.points.length > 1) {
                lsnav.data.addRoute(this.currentRouteData);
            }
            
            // Cleanup
            this.routingMode = false;
            this.currentRouteData = null;
            if (this.routingPolyline) lsnav.map.instance.removeLayer(this.routingPolyline);
            this.routingPolyline = null;
            
            const btn = document.getElementById('btn-finish-route');
            if (btn) btn.remove();
        },

        handleMapPick: function(latlng) {
            this.pickingMode = false;
            this.tempLat = latlng.lat;
            this.tempLng = latlng.lng;
            
            // Reopen correct modal
            if (this.pickingType === 'rock') {
                lsnav.ui.openRockModal();
            } else {
                lsnav.ui.openWaypointModal();
            }
        }
    },

    // --- UI ---
    ui: {
        switchTab: function (tabId) {
            document.querySelectorAll('.tab-page').forEach(el => el.classList.remove('active'));
            const mapTab = document.getElementById('tab-map');
            if (mapTab) {
                if (tabId === 'tab-map') mapTab.classList.add('active');
                else mapTab.classList.remove('active');
            }
            const target = document.getElementById(tabId);
            if (target) target.classList.add('active');
            if (tabId === 'tab-map') {
                setTimeout(() => lsnav.map.instance.invalidateSize(), 100);
            }
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === tabId);
            });
        },

        renderMarks: function () {
            const list = document.getElementById('marks-list');
            if (!list) return;
            list.innerHTML = '';
            
            const isEs = lsnav.data.lang === 'es';
            const allMarks = [...lsnav.data.store.waypoints.map(w => ({...w, _t:'waypoint'})), ...lsnav.data.store.rocks.map(r => ({...r, _t:'rock'}))];
            
            if (allMarks.length === 0) {
                list.innerHTML = `<p class="text-muted" style="font-size:0.9rem;">${isEs ? 'No hay marcas.' : 'No marks.'}</p>`;
                return;
            }

            allMarks.forEach(item => {
                const div = document.createElement('div');
                div.className = 'list-item';
                
                let iconHtml = item._t === 'rock' 
                    ? `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="display:block;">
                         <circle cx="12" cy="12" r="11" fill="#93c5fd" stroke="black" stroke-width="1.5" stroke-dasharray="3,2"/>
                         <line x1="12" y1="5" x2="12" y2="19" stroke="black" stroke-width="2.5" stroke-linecap="round"/>
                         <line x1="5.9" y1="8.5" x2="18.1" y2="15.5" stroke="black" stroke-width="2.5" stroke-linecap="round"/>
                         <line x1="5.9" y1="15.5" x2="18.1" y2="8.5" stroke="black" stroke-width="2.5" stroke-linecap="round"/>
                       </svg>`
                    : `<i class="fa-solid fa-location-dot" style="color:white;"></i>`;
                    
                let typeTxt = item._t === 'rock' ? (isEs ? 'Roca' : 'Rock') : 'Waypoint';

                div.innerHTML = `
                    <div class="item-main" onclick="lsnav.map.instance.flyTo([${item.lat}, ${item.lng}], 15); lsnav.ui.switchTab('tab-map')">
                        <div class="item-icon" style="${item._t==='rock'?'background:transparent; border:none;':''}">${iconHtml}</div>
                        <div>
                            <div><b>${item.name}</b></div>
                            <small class="text-muted">${typeTxt} | ${item.lat.toFixed(3)}, ${item.lng.toFixed(3)}</small>
                        </div>
                    </div>
                    <button onclick="lsnav.data.removeMark(${item.id}, '${item._t}')" style="color:#ef4444; background:none; border:none;"><i class="fa-solid fa-trash"></i></button>
                `;
                list.appendChild(div);
            });
        },

        renderRoutes: function () {
            const list = document.getElementById('routes-list');
            if (!list) return;
            list.innerHTML = '';
            
            const isEs = lsnav.data.lang === 'es';
            if (lsnav.data.store.routes.length === 0) {
                list.innerHTML = `<p class="text-muted" style="font-size:0.9rem;">${isEs ? 'No hay rutas.' : 'No routes.'}</p>`;
                return;
            }

            lsnav.data.store.routes.forEach(item => {
                const div = document.createElement('div');
                div.className = 'list-item';
                div.innerHTML = `
                    <div class="item-main" onclick="lsnav.map.instance.flyTo([${item.points[0][0]}, ${item.points[0][1]}], 12); lsnav.ui.switchTab('tab-map')">
                        <div class="item-icon"><i class="fa-solid fa-route" style="color:white;"></i></div>
                        <div>
                            <div><b>${item.name}</b></div>
                            <small class="text-muted">${item.distance.toFixed(2)} NM | ${item.points.length} pts</small>
                        </div>
                    </div>
                    <button onclick="lsnav.data.removeRoute(${item.id})" style="color:#ef4444; background:none; border:none;"><i class="fa-solid fa-trash"></i></button>
                `;
                list.appendChild(div);
            });
        },

        closeModals: function () {
            document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('open'));
            lsnav.logic.pickingMode = false;
        },

        openWaypointModal: function() {
            document.getElementById('modal-waypoint').classList.add('open');
        },

        openRockModal: function() {
            document.getElementById('modal-rock').classList.add('open');
        },

        openRouteModal: function() {
            document.getElementById('modal-route').classList.add('open');
        },

        pickOnMap: function (type) {
            lsnav.ui.closeModals();
            lsnav.logic.pickingMode = true;
            lsnav.logic.pickingType = type;
            const msg = lsnav.data.lang === 'es'
                ? "Mantén pulsado (o haz clic) en la carta para elegir la ubicación."
                : "Long press (or click) on the chart to pick location.";
            alert(msg);
        }
    },

    // --- SETTINGS ---
    settings: {
        syncUI: function() {
            const s = lsnav.data.store.settings;
            if (document.getElementById('opt-bg')) document.getElementById('opt-bg').value = s.bg;
            if (document.getElementById('opt-isobaths')) document.getElementById('opt-isobaths').checked = s.showIsobaths;
            if (document.getElementById('opt-iso-opacity')) document.getElementById('opt-iso-opacity').value = s.isoOpacity;
            if (document.getElementById('opt-iso-zoom')) document.getElementById('opt-iso-zoom').value = s.isoZoom;
            if (document.getElementById('opt-iso-detail')) document.getElementById('opt-iso-detail').value = s.isoDetail || 'standard';
        },
        
        setBackground: function(val) {
            lsnav.data.store.settings.bg = val;
            lsnav.data.save();
            lsnav.map.updateBackground(val);
            
            // Focus on Galicia Coast briefly when selecting oceanic Navionics style
            if(val === 'ocean') {
                 lsnav.map.instance.flyTo([42.85, -9.1], 9);
            }
        },

        toggleIsobaths: function(checked) {
            lsnav.data.store.settings.showIsobaths = checked;
            lsnav.data.save();
            lsnav.map.updateIsobaths();
        },

        setIsobathOpacity: function(val) {
            lsnav.data.store.settings.isoOpacity = parseFloat(val);
            lsnav.data.save();
            lsnav.map.updateIsobaths();
        },

        setIsobathZoom: function(val) {
            lsnav.data.store.settings.isoZoom = parseInt(val);
            lsnav.data.save();
            lsnav.map.updateIsobaths();
        },
        
        setIsobathDetail: function(val) {
            lsnav.data.store.settings.isoDetail = val;
            lsnav.data.save();
            lsnav.map.updateIsobaths();
        }
    },

    // --- UTILS ---
    utils: {
        getDistance: function (p1, p2) {
            // Haversine
            const R = 6371e3; // metres
            const f1 = p1.lat * Math.PI / 180;
            const f2 = p2.lat * Math.PI / 180;
            const df = (p2.lat - p1.lat) * Math.PI / 180;
            const dl = (p2.lng - p1.lng) * Math.PI / 180;

            const a = Math.sin(df / 2) * Math.sin(df / 2) +
                Math.cos(f1) * Math.cos(f2) *
                Math.sin(dl / 2) * Math.sin(dl / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c; 
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    lsnav.init();
});
