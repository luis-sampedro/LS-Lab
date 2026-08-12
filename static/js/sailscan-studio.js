// LS Sail Scan (L3S) Studio v4.0 PRO
// Advanced CAD Image Editor, 2D Measurement & Multi-Stripe Sail Aerodynamics Engine

let scanData = {
    imageSrc: null,
    imageObj: null,
    imageDimensions: { width: 0, height: 0 },
    scanType: 'foot', // 'foot', 'leech', 'side', 'spinnaker'
    tack: 'starboard',  // 'starboard' (STBD) or 'port' (PORT) — critical for orientation tracking
    stripes: [],
    activeStripeIndex: 0,
    annotations: [], // 2D Vector CAD Annotations
    transform: {
        rotate: 0,
        flipH: false,
        flipV: false,
        crop: null, // { x, y, width, height }
        filters: { brightness: 100, contrast: 100, exposure: 0, invert: false }
    },
    manualMode: false,
    manualPoints: [],
    sailColor: 'auto',
    stripeColor: 'auto',
    numStripes: 3,
    sensitivity: 1.0,
    boatId: '',
    boatName: '',
    sailId: '',
    sailName: '',
    sailNumber: '',
    boatYear: '',
    sailmaker: '',
    certificateType: 'ORC',
    dimensions: {
        hlu: '',
        hlp: '',
        hqw: '',
        hhw: '',
        htw: '',
        huw: '',
        hb: '',
        area: ''
    },
    labelPhotoSrc: null,
    wind: { tws: '', twa: '' },
    rig: { cunningham: '', sheet: '' },
    notes: ''
};

// Virtual Camera & Canvas State
let camera = {
    zoom: 1.0,
    panX: 0,
    panY: 0,
    isPanning: false,
    startX: 0,
    startY: 0
};

let currentTool = 'select'; // 'select', 'pan', 'zoom', 'crop', 'ruler', 'angle', 'caliper', 'spline', 'pen', 'arrow', 'rect', 'ellipse', 'text', 'eyedropper'
let toolProps = {
    strokeColor: '#38bdf8',
    lineWidth: 2,
    lineStyle: 'solid',
    fillOpacity: 0,
    fontSize: 15
};

let viewOptions = {
    gridSize: 0,
    showThirds: false,
    showCrosshairs: false,
    snap: false,
    unit: 'm',
    pxPerMeter: 66.15 // Default: 1200px = 18.14m (1px = 0.0151m)
};

let undoStack = [];
let redoStack = [];
let selectedAnnotationId = null;
let isDrawing = false;
let drawingPoints = [];
let tempAnnotation = null;
let anglePoints = []; // 3-point protractor points

let cropState = {
    active: false,
    aspect: 'free',
    rect: { x: 0, y: 0, w: 0, h: 0 },
    dragMode: null, // 'move', 'nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'
    startX: 0,
    startY: 0
};

let ghostData = null;
let canvas = null;
let ctx = null;
let isDraggingHandle = null; // 'p0', 'p1', 'p2', 'p3', or null
let hoverHandle = null;
let showBSplinePolygon = true; // Show/hide 4-point B-spline control polygon and tangent arms
let camberChart = null;
let twistChart = null;
let compareChart = null;
let currentUserToken = null;
let isUserPro = false;
let isMagicSnapMode = false;
let eyedropperTarget = null; // 'sail', 'stripe', or 'cad'

// ---------------- INITIALIZATION & LIFECYCLE ----------------

document.addEventListener('DOMContentLoaded', () => {
    initStudio();
    setupDropzone();
    setupCanvasEvents();
    setupKeyboardShortcuts();
    initAuth();
    loadUrlParams();
    applyToolbarConfig();
});

function initStudio() {
    canvas = document.getElementById('sailStudioCanvas');
    if (canvas) {
        ctx = canvas.getContext('2d');
    }
}

function setupDropzone() {
    const dropzone = document.getElementById('dropzone');
    if (!dropzone) return;
    
    ['dragenter', 'dragover'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.style.borderColor = '#38bdf8';
            dropzone.style.background = 'rgba(56, 189, 248, 0.1)';
        });
    });
    
    ['dragleave', 'drop'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.style.borderColor = '#475569';
            dropzone.style.background = '#0f172a';
        });
    });
    
    dropzone.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });
}

function loadUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const bId = params.get('boat_id');
    const sId = params.get('sail_id');
    const type = params.get('type');
    
    if (type && ['foot', 'leech', 'side', 'spinnaker'].includes(type)) {
        selectScanType(type);
    }
    if (bId) scanData.boatId = bId;
    if (sId) scanData.sailId = sId;
}

// ---------------- TAB WIZARD NAVIGATION ----------------

window.switchScanTab = function(tabName) {
    document.querySelectorAll('.wizard-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    const panel = document.getElementById(`panel-${tabName}`);
    const btn = document.getElementById(`btn-tab-${tabName}`);
    
    if (panel) panel.classList.add('active');
    if (btn) btn.classList.add('active');
    
    if (tabName === 'canvas') {
        resizeCanvasToFit();
        renderCanvas();
    } else if (tabName === 'analytics') {
        updateAnalyticsView();
    } else if (tabName === 'compare') {
        updateCompareView();
    } else if (tabName === 'report') {
        buildReportPreview();
    }
};

function unlockAllTabs() {
    ['canvas', 'analytics', 'compare', 'report'].forEach(tab => {
        const btn = document.getElementById(`btn-tab-${tab}`);
        if (btn) {
            btn.classList.remove('disabled');
            btn.removeAttribute('disabled');
        }
    });
}

// ---------------- SCAN TYPE SELECTION ----------------

// ---------------- TACK / SIDE SELECTOR ----------------

window.setScanTack = function(tack) {
    scanData.tack = tack;
    
    const isStbd = (tack === 'starboard');
    
    // Update toggle buttons
    const btnStbd = document.getElementById('btn-tack-stbd');
    const btnPort = document.getElementById('btn-tack-port');
    if (btnStbd && btnPort) {
        if (isStbd) {
            btnStbd.style.borderColor = '#10b981';
            btnStbd.style.background = 'rgba(16, 185, 129, 0.15)';
            btnStbd.style.color = '#34d399';
            btnPort.style.borderColor = '#475569';
            btnPort.style.background = '#0f172a';
            btnPort.style.color = '#94a3b8';
        } else {
            btnPort.style.borderColor = '#ef4444';
            btnPort.style.background = 'rgba(239, 68, 68, 0.15)';
            btnPort.style.color = '#fca5a5';
            btnStbd.style.borderColor = '#475569';
            btnStbd.style.background = '#0f172a';
            btnStbd.style.color = '#94a3b8';
        }
    }
    
    // Update sidebar badge
    const badge = document.getElementById('scan-tack-badge');
    if (badge) {
        badge.innerText = isStbd ? 'STBD' : 'PORT';
        badge.style.background = isStbd ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
        badge.style.color = isStbd ? '#34d399' : '#fca5a5';
        badge.style.borderColor = isStbd ? '#10b981' : '#ef4444';
    }
    
    // Sync Report Panel quick-selector buttons
    const repStbd = document.getElementById('rep-btn-tack-stbd');
    const repPort = document.getElementById('rep-btn-tack-port');
    if (repStbd && repPort) {
        if (isStbd) {
            repStbd.style.borderColor = '#10b981'; repStbd.style.background = 'rgba(16,185,129,0.2)'; repStbd.style.color = '#34d399';
            repPort.style.borderColor = '#475569'; repPort.style.background = '#0f172a'; repPort.style.color = '#94a3b8';
        } else {
            repPort.style.borderColor = '#ef4444'; repPort.style.background = 'rgba(239,68,68,0.15)'; repPort.style.color = '#fca5a5';
            repStbd.style.borderColor = '#475569'; repStbd.style.background = '#0f172a'; repStbd.style.color = '#94a3b8';
        }
    }
    
    // Re-render canvas to update watermark
    if (canvas && scanData.imageObj) renderCanvas();
};

window.selectScanType = function(type) {
    scanData.scanType = type;
    
    document.querySelectorAll('.type-pill-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`btn-type-${type}`);
    if (activeBtn) activeBtn.classList.add('active');
    
    const badge = document.getElementById('scan-type-badge');
    if (badge) badge.innerText = type.toUpperCase();
    
    const colorCard = document.getElementById('autodetect-color-card');
    const statusPill = document.getElementById('autodetect-status-pill');
    
    if (type === 'foot') {
        if (colorCard) colorCard.style.display = 'block';
        if (statusPill) {
            statusPill.style.display = 'inline-block';
            statusPill.innerText = 'Auto-detect Active (Foot)';
            statusPill.style.color = '#10b981';
            statusPill.style.borderColor = '#10b981';
        }
    } else {
        if (colorCard) colorCard.style.display = 'block';
        if (statusPill) {
            statusPill.style.display = 'inline-block';
            statusPill.innerText = 'Edge & Corridor Tracer Guide';
            statusPill.style.color = '#f59e0b';
            statusPill.style.borderColor = '#f59e0b';
        }
    }
};

// ---------------- IMAGE HANDLING & PRESETS ----------------

window.handleFileSelect = window.handleSailImageFile = function(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const dataUrl = e.target.result;
        loadImageFromDataUrl(dataUrl, file.name);
    };
    reader.readAsDataURL(file);
};

function loadImageFromDataUrl(dataUrl, filename = 'sail_photo.jpg') {
    scanData.imageSrc = dataUrl;
    const img = new Image();
    img.onload = function() {
        scanData.imageObj = img;
        scanData.imageDimensions = { width: img.width, height: img.height };
        
        // Reset transforms
        scanData.transform = {
            rotate: 0,
            flipH: false,
            flipV: false,
            crop: null,
            filters: { brightness: 100, contrast: 100, exposure: 0, invert: false }
        };
        camera.zoom = 1.0;
        camera.panX = 0;
        camera.panY = 0;
        
        // Update dropzone preview
        const dropzonePreview = document.getElementById('dropzone-preview');
        const dropzonePrompt = document.getElementById('dropzone-prompt');
        const previewImg = document.getElementById('previewImg');
        
        if (previewImg) previewImg.src = dataUrl;
        if (dropzonePreview) dropzonePreview.style.display = 'flex';
        if (dropzonePrompt) dropzonePrompt.style.display = 'none';
        
        // Update thumbnail if present
        const thumb = document.getElementById('image-thumbnail');
        const fname = document.getElementById('image-filename');
        const meta = document.getElementById('image-meta');
        const bar = document.getElementById('image-preview-bar');
        
        if (thumb) thumb.src = dataUrl;
        if (fname) fname.innerText = filename;
        if (meta) meta.innerText = `${img.width} × ${img.height} px`;
        if (bar) bar.style.display = 'flex';
        
        updateMinimapThumbnail();
    };
    img.src = dataUrl;
}

window.loadPresetSample = function(presetKey) {
    if (!presetKey) return;
    
    if (presetKey === 'white_blue') {
        selectScanType('foot');
        document.getElementById('paramSailColor').value = 'white';
        document.getElementById('paramStripeColor').value = 'blue';
        loadImageFromDataUrl('/static/images/sample-white-blue.jpg', 'White_Sail_Blue_Stripes.jpg');
    } else if (presetKey === 'white_boom') {
        selectScanType('foot');
        document.getElementById('paramSailColor').value = 'white';
        document.getElementById('paramStripeColor').value = 'black';
        loadImageFromDataUrl('/static/images/sample-white-boom.jpg', 'White_Sail_Dark_Boom.jpg');
    } else if (presetKey === 'black_carbon') {
        selectScanType('foot');
        document.getElementById('paramSailColor').value = 'black';
        document.getElementById('paramStripeColor').value = 'red';
        loadImageFromDataUrl('/static/images/sample-black-red.jpg', 'Black_Carbon_Red_Stripes.jpg');
    } else if (presetKey === 'jib_label') {
        unlockAllTabs();
        loadSampleJibLabel();
        switchScanTab('report');
    }
};

window.loadSampleJibLabel = function() {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('specSailNumber', '831 (ESP)');
    setVal('specSailName', 'J1 Light-Medium Jib');
    setVal('specBoatName', 'ESP-831 Grand Soleil / TP52');
    setVal('specBoatYear', '2025');
    setVal('specSailmaker', 'Custom Tech Loft');
    setVal('specCertificate', 'ORC');
    
    setVal('dim_hlu', '18.14');
    setVal('dim_hlp', '5.25');
    setVal('dim_hqw', '3.93');
    setVal('dim_hhw', '2.68');
    setVal('dim_htw', '1.46');
    setVal('dim_huw', '0.77');
    setVal('dim_hb', '0.108');

    setVal('rig_tws', '14.5');
    setVal('rig_twa', '42');
    setVal('rig_cunningham', 'Mark 4 / 2800 kg');
    setVal('rig_sheet', 'Position 3 / Trimmed');
    
    const labelImg = document.getElementById('labelPhotoImg');
    const labelPlaceholder = document.getElementById('labelPhotoPlaceholder');
    if (labelImg) {
        labelImg.src = '/static/images/sample-jib-label.jpg';
        labelImg.style.display = 'block';
    }
    if (labelPlaceholder) labelPlaceholder.style.display = 'none';
    scanData.labelPhotoSrc = '/static/images/sample-jib-label.jpg';
    
    syncSpecsFromInputs();
    buildReportPreview();
};

// ---------------- COMPUTER VISION & AUTO-DETECTION ----------------

window.processAndOpenStudio = function() {
    if (!scanData.imageSrc && !scanData.imageObj) {
        alert('Please select or upload a sail photo first.');
        return;
    }
    
    unlockAllTabs();
    runAutoDetection();
};

window.toggleMagicSnapMode = function() {
    isMagicSnapMode = !isMagicSnapMode;
    const lbl = document.getElementById('magic-snap-lbl');
    const btn = document.getElementById('btn-magic-snap');
    const hint = document.getElementById('canvas-hint-pill');
    
    if (lbl) lbl.innerText = isMagicSnapMode ? 'ON' : 'OFF';
    if (btn) {
        btn.style.background = isMagicSnapMode ? 'linear-gradient(135deg, #6366f1, #a855f7)' : '#1e293b';
        btn.style.color = isMagicSnapMode ? '#ffffff' : '#a855f7';
    }
    
    if (canvas) {
        canvas.style.cursor = isMagicSnapMode ? 'crosshair' : 'default';
    }
    
    if (isMagicSnapMode && hint) {
        hint.innerHTML = '✨ <strong>Magic Snap Active:</strong> Click anywhere on/near a stripe to auto-trace the full line!';
    } else if (hint) {
        hint.innerHTML = '💡 <strong>Tip:</strong> Drag P1 or P2 endpoints to adjust, or activate ✨ Magic Snap.';
    }
};

window.snapStripeFromClick = function(clickX, clickY) {
    if (!scanData.imageSrc) return;
    
    const sailColor = document.getElementById('canvasSailColor')?.value || document.getElementById('paramSailColor')?.value || 'auto';
    const stripeColor = document.getElementById('canvasStripeColor')?.value || document.getElementById('paramStripeColor')?.value || 'auto';
    const sensitivity = parseFloat(document.getElementById('paramSensitivity')?.value || '1.0');
    
    const hint = document.getElementById('canvas-hint-pill');
    if (hint) hint.innerHTML = '⚡ <strong>Snapping to stripe ridge...</strong>';
    
    fetch('/api/sail-scan/snap-stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            image: scanData.imageSrc,
            click_point: { x: clickX, y: clickY },
            sail_color: sailColor,
            stripe_color: stripeColor,
            sensitivity: sensitivity
        })
    })
    .then(r => r.json())
    .then(res => {
        if (res.success && res.path && res.path.length > 0) {
            pushUndoState();
            let active = scanData.stripes[scanData.activeStripeIndex];
            if (!active) {
                active = {
                    id: `stripe_${scanData.activeStripeIndex + 1}`,
                    label: `Stripe #${scanData.activeStripeIndex + 1}`,
                    color: '#38bdf8'
                };
                scanData.stripes.push(active);
            }
            
            active.p1 = res.p1;
            active.p2 = res.p2;
            active.path = res.path;
            active.metrics = res.metrics;
            
            renderCanvas();
            updateHUDMetrics();
            updateStripeLayerTabs();
            updateLayersList();
            
            if (hint) hint.innerHTML = `✨ <strong>Locked onto stripe!</strong> Camber: ${res.metrics.camber}% | Draft: ${res.metrics.draft_pos}%`;
        }
    })
    .catch(err => console.error('Snap stripe error:', err));
};

