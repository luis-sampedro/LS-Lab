// SailCam Vision Lab Autodetect Workbench JS
// Cognitive Sail Recognition Pipeline & Interactive Testing Engine

let currentImage = null;
let currentImagePath = '';
let currentImageB64 = null;
let currentResult = null;
let activeStripeIndex = 0;
let isSnapMode = false;
let selectedSailType = 'mainsail';

// Camera State
const camera = {
    panX: 0,
    panY: 0,
    zoom: 1.0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    effectiveScale: 1.0
};

// Dragging Handle State
let draggingHandle = null; // { stripeIdx, handleName: 'p0'|'p1'|'p2'|'p3' }

// Canvas Elements
let canvas, ctx, container;

document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('workbenchCanvas');
    ctx = canvas.getContext('2d');
    container = document.getElementById('canvasContainer');

    window.addEventListener('resize', resizeCanvas);
    setupCanvasEvents();
    resizeCanvas();

    // Load first image from selector
    const sel = document.getElementById('imageSelect');
    if (sel && sel.options.length > 0) {
        handleImageSelection(sel.options[0].value);
    }
});

function resizeCanvas() {
    if (!canvas || !container) return;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    redraw();
}

function resetCanvasView() {
    if (!currentImage || !canvas) return;
    const cw = canvas.width, ch = canvas.height;
    const iw = currentImage.width, ih = currentImage.height;
    const scale = Math.min((cw - 60) / iw, (ch - 60) / ih, 1.0);
    camera.zoom = scale;
    camera.panX = 0;
    camera.panY = 0;
    updateZoomReadout();
    redraw();
}

function updateZoomReadout() {
    const el = document.getElementById('zoomLevel');
    if (el) el.innerText = `Zoom: ${Math.round(camera.zoom * 100)}%`;
}

// ---------------- COORDINATE TRANSFORMATIONS ----------------

function imageToScreen(ix, iy) {
    const cw = canvas.width, ch = canvas.height;
    const iw = currentImage ? currentImage.width : 0;
    const ih = currentImage ? currentImage.height : 0;
    
    const cx = cw / 2 + camera.panX;
    const cy = ch / 2 + camera.panY;
    const sx = cx + (ix - iw / 2) * camera.zoom;
    const sy = cy + (iy - ih / 2) * camera.zoom;
    return { x: sx, y: sy };
}

function screenToImage(sx, sy) {
    const cw = canvas.width, ch = canvas.height;
    const iw = currentImage ? currentImage.width : 0;
    const ih = currentImage ? currentImage.height : 0;
    
    const cx = cw / 2 + camera.panX;
    const cy = ch / 2 + camera.panY;
    const ix = (sx - cx) / camera.zoom + iw / 2;
    const iy = (sy - cy) / camera.zoom + ih / 2;
    return { x: ix, y: iy };
}

// ---------------- CANVAS MOUSE / GESTURE EVENTS ----------------

function setupCanvasEvents() {
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        
        const ptBefore = screenToImage(mx, my);
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        camera.zoom = Math.max(0.1, Math.min(15.0, camera.zoom * factor));
        
        const ptAfter = screenToImage(mx, my);
        camera.panX += (ptAfter.x - ptBefore.x) * camera.zoom;
        camera.panY += (ptAfter.y - ptBefore.y) * camera.zoom;
        
        updateZoomReadout();
        redraw();
    });

    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Check if clicked a handle
        if (currentResult && currentResult.stripes) {
            const hit = findHitHandle(mx, my);
            if (hit) {
                draggingHandle = hit;
                activeStripeIndex = hit.stripeIdx;
                updateInspector();
                redraw();
                return;
            }
        }

        // Pan start
        camera.isDragging = true;
        camera.dragStartX = mx - camera.panX;
        camera.dragStartY = my - camera.panY;
        container.classList.add('grabbing');
    });

    window.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (draggingHandle && currentResult && currentResult.stripes) {
            const imgPt = screenToImage(mx, my);
            const stripe = currentResult.stripes[draggingHandle.stripeIdx];
            stripe[draggingHandle.handleName] = { x: imgPt.x, y: imgPt.y };
            
            // Recompute curve and metrics
            recalculateStripeFromHandles(stripe);
            updateInspector();
            redraw();
            return;
        }

        if (camera.isDragging) {
            camera.panX = mx - camera.dragStartX;
            camera.panY = my - camera.dragStartY;
            redraw();
        }
    });

    window.addEventListener('mouseup', () => {
        camera.isDragging = false;
        draggingHandle = null;
        if (container) container.classList.remove('grabbing');
    });
}

