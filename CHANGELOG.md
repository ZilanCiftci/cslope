# Changelog

All notable changes to cSlope. Versions follow [semantic versioning](https://semver.org).

## [0.1.0-rc.1] - 2026-10-16

Release candidate for 0.1.0, to test the signed Windows installer before the first public release. It has the contents listed under 0.1.0 in CHANGELOG.md.

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

### Results and reporting

- Critical surface, all surfaces or a factor-of-safety filter, slices, annotations and templates.
- Plots of slice data and of Fm and Ff against λ; export to PDF and PNG, slice data to Excel and CSV.

### Verification

- 177 verification problems with 356 reference values from the literature and from other programs, run by the automated tests on every change.