window.runAutoDetection = function() {
    if (!scanData.imageSrc) return;
    
    const sailColorEl = document.getElementById('canvasSailColor') || document.getElementById('paramSailColor');
    const stripeColorEl = document.getElementById('canvasStripeColor') || document.getElementById('paramStripeColor');
    const numStripesEl = document.getElementById('paramNumStripes');
    const sensitivityEl = document.getElementById('paramSensitivity');
    
    const sailColor = scanData.customSailColor || sailColorEl?.value || 'auto';
    const stripeColor = scanData.customStripeColor || stripeColorEl?.value || 'auto';
    const numStripes = parseInt(numStripesEl?.value || '3');
    const sensitivity = parseFloat(sensitivityEl?.value || '1.0');
    
    if (!scanData.customSailColor) {
        if (document.getElementById('canvasSailColor')) document.getElementById('canvasSailColor').value = sailColor;
        if (document.getElementById('paramSailColor')) document.getElementById('paramSailColor').value = sailColor;
    }
    if (!scanData.customStripeColor) {
        if (document.getElementById('canvasStripeColor')) document.getElementById('canvasStripeColor').value = stripeColor;
        if (document.getElementById('paramStripeColor')) document.getElementById('paramStripeColor').value = stripeColor;
    }
    
    scanData.sailColor = sailColor;
    scanData.stripeColor = stripeColor;
    scanData.numStripes = numStripes;
    scanData.sensitivity = sensitivity;
    
    const hint = document.getElementById('canvas-hint-pill');
    if (hint) hint.innerHTML = '⏳ <strong>Running Computer Vision Auto-Detection...</strong>';
    
    fetch('/api/sail-scan/autodetect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            image: scanData.imageSrc,
            sail_color: sailColor,
            stripe_color: stripeColor,
            num_stripes: numStripes,
            sensitivity: sensitivity
        })
    })
    .then(r => r.json())
    .then(data => {
        if (data.detected_sail) {
            const dot1 = document.getElementById('dot-detected-sail');
            const lbl1 = document.getElementById('lbl-detected-sail');
            const dot2 = document.getElementById('canvas-dot-sail');
            const lbl2 = document.getElementById('canvas-lbl-sail');
            const bnr = document.getElementById('autodetect-result-badge');
            
            if (dot1) dot1.style.background = data.detected_sail.hex || '#fff';
            if (lbl1) lbl1.innerText = `Sail: ${data.detected_sail.name}`;
            if (dot2) dot2.style.background = data.detected_sail.hex || '#fff';
            if (lbl2) lbl2.innerText = `Sail: ${data.detected_sail.name.split('/')[0]}`;
            if (bnr) bnr.style.display = 'flex';
        }
        
        if (data.detected_stripe) {
            const dot1 = document.getElementById('dot-detected-stripe');
            const lbl1 = document.getElementById('lbl-detected-stripe');
            const dot2 = document.getElementById('canvas-dot-stripe');
            const lbl2 = document.getElementById('canvas-lbl-stripe');
            
            if (dot1) dot1.style.background = data.detected_stripe.hex || '#38bdf8';
            if (lbl1) lbl1.innerText = `Stripe: ${data.detected_stripe.name}`;
            if (dot2) dot2.style.background = data.detected_stripe.hex || '#38bdf8';
            if (lbl2) lbl2.innerText = `Stripe: ${data.detected_stripe.name}`;
        }
        
        if (data.success && data.stripes && data.stripes.length > 0) {
            pushUndoState();
            scanData.stripes = data.stripes;
            scanData.activeStripeIndex = 0;
            
            updateStripeLayerTabs();
            updateHUDMetrics();
            updateLayersList();
            switchScanTab('canvas');
            
            if (hint) hint.innerHTML = `✅ <strong>${data.stripes.length} Real Stripes Detected!</strong> (${data.detected_sail?.name || 'Sail'} • ${data.detected_stripe?.name || 'Stripe'})`;
        } else {
            fallbackDefaultStripes();
        }
    })
    .catch(err => {
        console.error('Autodetect error:', err);
        fallbackDefaultStripes();
    });
};

function fallbackDefaultStripes() {
    const w = scanData.imageDimensions.width || 800;
    const h = scanData.imageDimensions.height || 600;
    
    const yLevels = [0.72, 0.48, 0.25];
    const colors = ['#38bdf8', '#10b981', '#f59e0b'];
    
    scanData.stripes = yLevels.map((yFrac, idx) => {
        const x1 = w * 0.12, y1 = h * (yFrac + 0.04);
        const x2 = w * 0.88, y2 = h * (yFrac - 0.04);
        const chord = x2 - x1;
        const depth = chord * (0.13 - idx * 0.02);
        
        const path = [];
        for (let i = 0; i <= 60; i++) {
            const t = i / 60;
            const px = x1 + (x2 - x1) * t;
            const py = y1 + (y2 - y1) * t - depth * 4 * t * (1 - t);
            path.push([px, py]);
        }
        
        return {
            id: `stripe_${idx + 1}`,
            label: idx === 0 ? 'Stripe #1 (Bottom)' : idx === 1 ? 'Stripe #2 (Mid)' : 'Stripe #3 (Top)',
            color: colors[idx % colors.length],
            p1: { x: x1, y: y1 },
            p2: { x: x2, y: y2 },
            path: path,
            metrics: {
                camber: parseFloat(((depth / chord) * 100).toFixed(1)),
                draft_pos: 45.0,
                twist: parseFloat((idx * 3.5).toFixed(1)),
                entry: 18.2,
                exit: 9.4,
                chord_len: parseFloat(chord.toFixed(1)),
                normalized_curve: path.map(([px, py]) => [(px - x1) / chord, (Math.abs(py - (y1 + (y2 - y1) * ((px - x1) / chord))) / chord) * 100])
            }
        };
    });
    
    scanData.activeStripeIndex = 0;
    updateStripeLayerTabs();
    updateHUDMetrics();
    updateLayersList();
    switchScanTab('canvas');
    
    const hint = document.getElementById('canvas-hint-pill');
    if (hint) hint.innerHTML = `💡 <strong>Click '✨ Magic Snap'</strong> or use the 2D CAD toolbar on the left!`;
}

// ---------------- PRO CAD TOOLBAR & TOOL SWITCHING ----------------

const CAD_TOOL_NAMES = {
    select: { icon: '👆', name: 'Select & Move (V)', nameEs: 'Seleccionar (V)' },
    pan: { icon: '🖐️', name: 'Pan View (H / Space)', nameEs: 'Mano / Desplazar (H)' },
    zoom: { icon: '🔍', name: 'Box Zoom (Z)', nameEs: 'Zoom por Caja (Z)' },
    crop: { icon: '✂️', name: 'Crop Image (C)', nameEs: 'Recortar (C)' },
    ruler: { icon: '📏', name: 'Distance Ruler (R)', nameEs: 'Regla de Medición (R)' },
    angle: { icon: '📐', name: 'Angle Protractor (A)', nameEs: 'Goniómetro / Ángulo (A)' },
    caliper: { icon: '⛵', name: 'Draft Caliper (D)', nameEs: 'Calibre de Camber (D)' },
    spline: { icon: '〰️', name: 'Curvature Spline (S)', nameEs: 'Curva Spline (S)' },
    pen: { icon: '✏️', name: 'Freehand Pen (P)', nameEs: 'Pincel Libre (P)' },
    arrow: { icon: '↗️', name: 'Dimension Arrow (W)', nameEs: 'Flecha de Apunte (W)' },
    rect: { icon: '⬜', name: 'Rectangle (B)', nameEs: 'Rectángulo (B)' },
    ellipse: { icon: '⭕', name: 'Circle / Ellipse (O)', nameEs: 'Círculo / Elipse (O)' },
    text: { icon: '🔤', name: 'Text Box (T)', nameEs: 'Cuadro de Texto (T)' },
    eyedropper: { icon: '🧪', name: 'Color Eyedropper', nameEs: 'Pipeta de Color' }
};

window.setStudioTool = function(toolName) {
    currentTool = toolName;
    
    // Update toolbar button highlights
    document.querySelectorAll('.cad-vtool-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`tool-${toolName}`);
    if (activeBtn) activeBtn.classList.add('active');
    
    // Update active tool pill
    const pill = document.getElementById('cad-active-tool-pill');
    if (pill) {
        const info = CAD_TOOL_NAMES[toolName] || { icon: '🛠️', name: toolName };
        pill.innerHTML = `Tool: ${info.icon} ${info.name}`;
    }
    
    // Crop Mode Management
    const cropBar = document.getElementById('crop-action-bar');
    if (toolName === 'crop') {
        initCropBox();
        if (cropBar) cropBar.style.display = 'flex';
    } else {
        if (cropBar) cropBar.style.display = 'none';
        cropState.active = false;
    }
    
    // Reset temporary drawing states
    isDrawing = false;
    drawingPoints = [];
    anglePoints = [];
    tempAnnotation = null;
    
    // Cursor handling
    updateCanvasCursor();
    renderCanvas();
};

function updateCanvasCursor() {
    if (!canvas) return;
    if (currentTool === 'pan') canvas.style.cursor = 'grab';
    else if (currentTool === 'select') canvas.style.cursor = 'default';
    else if (currentTool === 'text') canvas.style.cursor = 'text';
    else if (currentTool === 'eyedropper') canvas.style.cursor = 'crosshair';
    else canvas.style.cursor = 'crosshair';
}

window.setToolProp = function(propName, value) {
    toolProps[propName] = value;
    
    // If an annotation is currently selected, update its styling in real-time
    if (selectedAnnotationId) {
        const ann = scanData.annotations.find(a => a.id === selectedAnnotationId);
        if (ann) {
            pushUndoState();
            ann[propName] = value;
            renderCanvas();
            updateLayersList();
        }
    }
};

// ---------------- IMAGE TRANSFORMS & FILTERS ----------------

window.rotateImage = function(deg) {
    pushUndoState();
    scanData.transform.rotate = ((scanData.transform.rotate || 0) + deg) % 360;
    renderCanvas();
    updateMinimapThumbnail();
};

window.flipImage = function(axis) {
    pushUndoState();
    if (axis === 'h') {
        scanData.transform.flipH = !scanData.transform.flipH;
        // Auto-swap tack on horizontal flip — the image side changes
        const newTack = (scanData.tack === 'starboard') ? 'port' : 'starboard';
        setScanTack(newTack);
    }
    if (axis === 'v') scanData.transform.flipV = !scanData.transform.flipV;
    renderCanvas();
    updateMinimapThumbnail();
};

window.applyImageFilter = function(filterName, value) {
    scanData.transform.filters[filterName] = value;
    const lbl = document.getElementById(`lbl-filter-${filterName}`);
    if (lbl) {
        lbl.innerText = (filterName === 'exposure') ? (value > 0 ? `+${value}` : value) : `${value}%`;
    }
    renderCanvas();
};

window.resetImageFilters = function() {
    scanData.transform.filters = { brightness: 100, contrast: 100, exposure: 0, invert: false };
    
    const b = document.getElementById('filter-brightness'); if (b) b.value = 100;
    const c = document.getElementById('filter-contrast'); if (c) c.value = 100;
    const e = document.getElementById('filter-exposure'); if (e) e.value = 0;
    const i = document.getElementById('filter-invert'); if (i) i.checked = false;
    
    const lb = document.getElementById('lbl-filter-brightness'); if (lb) lb.innerText = '100%';
    const lc = document.getElementById('lbl-filter-contrast'); if (lc) lc.innerText = '100%';
    const le = document.getElementById('lbl-filter-exposure'); if (le) le.innerText = '0';
    
    renderCanvas();
};

window.toggleFilterPopover = function() {
    const pop = document.getElementById('cad-filters-popover');
    if (pop) {
        pop.style.display = (pop.style.display === 'none' || !pop.style.display) ? 'flex' : 'none';
    }
};

window.toggleOptionsMenu = function() {
    const m = document.getElementById('cad-options-menu');
    if (m) {
        m.style.display = (m.style.display === 'none' || !m.style.display) ? 'flex' : 'none';
    }
};

// ---------------- CROP ENGINE ----------------

function initCropBox() {
    cropState.active = true;
    const w = scanData.imageDimensions.width || 800;
    const h = scanData.imageDimensions.height || 600;
    
    // Default: centered 80% box
    cropState.rect = {
        x: w * 0.1,
        y: h * 0.1,
        w: w * 0.8,
        h: h * 0.8
    };
}

window.setCropAspect = function(aspect) {
    cropState.aspect = aspect;
    const w = scanData.imageDimensions.width;
    const h = scanData.imageDimensions.height;
    
    if (aspect === '1:1') {
        const side = Math.min(w, h) * 0.8;
        cropState.rect.w = side;
        cropState.rect.h = side;
    } else if (aspect === '4:3') {
        const baseW = w * 0.8;
        cropState.rect.w = baseW;
        cropState.rect.h = baseW * (3 / 4);
    } else if (aspect === '16:9') {
        const baseW = w * 0.8;
        cropState.rect.w = baseW;
        cropState.rect.h = baseW * (9 / 16);
    } else if (aspect === 'sail') {
        const hlu = parseFloat(scanData.dimensions.hlu || '18.14');
        const hlp = parseFloat(scanData.dimensions.hlp || '5.25');
        const ratio = hlp / hlu;
        const baseH = h * 0.8;
        cropState.rect.h = baseH;
        cropState.rect.w = baseH * ratio;
    }
    renderCanvas();
};

window.applyCrop = function() {
    if (!scanData.imageObj || !cropState.active) return;
    
    pushUndoState();
    
    // Render cropped image to offscreen canvas
    const offCanvas = document.createElement('canvas');
    offCanvas.width = Math.max(10, Math.floor(cropState.rect.w));
    offCanvas.height = Math.max(10, Math.floor(cropState.rect.h));
    const offCtx = offCanvas.getContext('2d');
    
    offCtx.drawImage(
        scanData.imageObj,
        cropState.rect.x, cropState.rect.y, cropState.rect.w, cropState.rect.h,
        0, 0, offCanvas.width, offCanvas.height
    );
    
    const croppedDataUrl = offCanvas.toDataURL('image/jpeg', 0.95);
    loadImageFromDataUrl(croppedDataUrl, 'cropped_sail.jpg');
    
    setStudioTool('select');
};

window.cancelCrop = function() {
    setStudioTool('select');
};

// ---------------- PRO ZOOM, PAN & CAMERA MATRIX ----------------

window.zoomStep = function(delta, centerCanvasPoint = null) {
    const prevZoom = camera.zoom;
    camera.zoom = Math.min(10.0, Math.max(0.1, camera.zoom + delta));
    
    if (centerCanvasPoint && canvas) {
        // Zoom centered around mouse pointer
        const scaleChange = camera.zoom / prevZoom;
        const cx = centerCanvasPoint.x - canvas.width / 2;
        const cy = centerCanvasPoint.y - canvas.height / 2;
        camera.panX = cx - (cx - camera.panX) * scaleChange;
        camera.panY = cy - (cy - camera.panY) * scaleChange;
    }
    
    updateZoomBadge();
    renderCanvas();
};

window.zoomToFit = function() {
    camera.zoom = 1.0;
    camera.panX = 0;
    camera.panY = 0;
    updateZoomBadge();
    resizeCanvasToFit();
    renderCanvas();
};

window.zoomActual = function() {
    camera.zoom = 1.0;
    camera.panX = 0;
    camera.panY = 0;
    updateZoomBadge();
    renderCanvas();
};

function updateZoomBadge() {
    const badge = document.getElementById('cad-zoom-badge');
    if (badge) {
        badge.innerText = `${Math.round(camera.zoom * 100)}%`;
    }
}

// ---------------- MINIMAP NAVIGATOR ----------------

window.toggleMinimap = function() {
    const box = document.getElementById('cad-minimap-box');
    if (box) {
        const isHidden = (box.style.display === 'none' || !box.style.display);
        box.style.display = isHidden ? 'block' : 'none';
        if (isHidden) updateMinimap();
    }
};

function updateMinimapThumbnail() {
    const mCanvas = document.getElementById('minimapCanvas');
    if (!mCanvas || !scanData.imageObj) return;
    const mCtx = mCanvas.getContext('2d');
    
    mCtx.clearRect(0, 0, mCanvas.width, mCanvas.height);
    mCtx.drawImage(scanData.imageObj, 0, 0, mCanvas.width, mCanvas.height);
}

function updateMinimap() {
    const mCanvas = document.getElementById('minimapCanvas');
    const vBox = document.getElementById('minimap-viewport-box');
    if (!mCanvas || !vBox || !scanData.imageDimensions.width) return;
    
    updateMinimapThumbnail();
    
    // Calculate viewport bounds on minimap
    const fracW = Math.min(1, 1 / camera.zoom);
    const fracH = Math.min(1, 1 / camera.zoom);
    
    const leftFrac = Math.max(0, Math.min(1 - fracW, (0.5 - (camera.panX / (canvas.width * camera.zoom)) - fracW / 2)));
    const topFrac = Math.max(0, Math.min(1 - fracH, (0.5 - (camera.panY / (canvas.height * camera.zoom)) - fracH / 2)));
    
    vBox.style.width = `${fracW * 100}%`;
    vBox.style.height = `${fracH * 100}%`;
    vBox.style.left = `${leftFrac * 100}%`;
    vBox.style.top = `${topFrac * 100}%`;
}

// ---------------- CANVAS COORDINATE TRANSFORMS ----------------

function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
}

