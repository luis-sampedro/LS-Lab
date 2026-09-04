# SailCam Vision Lab — Autodetect Workbench

A standalone computer vision testing platform and algorithm workbench for the Sail Camber Autodetection Engine.

---

## 1. Quick Start

To launch the workbench on its own dedicated server:

```powershell
python autodetect-workbench/workbench_server.py
```

Then open your browser to:
**[http://127.0.0.1:5055](http://127.0.0.1:5055)**

---

## 2. Key Features

1. **Physical Aerodynamic "Bowl" Constraint**:
   - Camber draft curves are constrained to always be **"open towards the sky, like a bowl"** (sagging downwards away from the masthead/sky towards the boom/deck).
   - Inverted domes, arches, and synthetic flatlines are strictly rejected or re-oriented into true aerodynamic bowls.
   - Status badge shows `[✓ Bowl Open Towards Sky]` or `[⚠ Inverted Dome]` per stripe.

2. **Multi-Spectral Ridge & Contour Extraction**:
   - **Top-Hat Filter**: Extracts bright/white/reflective draft stripes on dark carbon/laminate cloth.
   - **Steerable Hessian / Frangi Filter**: Extracts 1D continuous curve ridges based on second-derivative curvature eigenvalues.
   - **Black-Hat Filter**: Extracts dark stripes on light dacron cloth.
   - **Chroma Filter**: Extracts red or blue stripes based on chromatic difference.

3. **Width-Normalized Peak Detection**:
   - Evaluates row-wise ridge intensity normalized by sail cloth width, ensuring narrow top stripes near the masthead are prioritized equally with wide foot stripes.

4. **Multi-Layer Diagnostic Visualizer**:
   Toggle between:
   - **Photo**: Original high-resolution image.
   - **Sail Mask**: Segmented sail cloth vs blue sky and sun glare.
   - **Luff/Leech**: Green leading edge (luff) and red trailing edge (leech) envelope boundaries.
   - **Saliency Heatmap**: JET color-mapped ridge energy overlay.
   - **Ridge Points**: Column-wise non-maximum suppression (NMS) inlier points.
   - **Camber Curves**: Aerodynamic camber curves, chord lines, tangent arms, and max-camber dots.
   - **Controls (P0-P3)**: Interactive cubic B-spline handles ($P_0, P_1, P_2, P_3$).

5. **Test Gallery & Drag/Drop**:
   - Pre-loaded with gallery test images (`media_1788452085730.png`, `test1.jpg`, `test2.jpg`, `sample-black-red.jpg`, etc.).
   - Drag & drop or click to upload any custom sail image.

6. **Automated Test Suite**:
   ```powershell
   python autodetect-workbench/test_suite.py
   ```
