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

        // Initialize SQL.js for MBTiles support
        if (window.initSqlJs) {
            window.initSqlJs({
                locateFile: file => `/static/lib/${file}`
            }).then(SQL => {
                window.SQL = SQL;
                console.log("SQL.js Initialized");
            }).catch(e => console.error("SQL.js Init Error", e));
        }
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
                overlay: 'standard', // 'off', 'standard', 'high', 'riasbaixas'
                isoOpacity: 0.8,
                gpsInfo: false
            }
        },

        load: async function () {
            // Local load
            const saved = localStorage.getItem('lsnav_data');
            let localStore = { waypoints: [], rocks: [], routes: [], settings: { bg: 'satellite', overlay: 'standard', isoOpacity: 0.8 } };
            if (saved) {
                try {
                    localStore = JSON.parse(saved);
                    if (!localStore.settings) localStore.settings = { bg: 'satellite', overlay: 'standard', isoOpacity: 0.8 };
                    if (!localStore.settings.overlay) localStore.settings.overlay = 'standard';
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
            
            // PRO Status Check for Downloads
            if (this.user) {
                this.checkProStatus();
            }
        },

        checkProStatus: async function() {
            try {
                const token = await this.user.getIdToken();
                const response = await fetch('/api/user/profile', {
                    headers: { 'Authorization': token }
                });
                if (response.ok) {
                    const profile = await response.json();
                    if (profile.is_pro) {
                        const dlSection = document.getElementById('pro-downloads-section');
                        if (dlSection) dlSection.style.display = 'block';
                        
                        const dlLink = document.getElementById('download-riasbaixas');
                        if (dlLink) {
                            const isEs = this.lang === 'es';
                            const body = isEs 
                                ? "Hola Luis,%0A%0AEstoy interesado en obtener el paquete MBTiles de las Rías Baixas para navegación offline. ¿Podrías enviármelo?%0A%0ASaludos."
                                : "Hi Luis,%0A%0AI am interested in obtaining the Rías Baixas MBTiles package for offline navigation. Could you please send it to me?%0A%0ABest regards.";
                            const subject = isEs 
                                ? "Solicitud de Cartas MBTiles (LS-PRO)"
                                : "MBTiles Package Request (LS-PRO)";
                            
                            dlLink.href = `mailto:luis.sampedro.moix@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(decodeURIComponent(body))}`;
                        }

                    }
                }
            } catch (err) {
                console.error("Pro Status Check Error", err);
            }
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
        mbtilesLayer: null,

        init: function () {
            // Center near Vigo / Rias Baixas (NW Spain)
            this.instance = L.map('map', { zoomControl: false }).setView([42.2328, -8.7226], 10);

            // Debug Zoom Info
            const zoomControl = L.control({position: 'topleft'});
            zoomControl.onAdd = function (map) {
                this._div = L.DomUtil.create('div', 'debug-zoom');
                this._div.style.backgroundColor = 'rgba(0,0,0,0.6)';
                this._div.style.color = '#fff';
                this._div.style.padding = '4px 8px';
                this._div.style.borderRadius = '4px';
                this._div.style.fontSize = '12px';
                this._div.style.fontWeight = 'bold';
                this._div.innerHTML = 'Zoom: ' + map.getZoom();
                return this._div;
            };
            zoomControl.addTo(this.instance);
            
            this.instance.on('zoomend', () => {
                const el = document.querySelector('.debug-zoom');
                if (el) el.innerHTML = 'Zoom: ' + this.instance.getZoom();
            });

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
                } else {
                    lsnav.ui.openMapContextMenu(e.latlng, e.originalEvent);
                }
            });

            // Normal click also for routing
            this.instance.on('click', (e) => {
                if (lsnav.logic.pickingMode) {
                    lsnav.logic.handleMapPick(e.latlng);
                } else if (lsnav.logic.routingMode) {
                    lsnav.logic.addRoutePoint(e.latlng);
                } else {
                    lsnav.ui.closeMapContextMenu();
                }
            });

            // If map moves, close context menu
            this.instance.on('movestart', () => {
                lsnav.ui.closeMapContextMenu();
            });
        },

        startGPSWatch: function () {
            if (navigator.geolocation) {
                this.lastPosLatLng = null;

                this.watchId = navigator.geolocation.watchPosition(
                    (pos) => {
                        const lat = pos.coords.latitude;
                        const lng = pos.coords.longitude;
                        const speedMps = pos.coords.speed; // meters per second, can be null
                        const heading = pos.coords.heading; // 0-360, can be null

                        let speedKn = 0;
                        if (speedMps !== null) {
                            speedKn = speedMps * 1.94384;
                            document.getElementById('live-speed').innerText = speedKn.toFixed(1);
                        }

                        // Calculate COG (Course Over Ground)
                        let cog = null;
                        if (heading !== null && speedKn > 0.5) {
                            cog = heading;
                        } else if (this.lastPosLatLng && speedKn > 0.5) {
                            cog = lsnav.utils.getBearing(this.lastPosLatLng, { lat: lat, lng: lng });
                        }

                        if (cog !== null) {
                            document.getElementById('live-cog').innerText = cog.toFixed(0) + "°";
                        }

                        this.lastPosLatLng = { lat: lat, lng: lng };

                        // Update GPS Legend
                        if (lsnav.data.store.settings.gpsInfo) {
                            const lgCoords = document.getElementById('gps-coords');
                            const lgTime = document.getElementById('gps-time');
                            const lgAcc = document.getElementById('gps-acc');
                            if (lgCoords) {
                                lgCoords.innerText = lat.toFixed(5) + ", " + lng.toFixed(5);
                            }
                            if (lgTime) {
                                const d = new Date(pos.timestamp || Date.now());
                                lgTime.innerText = d.toLocaleTimeString();
                            }
                            if (lgAcc) {
                                const acc = pos.coords.accuracy ? pos.coords.accuracy.toFixed(0) + "m" : "--";
                                lgAcc.innerText = acc;
                            }
                        }

                        // Update Permanent Monitoring Legend (always)
                        const monLat = document.getElementById('mon-lat');
                        const monLng = document.getElementById('mon-lng');
                        const monAcc = document.getElementById('mon-acc');
                        const monTime = document.getElementById('mon-time');
                        if (monLat) monLat.innerText = lat.toFixed(5);
                        if (monLng) monLng.innerText = lng.toFixed(5);
                        if (monAcc) monAcc.innerText = pos.coords.accuracy ? pos.coords.accuracy.toFixed(0) + "m" : "--";
                        if (monTime) monTime.innerText = new Date(pos.timestamp || Date.now()).toLocaleTimeString();


                        // Active Navigation Logic
                        const nav = lsnav.logic.activeNav;
                        if (nav) {
                            let targetLatLng = null;
                            let routeName = "Target";
                            let isRoute = false;

                            if (nav.type === 'waypoint') {
                                const wp = lsnav.data.store.waypoints.find(w => w.id === nav.id) || lsnav.data.store.rocks.find(r => r.id === nav.id);
                                if (wp) {
                                    targetLatLng = { lat: wp.lat, lng: wp.lng };
                                    routeName = wp.name || "Waypoint";
                                }
                            } else if (nav.type === 'route') {
                                const rt = lsnav.data.store.routes.find(r => r.id === nav.id);
                                if (rt && nav.index < rt.points.length) {
                                    targetLatLng = { lat: rt.points[nav.index][0], lng: rt.points[nav.index][1] };
                                    routeName = rt.name + " (Pt " + (nav.index + 1) + ")";
                                    isRoute = true;
                                } else if (rt && nav.index >= rt.points.length && rt.points.length > 0) {
                                    lsnav.logic.stopNavigation();
                                    alert(lsnav.data.lang === 'es' ? "¡Has llegado al final de la ruta!" : "You have reached the end of the route!");
                                }
                            }

                            if (targetLatLng) {
                                const distMeters = lsnav.utils.getDistance({ lat: lat, lng: lng }, targetLatLng);
                                const distNM = distMeters / 1852;
                                const brg = lsnav.utils.getBearing({ lat: lat, lng: lng }, targetLatLng);

                                document.getElementById('nav-wp-name').innerText = routeName;
                                document.getElementById('nav-bearing').innerText = brg.toFixed(0) + "°";
                                document.getElementById('nav-dist').innerText = distNM.toFixed(2) + " NM";

                                // ETA calculation (Hours = Distance / Speed)
                                if (speedKn > 0.5) {
                                    const hoursToTarget = distNM / speedKn;
                                    const etaMs = Date.now() + (hoursToTarget * 60 * 60 * 1000);
                                    const etaDate = new Date(etaMs);
                                    const mins = etaDate.getMinutes().toString().padStart(2, '0');
                                    document.getElementById('nav-eta').innerText = etaDate.getHours() + ":" + mins;
                                } else {
                                    document.getElementById('nav-eta').innerText = "--:--";
                                }

                                // Auto-advance route points if within 50 meters
                                if (isRoute && distMeters < 50) {
                                    lsnav.logic.activeNav.index++;
                                }
                            }
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

        centerOnUser: function () {
            if (this.userMarker) {
                this.instance.flyTo(this.userMarker.getLatLng(), 14);
            } else {
                this.instance.locate({ setView: true, maxZoom: 14 });
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
                L.circleMarker(p, { radius: 4, color: '#facc15', fillOpacity: 1 }).addTo(group);
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

        updateBackground: function (type) {
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

        updateIsobaths: function () {
            if (this.isobathLayer) {
                this.instance.removeLayer(this.isobathLayer);
                this.isobathLayer = null;
            }
            if (this.mbtilesLayer) {
                this.instance.removeLayer(this.mbtilesLayer);
                this.mbtilesLayer = null;
            }

            const s = lsnav.data.store.settings;
            const mbtilesRow = document.getElementById('row-mbtiles-upload');
            if (mbtilesRow) {
                mbtilesRow.style.display = (s.overlay === 'mbtiles') ? 'flex' : 'none';
            }

            if (s.overlay !== 'off') {
                if (s.overlay === 'high') {
                    // Spanish Official Hydrographic Institute (IHM) WMS - High Detail
                    this.isobathLayer = L.layerGroup([
                        L.tileLayer.wms('https://ideihm.covam.es/wms/cartaENCp3', { layers: 'ENC_ES3', format: 'image/png', transparent: true, opacity: parseFloat(s.isoOpacity), minZoom: 8 }),
                        L.tileLayer.wms('https://ideihm.covam.es/wms/cartaENCp4', { layers: 'ENC_ES4', format: 'image/png', transparent: true, opacity: parseFloat(s.isoOpacity), minZoom: 11 }),
                        L.tileLayer.wms('https://ideihm.covam.es/wms/cartaENCp5', { layers: 'ENC_ES5', format: 'image/png', transparent: true, opacity: parseFloat(s.isoOpacity), minZoom: 13 }),
                        L.tileLayer.wms('https://ideihm.covam.es/wms/cartaENCp6', { layers: 'ENC_ES6', format: 'image/png', transparent: true, opacity: parseFloat(s.isoOpacity), minZoom: 15 })
                    ]);
                } else if (s.overlay === 'riasbaixas') {
                    // Points to static/tiles for GitHub / Firebase Static Hosting compatibility
                    // Layer stacking trick to natively support "sparse" directories without breaking
                    let pane = this.instance.getPane('riasbaixasPane');
                    if (!pane) {
                        pane = this.instance.createPane('riasbaixasPane');
                        pane.style.zIndex = 400; // overlay
                    }
                    pane.style.opacity = parseFloat(s.isoOpacity);

                    const tr = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
                    this.isobathLayer = L.layerGroup([
                        L.tileLayer('/static/tiles/riasbaixas/{z}/{x}/{y}.png', { maxZoom: 22, maxNativeZoom: 12, pane: 'riasbaixasPane', attribution: 'Local (LS PRO)', errorTileUrl: tr }),
                        L.tileLayer('/static/tiles/riasbaixas/{z}/{x}/{y}.png', { maxZoom: 22, minZoom: 13, maxNativeZoom: 14, pane: 'riasbaixasPane', errorTileUrl: tr }),
                        L.tileLayer('/static/tiles/riasbaixas/{z}/{x}/{y}.png', { maxZoom: 22, minZoom: 15, maxNativeZoom: 17, pane: 'riasbaixasPane', errorTileUrl: tr }),
                        L.tileLayer('/static/tiles/riasbaixas/{z}/{x}/{y}.png', { maxZoom: 22, minZoom: 18, maxNativeZoom: 19, pane: 'riasbaixasPane', errorTileUrl: tr })
                    ]);
                } else if (s.overlay === 'mbtiles') {
                    if (this._localMBTilesBuffer) {
                        this.mbtilesLayer = L.tileLayer.mbTiles(this._localMBTilesBuffer, {
                            maxZoom: 22,
                            opacity: parseFloat(s.isoOpacity)
                        });
                    }
                } else if (s.overlay === 'standard') {
                    // EMODnet Bathymetry WMS - Standard
                    this.isobathLayer = L.tileLayer.wms('https://ows.emodnet-bathymetry.eu/wms', {
                        layers: 'emodnet:contours',
                        format: 'image/png',
                        transparent: true,
                        opacity: parseFloat(s.isoOpacity),
                        attribution: 'EMODnet Bathymetry'
                    });
                }

                if (this.isobathLayer) this.isobathLayer.addTo(this.instance);
                if (this.mbtilesLayer) this.mbtilesLayer.addTo(this.instance);
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

        activeNav: null, // { type: 'waypoint'|'route', id: 123, index: 0 }

        startNavigation: function (type, id) {
            this.activeNav = { type: type, id: id, index: 0 };
            document.getElementById('nav-data').style.display = 'flex';

            let name = "Target";
            if (type === 'waypoint') {
                const wp = lsnav.data.store.waypoints.find(w => w.id === id);
                if (wp) name = wp.name;
            } else if (type === 'rock') {
                this.activeNav.type = 'waypoint'; // treat as WP for nav
                const rk = lsnav.data.store.rocks.find(r => r.id === id);
                if (rk) name = "Rock: " + rk.name;
            } else if (type === 'route') {
                const rt = lsnav.data.store.routes.find(r => r.id === id);
                if (rt) name = rt.name + " (Pt 1)";
            }

            const wpNameEl = document.getElementById('nav-wp-name');
            if (wpNameEl) wpNameEl.innerText = name;
            lsnav.ui.switchTab('tab-map');

            const msg = lsnav.data.lang === 'es' ? "Navegación iniciada hacia el punto destino." : "Started navigating to target point.";
            alert(msg);
        },

        stopNavigation: function () {
            this.activeNav = null;
            document.getElementById('nav-data').style.display = 'none';
        },

        saveWaypoint: function (editId = null) {
            const name = document.getElementById('wp-name').value || "Waypoint";
            const desc = document.getElementById('wp-desc') ? document.getElementById('wp-desc').value : "";
            const tag = document.getElementById('wp-tag') ? document.getElementById('wp-tag').value : "General";

            if (!editId && !this.tempLat) return alert(lsnav.data.lang === 'es' ? "Elige una ubicación en la carta." : "Please pick a location on the chart.");

            if (editId) {
                const wp = lsnav.data.store.waypoints.find(w => w.id === editId);
                if (wp) {
                    wp.name = name;
                    wp.desc = desc;
                    wp.tag = tag;
                    if (this.tempLat) { wp.lat = this.tempLat; wp.lng = this.tempLng; }
                    lsnav.data.save();
                    lsnav.ui.renderMarks();
                    lsnav.map.removeLayer("mark_" + wp.id);
                    lsnav.map.renderMark(wp, 'waypoint');
                }
            } else {
                lsnav.data.addWaypoint({
                    id: Date.now(),
                    name: name,
                    desc: desc,
                    tag: tag,
                    lat: this.tempLat,
                    lng: this.tempLng
                });
            }

            lsnav.ui.closeModals();
            this.tempLat = null; this.tempLng = null;
        },

        saveRock: function (editId = null) {
            if (!lsnav.data.user) {
                const msg = lsnav.data.lang === 'es' ? "Inicia sesión para guardar rocas permanentes." : "Log in to save permanent rocks.";
                alert(msg);
                return;
            }

            const name = document.getElementById('rock-name') ? document.getElementById('rock-name').value : "Hazard / Rock";
            const desc = document.getElementById('rock-desc').value || "";
            const tag = document.getElementById('rock-tag') ? document.getElementById('rock-tag').value : "Danger";

            if (!editId && !this.tempLat) return alert(lsnav.data.lang === 'es' ? "Elige una ubicación en la carta." : "Please pick a location on the chart.");

            if (editId) {
                const rk = lsnav.data.store.rocks.find(r => r.id === editId);
                if (rk) {
                    rk.name = name;
                    rk.desc = desc;
                    rk.tag = tag;
                    if (this.tempLat) { rk.lat = this.tempLat; rk.lng = this.tempLng; }
                    lsnav.data.save();
                    lsnav.ui.renderMarks();
                    lsnav.map.removeLayer("mark_" + rk.id);
                    lsnav.map.renderMark(rk, 'rock');
                }
            } else {
                lsnav.data.addRock({
                    id: Date.now(),
                    name: name,
                    desc: desc,
                    tag: tag,
                    lat: this.tempLat,
                    lng: this.tempLng
                });
            }

            lsnav.ui.closeModals();
            this.tempLat = null; this.tempLng = null;
        },

        startRouteBuilder: function (editId = null) {
            const name = document.getElementById('route-name').value || "Route";
            const tag = document.getElementById('route-tag') ? document.getElementById('route-tag').value : "Cruising";
            const method = document.getElementById('route-method').value;

            if (method === 'auto') {
                const msg = lsnav.data.lang === 'es'
                    ? "El auto-enrutamiento marítimo complejo requiere APIs premium. Se utilizará enrutamiento directo (A -> B)."
                    : "Complex maritime auto-routing requires premium APIs. Direct line routing (A -> B) will be used.";
                alert(msg);
            }

            this.currentRouteData = {
                id: editId ? editId : Date.now(),
                name: name,
                tag: tag,
                method: method,
                points: [],
                distance: 0
            };

            lsnav.ui.closeModals();

            if (method === 'waypoints') {
                // Route via list of waypoints
                lsnav.ui.openRouteWaypointBuilder();
            } else {
                // Manual on chart
                this.routingMode = true;
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
                this.routingPolyline = L.polyline([], { color: '#ef4444', weight: 4, dashArray: '5,5' }).addTo(lsnav.map.instance);
            }
        },

        addRoutePoint: function (latlng) {
            if (!this.routingMode) return;
            this.currentRouteData.points.push([latlng.lat, latlng.lng]);
            this.routingPolyline.setLatLngs(this.currentRouteData.points);

            // Recalculate distance
            let distNM = 0;
            const pts = this.currentRouteData.points;
            for (let i = 1; i < pts.length; i++) {
                const p1 = { lat: pts[i - 1][0], lng: pts[i - 1][1] };
                const p2 = { lat: pts[i][0], lng: pts[i][1] };
                const dm = lsnav.utils.getDistance(p1, p2);
                distNM += (dm / 1852);
            }
            this.currentRouteData.distance = distNM;
        },

        finishRoute: function () {
            if (this.currentRouteData.points.length > 1) {
                // If editing existing, remove old route
                const existingIndex = lsnav.data.store.routes.findIndex(r => r.id === this.currentRouteData.id);
                if(existingIndex >= 0) {
                    lsnav.data.store.routes[existingIndex] = this.currentRouteData;
                    lsnav.data.save();
                    lsnav.ui.renderRoutes();
                    lsnav.map.removeLayer("route_" + this.currentRouteData.id);
                    lsnav.map.renderRoute(this.currentRouteData);
                } else {
                    lsnav.data.addRoute(this.currentRouteData);
                }
            }

            // Cleanup
            this.routingMode = false;
            this.currentRouteData = null;
            if (this.routingPolyline) lsnav.map.instance.removeLayer(this.routingPolyline);
            this.routingPolyline = null;

            const btn = document.getElementById('btn-finish-route');
            if (btn) btn.remove();
            lsnav.ui.closeModals();
        },

        addRoutePointFromList: function(lat, lng) {
            this.currentRouteData.points.push([lat, lng]);
            // Recalc
            let distNM = 0;
            const pts = this.currentRouteData.points;
            for (let i = 1; i < pts.length; i++) {
                const p1 = { lat: pts[i - 1][0], lng: pts[i - 1][1] };
                const p2 = { lat: pts[i][0], lng: pts[i][1] };
                const dm = lsnav.utils.getDistance(p1, p2);
                distNM += (dm / 1852);
            }
            this.currentRouteData.distance = distNM;
            
            document.getElementById('route-wp-current-len').innerText = this.currentRouteData.points.length;
        },

        clearRouteWaypointBuilder: function() {
            if(this.currentRouteData) {
                this.currentRouteData.points = [];
                this.currentRouteData.distance = 0;
            }
            document.getElementById('route-wp-current-len').innerText = 0;
        },

        cancelRouteWaypointBuilder: function() {
            this.currentRouteData = null;
            lsnav.ui.closeModals();
        },

        handleMapPick: function (latlng) {
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

        renderMarks: function (filterTag = '') {
            const list = document.getElementById('marks-list');
            if (!list) return;
            list.innerHTML = '';

            const isEs = lsnav.data.lang === 'es';
            let allMarks = [...lsnav.data.store.waypoints.map(w => ({ ...w, _t: 'waypoint' })), ...lsnav.data.store.rocks.map(r => ({ ...r, _t: 'rock' }))];

            if (filterTag) {
                allMarks = allMarks.filter(m => (m.tag || '').toLowerCase().includes(filterTag.toLowerCase()));
            }

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
                    <div class="item-main" onclick="lsnav.map.instance.flyTo([${item.lat}, ${item.lng}], 15); lsnav.ui.switchTab('tab-map')" style="cursor:pointer; flex: 1;">
                        <div class="item-icon" style="${item._t === 'rock' ? 'background:transparent; border:none;' : ''}">${iconHtml}</div>
                        <div>
                            <div><b>${item.name}</b> <span class="tag-badge">${item.tag || 'General'}</span></div>
                            <small class="text-muted">${typeTxt} | ${item.lat.toFixed(3)}, ${item.lng.toFixed(3)}</small>
                            ${item.desc ? `<div style="font-size:0.8rem; color:#cbd5e1;">${item.desc}</div>` : ''}
                        </div>
                    </div>
                    <div style="display:flex; align-items:center;">
                        <button onclick="setTimeout(() => lsnav.logic.startNavigation('${item._t}', ${item.id}), 100)" style="color:var(--success); background:none; border:none; margin-right:8px; font-size:1.2rem;" title="Navigate"><i class="fa-solid fa-location-arrow"></i></button>
                        <button onclick="lsnav.ui.${item._t === 'rock' ? 'openRockModal' : 'openWaypointModal'}(${item.id})" style="color:var(--primary); background:none; border:none; margin-right:8px; font-size:1.2rem;" title="Edit"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="lsnav.data.removeMark(${item.id}, '${item._t}')" style="color:#ef4444; background:none; border:none; font-size:1.2rem;" title="Delete"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `;
                list.appendChild(div);
            });
        },

        renderRoutes: function (filterTag = '') {
            const list = document.getElementById('routes-list');
            if (!list) return;
            list.innerHTML = '';

            const isEs = lsnav.data.lang === 'es';
            let allRoutes = lsnav.data.store.routes;

            if (filterTag) {
                allRoutes = allRoutes.filter(r => (r.tag || '').toLowerCase().includes(filterTag.toLowerCase()));
            }

            if (allRoutes.length === 0) {
                list.innerHTML = `<p class="text-muted" style="font-size:0.9rem;">${isEs ? 'No hay rutas.' : 'No routes.'}</p>`;
                return;
            }

            allRoutes.forEach(item => {
                const div = document.createElement('div');
                div.className = 'list-item';
                div.innerHTML = `
                    <div class="item-main" onclick="lsnav.map.instance.flyTo([${item.points[0][0]}, ${item.points[0][1]}], 12); lsnav.ui.switchTab('tab-map')" style="cursor:pointer; flex: 1;">
                        <div class="item-icon"><i class="fa-solid fa-route" style="color:white;"></i></div>
                        <div>
                            <div><b>${item.name}</b> <span class="tag-badge">${item.tag || 'Route'}</span></div>
                            <small class="text-muted">${item.distance.toFixed(2)} NM | ${item.points.length} pts</small>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center;">
                        <button onclick="setTimeout(() => lsnav.logic.startNavigation('route', ${item.id}), 100)" style="color:var(--success); background:none; border:none; margin-right:8px; font-size:1.2rem;" title="Navigate"><i class="fa-solid fa-location-arrow"></i></button>
                        <button onclick="lsnav.ui.openRouteModal(${item.id})" style="color:var(--primary); background:none; border:none; margin-right:8px; font-size:1.2rem;" title="Edit"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="lsnav.data.removeRoute(${item.id})" style="color:#ef4444; background:none; border:none; font-size:1.2rem;" title="Delete"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `;
                list.appendChild(div);
            });
        },

        closeModals: function () {
            document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('open'));
            lsnav.logic.pickingMode = false;
        },

        openMapContextMenu: function (latlng, evt) {
            let menu = document.getElementById('map-context-menu');
            if (!menu) {
                menu = document.createElement('div');
                menu.id = 'map-context-menu';
                menu.style.position = 'absolute';
                menu.style.zIndex = '5000';
                menu.style.background = 'var(--bg-card)';
                menu.style.border = '1px solid #334155';
                menu.style.borderRadius = '8px';
                menu.style.padding = '8px 0';
                menu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
                menu.style.minWidth = '160px';
                document.querySelector('.app-viewport').appendChild(menu);
            }

            // Adjust position
            let x = evt.clientX;
            let y = evt.clientY;
            
            // Basic boundary check
            const vp = document.querySelector('.app-viewport');
            if (x + 160 > vp.clientWidth) x = vp.clientWidth - 160;
            if (y + 160 > vp.clientHeight) y = vp.clientHeight - 160;

            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.style.display = 'block';

            const isEs = lsnav.data.lang === 'es';
            const html = `
                <div class="ctx-item" onclick="lsnav.ui.contextRoute(${latlng.lat}, ${latlng.lng})">
                    <i class="fa-solid fa-route" style="color:var(--primary);"></i>
                    <span>${isEs ? 'Ir Aquí' : 'Go Here (Route)'}</span>
                </div>
                <div class="ctx-divider"></div>
                <div class="ctx-item" onclick="lsnav.ui.contextNewMark('waypoint', ${latlng.lat}, ${latlng.lng})">
                    <i class="fa-solid fa-location-dot" style="color:#facc15;"></i>
                    <span>${isEs ? 'Nuevo Waypoint' : 'New Waypoint'}</span>
                </div>
                <div class="ctx-item" onclick="lsnav.ui.contextNewMark('rock', ${latlng.lat}, ${latlng.lng})">
                    <i class="fa-solid fa-triangle-exclamation" style="color:var(--danger);"></i>
                    <span>${isEs ? 'Nueva Piedra' : 'New Rock'}</span>
                </div>
            `;
            menu.innerHTML = html;
        },

        closeMapContextMenu: function () {
            const menu = document.getElementById('map-context-menu');
            if (menu) menu.style.display = 'none';
        },

        contextRoute: function(lat, lng) {
            this.closeMapContextMenu();
            const id = Date.now();
            // Start a quick 1-point route from user to target, or just navigate to this point directly.
            // Best is to create a temp waypoint for navigation
            lsnav.data.addWaypoint({
                id: id,
                name: "Quick Route Dest",
                lat: lat,
                lng: lng,
                tag: "Temporary"
            });
            lsnav.logic.startNavigation('waypoint', id);
        },

        contextNewMark: function(type, lat, lng) {
            this.closeMapContextMenu();
            lsnav.logic.tempLat = lat;
            lsnav.logic.tempLng = lng;
            if (type === 'rock') {
                this.openRockModal();
            } else {
                this.openWaypointModal();
            }
        },

        openWaypointModal: function (editId = null) {
            const modal = document.getElementById('modal-waypoint');
            const tit = document.getElementById('modal-waypoint-title');
            const btn = document.getElementById('btn-save-wp');
            const isEs = lsnav.data.lang === 'es';
            
            if (editId) {
                const wp = lsnav.data.store.waypoints.find(w => w.id === editId);
                if (wp) {
                    if (tit) tit.innerText = isEs ? 'Editar Waypoint' : 'Edit Waypoint';
                    document.getElementById('wp-name').value = wp.name || '';
                    if(document.getElementById('wp-desc')) document.getElementById('wp-desc').value = wp.desc || '';
                    if(document.getElementById('wp-tag')) document.getElementById('wp-tag').value = wp.tag || 'General';
                    btn.onclick = () => lsnav.logic.saveWaypoint(editId);
                    lsnav.logic.tempLat = wp.lat;
                    lsnav.logic.tempLng = wp.lng;
                }
            } else {
                if (tit) tit.innerText = isEs ? 'Añadir Waypoint' : 'Add Waypoint';
                document.getElementById('wp-name').value = '';
                if(document.getElementById('wp-desc')) document.getElementById('wp-desc').value = '';
                if(document.getElementById('wp-tag')) document.getElementById('wp-tag').value = 'General';
                btn.onclick = () => lsnav.logic.saveWaypoint();
            }
            modal.classList.add('open');
        },

        openRockModal: function (editId = null) {
            const modal = document.getElementById('modal-rock');
            const tit = document.getElementById('modal-rock-title');
            const btn = document.getElementById('btn-save-rock');
            const isEs = lsnav.data.lang === 'es';

            if (editId) {
                const rk = lsnav.data.store.rocks.find(w => w.id === editId);
                if (rk) {
                    if (tit) tit.innerText = isEs ? 'Editar Roca' : 'Edit Rock';
                    if(document.getElementById('rock-name')) document.getElementById('rock-name').value = rk.name || 'Hazard / Rock';
                    document.getElementById('rock-desc').value = rk.desc || '';
                    if(document.getElementById('rock-tag')) document.getElementById('rock-tag').value = rk.tag || 'Danger';
                    btn.onclick = () => lsnav.logic.saveRock(editId);
                    lsnav.logic.tempLat = rk.lat;
                    lsnav.logic.tempLng = rk.lng;
                }
            } else {
                if (tit) tit.innerText = isEs ? 'Añadir Roca' : 'Add Uncharted Rock';
                if(document.getElementById('rock-name')) document.getElementById('rock-name').value = 'Hazard / Rock';
                document.getElementById('rock-desc').value = '';
                if(document.getElementById('rock-tag')) document.getElementById('rock-tag').value = 'Danger';
                btn.onclick = () => lsnav.logic.saveRock();
            }
            modal.classList.add('open');
        },

        openRouteModal: function (editId = null) {
            const modal = document.getElementById('modal-route');
            const tit = document.getElementById('modal-route-title');
            const btn = document.getElementById('btn-save-route');
            const isEs = lsnav.data.lang === 'es';

            if (editId) {
                const rt = lsnav.data.store.routes.find(r => r.id === editId);
                if (rt) {
                    if (tit) tit.innerText = isEs ? 'Editar Ruta (Puntos desde cero)' : 'Edit Route (Redraw points)';
                    if(document.getElementById('route-name')) document.getElementById('route-name').value = rt.name || '';
                    if(document.getElementById('route-tag')) document.getElementById('route-tag').value = rt.tag || 'Route';
                    if(document.getElementById('route-method')) document.getElementById('route-method').value = rt.method || 'manual';
                    btn.onclick = () => lsnav.logic.startRouteBuilder(editId);
                }
            } else {
                if (tit) tit.innerText = isEs ? 'Crear Ruta' : 'Create Route';
                if(document.getElementById('route-name')) document.getElementById('route-name').value = '';
                if(document.getElementById('route-tag')) document.getElementById('route-tag').value = 'Route';
                if(document.getElementById('route-method')) document.getElementById('route-method').value = 'manual';
                btn.onclick = () => lsnav.logic.startRouteBuilder();
            }
            modal.classList.add('open');
        },

        openRouteWaypointBuilder: function() {
            const modal = document.getElementById('modal-route-waypoints');
            if(!modal) return;
            const list = document.getElementById('route-wp-list');
            list.innerHTML = '';
            
            lsnav.data.store.waypoints.forEach(wp => {
                const div = document.createElement('div');
                div.style.padding = '8px';
                div.style.borderBottom = '1px solid #334155';
                div.style.display = 'flex';
                div.style.justifyContent = 'space-between';
                div.style.alignItems = 'center';
                
                div.innerHTML = `
                    <div><b>${wp.name}</b> <small class="text-muted">${wp.tag||''}</small></div>
                    <button onclick="lsnav.logic.addRoutePointFromList(${wp.lat}, ${wp.lng})" style="background:var(--primary); color:white; border:none; padding:4px 8px; border-radius:4px; font-size:0.8rem;">Add</button>
                `;
                list.appendChild(div);
            });
            document.getElementById('route-wp-current-len').innerText = '0';
            modal.classList.add('open');
        },

        pickOnMap: function (type) {
            lsnav.ui.closeModals();
            lsnav.logic.pickingMode = true;
            lsnav.logic.pickingType = type;
            const msg = lsnav.data.lang === 'es'
                ? "Haz clic en la carta para elegir la ubicación."
                : "Click on the chart to pick location.";
            // Toast or small notification instead of alert is better but alert is what we're using
            alert(msg);
        }
    },

    // --- SETTINGS ---
    settings: {
        syncUI: function () {
            const s = lsnav.data.store.settings;
            if (document.getElementById('opt-bg')) document.getElementById('opt-bg').value = s.bg;
            if (document.getElementById('opt-overlay')) document.getElementById('opt-overlay').value = s.overlay || 'standard';
            if (document.getElementById('opt-iso-opacity')) document.getElementById('opt-iso-opacity').value = s.isoOpacity;
            if (document.getElementById('opt-gps-info')) {
                document.getElementById('opt-gps-info').checked = s.gpsInfo || false;
                lsnav.settings.toggleGpsInfo(s.gpsInfo || false);
            }
        },

        toggleGpsInfo: function (val) {
            lsnav.data.store.settings.gpsInfo = val;
            lsnav.data.save();
            const legend = document.getElementById('gps-info-legend');
            if (legend) {
                legend.style.display = val ? 'block' : 'none';
            }
        },

        setBackground: function (val) {
            lsnav.data.store.settings.bg = val;
            lsnav.data.save();
            lsnav.map.updateBackground(val);

            // Focus on Galicia Coast briefly when selecting oceanic Navionics style
            if (val === 'ocean') {
                lsnav.map.instance.flyTo([42.85, -9.1], 9);
            }
        },

        setOverlay: function (val) {
            // Check auth explicitly here before applying to store
            if (val === 'riasbaixas' && !lsnav.data.user) {
                const msg = lsnav.data.lang === 'es' ? "Inicia sesión para usar las cartas locales (HD offline)." : "Log in to use Offline HD local charts.";
                alert(msg);
                val = 'standard';
                if (document.getElementById('opt-overlay')) {
                    document.getElementById('opt-overlay').value = 'standard';
                }
            }

            lsnav.data.store.settings.overlay = val;
            lsnav.data.save();
            lsnav.map.updateIsobaths(); // Also updates the overlay now

            if (val === 'riasbaixas') {
                lsnav.map.instance.flyTo([42.50, -8.90], 12);
            }
        },

        loadLocalMBTiles: function (file) {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                lsnav.map._localMBTilesBuffer = e.target.result;
                lsnav.map.updateIsobaths();
                const msg = lsnav.data.lang === 'es' ? "Archivo MBTiles cargado correctamente." : "MBTiles file loaded successfully.";
                alert(msg);
            };
            reader.readAsArrayBuffer(file);
        },

        setIsobathOpacity: function (val) {
            lsnav.data.store.settings.isoOpacity = parseFloat(val);
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
        },

        getBearing: function (p1, p2) {
            const lat1 = p1.lat * Math.PI / 180;
            const lat2 = p2.lat * Math.PI / 180;
            const dLon = (p2.lng - p1.lng) * Math.PI / 180;

            const y = Math.sin(dLon) * Math.cos(lat2);
            const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
            let brng = Math.atan2(y, x);
            brng = brng * 180 / Math.PI;
            brng = (brng + 360) % 360;
            return brng;
        },

        exportRocks: function() {
            if (lsnav.data.store.rocks.length === 0) {
                alert(lsnav.data.lang === 'es' ? "No hay rocas que exportar." : "No rocks to export.");
                return;
            }
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(lsnav.data.store.rocks));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href",     dataStr);
            downloadAnchorNode.setAttribute("download", "ls_rocks_" + Date.now() + ".json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        },

        importRocks: function(file) {
            if(!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const imported = JSON.parse(e.target.result);
                    if(Array.isArray(imported)) {
                        let added = 0;
                        imported.forEach(rk => {
                            if (!lsnav.data.store.rocks.find(r => r.id === rk.id)) {
                                lsnav.data.addRock(rk);
                                added++;
                            }
                        });
                        alert(lsnav.data.lang === 'es' ? `Importadas ${added} rocas.` : `Imported ${added} rocks.`);
                    }
                } catch(err) {
                    console.error("Import error", err);
                    alert("Error parsing JSON");
                }
            };
            reader.readAsText(file);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    lsnav.init();
});