function screenToImage(canvasX, canvasY) {
    if (!canvas || !scanData.imageDimensions.width) return { x: canvasX, y: canvasY };
    
    const cw = canvas.width;
    const ch = canvas.height;
    const baseScale = Math.min(cw / scanData.imageDimensions.width, ch / scanData.imageDimensions.height);
    const effectiveScale = baseScale * camera.zoom;
    
    const imgCenterX = cw / 2 + camera.panX;
    const imgCenterY = ch / 2 + camera.panY;
    
    const ix = (canvasX - imgCenterX) / effectiveScale + scanData.imageDimensions.width / 2;
    const iy = (canvasY - imgCenterY) / effectiveScale + scanData.imageDimensions.height / 2;
    
    return { x: ix, y: iy };
}

function imageToScreen(imgX, imgY) {
    if (!canvas || !scanData.imageDimensions.width) return { x: imgX, y: imgY };
    
    const cw = canvas.width;
    const ch = canvas.height;
    const baseScale = Math.min(cw / scanData.imageDimensions.width, ch / scanData.imageDimensions.height);
    const effectiveScale = baseScale * camera.zoom;
    
    const imgCenterX = cw / 2 + camera.panX;
    const imgCenterY = ch / 2 + camera.panY;
    
    const cx = (imgX - scanData.imageDimensions.width / 2) * effectiveScale + imgCenterX;
    const cy = (imgY - scanData.imageDimensions.height / 2) * effectiveScale + imgCenterY;
    
    return { x: cx, y: cy };
}

// ---------------- CANVAS RENDERING PIPELINE ----------------

function resizeCanvasToFit() {
    const wrapper = document.getElementById('canvasWrapper');
    if (!wrapper || !canvas || !scanData.imageObj) return;
    
    const maxW = wrapper.clientWidth;
    const maxH = wrapper.clientHeight;
    
    const imgW = scanData.imageDimensions.width;
    const imgH = scanData.imageDimensions.height;
    
    const aspect = imgW / imgH;
    let targetW = maxW;
    let targetH = maxW / aspect;
    
    if (targetH > maxH) {
        targetH = maxH;
        targetW = maxH * aspect;
    }
    
    canvas.width = Math.floor(targetW);
    canvas.height = Math.floor(targetH);
    canvas.style.width = `${targetW}px`;
    canvas.style.height = `${targetH}px`;
}

function renderCanvas() {
    if (!ctx || !canvas || !scanData.imageObj) return;
    
    const cw = canvas.width;
    const ch = canvas.height;
    
    ctx.clearRect(0, 0, cw, ch);
    
    // 1. Draw Background Grid & Guides if enabled
    drawCanvasGridAndGuides(cw, ch);
    
    ctx.save();
    
    // 2. Apply Camera Transform (Center + Pan + Zoom)
    const baseScale = Math.min(cw / scanData.imageDimensions.width, ch / scanData.imageDimensions.height);
    const effectiveScale = baseScale * camera.zoom;
    
    ctx.translate(cw / 2 + camera.panX, ch / 2 + camera.panY);
    ctx.scale(effectiveScale, effectiveScale);
    ctx.translate(-scanData.imageDimensions.width / 2, -scanData.imageDimensions.height / 2);
    
    // 3. Apply Image Transformations (Rotate & Flip)
    ctx.save();
    const iw = scanData.imageDimensions.width;
    const ih = scanData.imageDimensions.height;
    
    ctx.translate(iw / 2, ih / 2);
    if (scanData.transform.rotate) {
        ctx.rotate((scanData.transform.rotate * Math.PI) / 180);
    }
    if (scanData.transform.flipH || scanData.transform.flipV) {
        ctx.scale(scanData.transform.flipH ? -1 : 1, scanData.transform.flipV ? -1 : 1);
    }
    ctx.translate(-iw / 2, -ih / 2);
    
    // 4. Apply Image Filters (CSS Filter Matrix)
    const f = scanData.transform.filters;
    const totalBrightness = Math.max(0, f.brightness + f.exposure);
    ctx.filter = `brightness(${totalBrightness}%) contrast(${f.contrast}%) ${f.invert ? 'invert(100%)' : ''}`;
    
    ctx.drawImage(scanData.imageObj, 0, 0, iw, ih);
    ctx.filter = 'none';
    ctx.restore();
    
    // 5. Draw Draft Stripes Overlay
    drawDraftStripesOnContext(ctx);
    
    // 6. Draw 2D CAD Annotations
    drawCadAnnotationsOnContext(ctx);
    
    // 7. Draw Active In-Progress Vector Drawing
    if (isDrawing && tempAnnotation) {
        drawSingleAnnotation(ctx, tempAnnotation, true);
    }
    
    // 8. Draw Crop Overlay & Handles if in Crop Mode
    if (cropState.active) {
        drawCropOverlay(ctx, iw, ih);
    }
    
    ctx.restore();
    
    // 9. Draw PORT/STBD Tack Watermark (light, always on top in screen space)
    drawTackWatermark();
    
    // Update Minimap Viewport
    updateMinimap();
}