function findHitHandle(screenX, screenY) {
    if (!currentResult || !currentResult.stripes) return null;
    const thresh = 16; // 16px screen grab radius
    
    for (let sIdx = 0; sIdx < currentResult.stripes.length; sIdx++) {
        const s = currentResult.stripes[sIdx];
        for (const hName of ['p0', 'p1', 'p2', 'p3']) {
            if (!s[hName]) continue;
            const ptScreen = imageToScreen(s[hName].x, s[hName].y);
            const dist = Math.hypot(ptScreen.x - screenX, ptScreen.y - screenY);
            if (dist <= thresh) {
                return { stripeIdx: sIdx, handleName: hName };
            }
        }
    }
    return null;
}

function recalculateStripeFromHandles(stripe) {
    const p0 = stripe.p0, p1 = stripe.p1, p2 = stripe.p2, p3 = stripe.p3;
    if (!p0 || !p1 || !p2 || !p3) return;
    
    // Evaluate cubic Bezier path
    const path = [];
    const steps = 70;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        const x = u*u*u * p0.x + 3*u*u*t * p1.x + 3*u*t*t * p2.x + t*t*t * p3.x;
        const y = u*u*u * p0.y + 3*u*u*t * p1.y + 3*u*t*t * p2.y + t*t*t * p3.y;
        path.push([x, y]);
    }
    stripe.path = path;
    
    // Chord & Camber metrics
    const dx = p3.x - p0.x, dy = p3.y - p0.y;
    const chordLen = Math.hypot(dx, dy) + 1e-6;
    const nx = -dy / chordLen, ny = dx / chordLen;
    
    let maxDepth = 0.0, maxIdx = 0;
    for (let i = 0; i < path.length; i++) {
        const px = path[i][0], py = path[i][1];
        const dist = (px - p0.x) * nx + (py - p0.y) * ny;
        if (dist > maxDepth) {
            maxDepth = dist;
            maxIdx = i;
        }
    }
    
    const isBowl = maxDepth > 0.5;
    const camberPct = (Math.max(0, maxDepth) / chordLen) * 100.0;
    const draftPosPct = (maxIdx / (path.length - 1)) * 100.0;
    
    stripe.metrics = {
        ...stripe.metrics,
        camber: parseFloat(camberPct.toFixed(2)),
        draft_pos: parseFloat(draftPosPct.toFixed(1)),
        chord_len: parseFloat(chordLen.toFixed(1)),
        max_point: { x: path[maxIdx][0], y: path[maxIdx][1] },
        bowl_valid: isBowl,
        bowl_orientation: isBowl ? 'Open Towards Sky (Valid)' : 'Inverted Dome (Invalid)'
    };
}

// ---------------- USER CONTEXT CONTROLS ----------------

function setSailType(type) {
    selectedSailType = type;
    const btnM = document.getElementById('btnMainsail');
    const btnJ = document.getElementById('btnJib');
    if (btnM) btnM.classList.toggle('active', type === 'mainsail');
    if (btnJ) btnJ.classList.toggle('active', type === 'jib');
    triggerDetect();
}

// ---------------- IMAGE LOADING & SELECTION ----------------

function handleImageSelection(path) {
    if (!path) return;
    currentImagePath = path;
    currentImageB64 = null;
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        currentImage = img;
        resetCanvasView();
        triggerDetect();
    };
    img.src = `/api/image-file?path=${encodeURIComponent(path)}`;
}

function handleFileUpload(files) {
    if (!files || files.length === 0) return;
    const file = files[0];
    const formData = new FormData();
    formData.append('file', file);
    
    fetch('/api/upload', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                const sel = document.getElementById('imageSelect');
                const opt = document.createElement('option');
                opt.value = res.path;
                opt.innerText = `[Upload] ${res.name}`;
                sel.insertBefore(opt, sel.firstChild);
                sel.value = res.path;
                handleImageSelection(res.path);
            }
        });
}

// ---------------- API EXECUTION ----------------

