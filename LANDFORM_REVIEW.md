# LANDFORM reference review — 3 November 2026

Public reference: https://landform.ildar.space/. I inspected the landing page and the initial site-framing app screen. The app then displayed a terms and age gate; I did not accept those terms, create a model, pay, inspect private services, or verify the accuracy of its outputs. The following distinguishes visible product claims from our own engineering conclusions.

## What is visible

| Area | Publicly visible behavior | Implication for our tool |
|---|---|---|
| Entry | A terrain-led promise aimed at architects, landscape architects and model makers; a before/after comparison labels an open DEM at 10–30 m and Terrain Pro at 0.5–1.5 m. | Show the elevation source and its actual spatial support next to the model. A fine output grid is not automatically fine source data. |
| Site frame | Map or satellite base; a draggable rectangle or circle; width and height controls; area, open DEM and Terrain Pro resolution indicators; a single Build 3D model action. | Preflight should make area, expected processing cost and terrain source clear before work starts. Our polygon workflow supports irregular boundaries, so it need not copy their fixed frame. |
| Terrain | Landing page lists slope, aspect, roughness, curvature, wetness index, contours and terrain display looks. | A DEM can support a transparent first contour view. Slope and hydrology need separate algorithms, checks and scale caveats. |
| Other layers | Buildings, roads, individual trees/shrubs, land cover, habitats, river zones, water history and climate appear in the product menu. | Keep saved source layers distinct from derived maps. Add each analysis only when its inputs and provenance can be inspected. |
| Live scenarios | Rainfall runoff, wind and solar/shadow demonstrations are advertised, with dates or seasons. | These are richer modelling modules with distinct assumptions. A terrain mesh alone does not provide reliable flow, comfort or flood results. |
| Physical model | Laser cut beta describes closed plates, material thickness, a contour step, scale-dependent vertical exaggeration and a parts sheet. | Useful future architectural output, but it requires a watertight mesh, minimum-feature constraints and test cuts. |
| Export | The site lists Rhino, DXF, SVG, PDF, GeoTIFF, Shapefile, KMZ and laser formats, with named layers and GIS/visual packages. | Our current GeoTIFF, GeoJSON, DXF and DAE are a narrower contract. Do not label DAE a native SketchUp file. |
| Pricing | Public page shows site credit tiers and free exploration. It says sizes up to 5 km in the app/pricing section, while the landing hero says “frame up to 10 km.” | The visible size statements are inconsistent; no size or price claim should be borrowed without checking the actual product rules. |

The app’s own notice says results are computed, not surveyed, **Terrain Pro detail is synthesised where no measured data exists**, analyses are simplified, and laser cutting is beta. This is the central accuracy distinction for our project. A 0.5 m visual grid does not mean 0.5 m measured elevation. The public footer names national orthophotos, Sentinel-2 cloudless 2016, Earth Search, JRC water, Mapterhorn, Copernicus DEM GLO-30, Terrarium mixed sources and regional lidar programs. Coverage and reuse rights differ by source and place. I did not verify that those sources were returned for any specific site.

## Current adaptation in Site Context Studio 0.1.13

1. **Full captured model:** The renderer no longer stops at the first 600 buildings or 1,800 road features. It processes all valid saved building geometry progressively into material batches, draws all saved linework and reports processed, drawn and invalid geometry counts. A 40,000-footprint *test-only synthetic geometry* fixture reached 40,000 drawn and zero skipped in the browser without console errors. That verifies the batching path, not the accuracy or timing of a 40,000-building real capture. The fixture was removed after testing.
2. **Terrain surface:** The 3D view uses saved DEM values, a height-tinted mesh and bilinear positioning for building/linework placement. Land use and water are draped outlines in 3D so planar fills do not hide the relief; their full fill and attributes remain in the 2D map and export.
3. **Contours:** Marching-squares lines are computed from the scene DEM grid. The interval is selected from the visible elevation range and shown in metres. The lines are a *visual derivative of a preview grid*, not a surveyed contour drawing or a new high-resolution data source. They can be hidden without rebuilding the building model.
4. **Relief control:** The display scale is 1–8× and explicitly says the downloaded GeoTIFF is unchanged. Building heights are not exaggerated. Source elevation minimum/maximum, output grid spacing and accuracy caveat remain visible.
5. **Existing captures:** A saved GeoTIFF can regenerate an older 96-cell preview at up to 256 cells per side without another network call. New terrain captures save that denser preview initially. This raises visual sampling density only; it does not improve the underlying DEM source accuracy.

The UI takes the broad ideas of a terrain-first canvas and nearby controls, while keeping our own map-first Urbanist visual language, polygon capture flow, labels, code and styling. No LANDFORM source, assets or proprietary analysis logic was incorporated.

## Next honest technical steps

- Validate a large **real** capture with height distribution and DEM range, measure browser memory and draw time on an ordinary laptop, and set a documented performance budget. The 40,000 test had simple rectangular footprints; dense multipolygons are more expensive.
- Export contours as georeferenced vectors only after checking contour topology, no-data edges, projection and interval against GIS tools. The current 3D contour layer is a view, not a contour file.
- Improve ground sampling and contour quality only with a licensed higher-resolution measured DEM where coverage exists. Interpolation and visual exaggeration must remain labelled as such.
- Add source and method fields for any future slope, aspect or flow analysis; verify against independent GIS examples before presenting them as design evidence.