function drawTackWatermark() {
    if (!canvas || !scanData.imageObj) return;
    
    const label = scanData.tack === 'port' ? 'PORT' : 'STBD';
    const isPort = (scanData.tack === 'port');
    
    const cw = canvas.width;
    const ch = canvas.height;
    
    // Position: bottom-right corner, always in screen space (outside the camera transform)
    const fontSize = Math.max(13, Math.min(22, cw * 0.025));
    ctx.save();
    ctx.font = `900 ${fontSize}px 'Inter', 'Arial Black', sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.letterSpacing = '3px';
    
    // Subtle glow shadow for legibility on any background
    ctx.shadowColor = isPort ? 'rgba(239,68,68,0.5)' : 'rgba(16,185,129,0.5)';
    ctx.shadowBlur = 8;
    
    // Very transparent fill
    ctx.fillStyle = isPort ? 'rgba(239, 68, 68, 0.22)' : 'rgba(16, 185, 129, 0.22)';
    ctx.fillText(label, cw - 14, ch - 12);
    
    // Slightly more opaque stroke for definition
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = isPort ? 'rgba(239, 68, 68, 0.45)' : 'rgba(16, 185, 129, 0.45)';
    ctx.shadowBlur = 0;
    ctx.strokeText(label, cw - 14, ch - 12);
    
    ctx.restore();
}

function drawCanvasGridAndGuides(cw, ch) {
    if (viewOptions.gridSize > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.lineWidth = 1;
        const step = viewOptions.gridSize;
        
        ctx.beginPath();
        for (let x = 0; x < cw; x += step) {
            ctx.moveTo(x, 0); ctx.lineTo(x, ch);
        }
        for (let y = 0; y < ch; y += step) {
            ctx.moveTo(0, y); ctx.lineTo(cw, y);
        }
        ctx.stroke();
        ctx.restore();
    }
    
    if (viewOptions.showThirds) {
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(cw / 3, 0); ctx.lineTo(cw / 3, ch);
        ctx.moveTo((cw * 2) / 3, 0); ctx.lineTo((cw * 2) / 3, ch);
        ctx.moveTo(0, ch / 3); ctx.lineTo(cw, ch / 3);
        ctx.moveTo(0, (ch * 2) / 3); ctx.lineTo(cw, (ch * 2) / 3);
        ctx.stroke();
        ctx.restore();
    }
    
    if (viewOptions.showCrosshairs) {
        ctx.save();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cw / 2, 0); ctx.lineTo(cw / 2, ch);
        ctx.moveTo(0, ch / 2); ctx.lineTo(cw, ch / 2);
        ctx.stroke();
        ctx.restore();
    }
}

// ---------------- 4-POINT 3-DEGREE B-SPLINE MATH & RENDERING ----------------

function evaluateCubicBSpline(p0, p1, p2, p3, steps = 80) {
    const points = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const t2 = t * t;
        const t3 = t2 * t;
        
        const x = mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x;
        const y = mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y;
        points.push([x, y]);
    }
    return points;
}

function ensure4PointBSpline(stripe) {
    if (!stripe) return;
    if (!stripe.p0 || !stripe.p3) {
        const p0 = stripe.p1 ? { ...stripe.p1 } : { x: 100, y: 300 };
        const p3 = stripe.p2 ? { ...stripe.p2 } : { x: 700, y: 300 };
        
        const chordDx = p3.x - p0.x;
        const chordDy = p3.y - p0.y;
        const chordLen = Math.hypot(chordDx, chordDy) || 1;
        const nx = -chordDy / chordLen;
        const ny = chordDx / chordLen;
        const camberDepth = (stripe.metrics?.camber || 11.5) / 100 * chordLen;
        const draftFrac = (stripe.metrics?.draft_pos || 45.0) / 100;
        
        const p1 = {
            x: p0.x + chordDx * 0.25 + nx * camberDepth * 0.75,
            y: p0.y + chordDy * 0.25 + ny * camberDepth * 0.75
        };
        const p2 = {
            x: p0.x + chordDx * Math.min(0.85, draftFrac + 0.15) + nx * camberDepth * 1.15,
            y: p0.y + chordDy * Math.min(0.85, draftFrac + 0.15) + ny * camberDepth * 1.15
        };
        
        stripe.p0 = p0;
        stripe.p1 = p1;
        stripe.p2 = p2;
        stripe.p3 = p3;
    }
    if (!stripe.type) stripe.type = 'mid';
    computeStripeMetricsFromBSpline(stripe);
}

function computeStripeMetricsFromBSpline(stripe) {
    if (!stripe || !stripe.p0 || !stripe.p3) return;
    const p0 = stripe.p0;
    const p1 = stripe.p1;
    const p2 = stripe.p2;
    const p3 = stripe.p3;
    
    const chordDx = p3.x - p0.x;
    const chordDy = p3.y - p0.y;
    const chordLen = Math.hypot(chordDx, chordDy);
    if (chordLen < 1) return;
    
    const ux = chordDx / chordLen;
    const uy = chordDy / chordLen;
    const nx = -uy;
    const ny = ux;
    
    // Entry angle at P0 (tangent vector P0 -> P1)
    const eDx = p1.x - p0.x;
    const eDy = p1.y - p0.y;
    const eLen = Math.hypot(eDx, eDy) || 1;
    const entryDotU = (eDx * ux + eDy * uy) / eLen;
    const entryDotN = (eDx * nx + eDy * ny) / eLen;
    const entryAngle = Math.abs(Math.atan2(entryDotN, entryDotU) * (180 / Math.PI));
    
    // Exit angle at P3 (tangent vector P2 -> P3)
    const xDx = p3.x - p2.x;
    const xDy = p3.y - p2.y;
    const xLen = Math.hypot(xDx, xDy) || 1;
    const exitDotU = (xDx * ux + xDy * uy) / xLen;
    const exitDotN = (xDx * nx + xDy * ny) / xLen;
    const exitAngle = Math.abs(Math.atan2(exitDotN, exitDotU) * (180 / Math.PI));
    
    // Evaluate 80 points along 4-point cubic B-spline
    const path = evaluateCubicBSpline(p0, p1, p2, p3, 80);
    stripe.path = path;
    
    let maxDist = 0;
    let bestTFrac = 0.45;
    let maxPt = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
    const normalizedCurve = [];
    
    for (let i = 0; i < path.length; i++) {
        const px = path[i][0];
        const py = path[i][1];
        const vDx = px - p0.x;
        const vDy = py - p0.y;
        
        const uProj = vDx * ux + vDy * uy;
        const nProj = vDx * nx + vDy * ny;
        
        const uFrac = Math.max(0, Math.min(1, uProj / chordLen));
        const camberDist = Math.abs(nProj);
        
        if (camberDist > maxDist) {
            maxDist = camberDist;
            bestTFrac = uFrac;
            maxPt = { x: px, y: py };
        }
        normalizedCurve.push([uFrac, (camberDist / chordLen) * 100]);
    }
    
    const camberPct = (maxDist / chordLen) * 100;
    const draftPosPct = bestTFrac * 100;
    
    if (!stripe.metrics) stripe.metrics = {};
    stripe.metrics.camber = parseFloat(camberPct.toFixed(1));
    stripe.metrics.draft_pos = parseFloat(draftPosPct.toFixed(1));
    stripe.metrics.entry = parseFloat(entryAngle.toFixed(1));
    stripe.metrics.exit = parseFloat(exitAngle.toFixed(1));
    stripe.metrics.chord_len = parseFloat(chordLen.toFixed(1));
    stripe.metrics.twist = parseFloat((stripe.metrics.twist || 0).toFixed(1));
    stripe.metrics.max_point = maxPt;
    stripe.metrics.normalized_curve = normalizedCurve;
}

function drawDraftStripesOnContext(ctx) {
    scanData.stripes.forEach((stripe, idx) => {
        ensure4PointBSpline(stripe);
        const isActive = (idx === scanData.activeStripeIndex);
        const path = stripe.path;
        if (!path || path.length < 2) return;
        
        // 1. Draw Chord Line (dashed)
        ctx.save();
        ctx.strokeStyle = isActive ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.25)';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = isActive ? 1.8 : 1.0;
        ctx.beginPath();
        ctx.moveTo(stripe.p0.x, stripe.p0.y);
        ctx.lineTo(stripe.p3.x, stripe.p3.y);
        ctx.stroke();
        ctx.restore();
        
        // 2. Draw 4-Point 3-Deg Cubic B-Spline Curve
        ctx.save();
        ctx.strokeStyle = stripe.color || '#38bdf8';
        ctx.lineWidth = isActive ? 4.0 : 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = stripe.color || '#38bdf8';
        ctx.shadowBlur = isActive ? 12 : 2;
        
        ctx.beginPath();
        ctx.moveTo(path[0][0], path[0][1]);
        for (let i = 1; i < path.length; i++) {
            ctx.lineTo(path[i][0], path[i][1]);
        }
        ctx.stroke();
        ctx.restore();
        
        // 3. Draw Max Camber Point Indicator (Red Marker Dot)
        if (stripe.metrics && stripe.metrics.max_point) {
            ctx.save();
            ctx.fillStyle = '#ef4444';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(stripe.metrics.max_point.x, stripe.metrics.max_point.y, isActive ? 5.5 : 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
        
        // 4. Draw 4-Point B-Spline Control Arms & Handles for Active Stripe
        if (isActive) {
            if (showBSplinePolygon) {
                // Control Polygon / Tangent Arms
                ctx.save();
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1.5;
                
                // P0 -> P1 (Entry Tangent Arm)
                ctx.strokeStyle = '#06b6d4';
                ctx.beginPath();
                ctx.moveTo(stripe.p0.x, stripe.p0.y);
                ctx.lineTo(stripe.p1.x, stripe.p1.y);
                ctx.stroke();
                
                // P3 -> P2 (Exit Tangent Arm)
                ctx.strokeStyle = '#f59e0b';
                ctx.beginPath();
                ctx.moveTo(stripe.p3.x, stripe.p3.y);
                ctx.lineTo(stripe.p2.x, stripe.p2.y);
                ctx.stroke();
                ctx.restore();
                
                // 4 Interactive Handles
                drawHandle(ctx, stripe.p0.x, stripe.p0.y, 'P0: Luff Root', '#38bdf8', hoverHandle === 'p0');
                drawHandle(ctx, stripe.p1.x, stripe.p1.y, 'P1: Entry Angle', '#06b6d4', hoverHandle === 'p1');
                drawHandle(ctx, stripe.p2.x, stripe.p2.y, 'P2: Draft & Exit', '#f59e0b', hoverHandle === 'p2');
                drawHandle(ctx, stripe.p3.x, stripe.p3.y, 'P3: Leech Root', '#f97316', hoverHandle === 'p3');
            } else {
                // Just endpoint handles
                drawHandle(ctx, stripe.p0.x, stripe.p0.y, 'Luff (P0)', '#38bdf8', hoverHandle === 'p0');
                drawHandle(ctx, stripe.p3.x, stripe.p3.y, 'Leech (P3)', '#f97316', hoverHandle === 'p3');
            }
        }
    });
}

function drawHandle(ctx, x, y, label, color, isHover) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = isHover ? 3.5 : 2;
    ctx.beginPath();
    ctx.arc(x, y, isHover ? 9.5 : 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // Pill label
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.font = 'bold 11px Inter, sans-serif';
    const textW = ctx.measureText(label).width;
    ctx.fillRect(x - textW / 2 - 4, y - 24, textW + 8, 16);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(label, x - textW / 2, y - 12);
    ctx.restore();
}

// ---------------- 2D CAD VECTOR DRAWING & MEASUREMENT ----------------

function drawCadAnnotationsOnContext(ctx) {
    scanData.annotations.forEach(ann => {
        if (ann.visible === false) return;
        const isSelected = (ann.id === selectedAnnotationId);
        drawSingleAnnotation(ctx, ann, isSelected);
    });
}

function drawSingleAnnotation(ctx, ann, isSelected = false) {
    ctx.save();
    ctx.strokeStyle = ann.strokeColor || '#38bdf8';
    ctx.fillStyle = ann.fillColor || ann.strokeColor || '#38bdf8';
    ctx.lineWidth = ann.lineWidth || 2;
    
    if (ann.lineStyle === 'dashed') ctx.setLineDash([6, 6]);
    else if (ann.lineStyle === 'dotted') ctx.setLineDash([2, 4]);
    else ctx.setLineDash([]);
    
    if (isSelected) {
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 8;
    }
    
    const type = ann.type;
    
    if (type === 'ruler') {
        // Distance ruler with end caps and metric readout
        const p1 = ann.p1, p2 = ann.p2;
        if (!p1 || !p2) return;
        
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        
        // Ticks at ends
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const perp = angle + Math.PI / 2;
        const tickLen = 8;
        
        ctx.beginPath();
        ctx.moveTo(p1.x + Math.cos(perp) * tickLen, p1.y + Math.sin(perp) * tickLen);
        ctx.lineTo(p1.x - Math.cos(perp) * tickLen, p1.y - Math.sin(perp) * tickLen);
        ctx.moveTo(p2.x + Math.cos(perp) * tickLen, p2.y + Math.sin(perp) * tickLen);
        ctx.lineTo(p2.x - Math.cos(perp) * tickLen, p2.y - Math.sin(perp) * tickLen);
        ctx.stroke();
        
        // Distance label badge in middle
        const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const distM = (distPx / viewOptions.pxPerMeter).toFixed(2);
        const label = `${distM} m (${Math.round(distPx)} px)`;
        
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        
        drawCadTextBadge(ctx, midX, midY, label, ann.strokeColor);
        
    } else if (type === 'arrow') {
        const p1 = ann.p1, p2 = ann.p2;
        if (!p1 || !p2) return;
        
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        
        // Arrowhead
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const headLen = 12;
        ctx.beginPath();
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(p2.x - headLen * Math.cos(angle - Math.PI / 6), p2.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(p2.x - headLen * Math.cos(angle + Math.PI / 6), p2.y - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
        
    } else if (type === 'angle') {
        const p1 = ann.p1, p2 = ann.p2, p3 = ann.p3; // p2 is vertex
        if (!p1 || !p2 || !p3) return;
        
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.stroke();
        
        // Angle computation
        const a1 = Math.atan2(p1.y - p2.y, p1.x - p2.x);
        const a2 = Math.atan2(p3.y - p2.y, p3.x - p2.x);
        let deg = Math.abs((a2 - a1) * (180 / Math.PI));
        if (deg > 180) deg = 360 - deg;
        
        // Arc
        ctx.beginPath();
        ctx.arc(p2.x, p2.y, 25, Math.min(a1, a2), Math.max(a1, a2));
        ctx.stroke();
        
        drawCadTextBadge(ctx, p2.x + 30, p2.y - 10, `${deg.toFixed(1)}°`, ann.strokeColor);
        
    } else if (type === 'caliper') {
        // Sail Draft Caliper (Luff P1, Leech P2, Camber Depth P3)
        const p1 = ann.p1, p2 = ann.p2, p3 = ann.p3;
        if (!p1 || !p2 || !p3) return;
        
        // Chord Line
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        
        // Perpendicular Sag Line to P3
        const chordLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const uX = (p2.x - p1.x) / chordLen;
        const uY = (p2.y - p1.y) / chordLen;
        
        // Projected point on chord
        const vX = p3.x - p1.x;
        const vY = p3.y - p1.y;
        const projLen = vX * uX + vY * uY;
        const projX = p1.x + uX * projLen;
        const projY = p1.y + uY * projLen;
        
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(projX, projY);
        ctx.lineTo(p3.x, p3.y);
        ctx.stroke();
        ctx.restore();
        
        const depth = Math.hypot(p3.x - projX, p3.y - projY);
        const camberPct = ((depth / chordLen) * 100).toFixed(1);
        const draftPosPct = ((projLen / chordLen) * 100).toFixed(1);
        
        drawCadTextBadge(ctx, p3.x, p3.y - 12, `Camber: ${camberPct}% | Draft: ${draftPosPct}%`, '#38bdf8');
        
    } else if (type === 'rect') {
        const p1 = ann.p1, p2 = ann.p2;
        if (!p1 || !p2) return;
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x);
        const h = Math.abs(p2.y - p1.y);
        
        if (ann.fillOpacity > 0) {
            ctx.save();
            ctx.globalAlpha = ann.fillOpacity;
            ctx.fillRect(x, y, w, h);
            ctx.restore();
        }
        ctx.strokeRect(x, y, w, h);
        
    } else if (type === 'ellipse') {
        const p1 = ann.p1, p2 = ann.p2;
        if (!p1 || !p2) return;
        const rx = Math.abs(p2.x - p1.x) / 2;
        const ry = Math.abs(p2.y - p1.y) / 2;
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (ann.fillOpacity > 0) {
            ctx.save();
            ctx.globalAlpha = ann.fillOpacity;
            ctx.fill();
            ctx.restore();
        }
        ctx.stroke();
        
    } else if (type === 'pen' || type === 'spline') {
        const pts = ann.points || [];
        if (pts.length < 2) return;
        
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
        
    } else if (type === 'text') {
        const p = ann.p1 || { x: 50, y: 50 };
        ctx.font = `bold ${ann.fontSize || 15}px Inter, sans-serif`;
        ctx.fillStyle = ann.strokeColor || '#ffffff';
        ctx.fillText(ann.text || 'Label', p.x, p.y);
    }
    
    ctx.restore();
}

function drawCadTextBadge(ctx, x, y, text, color) {
    ctx.save();
    ctx.font = 'bold 11px Inter, sans-serif';
    const textW = ctx.measureText(text).width;
    
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.strokeStyle = color || '#38bdf8';
    ctx.lineWidth = 1;
    ctx.fillRect(x - textW / 2 - 6, y - 18, textW + 12, 20);
    ctx.strokeRect(x - textW / 2 - 6, y - 18, textW + 12, 20);
    
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x - textW / 2, y - 4);
    ctx.restore();
}

function drawCropOverlay(ctx, iw, ih) {
    const r = cropState.rect;
    
    // Darken outer mask
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    
    // Top
    ctx.fillRect(0, 0, iw, r.y);
    // Bottom
    ctx.fillRect(0, r.y + r.h, iw, ih - (r.y + r.h));
    // Left
    ctx.fillRect(0, r.y, r.x, r.h);
    // Right
    ctx.fillRect(r.x + r.w, r.y, iw - (r.x + r.w), r.h);
    
    // 8-point crop bounding border
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
    
    // Handles
    const handles = [
        { x: r.x, y: r.y }, // nw
        { x: r.x + r.w / 2, y: r.y }, // n
        { x: r.x + r.w, y: r.y }, // ne
        { x: r.x + r.w, y: r.y + r.h / 2 }, // e
        { x: r.x + r.w, y: r.y + r.h }, // se
        { x: r.x + r.w / 2, y: r.y + r.h }, // s
        { x: r.x, y: r.y + r.h }, // sw
        { x: r.x, y: r.y + r.h / 2 } // w
    ];
    
    ctx.fillStyle = '#38bdf8';
    handles.forEach(h => {
        ctx.fillRect(h.x - 5, h.y - 5, 10, 10);
    });
    
    ctx.restore();
}

// ---------------- CANVAS MOUSE & DRAWING INTERACTIONS ----------------

function setupCanvasEvents() {
    if (!canvas) return;
    
    // Mouse Wheel Zooming
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        const mouse = getCanvasCoords(e);
        zoomStep(delta, mouse);
    }, { passive: false });
    
    // Mouse Down
    canvas.addEventListener('mousedown', (e) => {
        const mouse = getCanvasCoords(e);
        const imgPt = screenToImage(mouse.x, mouse.y);
        
        // 1. Color Eyedropper
        if (currentTool === 'eyedropper' || eyedropperTarget) {
            sampleColorFromCanvas(mouse.x, mouse.y);
            return;
        }
        
        // 2. Magic Snap
        if (isMagicSnapMode) {
            snapStripeFromClick(imgPt.x, imgPt.y);
            return;
        }
        
        // 3. Pan Tool / Middle Click
        if (currentTool === 'pan' || e.button === 1 || e.spaceKey) {
            camera.isPanning = true;
            camera.startX = mouse.x - camera.panX;
            camera.startY = mouse.y - camera.panY;
            canvas.style.cursor = 'grabbing';
            return;
        }
        
        // 4. Select & Move Tool
        if (currentTool === 'select') {
            // Check 4-point B-Spline handles for active stripe
            const activeStripe = scanData.stripes[scanData.activeStripeIndex];
            if (activeStripe) {
                ensure4PointBSpline(activeStripe);
                const thresh = 22 / camera.zoom;
                const d0 = Math.hypot(imgPt.x - activeStripe.p0.x, imgPt.y - activeStripe.p0.y);
                const d1 = Math.hypot(imgPt.x - activeStripe.p1.x, imgPt.y - activeStripe.p1.y);
                const d2 = Math.hypot(imgPt.x - activeStripe.p2.x, imgPt.y - activeStripe.p2.y);
                const d3 = Math.hypot(imgPt.x - activeStripe.p3.x, imgPt.y - activeStripe.p3.y);
                
                if (d0 < thresh) { isDraggingHandle = 'p0'; pushUndoState(); return; }
                if (d1 < thresh && showBSplinePolygon) { isDraggingHandle = 'p1'; pushUndoState(); return; }
                if (d2 < thresh && showBSplinePolygon) { isDraggingHandle = 'p2'; pushUndoState(); return; }
                if (d3 < thresh) { isDraggingHandle = 'p3'; pushUndoState(); return; }
            }
            
            // Check other stripes selection
            for (let i = 0; i < scanData.stripes.length; i++) {
                if (i === scanData.activeStripeIndex) continue;
                const s = scanData.stripes[i];
                ensure4PointBSpline(s);
                const d0 = Math.hypot(imgPt.x - s.p0.x, imgPt.y - s.p0.y);
                const d3 = Math.hypot(imgPt.x - s.p3.x, imgPt.y - s.p3.y);
                if (d0 < 22 / camera.zoom || d3 < 22 / camera.zoom) {
                    selectStripeByIndex(i);
                    return;
                }
            }
            
            // Check CAD annotations selection
            const clickedAnn = scanData.annotations.find(ann => isPointNearAnnotation(imgPt, ann));
            if (clickedAnn) {
                selectedAnnotationId = clickedAnn.id;
                updateLayersList();
                renderCanvas();
            } else {
                selectedAnnotationId = null;
                updateLayersList();
                renderCanvas();
            }
            return;
        }
        
        // 5. 2D CAD Vector Creation Tools
        if (['ruler', 'arrow', 'rect', 'ellipse'].includes(currentTool)) {
            pushUndoState();
            isDrawing = true;
            tempAnnotation = {
                id: `cad_${Date.now()}`,
                type: currentTool,
                p1: { x: imgPt.x, y: imgPt.y },
                p2: { x: imgPt.x, y: imgPt.y },
                strokeColor: toolProps.strokeColor,
                lineWidth: toolProps.lineWidth,
                lineStyle: toolProps.lineStyle,
                fillOpacity: toolProps.fillOpacity,
                fontSize: toolProps.fontSize
            };
            return;
        }
        
        if (currentTool === 'pen') {
            pushUndoState();
            isDrawing = true;
            drawingPoints = [{ x: imgPt.x, y: imgPt.y }];
            tempAnnotation = {
                id: `cad_${Date.now()}`,
                type: 'pen',
                points: drawingPoints,
                strokeColor: toolProps.strokeColor,
                lineWidth: toolProps.lineWidth,
                lineStyle: toolProps.lineStyle
            };
            return;
        }
        
        if (currentTool === 'angle') {
            anglePoints.push({ x: imgPt.x, y: imgPt.y });
            if (anglePoints.length === 3) {
                pushUndoState();
                scanData.annotations.push({
                    id: `cad_${Date.now()}`,
                    type: 'angle',
                    p1: anglePoints[0],
                    p2: anglePoints[1],
                    p3: anglePoints[2],
                    strokeColor: toolProps.strokeColor,
                    lineWidth: toolProps.lineWidth
                });
                anglePoints = [];
                updateLayersList();
                renderCanvas();
            }
            return;
        }
        
        if (currentTool === 'caliper') {
            anglePoints.push({ x: imgPt.x, y: imgPt.y });
            if (anglePoints.length === 3) {
                pushUndoState();
                scanData.annotations.push({
                    id: `cad_${Date.now()}`,
                    type: 'caliper',
                    p1: anglePoints[0],
                    p2: anglePoints[1],
                    p3: anglePoints[2],
                    strokeColor: toolProps.strokeColor,
                    lineWidth: toolProps.lineWidth
                });
                anglePoints = [];
                updateLayersList();
                renderCanvas();
            }
            return;
        }
        
        if (currentTool === 'text') {
            const userText = prompt('Enter Annotation Text:', 'Camber Reference');
            if (userText) {
                pushUndoState();
                scanData.annotations.push({
                    id: `cad_${Date.now()}`,
                    type: 'text',
                    text: userText,
                    p1: { x: imgPt.x, y: imgPt.y },
                    strokeColor: toolProps.strokeColor,
                    fontSize: toolProps.fontSize
                });
                updateLayersList();
                renderCanvas();
            }
            return;
        }
    });
    
    // Mouse Move
    canvas.addEventListener('mousemove', (e) => {
        const mouse = getCanvasCoords(e);
        const imgPt = screenToImage(mouse.x, mouse.y);
        
        if (camera.isPanning) {
            camera.panX = mouse.x - camera.startX;
            camera.panY = mouse.y - camera.startY;
            renderCanvas();
            return;
        }
        
        if (isDrawing && tempAnnotation) {
            if (['ruler', 'arrow', 'rect', 'ellipse'].includes(tempAnnotation.type)) {
                tempAnnotation.p2 = { x: imgPt.x, y: imgPt.y };
                renderCanvas();
            } else if (tempAnnotation.type === 'pen') {
                drawingPoints.push({ x: imgPt.x, y: imgPt.y });
                renderCanvas();
            }
            return;
        }
        
        // Dragging 4-point B-spline handles
        if (isDraggingHandle && scanData.stripes.length) {
            const activeStripe = scanData.stripes[scanData.activeStripeIndex];
            if (activeStripe) {
                ensure4PointBSpline(activeStripe);
                if (isDraggingHandle === 'p0') {
                    const dx = imgPt.x - activeStripe.p0.x;
                    const dy = imgPt.y - activeStripe.p0.y;
                    activeStripe.p0 = { x: imgPt.x, y: imgPt.y };
                    if (!e.altKey && !e.ctrlKey) {
                        activeStripe.p1.x += dx;
                        activeStripe.p1.y += dy;
                    }
                } else if (isDraggingHandle === 'p1') {
                    activeStripe.p1 = { x: imgPt.x, y: imgPt.y };
                } else if (isDraggingHandle === 'p2') {
                    activeStripe.p2 = { x: imgPt.x, y: imgPt.y };
                } else if (isDraggingHandle === 'p3') {
                    const dx = imgPt.x - activeStripe.p3.x;
                    const dy = imgPt.y - activeStripe.p3.y;
                    activeStripe.p3 = { x: imgPt.x, y: imgPt.y };
                    if (!e.altKey && !e.ctrlKey) {
                        activeStripe.p2.x += dx;
                        activeStripe.p2.y += dy;
                    }
                }
                
                computeStripeMetricsFromBSpline(activeStripe);
                renderCanvas();
                updateHUDMetrics();
                updateToolbarStripeControls();
                return;
            }
        }
        
        // Hover detection on all 4 handles
        if (currentTool === 'select' && scanData.stripes.length) {
            const activeStripe = scanData.stripes[scanData.activeStripeIndex];
            if (activeStripe) {
                ensure4PointBSpline(activeStripe);
                const thresh = 18 / camera.zoom;
                const d0 = Math.hypot(imgPt.x - activeStripe.p0.x, imgPt.y - activeStripe.p0.y);
                const d1 = Math.hypot(imgPt.x - activeStripe.p1.x, imgPt.y - activeStripe.p1.y);
                const d2 = Math.hypot(imgPt.x - activeStripe.p2.x, imgPt.y - activeStripe.p2.y);
                const d3 = Math.hypot(imgPt.x - activeStripe.p3.x, imgPt.y - activeStripe.p3.y);
                
                if (d0 < thresh) hoverHandle = 'p0';
                else if (d1 < thresh && showBSplinePolygon) hoverHandle = 'p1';
                else if (d2 < thresh && showBSplinePolygon) hoverHandle = 'p2';
                else if (d3 < thresh) hoverHandle = 'p3';
                else hoverHandle = null;
                
                canvas.style.cursor = hoverHandle ? 'grab' : 'default';
                renderCanvas();
            }
        }
    });
    
    // Mouse Up
    window.addEventListener('mouseup', () => {
        if (camera.isPanning) {
            camera.isPanning = false;
            updateCanvasCursor();
        }
        
        if (isDrawing && tempAnnotation) {
            scanData.annotations.push(tempAnnotation);
            selectedAnnotationId = tempAnnotation.id;
            isDrawing = false;
            tempAnnotation = null;
            updateLayersList();
            renderCanvas();
        }
        
        if (isDraggingHandle) {
            isDraggingHandle = null;
            renderCanvas();
        }
    });
}

function isPointNearAnnotation(pt, ann) {
    if (ann.p1 && ann.p2) {
        const dist = distToSegment(pt, ann.p1, ann.p2);
        return dist < 15;
    }
    return false;
}

function distToSegment(p, v, w) {
    const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

function recalculateStripeCorridor(stripe) {
    ensure4PointBSpline(stripe);
    computeStripeMetricsFromBSpline(stripe);
}

// ---------------- EYEDROPPER & COLOR SAMPLING ----------------

window.activateEyedropper = function(target) {
    eyedropperTarget = target;
    switchScanTab('canvas');
    const hint = document.getElementById('canvas-hint-pill');
    if (hint) hint.innerHTML = `🧪 <strong>Sampling ${target.toUpperCase()}:</strong> Click any pixel on the photo to sample!`;
    if (canvas) canvas.style.cursor = 'crosshair';
};

window.sampleColorFromCanvas = function(canvasX, canvasY) {
    if (!ctx || !canvas) return;
    try {
        const pixel = ctx.getImageData(Math.floor(canvasX), Math.floor(canvasY), 1, 1).data;
        const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1)}`;
        
        if (eyedropperTarget === 'stripe') {
            scanData.customStripeColor = hex;
            scanData.stripeColor = hex;
            const swatch = document.getElementById('stripe-picked-swatch');
            if (swatch) { swatch.style.background = hex; swatch.style.display = 'inline-block'; }
            eyedropperTarget = null;
            runAutoDetection();
        } else if (eyedropperTarget === 'sail') {
            scanData.customSailColor = hex;
            scanData.sailColor = hex;
            const swatch = document.getElementById('sail-picked-swatch');
            if (swatch) { swatch.style.background = hex; swatch.style.display = 'inline-block'; }
            eyedropperTarget = null;
            runAutoDetection();
        } else {
            setToolProp('strokeColor', hex);
            const cp = document.getElementById('propStrokeColor');
            if (cp) cp.value = hex;
            setStudioTool('select');
        }
    } catch (e) {
        console.error('Sampling error:', e);
    }
};