function triggerDetect() {
    if (!currentImage) return;
    
    const latencyEl = document.getElementById('latencyBadge');
    if (latencyEl) {
        latencyEl.innerText = 'Detecting...';
        latencyEl.className = 'badge badge-slate';
    }
    
    const payload = {
        image_path: currentImagePath,
        sail_type: selectedSailType,
        is_foot_picture: true,
        stripe_color: document.getElementById('stripeColorSelect').value,
        sensitivity: parseFloat(document.getElementById('sensitivitySlider').value),
        enforce_bowl: document.getElementById('enforceBowlToggle').checked
    };

    fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(res => {
        if (!res.success) {
            alert('Autodetect error: ' + (res.error || 'Unknown error'));
            return;
        }
        currentResult = res;
        activeStripeIndex = 0;
        
        // Update latency readout
        if (latencyEl) {
            latencyEl.innerText = `${res.elapsed_ms} ms`;
            latencyEl.className = 'badge badge-emerald';
        }
        
        // Fabric badges
        if (res.detected_sail) {
            document.getElementById('sailDetectedBadge').innerText = res.detected_sail.name || '--';
            document.getElementById('brightnessBadge').innerText = `${res.detected_sail.uniformity}% Uniform`;
        }
        if (res.detected_stripe) {
            document.getElementById('stripeDetectedBadge').innerText = res.detected_stripe.name || '--';
        }
        
        // Populate Cognitive Step-by-Step Thinking Log
        if (res.cognitive_steps) {
            updateCognitiveSteps(res.cognitive_steps);
        }
        
        // Preload debug stage images if needed
        loadStageImages(res.debug_stages);
        
        updateInspector();
        redraw();
    })
    .catch(err => {
        console.error('Detection failed:', err);
    });
}

function updateCognitiveSteps(steps) {
    const list = document.getElementById('cognitiveStepsList');
    if (!list || !steps) return;
    list.innerHTML = '';
    
    steps.forEach(st => {
        const card = document.createElement('div');
        card.className = 'cognitive-step-card';
        card.innerHTML = `
            <div class="cognitive-step-header">
                <span class="cognitive-step-title">
                    <span class="step-num-badge">${st.step}</span>
                    <span>${st.title}</span>
                </span>
                <span class="cognitive-step-time">${st.time_ms}ms</span>
            </div>
            <div class="flex justify-between items-center mb-1">
                <span class="cognitive-step-badge">${st.badge}</span>
            </div>
            <p class="cognitive-step-summary">${st.detail}</p>
        `;
        list.appendChild(card);
    });
}

const debugImages = {};
function loadStageImages(stages) {
    if (!stages) return;
    for (const [key, b64] of Object.entries(stages)) {
        const img = new Image();
        img.onload = () => redraw();
        img.src = b64;
        debugImages[key] = img;
    }
}

// ---------------- CANVAS RENDERING ----------------

function redraw() {
    if (!canvas || !ctx || !currentImage) return;
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    
    const iw = currentImage.width, ih = currentImage.height;
    camera.effectiveScale = camera.zoom;
    const s = 1.0 / camera.effectiveScale; // Inverse scale factor
    
    ctx.save();
    // Center & camera transforms
    ctx.translate(cw / 2 + camera.panX, ch / 2 + camera.panY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-iw / 2, -ih / 2);
    
    // 1. Layer: Photo
    if (document.getElementById('layerOrig').checked) {
        ctx.drawImage(currentImage, 0, 0, iw, ih);
    }
    
    // 2. Layer: Saliency Heatmap
    if (document.getElementById('layerHeatmap').checked && debugImages.heatmap_overlay) {
        ctx.save();
        ctx.globalAlpha = 0.70;
        ctx.drawImage(debugImages.heatmap_overlay, 0, 0, iw, ih);
        ctx.restore();
    }
    
    // 3. Layer: Sun & Light Source (Step 1)
    if (document.getElementById('layerSun')?.checked && currentResult && currentResult.sun) {
        drawSunAndLight(ctx, s, currentResult.sun);
    }
    
    // 4. Layer: Luff (White Leading Edge) (Step 3)
    if (document.getElementById('layerLuff')?.checked && currentResult && currentResult.boundaries) {
        drawLuffBoundary(ctx, s, currentResult.boundaries);
    }
    
    // 5. Layer: Leech (Step 3)
    if (document.getElementById('layerLeech')?.checked && currentResult && currentResult.boundaries) {
        drawLeechBoundary(ctx, s, currentResult.boundaries);
    }
    
    // 6. Layer: Height Sectors 1/4, 2/4, 3/4 (Step 4)
    if (document.getElementById('layerSectors')?.checked && currentResult && currentResult.height_sectors) {
        drawHeightSectors(ctx, s, currentResult.height_sectors);
    }
    
    // 7. Layer: Camber Curves (Step 5)
    if (document.getElementById('layerCurves')?.checked && currentResult && currentResult.stripes) {
        drawCamberCurves(ctx, s);
    }
    
    // 8. Layer: 4-Point B-Spline Controls (P0, P1, P2, P3)
    if (document.getElementById('layerHandles')?.checked && currentResult && currentResult.stripes) {
        drawControlHandles(ctx, s);
    }
    
    ctx.restore();
}

