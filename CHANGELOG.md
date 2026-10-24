# Changelog

All notable changes to cSlope. Versions follow [semantic versioning](https://semver.org).

## [0.1.0-beta.1] - 2026-10-16

Beta of 0.1.0, to test the program and the signed Windows installer before the first public release. It has the contents listed under 0.1.0 in CHANGELOG.md.

## [0.1.0] - Unreleased

The first public release.

### Analysis

- Bishop simplified, Janbu simplified with the f₀ correction, and Morgenstern–Price with constant (Spencer), half-sine, clipped-sine, trapezoidal and user-defined interslice functions.
- Circular and non-circular slip surfaces: search between entry and exit ranges, custom circles and polylines, non-circular optimisation, minimum slip depth and minimum sliding area, analysis in both slip directions.
- Tension cracks with a fixed or automatic (Rankine) depth, dry or water-filled.
- Partial factors on strength and loads, with presets for Swedish practice (EKS/IEG) and EN 1997-1 DA3.
- Sensitivity analysis, and probabilistic analysis with the Taylor series and Monte Carlo methods.
- Ito & Matsui pile rows take the effective overburden (γ′ below the water table) instead of the total; a Morgenstern–Price surface where moment and force equilibrium never meet keeps its closest-pair factor but is reported as not converged, with the gap in the sidebar, result panel and PDF summary.

### Model

- Exterior and interior boundaries with snapping, DXF import, and parameters with expressions.
- Material models: Mohr–Coulomb, undrained, strength increasing with depth (from the ground or from the top of the layer) or from a datum, with a strength cutoff, anisotropic, spatially varying, lime-cement columns, and high-strength and impenetrable (bedrock) layers. Saturated unit weight below the water table.
- Water: several piezometric lines with one per material if needed, ponded water above the ground.
- Distributed and line loads; anchors, grouted tiebacks, soil nails, geosynthetics, pile rows and sheet pile walls.
- Edit view: coordinate labels find a free place around their point, clear of other labels, markers, loads and water symbols; interior boundaries are drawn only inside the model; custom slip surfaces show dashed; rulers leave out labels the edge would cut.
- Edit view: coordinate labels sit outside the fill, clear of the boundary lines, entry/exit dots, elements, water lines and custom surfaces, and points off the screen get none; vertex dots are drawn over the search-limit markers; a custom circle shows only from where it enters the ground to where it leaves it, on a halo that keeps it visible on dark layers; a fixed tension-crack depth shows as a labelled dimension on the crest instead of a dashed line along the whole ground; with only custom surfaces analysed the search limits are hidden; long ruler labels are set smaller instead of left out, and load handles are picked over the arrow height as drawn.

### Results and reporting

- The paper takes in the critical circle's centre and FOS label when they are shown, widening a fitted frame after a run if needed.
- Critical surface, all surfaces or a factor-of-safety filter, slices, annotations and templates.
- Plots of slice data and of Fm and Ff against λ; export to PDF and PNG, slice data to Excel and CSV.
- The PDF report ends with an analysis summary: method, search, water and tension crack, partial factors, materials and loads. With partial factors, the PDF and the slice data mark design values.
- The paper frames the model at true scale with a margin, including water lines, loads and reinforcement, and spaces its axis ticks for their labels; PNG export is 2400 px wide on white. "Use model bounds" and the refit after the geometry grows give the same frame the model starts with, below the title block. Fit in the edit view ignores water lines far below the model, and the parts of a water line below its base, and keeps clear of the toolbar.
- Result plot: the sliding mass follows stepped and vertical faces, a tension crack is drawn as part of the critical surface with the water in it, slice lines show on dark layers, and the search limits point into their ranges under the result.
- Loads, reinforcement forces and water symbols on the canvas and in the PDF: touching load strips draw as one load with one label ("q = 20–40 kPa"), box heights follow the magnitude and magnitudes are rounded; force arrows sit beside the element they act along, on one side and within 30 % of the spacing in a dense wall so each reads as its own element's, clear of the slip line, the element itself, material boundaries, other elements and each other and never longer than the element; each force value is written at its element's head, outside the slope on the element's line, or beside its arrow when the slip surface crosses the element far from the head, and where elements are closer than the text height the values form a column with a leader to each element number, so no value is left out ("÷ FOS", drawn so it cannot read as "+", marks a force divided by the factor of safety; forces of 0.0 kN/m are left out); force labels keep clear of the search-limit markers and a margin inside the frame; element numbers, on a light halo, keep clear of a vertex dot at the head and move off lines and markers; water-table symbols are spaced along each line on its flat parts, clear of the critical surface and the anchors.
- Water-table symbols prefer open water, then the soil outside the sliding mass, keep clear of vertices, prescribed surfaces, search markers, loads and reinforcement, and leave out the ≡ where the water is too shallow for it. Over a result the search-limit triangles stand above the ground, a limit shared by both ranges is drawn once and no dots lie on the sliding mass. A tension crack is drawn only where the analysis cut the surface at one, with its water in the crack; a thin sliding mass is widened only under the ground, coincident or dense slice lines are thinned, and outlines have no mitre spikes. The PDF draws loads, search markers and water symbols as the canvas does.
- Ponded water shows small load arrows pointing at the ground, normal to it and scaled with the depth, clear of the water-table symbols, on the canvas and in the PDF.
- Drawing details: in the edit view a search-limit triangle at a vertex moves off the vertex dot; with a fixed tension crack a custom surface starts at the crack's base, as the analysis takes it, and the crack dimension stands at that crack (otherwise on the crest with its bottom clear of layer boundaries), labelled next to it; slice boundaries closer than 2.5 px (0.7 mm in the PDF) are drawn as one line; water-table symbols keep clear of vertex dots, thin layers and the model's sides, and coordinate labels do not touch them; the band of a thin sliding mass ends at the slip line's ends.

### Interface

- A failed run shows its error over the edit canvas and in the status bar, with a shortcut to the search limits when no slip surface was found. F5 or Ctrl+Enter runs the analysis; Escape closes the dialog windows and Model Properties. A new project starts with a neutral "Model 1" instead of an example's name and title.

### Verification

- 177 verification problems with 356 reference values from the literature and from other programs, run by the automated tests on every change.