// ---------------- 4-POINT B-SPLINE STRIPES & TOOLBAR CONTROLS ----------------

function updateStripeLayerTabs() {
    const container = document.getElementById('stripe-layer-tabs');
    if (!container) return;
    container.innerHTML = '';
    
    scanData.stripes.forEach((stripe, idx) => {
        ensure4PointBSpline(stripe);
        const btn = document.createElement('button');
        btn.className = `btn-canvas-tool ${idx === scanData.activeStripeIndex ? 'active' : ''}`;
        btn.style.borderColor = stripe.color || '#38bdf8';
        btn.style.color = (idx === scanData.activeStripeIndex) ? '#0f172a' : (stripe.color || '#38bdf8');
        btn.style.background = (idx === scanData.activeStripeIndex) ? (stripe.color || '#38bdf8') : '#1e293b';
        btn.style.fontWeight = '700';
        btn.innerText = `#${idx + 1}`;
        btn.onclick = () => {
            selectStripeByIndex(idx);
        };
        container.appendChild(btn);
    });
    
    updateToolbarStripeControls();
}

function updateToolbarStripeControls() {
    const select = document.getElementById('toolbar-stripe-select');
    const typeSelect = document.getElementById('toolbar-stripe-type');
    const colorPicker = document.getElementById('toolbar-stripe-color');
    const camberBadge = document.getElementById('badge-stripe-camber');
    const draftBadge = document.getElementById('badge-stripe-draft');
    
    if (select) {
        select.innerHTML = '';
        scanData.stripes.forEach((s, i) => {
            ensure4PointBSpline(s);
            const opt = document.createElement('option');
            opt.value = i;
            opt.innerText = `[#${i + 1}] ${s.label} (${s.metrics?.camber || '--'}%)`;
            if (i === scanData.activeStripeIndex) opt.selected = true;
            select.appendChild(opt);
        });
    }
    
    const active = scanData.stripes[scanData.activeStripeIndex];
    if (active) {
        ensure4PointBSpline(active);
        if (typeSelect) typeSelect.value = active.type || 'mid';
        if (colorPicker) colorPicker.value = active.color || '#38bdf8';
        if (camberBadge) camberBadge.innerText = `${active.metrics?.camber || 12.0}%`;
        if (draftBadge) draftBadge.innerText = `${active.metrics?.draft_pos || 45.0}%`;
    }
}

window.selectStripeByIndex = function(idx) {
    if (idx < 0 || idx >= scanData.stripes.length) return;
    scanData.activeStripeIndex = idx;
    const active = scanData.stripes[idx];
    ensure4PointBSpline(active);
    updateStripeLayerTabs();
    updateToolbarStripeControls();
    updateHUDMetrics();
    updateLayersList();
    renderCanvas();
};

window.changeActiveStripeType = function(type) {
    const active = scanData.stripes[scanData.activeStripeIndex];
    if (!active) return;
    pushUndoState();
    active.type = type;
    
    const typeLabels = {
        'foot': 'Foot 25%',
        'lower_quarter': 'Lower Qtr 37.5%',
        'mid': 'Mid 50%',
        'upper_quarter': 'Upper Qtr 62.5%',
        'top': 'Top 75%',
        'custom': 'Custom'
    };
    if (!active.customLabel) {
        active.label = `Stripe #${scanData.activeStripeIndex + 1} (${typeLabels[type] || type})`;
    }
    
    updateToolbarStripeControls();
    updateLayersList();
    renderCanvas();
};

window.changeActiveStripeColor = function(color) {
    const active = scanData.stripes[scanData.activeStripeIndex];
    if (!active) return;
    pushUndoState();
    active.color = color;
    updateStripeLayerTabs();
    updateToolbarStripeControls();
    updateLayersList();
    renderCanvas();
};

window.toggleControlPolygon = function() {
    showBSplinePolygon = !showBSplinePolygon;
    const statusLbl = document.getElementById('lbl-polygon-status');
    if (statusLbl) statusLbl.innerText = showBSplinePolygon ? 'ON' : 'OFF';
    const btn = document.getElementById('btn-toggle-polygon');
    if (btn) {
        btn.style.color = showBSplinePolygon ? '#38bdf8' : '#94a3b8';
        btn.style.borderColor = showBSplinePolygon ? '#38bdf8' : '#475569';
    }
    renderCanvas();
};

window.invertActiveStripeDirection = function() {
    const active = scanData.stripes[scanData.activeStripeIndex];
    if (!active) return;
    pushUndoState();
    ensure4PointBSpline(active);
    
    // Swap P0 <-> P3 and P1 <-> P2
    const tempP0 = { ...active.p0 };
    const tempP1 = { ...active.p1 };
    active.p0 = { ...active.p3 };
    active.p1 = { ...active.p2 };
    active.p3 = tempP0;
    active.p2 = tempP1;
    
    computeStripeMetricsFromBSpline(active);
    updateToolbarStripeControls();
    updateHUDMetrics();
    renderCanvas();
};

window.nudgeStripeCamber = function(deltaPct) {
    const active = scanData.stripes[scanData.activeStripeIndex];
    if (!active) return;
    pushUndoState();
    ensure4PointBSpline(active);
    
    const p0 = active.p0;
    const p3 = active.p3;
    const chordDx = p3.x - p0.x;
    const chordDy = p3.y - p0.y;
    const chordLen = Math.hypot(chordDx, chordDy) || 1;
    const nx = -chordDy / chordLen;
    const ny = chordDx / chordLen;
    
    const offsetDelta = (deltaPct / 100) * chordLen;
    active.p1.x += nx * offsetDelta * 0.75;
    active.p1.y += ny * offsetDelta * 0.75;
    active.p2.x += nx * offsetDelta * 1.15;
    active.p2.y += ny * offsetDelta * 1.15;
    
    computeStripeMetricsFromBSpline(active);
    updateToolbarStripeControls();
    updateHUDMetrics();
    updateLayersList();
    renderCanvas();
};

window.nudgeStripeDraft = function(deltaPct) {
    const active = scanData.stripes[scanData.activeStripeIndex];
    if (!active) return;
    pushUndoState();
    ensure4PointBSpline(active);
    
    const p0 = active.p0;
    const p3 = active.p3;
    const chordDx = p3.x - p0.x;
    const chordDy = p3.y - p0.y;
    const chordLen = Math.hypot(chordDx, chordDy) || 1;
    const ux = chordDx / chordLen;
    const uy = chordDy / chordLen;
    
    const axialShift = (deltaPct / 100) * chordLen;
    active.p1.x += ux * axialShift * 0.4;
    active.p1.y += uy * axialShift * 0.4;
    active.p2.x += ux * axialShift;
    active.p2.y += uy * axialShift;
    
    computeStripeMetricsFromBSpline(active);
    updateToolbarStripeControls();
    updateHUDMetrics();
    updateLayersList();
    renderCanvas();
};

window.duplicateActiveStripe = function() {
    const active = scanData.stripes[scanData.activeStripeIndex];
    if (!active) return;
    pushUndoState();
    ensure4PointBSpline(active);
    
    const idx = scanData.stripes.length;
    const colors = ['#38bdf8', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];
    const color = colors[idx % colors.length];
    
    const h = scanData.imageDimensions.height || 600;
    const yShift = -h * 0.14;
    
    const newStripe = {
        id: `stripe_${idx + 1}`,
        label: `Stripe #${idx + 1} (Copy of #${scanData.activeStripeIndex + 1})`,
        type: active.type || 'custom',
        color: color,
        p0: { x: active.p0.x, y: active.p0.y + yShift },
        p1: { x: active.p1.x, y: active.p1.y + yShift },
        p2: { x: active.p2.x, y: active.p2.y + yShift },
        p3: { x: active.p3.x, y: active.p3.y + yShift }
    };
    
    computeStripeMetricsFromBSpline(newStripe);
    scanData.stripes.push(newStripe);
    scanData.activeStripeIndex = idx;
    
    updateStripeLayerTabs();
    updateToolbarStripeControls();
    updateHUDMetrics();
    updateLayersList();
    renderCanvas();
};

window.openNewStripeModal = function() {
    const modal = document.getElementById('modal-new-stripe');
    if (!modal) return;
    const nextIdx = scanData.stripes.length + 1;
    const nameInput = document.getElementById('new-stripe-name');
    if (nameInput) nameInput.value = `Stripe #${nextIdx}`;
    modal.style.display = 'flex';
};

window.closeNewStripeModal = function() {
    const modal = document.getElementById('modal-new-stripe');
    if (modal) modal.style.display = 'none';
};

window.confirmCreateNewStripe = function() {
    const name = document.getElementById('new-stripe-name')?.value || `Stripe #${scanData.stripes.length + 1}`;
    const type = document.getElementById('new-stripe-type')?.value || 'mid';
    const camberPreset = parseFloat(document.getElementById('new-stripe-camber-preset')?.value || '11.0');
    const color = document.getElementById('new-stripe-color')?.value || '#38bdf8';
    
    pushUndoState();
    const w = scanData.imageDimensions.width || 800;
    const h = scanData.imageDimensions.height || 600;
    const idx = scanData.stripes.length;
    
    let yFrac = 0.50;
    if (type === 'foot') yFrac = 0.78;
    else if (type === 'lower_quarter') yFrac = 0.65;
    else if (type === 'mid') yFrac = 0.50;
    else if (type === 'upper_quarter') yFrac = 0.35;
    else if (type === 'top') yFrac = 0.20;
    else yFrac = Math.max(0.15, 0.80 - idx * 0.18);
    
    const x0 = w * 0.12, y0 = h * (yFrac + 0.03);
    const x3 = w * 0.88, y3 = h * (yFrac - 0.03);
    const chordDx = x3 - x0;
    const chordDy = y3 - y0;
    const chordLen = Math.hypot(chordDx, chordDy);
    const nx = -chordDy / chordLen;
    const ny = chordDx / chordLen;
    const camberDepth = (camberPreset / 100) * chordLen;
    
    const p0 = { x: x0, y: y0 };
    const p1 = { x: x0 + chordDx * 0.25 + nx * camberDepth * 0.75, y: y0 + chordDy * 0.25 + ny * camberDepth * 0.75 };
    const p2 = { x: x0 + chordDx * 0.58 + nx * camberDepth * 1.15, y: y0 + chordDy * 0.58 + ny * camberDepth * 1.15 };
    const p3 = { x: x3, y: y3 };
    
    const stripe = {
        id: `stripe_${idx + 1}`,
        label: name,
        customLabel: true,
        type: type,
        color: color,
        p0: p0,
        p1: p1,
        p2: p2,
        p3: p3
    };
    
    computeStripeMetricsFromBSpline(stripe);
    scanData.stripes.push(stripe);
    scanData.activeStripeIndex = idx;
    
    closeNewStripeModal();
    updateStripeLayerTabs();
    updateToolbarStripeControls();
    updateHUDMetrics();
    updateLayersList();
    renderCanvas();
};

window.openEditStripeModal = function(idx) {
    const stripe = scanData.stripes[idx];
    if (!stripe) return;
    const modal = document.getElementById('modal-edit-stripe');
    if (!modal) return;
    
    document.getElementById('edit-stripe-index').value = idx;
    document.getElementById('edit-stripe-name').value = stripe.label || `Stripe #${idx + 1}`;
    document.getElementById('edit-stripe-type').value = stripe.type || 'mid';
    document.getElementById('edit-stripe-color').value = stripe.color || '#38bdf8';
    
    modal.style.display = 'flex';
};

window.closeEditStripeModal = function() {
    const modal = document.getElementById('modal-edit-stripe');
    if (modal) modal.style.display = 'none';
};

window.saveEditedStripe = function() {
    const idx = parseInt(document.getElementById('edit-stripe-index')?.value || '0');
    const stripe = scanData.stripes[idx];
    if (!stripe) return;
    
    pushUndoState();
    stripe.label = document.getElementById('edit-stripe-name')?.value || stripe.label;
    stripe.customLabel = true;
    stripe.type = document.getElementById('edit-stripe-type')?.value || stripe.type;
    stripe.color = document.getElementById('edit-stripe-color')?.value || stripe.color;
    
    closeEditStripeModal();
    updateStripeLayerTabs();
    updateToolbarStripeControls();
    updateHUDMetrics();
    updateLayersList();
    renderCanvas();
};

window.addNewStripeLayer = function() {
    openNewStripeModal();
};

window.toggleLayersPanel = function() {
    const panel = document.getElementById('cad-layers-panel');
    if (panel) {
        panel.style.display = (panel.style.display === 'none' || !panel.style.display) ? 'flex' : 'none';
        updateLayersList();
    }
};

function updateLayersList() {
    const list = document.getElementById('cad-layers-list');
    const countBadge = document.getElementById('cad-layers-count');
    if (countBadge) countBadge.innerText = scanData.stripes.length + scanData.annotations.length;
    if (!list) return;
    
    list.innerHTML = '';
    
    // 1. Stripes Layers (4-Point B-Splines)
    scanData.stripes.forEach((s, idx) => {
        ensure4PointBSpline(s);
        const item = document.createElement('div');
        item.className = `cad-layer-item ${idx === scanData.activeStripeIndex ? 'selected' : ''}`;
        
        const typeBadge = s.type ? s.type.toUpperCase() : 'MID';
        item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;">
                <span style="width: 10px; height: 10px; border-radius: 50%; background: ${s.color}; flex-shrink: 0;"></span>
                <div style="display: flex; flex-direction: column; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <span style="font-size: 0.65rem; background: #1e293b; border: 1px solid #475569; color: #38bdf8; padding: 1px 4px; border-radius: 3px; font-weight: 700;">${typeBadge}</span>
                        <span style="font-weight: 600; font-size: 0.76rem; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.label}</span>
                    </div>
                    <span style="font-size: 0.68rem; color: #94a3b8;">Camber: <strong style="color:#38bdf8">${s.metrics?.camber || '--'}%</strong> • Pos: <strong style="color:#f59e0b">${s.metrics?.draft_pos || '--'}%</strong></span>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 3px; flex-shrink: 0;">
                <button type="button" onclick="openEditStripeModal(${idx})" title="Edit Stripe Name & Type" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:2px 4px;font-size:0.75rem;">✏️</button>
                <button type="button" onclick="deleteStripeByIndex(${idx})" title="Delete Stripe" style="background:none;border:none;color:#ef4444;cursor:pointer;padding:2px 4px;font-size:0.75rem;">✕</button>
            </div>
        `;
        item.onclick = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            selectStripeByIndex(idx);
        };
        list.appendChild(item);
    });
    
    // 2. CAD Annotations
    scanData.annotations.forEach(ann => {
        const item = document.createElement('div');
        item.className = `cad-layer-item ${ann.id === selectedAnnotationId ? 'selected' : ''}`;
        const icon = CAD_TOOL_NAMES[ann.type]?.icon || '📐';
        item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                <span>${icon}</span>
                <span style="font-size: 0.75rem; color: #cbd5e1;">${ann.type.toUpperCase()}: ${ann.text || ann.id.slice(-4)}</span>
            </div>
            <div style="display: flex; gap: 3px;">
                <button type="button" onclick="toggleAnnotationVisibility('${ann.id}')" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:2px;">${ann.visible === false ? '🙈' : '👁️'}</button>
                <button type="button" onclick="deleteAnnotationById('${ann.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;padding:2px;">✕</button>
            </div>
        `;
        item.onclick = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            selectedAnnotationId = ann.id;
            updateLayersList();
            renderCanvas();
        };
        list.appendChild(item);
    });
}