// ---------------- LAYER DRAWING IMPLEMENTATIONS ----------------

function drawPillLabel(ctx, text, x, y, bgCol, borderCol, s) {
    ctx.save();
    ctx.font = `bold ${11 * s}px 'Plus Jakarta Sans', sans-serif`;
    const tw = ctx.measureText(text).width;
    const pad = 6 * s;
    const bw = tw + pad * 2;
    const bh = 18 * s;
    
    ctx.fillStyle = bgCol || 'rgba(15, 23, 42, 0.90)';
    ctx.strokeStyle = borderCol || '#38bdf8';
    ctx.lineWidth = 1.2 * s;
    
    ctx.beginPath();
    ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, 4 * s);
    ctx.fill();
    ctx.stroke();
    
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
}

// Step 1: Sun & Light Source Overlay
function drawSunAndLight(ctx, s, sun) {
    const sx = sun.sun_x, sy = sun.sun_y;
    ctx.save();
    
    // Glowing Sun Circle
    const grad = ctx.createRadialGradient(sx, sy, 4 * s, sx, sy, 32 * s);
    grad.addColorStop(0, 'rgba(253, 224, 71, 0.95)');
    grad.addColorStop(0.5, 'rgba(234, 179, 8, 0.6)');
    grad.addColorStop(1, 'rgba(234, 179, 8, 0.0)');
    
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, 32 * s, 0, Math.PI * 2);
    ctx.fill();
    
    // Core Sun Dot
    ctx.fillStyle = '#fef08a';
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 12 * s;
    ctx.beginPath();
    ctx.arc(sx, sy, 8 * s, 0, Math.PI * 2);
    ctx.fill();
    
    // Sun Rays
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)';
    ctx.lineWidth = 2.0 * s;
    for (let ang = 0; ang < Math.PI * 2; ang += Math.PI / 4) {
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(ang) * (12 * s), sy + Math.sin(ang) * (12 * s));
        ctx.lineTo(sx + Math.cos(ang) * (24 * s), sy + Math.sin(ang) * (24 * s));
        ctx.stroke();
    }
    
    // Sun Label Pill
    drawPillLabel(ctx, `☀️ Sun / Glare (${sun.light_direction})`, sx, sy + 38 * s, 'rgba(15, 23, 42, 0.92)', '#eab308', s);
    ctx.restore();
}

// Step 3: Luff Boundary Overlay (White Leading Edge)
function drawLuffBoundary(ctx, s, bounds) {
    const poly = bounds.luff_polyline;
    if (!poly || poly.length < 2) return;
    
    ctx.save();
    // Glowing cyan outline for contrast against dark sail & bright sky
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.40)';
    ctx.lineWidth = 5.5 * s;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.stroke();

    // Pure crisp white core line along the leading edge
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.0 * s;
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 8 * s;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.stroke();
    
    // Mid Luff Pill Label
    const midIdx = Math.floor(poly.length * 0.35);
    drawPillLabel(ctx, '⚪ Luff (White Leading Edge)', poly[midIdx][0], poly[midIdx][1] - 18 * s, 'rgba(15, 23, 42, 0.92)', '#ffffff', s);
    ctx.restore();
}

// Step 3: Leech Boundary Overlay (Orange)
function drawLeechBoundary(ctx, s, bounds) {
    const poly = bounds.leech_polyline;
    if (!poly || poly.length < 2) return;
    
    ctx.save();
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 2.8 * s;
    ctx.shadowColor = '#ea580c';
    ctx.shadowBlur = 6 * s;
    
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.stroke();
    
    // Mid Leech Pill Label
    const midIdx = Math.floor(poly.length / 2);
    drawPillLabel(ctx, '🟧 Leech (Trailing Edge)', poly[midIdx][0] + (bounds.leech_side === 'right' ? 65 * s : -65 * s), poly[midIdx][1], 'rgba(15, 23, 42, 0.92)', '#f97316', s);
    ctx.restore();
}

