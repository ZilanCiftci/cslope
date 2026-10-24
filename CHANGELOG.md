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

### Model

- Exterior and interior boundaries with snapping, DXF import, and parameters with expressions.
- Material models: Mohr–Coulomb, undrained, strength increasing with depth (from the ground or from the top of the layer) or from a datum, with a strength cutoff, anisotropic, spatially varying, lime-cement columns, and high-strength and impenetrable (bedrock) layers. Saturated unit weight below the water table.
- Water: several piezometric lines with one per material if needed, ponded water above the ground.
- Distributed and line loads; anchors, grouted tiebacks, soil nails, geosynthetics, pile rows and sheet pile walls.
- Edit view: coordinate labels find a free place around their point, clear of other labels, markers, loads and water symbols; interior boundaries are drawn only inside the model; custom slip surfaces show dashed; rulers leave out labels the edge would cut.

### Results and reporting

- Critical surface, all surfaces or a factor-of-safety filter, slices, annotations and templates.
- Plots of slice data and of Fm and Ff against λ; export to PDF and PNG, slice data to Excel and CSV.
- The PDF report ends with an analysis summary: method, search, water and tension crack, partial factors, materials and loads. With partial factors, the PDF and the slice data mark design values.
- The paper frames the model at true scale with a margin, including water lines, loads and reinforcement, and spaces its axis ticks for their labels; PNG export is 2400 px wide on white. Fit in the edit view ignores water lines far below the model and keeps clear of the toolbar.
- Result plot: the sliding mass follows stepped and vertical faces, a tension crack is drawn as part of the critical surface with the water in it, slice lines show on dark layers, and the search limits point into their ranges under the result.
- Loads, reinforcement forces and water symbols on the canvas and in the PDF: touching load strips draw as one load with one label ("q = 20–40 kPa"), box heights follow the magnitude and magnitudes are rounded; force arrows sit beside the line they act along with their size on a plate next to them, clear of each other ("÷ FOS" marks a force divided by the factor of safety; forces of 0.0 kN/m are left out); water-table symbols are spaced along each line on its flat parts, clear of the critical surface and the anchors.

### Interface

- A failed run shows its error over the edit canvas and in the status bar, with a shortcut to the search limits when no slip surface was found. F5 or Ctrl+Enter runs the analysis; Escape closes the dialog windows and Model Properties. A new project starts with a neutral "Model 1" instead of an example's name and title.

### Verification

- 177 verification problems with 356 reference values from the literature and from other programs, run by the automated tests on every change.