window.deleteStripeByIndex = function(idx) {
    if (scanData.stripes.length <= 1) {
        alert('You must keep at least 1 stripe in the analysis.');
        return;
    }
    pushUndoState();
    scanData.stripes.splice(idx, 1);
    scanData.activeStripeIndex = Math.max(0, Math.min(idx, scanData.stripes.length - 1));
    updateStripeLayerTabs();
    updateToolbarStripeControls();
    updateHUDMetrics();
    updateLayersList();
    renderCanvas();
};

window.deleteAnnotationById = function(id) {
    pushUndoState();
    scanData.annotations = scanData.annotations.filter(a => a.id !== id);
    if (selectedAnnotationId === id) selectedAnnotationId = null;
    updateLayersList();
    renderCanvas();
};

window.toggleAnnotationVisibility = function(id) {
    const ann = scanData.annotations.find(a => a.id === id);
    if (ann) {
        ann.visible = (ann.visible === false) ? true : false;
        updateLayersList();
        renderCanvas();
    }
};

window.deleteSelectedAnnotation = function() {
    if (selectedAnnotationId) {
        deleteAnnotationById(selectedAnnotationId);
    } else if (scanData.stripes.length > 1) {
        deleteStripeByIndex(scanData.activeStripeIndex);
    }
};

window.clearAllAnnotations = function() {
    if (confirm('Clear all CAD vector annotations?')) {
        pushUndoState();
        scanData.annotations = [];
        selectedAnnotationId = null;
        updateLayersList();
        renderCanvas();
    }
};

// ---------------- UNDO / REDO SYSTEM ----------------

function pushUndoState() {
    undoStack.push({
        stripes: JSON.parse(JSON.stringify(scanData.stripes)),
        annotations: JSON.parse(JSON.stringify(scanData.annotations)),
        transform: JSON.parse(JSON.stringify(scanData.transform))
    });
    if (undoStack.length > 30) undoStack.shift();
    redoStack = [];
}

window.cadUndo = function() {
    if (!undoStack.length) return;
    redoStack.push({
        stripes: JSON.parse(JSON.stringify(scanData.stripes)),
        annotations: JSON.parse(JSON.stringify(scanData.annotations)),
        transform: JSON.parse(JSON.stringify(scanData.transform))
    });
    const state = undoStack.pop();
    scanData.stripes = state.stripes;
    scanData.annotations = state.annotations;
    scanData.transform = state.transform;
    updateStripeLayerTabs();
    updateHUDMetrics();
    updateLayersList();
    renderCanvas();
};

window.cadRedo = function() {
    if (!redoStack.length) return;
    undoStack.push({
        stripes: JSON.parse(JSON.stringify(scanData.stripes)),
        annotations: JSON.parse(JSON.stringify(scanData.annotations)),
        transform: JSON.parse(JSON.stringify(scanData.transform))
    });
    const state = redoStack.pop();
    scanData.stripes = state.stripes;
    scanData.annotations = state.annotations;
    scanData.transform = state.transform;
    updateStripeLayerTabs();
    updateHUDMetrics();
    updateLayersList();
    renderCanvas();
};

// ---------------- METRIC SCALE CALIBRATION ----------------

window.openScaleCalibrationModal = function() {
    const m = document.getElementById('modal-scale-calibration');
    if (m) m.style.display = 'flex';
};

window.closeScaleCalibrationModal = function() {
    const m = document.getElementById('modal-scale-calibration');
    if (m) m.style.display = 'none';
};

window.applyScaleCalibration = function() {
    const dist = parseFloat(document.getElementById('calib-known-dist')?.value || '18.14');
    const px = parseFloat(document.getElementById('calib-pixel-dist')?.value || '1200');
    const unit = document.getElementById('calib-unit')?.value || 'm';
    
    if (dist > 0 && px > 0) {
        viewOptions.pxPerMeter = px / dist;
        viewOptions.unit = unit;
        
        const badge = document.getElementById('cad-scale-display');
        if (badge) {
            badge.innerHTML = `Scale: <strong>1 px = ${(1 / viewOptions.pxPerMeter).toFixed(4)} ${unit}</strong>`;
        }
        renderCanvas();
        closeScaleCalibrationModal();
    }
};

// ---------------- TOOLBAR CUSTOMIZER MODAL ----------------

window.openToolbarCustomizer = function() {
    const m = document.getElementById('modal-custom-toolbar');
    if (m) m.style.display = 'flex';
};

window.closeToolbarCustomizer = function() {
    const m = document.getElementById('modal-custom-toolbar');
    if (m) m.style.display = 'none';
};

window.saveToolbarConfig = function() {
    const tools = ['select', 'pan', 'zoom', 'crop', 'ruler', 'angle', 'caliper', 'spline', 'pen', 'arrow', 'rect', 'ellipse', 'text', 'eyedropper'];
    const config = {};
    tools.forEach(t => {
        const chk = document.getElementById(`tcfg-${t}`);
        if (chk) config[t] = chk.checked;
    });
    localStorage.setItem('cadToolbarConfig', JSON.stringify(config));
    applyToolbarConfig();
};

window.resetToolbarConfig = function() {
    localStorage.removeItem('cadToolbarConfig');
    document.querySelectorAll('[id^="tcfg-"]').forEach(chk => chk.checked = true);
    applyToolbarConfig();
};

function applyToolbarConfig() {
    const saved = localStorage.getItem('cadToolbarConfig');
    if (!saved) return;
    try {
        const config = JSON.parse(saved);
        Object.keys(config).forEach(t => {
            const btn = document.getElementById(`tool-${t}`);
            if (btn) btn.style.display = config[t] ? 'flex' : 'none';
            const chk = document.getElementById(`tcfg-${t}`);
            if (chk) chk.checked = config[t];
        });
    } catch (e) {}
}

window.exportAnnotatedCanvas = function() {
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `sail_scan_${scanData.sailName || 'export'}_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
};

// ---------------- KEYBOARD SHORTCUTS ----------------

function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
        
        const key = e.key.toLowerCase();
        
        if (e.ctrlKey || e.metaKey) {
            if (key === 'z') { e.preventDefault(); e.shiftKey ? cadRedo() : cadUndo(); return; }
            if (key === 'y') { e.preventDefault(); cadRedo(); return; }
        }
        
        if (key === 'v') setStudioTool('select');
        else if (key === 'h') setStudioTool('pan');
        else if (key === 'z') setStudioTool('zoom');
        else if (key === 'c') setStudioTool('crop');
        else if (key === 'r') setStudioTool('ruler');
        else if (key === 'a') setStudioTool('angle');
        else if (key === 'd') setStudioTool('caliper');
        else if (key === 's') setStudioTool('spline');
        else if (key === 'p') setStudioTool('pen');
        else if (key === 'w') setStudioTool('arrow');
        else if (key === 'b') setStudioTool('rect');
        else if (key === 'o') setStudioTool('ellipse');
        else if (key === 't') setStudioTool('text');
        else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelectedAnnotation();
        else if (e.key === 'Escape') setStudioTool('select');
    });
}

// ---------------- HUD, ANALYTICS & INDUSTRY REPORT ----------------

function updateHUDMetrics() {
    const active = scanData.stripes[scanData.activeStripeIndex];
    if (!active || !active.metrics) return;
    
    const hudCamber = document.getElementById('hud-camber');
    const hudDraft = document.getElementById('hud-draft');
    const hudTwist = document.getElementById('hud-twist');
    const hudEntryExit = document.getElementById('hud-entry-exit');
    
    if (hudCamber) hudCamber.innerText = `${active.metrics.camber || '--'}%`;
    if (hudDraft) hudDraft.innerText = `${active.metrics.draft_pos || '--'}%`;
    if (hudTwist) hudTwist.innerText = `${active.metrics.twist || '--'}°`;
    if (hudEntryExit) hudEntryExit.innerText = `${active.metrics.entry || '--'}° / ${active.metrics.exit || '--'}°`;
    
    const badgeCamber = document.getElementById('badge-stripe-camber');
    const badgeDraft = document.getElementById('badge-stripe-draft');
    if (badgeCamber) badgeCamber.innerText = `${active.metrics.camber || '--'}%`;
    if (badgeDraft) badgeDraft.innerText = `${active.metrics.draft_pos || '--'}%`;
}

// ===== ANALYTICS STUDIO STATE =====
let draftBarChart = null;
let radarChart = null;
let shapeIndexChart = null;

// Per-stripe visibility overrides: { index: bool }
let stripeVisibility = {};

function updateAnalyticsView() {
    buildAnalyticsStripeControls();
    buildAnalyticAeroCards();
    renderCamberChart();
    renderDraftBarChart();
    renderRadarChart();
    renderShapeIndexChart();
    renderAnalyticsTable();
}

// ---- CHART 1: Camber Profile Curves (with zoom, draft lines, reference annotations) ----
function renderCamberChart() {
    const canvasEl = document.getElementById('camberChartCanvas');
    if (!canvasEl) return;
    const ctxChart = canvasEl.getContext('2d');

    const fill      = document.getElementById('aopt-fill')?.checked ?? true;
    const showGrid  = document.getElementById('aopt-grid')?.checked ?? true;
    const showPts   = document.getElementById('aopt-points')?.checked ?? false;
    const smooth    = document.getElementById('aopt-smooth')?.checked ?? true;
    const tension   = parseFloat(document.getElementById('aopt-tension')?.value ?? '0.35');
    const showDraftLine = document.getElementById('aopt-draftline')?.checked ?? true;
    const showAngles    = document.getElementById('aopt-angles')?.checked ?? true;

    const xmin = parseFloat(document.getElementById('ax-xmin')?.value ?? '0');
    const xmax = parseFloat(document.getElementById('ax-xmax')?.value ?? '100');
    const ymin = document.getElementById('ax-ymin')?.value ? parseFloat(document.getElementById('ax-ymin').value) : undefined;
    const ymax = document.getElementById('ax-ymax')?.value ? parseFloat(document.getElementById('ax-ymax').value) : undefined;

    const refCamberEn = document.getElementById('ref-camber-en')?.checked ?? true;
    const refCamber   = parseFloat(document.getElementById('ref-camber')?.value ?? '12.5');
    const refDraftEn  = document.getElementById('ref-draft-en')?.checked ?? true;
    const refDraft    = parseFloat(document.getElementById('ref-draft')?.value ?? '40');

    // Build datasets
    const datasets = scanData.stripes
        .filter((_, i) => stripeVisibility[i] !== false)
        .map(stripe => {
            const curve = stripe.metrics?.normalized_curve || [];
            return {
                label: stripe.label,
                data: curve.map(pt => ({ x: parseFloat((pt[0] * 100).toFixed(1)), y: parseFloat(pt[1].toFixed(3)) })),
                borderColor: stripe.color || '#38bdf8',
                backgroundColor: fill ? `${stripe.color || '#38bdf8'}22` : 'transparent',
                fill: fill,
                tension: smooth ? tension : 0,
                pointRadius: showPts ? 3 : 0,
                pointHoverRadius: 5,
                borderWidth: 2
            };
        });

    // Reference annotation lines
    const annotations = {};
    if (refCamberEn && !isNaN(refCamber)) {
        annotations.refCamberLine = {
            type: 'line',
            yMin: refCamber,
            yMax: refCamber,
            borderColor: 'rgba(245,158,11,0.7)',
            borderWidth: 1.5,
            borderDash: [6, 4],
            label: { content: `Target ${refCamber}%`, display: true, position: 'start', color: '#f59e0b', font: { size: 10, weight: 'bold' }, backgroundColor: 'rgba(245,158,11,0.15)' }
        };
    }
    if (refDraftEn && !isNaN(refDraft)) {
        annotations.refDraftLine = {
            type: 'line',
            xMin: refDraft,
            xMax: refDraft,
            borderColor: 'rgba(167,139,250,0.7)',
            borderWidth: 1.5,
            borderDash: [6, 4],
            label: { content: `Draft ${refDraft}%`, display: true, position: 'start', color: '#a78bfa', font: { size: 10, weight: 'bold' }, backgroundColor: 'rgba(167,139,250,0.15)' }
        };
    }

    // Draft position lines per stripe
    if (showDraftLine) {
        scanData.stripes.filter((_, i) => stripeVisibility[i] !== false).forEach((stripe, i) => {
            const dp = stripe.metrics?.draft_pos;
            if (dp != null) {
                annotations[`draftPos${i}`] = {
                    type: 'line',
                    xMin: dp, xMax: dp,
                    borderColor: `${stripe.color || '#f59e0b'}80`,
                    borderWidth: 1,
                    borderDash: [3, 3]
                };
            }
        });
    }

    if (camberChart) camberChart.destroy();

    camberChart = new Chart(ctxChart, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 250 },
            scales: {
                x: {
                    type: 'linear',
                    min: xmin, max: xmax,
                    title: { display: true, text: '% Chord (0% Luff → 100% Leech)', color: '#94a3b8', font: { size: 11 } },
                    grid: { color: showGrid ? 'rgba(255,255,255,0.06)' : 'transparent' },
                    ticks: { color: '#94a3b8', font: { size: 11 } }
                },
                y: {
                    min: ymin, max: ymax,
                    title: { display: true, text: '% Camber Depth', color: '#94a3b8', font: { size: 11 } },
                    grid: { color: showGrid ? 'rgba(255,255,255,0.06)' : 'transparent' },
                    ticks: { color: '#94a3b8', font: { size: 11 } }
                }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc', font: { size: 12 }, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}% camber @ ${ctx.parsed.x.toFixed(1)}% chord`
                    }
                },
                zoom: {
                    pan: { enabled: true, mode: 'xy' },
                    zoom: {
                        wheel: { enabled: true },
                        pinch: { enabled: true },
                        mode: 'xy'
                    }
                },
                annotation: { annotations }
            }
        }
    });
}

// ---- CHART 2: Grouped Bar — Max Camber + Draft Position per Stripe ----
function renderDraftBarChart() {
    const canvasEl = document.getElementById('draftBarChartCanvas');
    if (!canvasEl) return;

    const visibleStripes = scanData.stripes.filter((_, i) => stripeVisibility[i] !== false);
    const labels = visibleStripes.map(s => s.label);
    const camberData = visibleStripes.map(s => parseFloat(s.metrics?.camber ?? 0));
    const draftData  = visibleStripes.map(s => parseFloat(s.metrics?.draft_pos ?? 0));
    const entryData  = visibleStripes.map(s => parseFloat(s.metrics?.entry ?? 0));

    const refCamberEn = document.getElementById('ref-camber-en')?.checked ?? true;
    const refCamber   = parseFloat(document.getElementById('ref-camber')?.value ?? '12.5');
    const refDraftEn  = document.getElementById('ref-draft-en')?.checked ?? true;
    const refDraft    = parseFloat(document.getElementById('ref-draft')?.value ?? '40');

    const annotations = {};
    if (refCamberEn && !isNaN(refCamber)) {
        annotations.refCamber = { type: 'line', yMin: refCamber, yMax: refCamber, borderColor: 'rgba(245,158,11,0.6)', borderWidth: 1.5, borderDash: [5, 4],
            label: { content: `Target Camber ${refCamber}%`, display: true, color: '#f59e0b', font: { size: 9 }, backgroundColor: 'rgba(245,158,11,0.12)' }
        };
    }

    if (draftBarChart) draftBarChart.destroy();

    draftBarChart = new Chart(canvasEl.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Max Camber (%)',
                    data: camberData,
                    backgroundColor: visibleStripes.map(s => `${s.color || '#38bdf8'}bb`),
                    borderColor: visibleStripes.map(s => s.color || '#38bdf8'),
                    borderWidth: 1.5,
                    borderRadius: 4
                },
                {
                    label: 'Draft Position (%)',
                    data: draftData,
                    backgroundColor: 'rgba(167,139,250,0.5)',
                    borderColor: '#a78bfa',
                    borderWidth: 1.5,
                    borderRadius: 4
                },
                {
                    label: 'Entry Angle (°)',
                    data: entryData,
                    backgroundColor: 'rgba(16,185,129,0.4)',
                    borderColor: '#10b981',
                    borderWidth: 1.5,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 250 },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' }, beginAtZero: true }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc', font: { size: 10 }, usePointStyle: true } },
                annotation: { annotations }
            }
        }
    });
}