// Step 4: Height Sectors 1/4, 2/4, 3/4
function drawHeightSectors(ctx, s, heightSec) {
    if (!heightSec || !heightSec.sectors) return;
    
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.4 * s;
    ctx.setLineDash([4 * s, 4 * s]);
    
    heightSec.sectors.forEach(sec => {
        const lp = sec.luff_point;
        const rp = sec.leech_point;
        if (!lp || !rp) return;
        
        ctx.beginPath();
        ctx.moveTo(lp.x, lp.y);
        ctx.lineTo(rp.x, rp.y);
        ctx.stroke();
        
        // Sector tick marks on luff and leech
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(lp.x, lp.y, 3.5 * s, 0, Math.PI * 2);
        ctx.arc(rp.x, rp.y, 3.5 * s, 0, Math.PI * 2);
        ctx.fill();
        
        // Measurement Label Pill - vertically offset to avoid overlap
        const mx = (lp.x + rp.x) / 2.0;
        const my = (lp.y + rp.y) / 2.0;
        const yOffset = (sec.order === 'top' ? -18 : (sec.order === 'mid' ? -18 : 22)) * s;
        drawPillLabel(ctx, `📏 ${sec.name} (${Math.round(sec.chord_length)}px)`, mx, my + yOffset, 'rgba(15, 23, 42, 0.88)', '#94a3b8', s);
    });
    
    ctx.restore();
}

// Step 5: Camber Curves Overlay
function drawCamberCurves(ctx, s) {
    currentResult.stripes.forEach((stripe, idx) => {
        const isActive = (idx === activeStripeIndex);
        const color = stripe.color || '#38bdf8';
        
        // 1. Dashed Chord Line P0 -> P3
        if (stripe.p0 && stripe.p3) {
            ctx.save();
            ctx.strokeStyle = isActive ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.45)';
            ctx.lineWidth = (isActive ? 2.0 : 1.2) * s;
            ctx.setLineDash([5 * s, 5 * s]);
            ctx.beginPath();
            ctx.moveTo(stripe.p0.x, stripe.p0.y);
            ctx.lineTo(stripe.p3.x, stripe.p3.y);
            ctx.stroke();
            ctx.restore();
        }
        
        // 2. Active Stripe Control Arms (P0->P1 entry tangent, P3->P2 exit tangent, Pchord->P2 draft depth)
        if (isActive && stripe.p0 && stripe.p1 && stripe.p2 && stripe.p3) {
            ctx.save();
            // Entry tangent arm (Cyan dashed)
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.6 * s;
            ctx.setLineDash([4 * s, 4 * s]);
            ctx.beginPath();
            ctx.moveTo(stripe.p0.x, stripe.p0.y);
            ctx.lineTo(stripe.p1.x, stripe.p1.y);
            ctx.stroke();
            
            // Exit tangent arm (Orange dashed)
            ctx.strokeStyle = '#f59e0b';
            ctx.beginPath();
            ctx.moveTo(stripe.p3.x, stripe.p3.y);
            ctx.lineTo(stripe.p2.x, stripe.p2.y);
            ctx.stroke();
            
            // Draft depth arm (Yellow dashed from chord projection to P2)
            const dx = stripe.p3.x - stripe.p0.x, dy = stripe.p3.y - stripe.p0.y;
            const chordLen = Math.hypot(dx, dy) + 1e-6;
            const tProj = Math.max(0, Math.min(1, ((stripe.p2.x - stripe.p0.x) * dx + (stripe.p2.y - stripe.p0.y) * dy) / (chordLen * chordLen)));
            const projX = stripe.p0.x + dx * tProj;
            const projY = stripe.p0.y + dy * tProj;
            
            ctx.strokeStyle = '#facc15';
            ctx.beginPath();
            ctx.moveTo(projX, projY);
            ctx.lineTo(stripe.p2.x, stripe.p2.y);
            ctx.stroke();
            ctx.restore();
        }
        
        // 3. Camber Curve Path (Cubic B-Spline)
        if (stripe.path && stripe.path.length > 1) {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = (isActive ? 3.4 : 2.2) * s;
            if (isActive) {
                ctx.shadowColor = color;
                ctx.shadowBlur = 8 * s;
            }
            ctx.beginPath();
            ctx.moveTo(stripe.path[0][0], stripe.path[0][1]);
            for (let i = 1; i < stripe.path.length; i++) {
                ctx.lineTo(stripe.path[i][0], stripe.path[i][1]);
            }
            ctx.stroke();
            ctx.restore();
        }
        
        // 4. Red dot at maximum camber
        if (stripe.metrics && stripe.metrics.max_point) {
            const mp = stripe.metrics.max_point;
            ctx.save();
            ctx.fillStyle = '#ef4444';
            ctx.shadowColor = '#ef4444';
            ctx.shadowBlur = 6 * s;
            ctx.beginPath();
            ctx.arc(mp.x, mp.y, 4.5 * s, 0, Math.PI * 2);
            ctx.fill();
            
            // Camber % Pill Badge - vertically staggered to prevent collision
            const m = stripe.metrics;
            const badgeYOffset = (stripe.order === 'top') ? (-24 * s) : (stripe.order === 'mid' ? (-22 * s) : (26 * s));
            drawPillLabel(ctx, `${stripe.name}: ${m.camber}% / ${m.draft_pos}%`, mp.x, mp.y + badgeYOffset, 'rgba(15, 23, 42, 0.92)', color, s);
            ctx.restore();
        }
    });
}

