"""Schema, validation, result summary and public defaults (issue #55,
D-23, D-24). Needs only the installed package."""

from __future__ import annotations

import copy

import pytest

import cslope
from cslope import examples


def doc(definition, options=None):
    d = {"format": "cslope-analysis", "formatVersion": 1, "definition": definition}
    if options is not None:
        d["options"] = options
    return d


def codes(issues):
    return {(i["path"], i["code"]) for i in issues}


@pytest.mark.parametrize("name", examples.ALL)
def test_examples_validate_without_issues(name):
    assert cslope.validate(getattr(examples, name)()) == []
    assert cslope.validate(doc(getattr(examples, name)(), {"method": "Bishop"})) == []


def test_issue_shape_and_paths():
    d = examples.clay_crust_with_load()
    model = d["materials"][1]["model"]
    model["su"] = model.pop("undrainedShearStrength")
    issues = cslope.validate(doc(d, {"slices": 30.5}))
    for i in issues:
        assert set(i) == {"path", "code", "message", "severity"}
        assert i["severity"] in ("error", "warning")
    assert ("/definition/materials/1/model/su", "unknown-key") in codes(issues)
    assert ("/definition/materials/1/model/undrainedShearStrength", "missing-key") in codes(issues)
    assert ("/definition/options/slices", "type") not in codes(issues)
    assert ("/options/slices", "type") in codes(issues)
    # a bare definition: paths from its root, the options under /options
    issues = cslope.validate(d, {"method": "bishop"})
    assert ("/materials/1/model/su", "unknown-key") in codes(issues)
    assert ("/options/method", "enum") in codes(issues)


def test_silent_cases_are_reported():
    d = examples.clay_crust_with_load()
    del d["regionAssignments"]
    assert ("/regionAssignments", "missing-region-assignments") in codes(cslope.validate(d))

    d = examples.slope_with_water_table()
    del d["materials"][0]["model"]["unitWeightSat"]
    assert ("/materials/0/model/unitWeightSat", "missing-unit-weight-sat") in codes(cslope.validate(d))

    d = examples.slope_with_water_table()
    d["waterTable"]["followBoundary"] = True
    assert ("/waterTable/followBoundary", "follow-boundary-inverted") in codes(cslope.validate(d))


def test_free_water_is_read():
    # freeWater: true is followBoundary: false (D-24)
    base = examples.slope_with_water_table()
    base["waterTable"]["value"] = [[0.0, 9.0], [12.0, 9.0], [35.0, 6.0], [50.0, 6.0]]
    a = copy.deepcopy(base)
    a["waterTable"]["freeWater"] = True
    b = copy.deepcopy(base)
    b["waterTable"]["followBoundary"] = False
    o = {"method": "Bishop", "iterations": 500, "refinedIterations": 0}
    assert cslope.analyse(a, o)["minFOS"] == cslope.analyse(b, o)["minFOS"]
    assert cslope.validate(a) == []


def test_public_defaults():
    assert cslope.default_options() == {
        "method": "Morgenstern-Price",
        "slices": 30,
        "iterations": 1000,
        "refinedIterations": 500,
        "compositeSurfaces": True,
    }
    r = cslope.analyse(examples.simple_slope())
    assert r["method"] == "Morgenstern-Price"
    assert len(r["criticalSlices"]) == 30
    # an analysis document gives the same result as its parts
    d = doc(examples.simple_slope(), {"method": "Bishop"})
    a = cslope.analyse(d)
    b = cslope.analyse(examples.simple_slope(), {"method": "Bishop"})
    assert a["method"] == "Bishop" and a["minFOS"] == b["minFOS"]
    # options given apart override the document's
    assert cslope.analyse(d, {"method": "Janbu"})["method"] == "Janbu"


def test_summary_characteristic():
    r = cslope.analyse(examples.simple_slope(), {"iterations": 500, "refinedIterations": 0})
    s = cslope.summarize(r)
    assert s["fos"] == r["minFOS"]
    assert s["fosLabel"] == "factor of safety"
    assert s["valueBasis"] == "characteristic"
    assert s["partialFactors"] is None
    assert s["method"].startswith("Morgenstern-Price (complete equilibrium)")
    assert s["criticalSurface"]["entry"] == list(r["criticalSurface"]["entryPoint"]) or tuple(
        s["criticalSurface"]["entry"]
    ) == tuple(r["criticalSurface"]["entryPoint"])
    assert isinstance(s["warnings"], list) and isinstance(s["nonConverged"], int)
    assert s["bothDirections"] is None
    assert s["engineBuild"] == cslope.ENGINE_BUILD


def test_summary_design_values():
    pf = cslope.swedish_partial_factors(2, 1.0, 1.0, 1.4)
    assert pf["cu"] == 1.5 and pf["basis"]["safetyClass"] == 2
    o = {"partialFactors": pf, "iterations": 500, "refinedIterations": 0, "bothDirections": True}
    r = cslope.analyse(examples.clay_crust_with_load(), o)
    s = cslope.summarize(r, o)
    assert s["fosLabel"] == "over-design factor"
    assert s["valueBasis"] == "design"
    assert s["partialFactors"]["basis"]["etaCu"] == 1.0
    assert s["partialFactors"]["gammaD"] == 0.91
    assert s["bothDirections"] is not None
    # the document form of the options
    assert cslope.summarize(r, doc(examples.clay_crust_with_load(), o))["fosLabel"] == "over-design factor"
    with pytest.raises(cslope.EngineError):
        cslope.swedish_partial_factors(4, 1.0, 1.0, 1.4)


def test_schemas():
    assert cslope.SCHEMA_VERSION == cslope.__version__
    for name in cslope.SCHEMA_NAMES:
        s = cslope.schema(name)
        assert s["$id"] == f"urn:cslope:schema:{name}:{cslope.SCHEMA_VERSION}"
    d = cslope.schema()
    assert d["properties"]["format"]["$ref"] == "#/$defs/DocumentFormat"
    with pytest.raises(ValueError):
        cslope.schema("nope")