// ---- CHART 3: Radar — Shape Fingerprint Spider ----
function renderRadarChart() {
    const canvasEl = document.getElementById('radarChartCanvas');
    if (!canvasEl) return;

    const visibleStripes = scanData.stripes.filter((_, i) => stripeVisibility[i] !== false);

    // Normalize metrics 0-100 for radar display
    const normalise = (val, min, max) => Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));

    const datasets = visibleStripes.map(stripe => {
        const m = stripe.metrics || {};
        return {
            label: stripe.label,
            data: [
                normalise(parseFloat(m.camber ?? 0), 0, 25),       // Max Camber %
                normalise(parseFloat(m.draft_pos ?? 50), 20, 60),   // Draft Position (forward=high)
                normalise(parseFloat(m.twist ?? 0), 0, 15),         // Twist
                normalise(parseFloat(m.entry ?? 15), 10, 30),       // Entry Angle
                normalise(100 - parseFloat(m.exit ?? 5), 0, 30),    // Exit Angle (inverse: flatter=higher)
            ],
            backgroundColor: `${stripe.color || '#38bdf8'}30`,
            borderColor: stripe.color || '#38bdf8',
            borderWidth: 2,
            pointBackgroundColor: stripe.color || '#38bdf8',
            pointRadius: 4
        };
    });

    if (radarChart) radarChart.destroy();

    radarChart = new Chart(canvasEl.getContext('2d'), {
        type: 'radar',
        data: {
            labels: ['Max Camber', 'Draft Forward', 'Twist', 'Entry Angle', 'Flat Exit'],
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 250 },
            scales: {
                r: {
                    min: 0, max: 100,
                    grid: { color: 'rgba(255,255,255,0.08)' },
                    angleLines: { color: 'rgba(255,255,255,0.08)' },
                    pointLabels: { color: '#94a3b8', font: { size: 10 } },
                    ticks: { display: false }
                }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc', font: { size: 10 }, usePointStyle: true } }
            }
        }
    });
}

// ---- CHART 4: Shape Index Scatter — Draft Pos% vs Max Camber% ----
function renderShapeIndexChart() {
    const canvasEl = document.getElementById('shapeIndexChartCanvas');
    if (!canvasEl) return;

    const visibleStripes = scanData.stripes.filter((_, i) => stripeVisibility[i] !== false);

    const refCamberEn = document.getElementById('ref-camber-en')?.checked ?? true;
    const refCamber   = parseFloat(document.getElementById('ref-camber')?.value ?? '12.5');
    const refDraftEn  = document.getElementById('ref-draft-en')?.checked ?? true;
    const refDraft    = parseFloat(document.getElementById('ref-draft')?.value ?? '40');

    const datasets = visibleStripes.map(stripe => ({
        label: stripe.label,
        data: [{ x: parseFloat(stripe.metrics?.draft_pos ?? 40), y: parseFloat(stripe.metrics?.camber ?? 0) }],
        backgroundColor: `${stripe.color || '#10b981'}cc`,
        borderColor: stripe.color || '#10b981',
        borderWidth: 2,
        pointRadius: 10,
        pointStyle: 'circle'
    }));

    const annotations = {};
    if (refCamberEn && refDraftEn && !isNaN(refCamber) && !isNaN(refDraft)) {
        // Target crosshair
        annotations.targetV = { type: 'line', xMin: refDraft, xMax: refDraft,
            borderColor: 'rgba(245,158,11,0.5)', borderWidth: 1, borderDash: [4, 4] };
        annotations.targetH = { type: 'line', yMin: refCamber, yMax: refCamber,
            borderColor: 'rgba(245,158,11,0.5)', borderWidth: 1, borderDash: [4, 4] };
        annotations.targetPt = { type: 'point', xValue: refDraft, yValue: refCamber,
            radius: 10, backgroundColor: 'rgba(245,158,11,0.25)', borderColor: '#f59e0b', borderWidth: 2 };
    }

    if (shapeIndexChart) shapeIndexChart.destroy();

    shapeIndexChart = new Chart(canvasEl.getContext('2d'), {
        type: 'bubble',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 250 },
            scales: {
                x: {
                    title: { display: true, text: 'Draft Position (%)', color: '#94a3b8', font: { size: 11 } },
                    grid: { color: 'rgba(255,255,255,0.06)' },
                    ticks: { color: '#94a3b8' },
                    min: 20, max: 70
                },
                y: {
                    title: { display: true, text: 'Max Camber (%)', color: '#94a3b8', font: { size: 11 } },
                    grid: { color: 'rgba(255,255,255,0.06)' },
                    ticks: { color: '#94a3b8' },
                    min: 0
                }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc', font: { size: 11 }, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: Draft=${ctx.parsed.x}%, Camber=${ctx.parsed.y}%`
                    }
                },
                annotation: { annotations }
            }
        }
    });
}

// ---- Update all chart options live from toolbar controls ----
window.updateAnalyticsChartOptions = function() {
    renderCamberChart();
    renderDraftBarChart();
    renderShapeIndexChart();
};

// ---- Toggle chart block visibility ----
window.toggleAnalyticsChart = function(chartName, visible) {
    const blockMap = { camber: 'chart-block-camber', bar: 'chart-block-bar', radar: 'chart-block-radar', scatter: 'chart-block-scatter' };
    const el = document.getElementById(blockMap[chartName]);
    if (el) el.style.display = visible ? '' : 'none';
};

// ---- Build per-stripe color + visibility controls ----
function buildAnalyticsStripeControls() {
    const container = document.getElementById('analytics-stripe-controls');
    if (!container) return;
    if (!scanData.stripes.length) {
        container.innerHTML = '<div style="color: #64748b; font-size: 0.72rem; font-style: italic;">Load an image and autodetect stripes first</div>';
        return;
    }
    container.innerHTML = scanData.stripes.map((stripe, i) => `
        <div style="display: flex; align-items: center; gap: 8px; padding: 5px 7px; background: #0f172a; border-radius: 5px; border: 1px solid #1e293b;">
            <input type="color" value="${stripe.color || '#38bdf8'}"
                oninput="scanData.stripes[${i}].color=this.value; updateAnalyticsChartOptions();"
                style="width: 22px; height: 22px; border: none; background: none; cursor: pointer; border-radius: 3px; padding: 0;"
                title="Change stripe colour">
            <label style="display: flex; align-items: center; gap: 5px; cursor: pointer; flex: 1; min-width: 0;">
                <input type="checkbox" ${stripeVisibility[i] === false ? '' : 'checked'}
                    onchange="stripeVisibility[${i}]=(this.checked); updateAnalyticsChartOptions();"
                    style="accent-color: ${stripe.color || '#38bdf8'}; width: 13px; height: 13px;">
                <span style="color: ${stripe.color || '#38bdf8'}; font-weight: 700; font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${stripe.label}</span>
            </label>
            <span style="font-size: 0.68rem; color: #475569; white-space: nowrap;">${stripe.metrics?.camber ?? '--'}%</span>
        </div>
    `).join('');
}

// ---- Build per-stripe aero parameter cards ----
function buildAnalyticAeroCards() {
    const container = document.getElementById('analytics-aero-cards');
    if (!container) return;
    if (!scanData.stripes.length) {
        container.innerHTML = '<div style="color: #64748b; font-size: 0.72rem; font-style: italic;">Run analysis to see computed parameters</div>';
        return;
    }

    const refCamber = parseFloat(document.getElementById('ref-camber')?.value ?? '12.5');
    const refDraft  = parseFloat(document.getElementById('ref-draft')?.value ?? '40');

    container.innerHTML = scanData.stripes.map(stripe => {
        const m = stripe.metrics || {};
        const camberOk  = Math.abs((parseFloat(m.camber) || 0) - refCamber) < 2;
        const draftOk   = Math.abs((parseFloat(m.draft_pos) || 0) - refDraft) < 5;
        const shapeIdx  = m.entry && m.exit ? ((parseFloat(m.entry) / parseFloat(m.exit)) * 100).toFixed(0) : '--';
        return `
        <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; padding: 7px 9px; border-left: 3px solid ${stripe.color || '#38bdf8'};">
            <div style="font-weight: 700; font-size: 0.8rem; color: ${stripe.color || '#38bdf8'}; margin-bottom: 5px;">${stripe.label}</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 3px 8px; font-size: 0.72rem;">
                <span style="color: #94a3b8;">Camber:</span>
                <span style="font-weight: 700; color: ${camberOk ? '#10b981' : '#ef4444'};">${m.camber ?? '--'}%</span>
                <span style="color: #94a3b8;">Draft Pos:</span>
                <span style="font-weight: 700; color: ${draftOk ? '#10b981' : '#f59e0b'};">${m.draft_pos ?? '--'}%</span>
                <span style="color: #94a3b8;">Twist:</span>
                <span style="color: #a78bfa;">${m.twist ?? '--'}°</span>
                <span style="color: #94a3b8;">Entry:</span>
                <span style="color: #38bdf8;">${m.entry ?? '--'}°</span>
                <span style="color: #94a3b8;">Exit:</span>
                <span style="color: #38bdf8;">${m.exit ?? '--'}°</span>
                <span style="color: #94a3b8;">Shape Idx:</span>
                <span style="color: #f59e0b; font-weight: 600;">${shapeIdx}</span>
            </div>
        </div>`;
    }).join('');
}