function drawControlHandles(ctx, s) {
    currentResult.stripes.forEach((stripe, sIdx) => {
        const isActive = (sIdx === activeStripeIndex);
        
        const handles = [
            { name: 'p0', label: 'P0: Luff Root', pt: stripe.p0, col: '#38bdf8' },
            { name: 'p1', label: 'P1: Entry Angle', pt: stripe.p1, col: '#38bdf8' },
            { name: 'p2', label: 'P2: Draft & Exit', pt: stripe.p2, col: '#facc15' },
            { name: 'p3', label: 'P3: Leech Root', pt: stripe.p3, col: '#f59e0b' }
        ];
        
        handles.forEach(h => {
            if (!h.pt) return;
            const x = h.pt.x, y = h.pt.y;
            const isDraggingThis = (draggingHandle && draggingHandle.stripeIdx === sIdx && draggingHandle.handleName === h.name);
            
            ctx.save();
            ctx.shadowColor = h.col;
            ctx.shadowBlur = (isDraggingThis ? 12 : 6) * s;
            
            // Scale-invariant circle: stays ~6px on screen regardless of zoom
            ctx.fillStyle = isDraggingThis ? '#ffffff' : h.col;
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 2.0 * s;
            ctx.beginPath();
            ctx.arc(x, y, (isDraggingThis ? 8.0 : 5.5) * s, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            // Pill label badge if active stripe
            if (isActive) {
                ctx.font = `bold ${10 * s}px 'Plus Jakarta Sans', sans-serif`;
                const textW = ctx.measureText(h.label).width;
                const pad = 4 * s;
                const boxW = textW + pad * 2;
                const boxH = 15 * s;
                const boxY = y - (22 * s);
                
                ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
                ctx.strokeStyle = h.col;
                ctx.lineWidth = 1 * s;
                ctx.beginPath();
                ctx.roundRect(x - boxW / 2, boxY, boxW, boxH, 3 * s);
                ctx.fill();
                ctx.stroke();
                
                ctx.fillStyle = '#f8fafc';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(h.label, x, boxY + boxH / 2);
            }
            ctx.restore();
        });
    });
}

// ---------------- INSPECTOR & CHARTS ----------------

function updateInspector() {
    if (!currentResult || !currentResult.stripes) return;
    
    // 1. Populate Stripe Cards
    const container = document.getElementById('stripesCardsList');
    container.innerHTML = '';
    
    currentResult.stripes.forEach((stripe, idx) => {
        const isActive = (idx === activeStripeIndex);
        const m = stripe.metrics || {};
        const isBowl = m.bowl_valid !== false;
        
        const card = document.createElement('div');
        card.className = `stripe-card ${isActive ? 'active' : ''}`;
        card.onclick = () => { activeStripeIndex = idx; updateInspector(); redraw(); };
        
        card.innerHTML = `
            <div class="stripe-card-header">
                <div class="flex items-center gap-2">
                    <span style="width:10px;height:10px;border-radius:50%;background:${stripe.color};display:inline-block;"></span>
                    <span class="font-bold text-xs text-white">${stripe.name} (${stripe.sector_name || 'Sector'})</span>
                </div>
                <span class="badge ${isBowl ? 'badge-emerald' : 'badge-rose'}">
                    ${isBowl ? '✓ Bowl Open' : '⚠ Inverted'}
                </span>
            </div>
            
            <div class="metric-pill-grid">
                <div class="metric-item">
                    <span>Camber:</span>
                    <span class="font-bold text-sky-400">${m.camber || 0}%</span>
                </div>
                <div class="metric-item">
                    <span>Draft Pos:</span>
                    <span class="font-bold text-amber-400">${m.draft_pos || 0}%</span>
                </div>
                <div class="metric-item">
                    <span>Entry ∠:</span>
                    <span class="text-slate-200">${m.entry || 0}°</span>
                </div>
                <div class="metric-item">
                    <span>Exit ∠:</span>
                    <span class="text-slate-200">${m.exit || 0}°</span>
                </div>
                <div class="metric-item" style="grid-column: span 2;">
                    <span>Chord Length:</span>
                    <span class="text-slate-300 font-mono">${m.chord_len || 0} px</span>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
    
    // 2. Render Curvature Chart
    drawCurvatureChart();
    
    // 3. Update JSON Preview
    const preview = document.getElementById('jsonPreview');
    if (preview) {
        const cleanCopy = {
            cognitive_steps: currentResult.cognitive_steps,
            stripes: currentResult.stripes.map(s => ({
                id: s.id,
                name: s.name,
                p0: s.p0,
                p1: s.p1,
                p2: s.p2,
                p3: s.p3,
                metrics: s.metrics
            }))
        };
        preview.value = JSON.stringify(cleanCopy, null, 2);
    }
}

function drawCurvatureChart() {
    const chartCanvas = document.getElementById('profileChartCanvas');
    if (!chartCanvas || !currentResult || !currentResult.stripes) return;
    const cctx = chartCanvas.getContext('2d');
    const cw = chartCanvas.width, ch = chartCanvas.height;
    
    cctx.clearRect(0, 0, cw, ch);
    
    // Grid lines
    cctx.strokeStyle = '#1e293b';
    cctx.lineWidth = 1;
    for (let y = 20; y < ch - 20; y += 30) {
        cctx.beginPath();
        cctx.moveTo(30, y);
        cctx.lineTo(cw - 15, y);
        cctx.stroke();
    }
    
    // Axes
    cctx.strokeStyle = '#475569';
    cctx.beginPath();
    cctx.moveTo(30, ch - 25);
    cctx.lineTo(cw - 15, ch - 25);
    cctx.stroke();
    
    // Labels
    cctx.fillStyle = '#64748b';
    cctx.font = '10px JetBrains Mono';
    cctx.fillText('0% Luff', 28, ch - 10);
    cctx.fillText('50%', cw / 2 - 10, ch - 10);
    cctx.fillText('100% Leech', cw - 65, ch - 10);
    
    // Draw curves for each stripe
    currentResult.stripes.forEach(stripe => {
        const m = stripe.metrics || {};
        const camberPct = m.camber || 10.0;
        const draftPos = (m.draft_pos || 45.0) / 100.0;
        
        cctx.save();
        cctx.strokeStyle = stripe.color || '#38bdf8';
        cctx.lineWidth = 2;
        cctx.beginPath();
        
        const xStart = 35, xEnd = cw - 20;
        const spanW = xEnd - xStart;
        const baselineY = ch - 26;
        
        for (let i = 0; i <= 50; i++) {
            const t = i / 50.0;
            const x = xStart + t * spanW;
            const sag = Math.sin(Math.PI * Math.pow(t, Math.log(0.5) / Math.log(draftPos))) * (camberPct * 4.5);
            const y = baselineY - Math.max(0, sag);
            if (i === 0) cctx.moveTo(x, y);
            else cctx.lineTo(x, y);
        }
        cctx.stroke();
        cctx.restore();
    });
}

function copyJson() {
    const preview = document.getElementById('jsonPreview');
    if (preview) {
        preview.select();
        navigator.clipboard.writeText(preview.value);
        alert('JSON copied to clipboard!');
    }
}

function toggleSnapTool() {
    isSnapMode = !isSnapMode;
    const btn = document.getElementById('snapToolBtn');
    if (btn) {
        btn.classList.toggle('btn-primary', isSnapMode);
        btn.classList.toggle('btn-secondary', !isSnapMode);
    }
}