// ---- Full Analytics Table with range highlight ----
function renderAnalyticsTable() {
    const tbody = document.getElementById('analyticsTableBody');
    if (!tbody) return;
    const refCamber = parseFloat(document.getElementById('ref-camber')?.value ?? '12.5');
    const refDraft  = parseFloat(document.getElementById('ref-draft')?.value ?? '40');

    if (!scanData.stripes.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="padding: 20px; text-align: center; color: #64748b;">Run auto-detection to populate analytics</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    scanData.stripes.forEach(stripe => {
        const m = stripe.metrics || {};
        const camberVal = parseFloat(m.camber ?? 0);
        const draftVal  = parseFloat(m.draft_pos ?? 0);
        const shapeIdx  = m.entry && m.exit ? ((parseFloat(m.entry) / Math.max(1, parseFloat(m.exit))) * 100).toFixed(0) : '--';

        const camberDelta = Math.abs(camberVal - refCamber);
        const draftDelta  = Math.abs(draftVal - refDraft);
        const camberStatus = camberDelta < 1 ? '🟢 On target' : camberDelta < 3 ? '🟡 Close' : '🔴 Off target';
        const draftStatus  = draftDelta < 3 ? '🟢 On target' : draftDelta < 7 ? '🟡 Close' : '🔴 Off target';

        const camberBg = camberDelta < 1 ? 'rgba(16,185,129,0.08)' : camberDelta < 3 ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)';
        const draftBg  = draftDelta  < 3 ? 'rgba(16,185,129,0.08)' : draftDelta  < 7 ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)';

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #1e293b';
        tr.innerHTML = `
            <td style="padding: 7px 10px; font-weight: 700; color: ${stripe.color};">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${stripe.color}; margin-right: 5px;"></span>
                ${stripe.label}
            </td>
            <td style="padding: 7px 10px; font-weight: 700; color: #38bdf8; background: ${camberBg};">${m.camber ?? '--'}%</td>
            <td style="padding: 7px 10px; font-weight: 700; color: #f59e0b; background: ${draftBg};">${m.draft_pos ?? '--'}%</td>
            <td style="padding: 7px 10px; color: #10b981;">${m.twist ?? '--'}°</td>
            <td style="padding: 7px 10px; color: #f8fafc;">${m.entry ?? '--'}°</td>
            <td style="padding: 7px 10px; color: #f8fafc;">${m.exit ?? '--'}°</td>
            <td style="padding: 7px 10px; color: #a78bfa; font-weight: 600;">${shapeIdx}</td>
            <td style="padding: 7px 10px; color: #64748b;">${m.chord_len ?? '--'} px</td>
            <td style="padding: 7px 10px; font-size: 0.75rem;">${camberStatus}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ---- Axis helpers ----
window.resetAnalyticsAxes = function() {
    const el = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    el('ax-xmin', '0'); el('ax-xmax', '100');
    el('ax-ymin', ''); el('ax-ymax', '');
    renderCamberChart();
};

window.zoomFitAnalyticsAxes = function() {
    if (!scanData.stripes.length) return;
    let allY = [];
    scanData.stripes.forEach(s => {
        (s.metrics?.normalized_curve || []).forEach(pt => allY.push(pt[1]));
    });
    if (!allY.length) return;
    const yMin = Math.floor(Math.min(...allY) * 100) / 100;
    const yMax = Math.ceil(Math.max(...allY) * 100 + 1) / 100;
    const el = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    el('ax-ymin', yMin.toFixed(1)); el('ax-ymax', yMax.toFixed(1));
    renderCamberChart();
};

// ---- CSV Export ----
window.exportAnalyticsCSV = function() {
    if (!scanData.stripes.length) { alert('No stripe data to export.'); return; }
    const rows = [['Stripe', 'Max Camber (%)', 'Draft Pos (%)', 'Twist (°)', 'Entry Angle (°)', 'Exit Angle (°)', 'Shape Index', 'Chord (px)', 'Tack']];
    scanData.stripes.forEach(s => {
        const m = s.metrics || {};
        const shapeIdx = m.entry && m.exit ? ((parseFloat(m.entry) / Math.max(1, parseFloat(m.exit))) * 100).toFixed(0) : '';
        rows.push([s.label, m.camber ?? '', m.draft_pos ?? '', m.twist ?? '', m.entry ?? '', m.exit ?? '', shapeIdx, m.chord_len ?? '', scanData.tack === 'port' ? 'PORT' : 'STBD']);
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    const boat = scanData.boatName || 'boat';
    const sail = scanData.sailName || 'sail';
    a.download = `L3S_Analytics_${boat}_${sail}_${new Date().toISOString().slice(0,10)}.csv`.replace(/\s+/g, '_');
    a.click();
    URL.revokeObjectURL(url);
};



function updateCompareView() {
    if (!compareChart) {
        const canvasEl = document.getElementById('compareChartCanvas');
        if (!canvasEl) return;
        const ctxChart = canvasEl.getContext('2d');
        
        const datasets = scanData.stripes.map(s => ({
            label: `Current: ${s.label}`,
            data: (s.metrics?.normalized_curve || []).map(pt => ({ x: pt[0] * 100, y: pt[1] })),
            borderColor: s.color || '#38bdf8',
            tension: 0.35,
            pointRadius: 0
        }));
        
        compareChart = new Chart(ctxChart, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { type: 'linear', min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                },
                plugins: { legend: { labels: { color: '#f8fafc' } } }
            }
        });
    }
}

window.handleLabelPhoto = function(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        scanData.labelPhotoSrc = e.target.result;
        document.getElementById('labelPhotoImg').src = e.target.result;
        document.getElementById('labelPhotoImg').style.display = 'block';
        document.getElementById('labelPhotoPlaceholder').style.display = 'none';
    };
    reader.readAsDataURL(file);
};

function syncSpecsFromInputs() {
    const sNum = document.getElementById('specSailNumber')?.value || document.getElementById('inputSailNumber')?.value || '';
    const sName = document.getElementById('specSailName')?.value || document.getElementById('inputSailName')?.value || '';
    const bName = document.getElementById('specBoatName')?.value || document.getElementById('inputBoatModel')?.value || '';
    
    // Cross-populate if one is filled
    if (sNum) {
        if (document.getElementById('specSailNumber')) document.getElementById('specSailNumber').value = sNum;
        if (document.getElementById('inputSailNumber')) document.getElementById('inputSailNumber').value = sNum;
    }
    if (sName) {
        if (document.getElementById('specSailName')) document.getElementById('specSailName').value = sName;
        if (document.getElementById('inputSailName')) document.getElementById('inputSailName').value = sName;
    }
    if (bName) {
        if (document.getElementById('specBoatName')) document.getElementById('specBoatName').value = bName;
        if (document.getElementById('inputBoatModel')) document.getElementById('inputBoatModel').value = bName;
    }
    
    scanData.sailNumber = sNum;
    scanData.sailName = sName;
    scanData.boatName = bName;
    scanData.boatYear = document.getElementById('specBoatYear')?.value || '';
    scanData.sailmaker = document.getElementById('specSailmaker')?.value || '';
    scanData.certificateType = document.getElementById('specCertificate')?.value || 'ORC';
    
    scanData.dimensions = {
        hlu: document.getElementById('dim_hlu')?.value || '',
        hlp: document.getElementById('dim_hlp')?.value || '',
        hqw: document.getElementById('dim_hqw')?.value || '',
        hhw: document.getElementById('dim_hhw')?.value || '',
        htw: document.getElementById('dim_htw')?.value || '',
        huw: document.getElementById('dim_huw')?.value || '',
        hb: document.getElementById('dim_hb')?.value || ''
    };
    
    scanData.wind = {
        tws: document.getElementById('rig_tws')?.value || '',
        twa: document.getElementById('rig_twa')?.value || ''
    };
    
    scanData.rig = {
        cunningham: document.getElementById('rig_cunningham')?.value || '',
        sheet: document.getElementById('rig_sheet')?.value || ''
    };
}

window.buildReportPreview = function() {
    syncSpecsFromInputs();
    const sheet = document.getElementById('print-report-sheet');
    if (!sheet) return;
    
    const incSummary = document.getElementById('rep-mod-summary')?.checked ?? true;
    const incCurves = document.getElementById('rep-mod-curves')?.checked ?? true;
    const incCanvas = document.getElementById('rep-mod-canvas')?.checked ?? true;
    const incLabel = document.getElementById('rep-mod-label')?.checked ?? true;
    const incRig = document.getElementById('rep-mod-rig')?.checked ?? true;
    const notes = document.getElementById('rep-learning-points')?.value || '';
    
    const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const isPort = (scanData.tack === 'port');
    const tackLabel = isPort ? 'PORT' : 'STBD';
    const tackColor = isPort ? '#ef4444' : '#10b981';
    const tackBg = isPort ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';

    const refCamber = parseFloat(document.getElementById('ref-camber')?.value ?? '12.5');
    const refDraft  = parseFloat(document.getElementById('ref-draft')?.value ?? '40');
    
    let html = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0284c7; padding-bottom: 1rem; margin-bottom: 1.5rem;">
            <div>
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                    <h1 style="font-size: 1.6rem; color: #0284c7; margin: 0; font-weight: 800; text-transform: uppercase;">
                        L3S Sail Scan Performance Report
                    </h1>
                    <span style="font-size: 0.85rem; font-weight: 900; letter-spacing: 2px; color: ${tackColor}; background: ${tackBg}; border: 1.5px solid ${tackColor}; padding: 3px 10px; border-radius: 5px;">${tackLabel}</span>
                </div>
                <div style="font-size: 0.85rem; color: #64748b; margin-top: 4px;">
                    ${scanData.boatName || 'Grand Prix Sailing'} • Sail: <strong>${scanData.sailName || 'J1 Light-Medium'}</strong> (${scanData.sailNumber || 'ESP-831'})
                    &nbsp;•&nbsp; Tack: <strong style="color: ${tackColor};">${isPort ? 'Port (Babor)' : 'Starboard (Estribor)'}</strong>
                </div>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 0.85rem; font-weight: 700; color: #0f172a;">${dateStr}</div>
                <div style="font-size: 0.75rem; color: #64748b;">LS Lab Antigravity Engine</div>
            </div>
        </div>
    `;
    
    if (incSummary) {
        html += `
            <div style="margin-bottom: 1.5rem;">
                <h3 style="font-size: 1.05rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 0.75rem;">
                    1. Camber Distribution & Geometry Metrics (Target: C ${refCamber}%, D ${refDraft}%)
                </h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
                    <thead>
                        <tr style="background: #f8fafc; border-bottom: 1px solid #cbd5e1;">
                            <th style="padding: 6px 8px;">Stripe</th>
                            <th style="padding: 6px 8px;">Camber</th>
                            <th style="padding: 6px 8px;">Draft Pos</th>
                            <th style="padding: 6px 8px;">Twist</th>
                            <th style="padding: 6px 8px;">Entry/Exit</th>
                            <th style="padding: 6px 8px;">Shape Idx</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${scanData.stripes.map(s => {
                            const m = s.metrics || {};
                            const camberVal = parseFloat(m.camber ?? 0);
                            const draftVal = parseFloat(m.draft_pos ?? 0);
                            const shapeIdx = m.entry && m.exit ? ((parseFloat(m.entry) / Math.max(1, parseFloat(m.exit))) * 100).toFixed(0) : '--';
                            const cColor = Math.abs(camberVal - refCamber) < 1 ? '#10b981' : '#ef4444';
                            const dColor = Math.abs(draftVal - refDraft) < 3 ? '#10b981' : '#f59e0b';
                            return `
                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                <td style="padding: 6px 8px; font-weight: 700; color: ${s.color};">${s.label}</td>
                                <td style="padding: 6px 8px; font-weight: 700; color: ${cColor};">${m.camber ?? '--'}%</td>
                                <td style="padding: 6px 8px; font-weight: 700; color: ${dColor};">${m.draft_pos ?? '--'}%</td>
                                <td style="padding: 6px 8px;">${m.twist ?? '--'}°</td>
                                <td style="padding: 6px 8px;">${m.entry ?? '--'}°/${m.exit ?? '--'}°</td>
                                <td style="padding: 6px 8px; font-weight: 600;">${shapeIdx}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }
    
    if (incCanvas) {
        let canvasSnap = null;
        try {
            if (canvas && scanData.imageObj) {
                canvasSnap = canvas.toDataURL('image/jpeg', 0.85);
            }
        } catch (e) {}
        if (!canvasSnap && scanData.imageSrc) canvasSnap = scanData.imageSrc;

        if (canvasSnap) {
            html += `
                <div style="margin-bottom: 1.5rem;">
                    <h3 style="font-size: 1.05rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 0.75rem;">
                        Sail Photo &amp; Traced Draft Stripes Overlay
                    </h3>
                    <div style="border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; background: #0b0f17; max-height: 260px; display: flex; align-items: center; justify-content: center;">
                        <img src="${canvasSnap}" style="max-width: 100%; max-height: 260px; object-fit: contain;">
                    </div>
                </div>
            `;
        }
    }

    if (incCurves) {
        // Grab all 4 Step-3 analytics chart snapshots live
        const getSnap = chart => {
            try { return (chart && typeof chart.toBase64Image === 'function') ? chart.toBase64Image() : null; } catch { return null; }
        };
        const snap1 = getSnap(camberChart);
        const snap2 = getSnap(draftBarChart);
        const snap3 = getSnap(radarChart);
        const snap4 = getSnap(shapeIndexChart);

        const chartImg = (snap, hint) => snap
            ? `<img src="${snap}" style="width: 100%; border-radius: 4px; border: 1px solid #e2e8f0; background: #fff;">`
            : `<div style="height: 110px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; color: #94a3b8; text-align: center; padding: 8px;">${hint}</div>`;

        html += `
            <div style="margin-bottom: 1.5rem;">
                <h3 style="font-size: 1.05rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 0.75rem;">
                    3. Aero Analytics Studio — 4-Chart Panel
                </h3>
                <div style="margin-bottom: 0.6rem;">
                    <div style="font-size: 0.72rem; font-weight: 700; color: #0284c7; margin-bottom: 3px;">① Camber Profile Curves — % Chord vs % Camber Depth</div>
                    ${chartImg(snap1, '📊 Visit Step 3 first to capture chart')}
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin-bottom: 0.6rem;">
                    <div>
                        <div style="font-size: 0.72rem; font-weight: 700; color: #d97706; margin-bottom: 3px;">② Camber &amp; Draft Bar Chart</div>
                        ${chartImg(snap2, '📊 Visit Step 3 first')}
                    </div>
                    <div>
                        <div style="font-size: 0.72rem; font-weight: 700; color: #7c3aed; margin-bottom: 3px;">③ Shape Fingerprint Radar</div>
                        ${chartImg(snap3, '📊 Visit Step 3 first')}
                    </div>
                </div>
                <div>
                    <div style="font-size: 0.72rem; font-weight: 700; color: #059669; margin-bottom: 3px;">④ Shape Index Scatter — Draft % vs Max Camber %</div>
                    ${chartImg(snap4, '📊 Visit Step 3 first')}
                </div>
            </div>
        `;
    }

    if (incLabel) {
        html += `
            <div style="margin-bottom: 1.5rem;">
                <h3 style="font-size: 1.05rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 0.75rem;">
                    Official Sail Measurements &amp; Top Label (ORC Certification)
                </h3>
                <div style="display: grid; grid-template-columns: 140px 1fr; gap: 1rem; align-items: center;">
                    ${scanData.labelPhotoSrc ? `
                        <div style="width: 140px; height: 140px; border-radius: 6px; border: 1px solid #cbd5e1; overflow: hidden;">
                            <img src="${scanData.labelPhotoSrc}" style="width: 100%; height: 100%; object-fit: cover;">
                        </div>
                    ` : `<div style="width: 140px; height: 140px; background: #f1f5f9; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #94a3b8;">No Label Photo</div>`}
                    
                    <div>
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; font-size: 0.8rem; background: #f8fafc; padding: 8px; border-radius: 6px; border: 1px solid #e2e8f0;">
                            <div>HLU: <strong>${scanData.dimensions.hlu || '--'} m</strong></div>
                            <div>HLP: <strong>${scanData.dimensions.hlp || '--'} m</strong></div>
                            <div>HQW: <strong>${scanData.dimensions.hqw || '--'} m</strong></div>
                            <div>HHW: <strong>${scanData.dimensions.hhw || '--'} m</strong></div>
                            <div>HTW: <strong>${scanData.dimensions.htw || '--'} m</strong></div>
                            <div>HUW: <strong>${scanData.dimensions.huw || '--'} m</strong></div>
                            <div>HB: <strong>${scanData.dimensions.hb || '--'} m</strong></div>
                            <div>Loft: <strong>${scanData.sailmaker || '--'}</strong></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    if (incRig && (scanData.wind.tws || scanData.rig.cunningham)) {
        html += `
            <div style="margin-bottom: 1.5rem; background: #f1f5f9; padding: 10px 14px; border-radius: 6px; font-size: 0.8rem;">
                <div style="display: flex; gap: 1.5rem; flex-wrap: wrap;">
                    <div>Wind Speed (TWS): <strong>${scanData.wind.tws || '--'} kn</strong></div>
                    <div>Wind Angle (TWA): <strong>${scanData.wind.twa || '--'}°</strong></div>
                    <div>Cunningham: <strong>${scanData.rig.cunningham || '--'}</strong></div>
                    <div>Sheet / Car: <strong>${scanData.rig.sheet || '--'}</strong></div>
                </div>
            </div>
        `;
    }
    
    if (notes) {
        html += `
            <div style="margin-bottom: 1.5rem;">
                <h3 style="font-size: 1.05rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 0.75rem;">
                    Trimmer &amp; Coach Recommendations
                </h3>
                <div style="font-size: 0.85rem; color: #334155; line-height: 1.5; background: #fafafa; border-left: 3px solid #0284c7; padding: 8px 12px;">
                    ${notes.replace(/\n/g, '<br>')}
                </div>
            </div>
        `;
    }
    
    sheet.innerHTML = html;
};

// ---------------- DATABASE PERSISTENCE & LS-PRO SAVING ----------------

function initAuth() {
    const token = localStorage.getItem('firebaseToken') || window.currentUserToken;
    if (token) {
        currentUserToken = token;
        loadUserFleet();
    }
}

function loadUserFleet() {
    if (!currentUserToken) return;
    fetch('/api/boats', {
        headers: { 'Authorization': currentUserToken }
    })
    .then(r => r.json())
    .then(boats => {
        const boatSelect = document.getElementById('boatSelect');
        if (boatSelect && Array.isArray(boats)) {
            boatSelect.innerHTML = '<option value="">Guest (Unregistered)</option><option value="_new_">+ Create New Boat...</option>';
            boats.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.innerText = `${b.name} (${b.type || 'Boat'})`;
                boatSelect.appendChild(opt);
            });
            
            if (scanData.boatId) {
                boatSelect.value = scanData.boatId;
                handleBoatChange(scanData.boatId);
            }
        }
    })
    .catch(err => console.warn('Could not fetch fleet:', err));
}

window.handleBoatChange = function(bId) {
    if (bId === '_new_') {
        const name = prompt('Enter new boat name:');
        if (name) {
            fetch('/api/boats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': currentUserToken },
                body: JSON.stringify({ name: name, type: 'Grand Prix' })
            })
            .then(r => r.json())
            .then(newBoat => {
                scanData.boatId = newBoat.id;
                scanData.boatName = newBoat.name;
                loadUserFleet();
            });
        }
        return;
    }
    
    scanData.boatId = bId;
    const bSel = document.getElementById('boatSelect');
    if (bSel && bSel.selectedIndex >= 0) {
        scanData.boatName = bSel.options[bSel.selectedIndex].text;
        document.getElementById('lbl-active-boat').innerText = scanData.boatName;
    }
    
    if (bId) {
        fetch(`/api/boats/${bId}/sails`, {
            headers: { 'Authorization': currentUserToken }
        })
        .then(r => r.json())
        .then(sails => {
            const sailSelect = document.getElementById('sailSelect');
            if (sailSelect && Array.isArray(sails)) {
                sailSelect.innerHTML = '<option value="">Select or Create Sail</option><option value="_new_">+ Create New Sail...</option>';
                sails.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.id;
                    opt.innerText = s.code + (s.description ? ` (${s.description})` : '');
                    sailSelect.appendChild(opt);
                });
                
                if (scanData.sailId) {
                    sailSelect.value = scanData.sailId;
                    handleSailChange(scanData.sailId);
                }
            }
        });
    }
};

window.handleSailChange = function(sId) {
    if (sId === '_new_') {
        const code = prompt('Enter sail code / number (e.g. J1-4 / ESP-831):');
        if (code) {
            fetch(`/api/boats/${scanData.boatId}/sails`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': currentUserToken },
                body: JSON.stringify({ code: code, description: 'Created in L3S Studio' })
            })
            .then(r => r.json())
            .then(newSail => {
                scanData.sailId = newSail.id;
                scanData.sailName = code;
                handleBoatChange(scanData.boatId);
            });
        }
        return;
    }
    
    scanData.sailId = sId;
    const sSel = document.getElementById('sailSelect');
    if (sSel && sSel.selectedIndex >= 0) {
        scanData.sailName = sSel.options[sSel.selectedIndex].text;
        document.getElementById('lbl-active-sail').innerText = scanData.sailName;
    }
};

window.saveScanToFleetDatabase = function() {
    if (!scanData.boatId || !scanData.sailId) {
        alert('Please assign a Boat and Sail profile in Step 1 to save into the database.');
        switchScanTab('upload');
        return;
    }
    
    syncSpecsFromInputs();
    
    const analysisPayload = {
        date: new Date().toISOString(),
        scan_type: scanData.scanType,
        stripes: scanData.stripes,
        annotations: scanData.annotations,
        transform: scanData.transform,
        metrics: scanData.stripes[0]?.metrics || {},
        sail_specs: {
            sail_number: scanData.sailNumber,
            sail_name: scanData.sailName,
            boat_year: scanData.boatYear,
            sailmaker: scanData.sailmaker,
            certificate_type: scanData.certificateType,
            dimensions: scanData.dimensions,
            label_photo: scanData.labelPhotoSrc
        },
        wind: scanData.wind,
        rig: scanData.rig,
        notes: document.getElementById('rep-learning-points')?.value || ''
    };
    
    fetch('/api/sail-scan/save-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': currentUserToken },
        body: JSON.stringify({
            boat_id: scanData.boatId,
            sail_id: scanData.sailId,
            analysis_data: analysisPayload,
            sail_specs: analysisPayload.sail_specs
        })
    })
    .then(r => r.json())
    .then(res => {
        if (res.success) {
            showToast('✅ Saved to Boat & Sail Database successfully!');
        } else {
            alert('Save failed: ' + (res.error || 'Unknown error'));
        }
    })
    .catch(err => alert('Save error: ' + err));
};

window.saveSailScanProject = function() {
    syncSpecsFromInputs();
    
    const projectPayload = {
        name: `${scanData.sailName || 'Sail_Scan'}_${new Date().toISOString().slice(0, 10)}`,
        scanData: scanData,
        timestamp: new Date().toISOString()
    };
    
    fetch('/api/sail-scan/save-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': currentUserToken },
        body: JSON.stringify(projectPayload)
    })
    .then(r => r.json())
    .then(res => {
        if (res.success) {
            showToast(`💾 Project "${res.name}" saved to LS PRO Cloud!`);
        } else {
            showToast(`💾 Project saved locally in session.`);
        }
    })
    .catch(err => {
        showToast('💾 Project saved locally in session.');
    });
};

function showToast(msg) {
    const toast = document.getElementById('save-toast');
    if (toast) {
        toast.innerText = msg;
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 3500);
    }
}
