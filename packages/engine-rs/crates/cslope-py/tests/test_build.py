"""The definition builder (cslope.build) and the skill's examples.

The examples live in skills/cslope/examples of the repository; the tests
that run them skip when that folder is not checked out (the wheels workflow
checks out only the tests).
"""

from __future__ import annotations

import json
import math
import runpy
from pathlib import Path

import pytest

import cslope
from cslope import build
from cslope.build import Definition, InvalidDefinition, Options, swedish_partial_factors

EXAMPLES = Path(__file__).resolve().parents[5] / "skills" / "cslope" / "examples"
needs_examples = pytest.mark.skipif(not EXAMPLES.is_dir(), reason="the skill's examples are not in this checkout")

# The examples' F (Linux x86_64), within the tolerance policy's 1e-6
# (PORTING.md). Every option is written into the documents, so the engine's
# defaults do not move them.
PINNED = {
    "single_slope": 1.6205913376603949,
    "layered_soil": 1.8027804337477604,
    "water_table": 1.0158537043392202,
    "distributed_load": 1.2993105869298305,
    "swedish_partial_factors": 1.3872286356243877,
}


def example(name: str) -> Definition:
    return runpy.run_path(str(EXAMPLES / (name + ".py")), run_name="example")["build"]()


def slope() -> Definition:
    d = Definition()
    d.exterior = [(0, 0), (0, 15), (15, 15), (35, 5), (50, 5), (50, 0)]
    d.add_material("Sand", c=5, phi=30, gamma=19, gamma_sat=20)
    return d


# ── the examples ─────────────────────────────────────────────────────────


@needs_examples
def test_every_example_is_pinned():
    assert sorted(p.stem for p in EXAMPLES.glob("*.py")) == sorted(PINNED)


@needs_examples
@pytest.mark.parametrize("name", sorted(PINNED))
def test_example_runs_with_its_pinned_factor(name):
    doc = example(name).to_dict()
    result = cslope.analyse(doc)
    assert result["minFOS"] == pytest.approx(PINNED[name], abs=1e-6)
    summary = cslope.summarize(result, doc)
    assert summary["fos"] == pytest.approx(PINNED[name], abs=1e-6)
    if name == "swedish_partial_factors":
        assert summary["fosLabel"] == "over-design factor"
        assert summary["valueBasis"] == "design"
    else:
        assert summary["fosLabel"] == "factor of safety"
        assert summary["valueBasis"] == "characteristic"


@needs_examples
@pytest.mark.parametrize("name", sorted(PINNED))
def test_example_json_is_what_the_example_writes(name):
    written = json.loads((EXAMPLES / (name + ".json")).read_text(encoding="utf-8"))
    assert written == example(name).to_dict()
    assert (EXAMPLES / (name + ".json")).read_text(encoding="utf-8") == build.dumps(written)


@needs_examples
@pytest.mark.parametrize("name", sorted(PINNED))
def test_example_loads_back_unchanged(name):
    path = EXAMPLES / (name + ".json")
    assert Definition.load(path).to_dict() == json.loads(path.read_text(encoding="utf-8"))


@needs_examples
@pytest.mark.parametrize("name", sorted(PINNED))
def test_example_validates(name):
    doc = json.loads((EXAMPLES / (name + ".json")).read_text(encoding="utf-8"))
    assert cslope.validate(doc) == []


@needs_examples
def test_analyse_reads_the_document():
    doc = example("layered_soil").to_dict()
    assert cslope.analyse(doc)["minFOS"] == pytest.approx(PINNED["layered_soil"], abs=1e-6)


# ── the document ────────────────────────────────────────────────────────


def test_document_envelope_and_new_names():
    d = slope()
    d.add_material("Clay", su=20, gamma=17)
    d.add_interior_boundary([(0, 8), (29, 8)])
    d.assign("Sand", at=(5, 12))
    d.assign("Clay", at=(5, 2))
    d.add_piezometric_line([(0, 12), (50, 4)], free_water=False)
    doc = d.to_dict()
    assert doc["format"] == "cslope-analysis" and doc["formatVersion"] == 1
    assert doc["definition"]["materialBoundaries"] == [{"coordinates": [[0.0, 8.0], [29.0, 8.0]]}]
    assert doc["definition"]["waterTable"] == {
        "mode": "custom",
        "value": [[0.0, 12.0], [50.0, 4.0]],
        "freeWater": False,
    }
    assert doc["definition"]["materials"][1]["model"] == {
        "kind": "undrained",
        "unitWeight": 17.0,
        "undrainedShearStrength": 20.0,
    }
    # every option written out, with the app's defaults
    assert doc["options"]["method"] == "Morgenstern-Price"
    assert doc["options"]["slices"] == 30
    assert doc["options"]["compositeSurfaces"] is True


def test_new_names_give_the_same_factor_as_the_deprecated_ones():
    # D-24: freeWater and a boundary without materialName are the engine's
    # followBoundary = not freeWater and materialName "".
    d = slope()
    d.add_material("Clay", c=10, phi=25, gamma=19, gamma_sat=20)
    d.add_interior_boundary([(0, 8), (29, 8)])
    d.assign("Sand", at=(5, 12))
    d.assign("Clay", at=(5, 2))
    for free in (True, False):
        d._water = None
        d.add_piezometric_line([(0, 12), (30, 6), (50, 6)], free_water=free)
        doc = d.to_dict()
        old = json.loads(json.dumps(doc))
        old["definition"]["materialBoundaries"][0]["materialName"] = ""
        old["definition"]["waterTable"]["followBoundary"] = not old["definition"]["waterTable"].pop("freeWater")
        assert cslope.analyse(doc)["minFOS"] == cslope.analyse(old)["minFOS"]


def test_save_and_load(tmp_path):
    d = slope()
    d.add_distributed_load(x=(5, 12), q=15)
    d.add_line_load(x=10, p=40, angle=10)
    d.search_limits(entry=(2, 15), exit=(30, 48))
    d.options.method = "Bishop"
    path = tmp_path / "Släntmodell.json"
    assert d.save(path) == []
    assert Definition.load(path).to_dict() == d.to_dict()
    # a bare definition loads too
    bare = tmp_path / "bare.json"
    bare.write_text(json.dumps(d.to_dict()["definition"]), encoding="utf-8")
    assert Definition.load(bare).to_dict()["definition"] == d.to_dict()["definition"]


def test_load_keeps_what_the_builder_does_not_write(tmp_path):
    doc = slope().to_dict()
    doc["definition"]["reinforcements"] = [{"kind": "nail"}]
    doc["options"]["tensionCrackAuto"] = True
    assert Definition.from_dict(doc).to_dict() == doc


def test_load_reads_the_legacy_names():
    doc = slope().to_dict()
    doc["definition"]["waterTable"] = {"mode": "custom", "value": [[0, 12], [50, 4]], "followBoundary": True}
    assert Definition.from_dict(doc).to_dict()["definition"]["waterTable"]["freeWater"] is False


def test_save_refuses_a_definition_with_errors(tmp_path, monkeypatch):
    issues = [
        {
            "path": "/definition/regionAssignments",
            "code": "region-unassigned",
            "message": "A region has no material.",
            "severity": "error",
        },
        {"path": "/definition/materials/0", "code": "w", "message": "A warning.", "severity": "warning"},
    ]
    monkeypatch.setattr(cslope, "validate", lambda doc, options=None: issues)
    path = tmp_path / "bad.json"
    with pytest.raises(InvalidDefinition) as e:
        slope().save(path)
    assert e.value.issues == issues[:1]
    assert "/definition/regionAssignments" in str(e.value)
    assert not path.exists()
    monkeypatch.setattr(cslope, "validate", lambda doc, options=None: issues[1:])
    assert slope().save(path) == issues[1:]
    assert path.exists()


def test_not_a_document():
    with pytest.raises(ValueError, match="format"):
        Definition.from_dict({"format": "something", "definition": {}})
    with pytest.raises(ValueError, match="formatVersion"):
        Definition.from_dict({"format": "cslope-analysis", "formatVersion": 2, "definition": {}})


# ── the checks at each call ─────────────────────────────────────────────


def test_points_must_be_numbers():
    d = Definition()
    with pytest.raises(TypeError):
        d.exterior = [(0, 0), ("1", 1), (2, 0)]
    with pytest.raises(TypeError):
        d.exterior = [(0, 0), (1,), (2, 0)]
    with pytest.raises(ValueError):
        d.exterior = [(0, 0), (1, 1)]
    with pytest.raises(ValueError):
        d.exterior = [(0, 0), (1, 1), (2, 2)]  # no area
    with pytest.raises(ValueError):
        d.exterior = [(0, 0), (math.nan, 1), (2, 0)]


def test_orientation():
    d = Definition(orientation="rtl")
    d.exterior = [(0, 0), (0, 5), (20, 15), (30, 15), (30, 0)]
    d.add_material("Sand", c=5, phi=30, gamma=19)
    assert d.to_dict()["definition"]["orientation"] == "rtl"
    with pytest.raises(ValueError):
        Definition(orientation="left")


def test_materials():
    d = slope()
    with pytest.raises(ValueError, match="exists already"):
        d.add_material("Sand", c=1, phi=30, gamma=18)
    with pytest.raises(ValueError, match="not both"):
        d.add_material("Mixed", c=1, phi=30, su=20, gamma=18)
    with pytest.raises(ValueError, match="needs c and phi"):
        d.add_material("Half", c=1, gamma=18)
    with pytest.raises(TypeError):
        d.add_material("Clay", su="20", gamma=18)
    with pytest.raises(ValueError):
        d.add_material("Clay", su=20, gamma=0)
    with pytest.raises(TypeError):
        d.add_material("Clay", 20, 18)  # keyword arguments only


def test_assign_needs_a_known_material_inside_the_model():
    d = slope()
    with pytest.raises(ValueError, match="No material named 'Clay'"):
        d.assign("Clay", at=(5, 5))
    with pytest.raises(ValueError, match="not inside"):
        d.assign("Sand", at=(45, 10))  # above the toe
    with pytest.raises(ValueError, match="not inside"):
        d.assign("Sand", at=(0, 5))  # on the edge
    d.assign("Sand", at=(5, 5))


def test_needs_the_exterior_first():
    d = Definition()
    d.add_material("Sand", c=5, phi=30, gamma=19)
    with pytest.raises(ValueError, match="exterior"):
        d.assign("Sand", at=(1, 1))
    with pytest.raises(ValueError, match="exterior"):
        d.add_interior_boundary([(0, 1), (2, 1)])
    with pytest.raises(ValueError, match="no exterior"):
        d.to_dict()


def test_interior_boundary_reaches_the_exterior():
    d = slope()
    with pytest.raises(ValueError, match="extend it to the exterior"):
        d.add_interior_boundary([(0, 8), (20, 8)])  # stops inside
    d.add_interior_boundary([(0, 8), (29, 8)])  # on the slope face
    d.add_interior_boundary([(-0.05, 3), (50.05, 3)])  # beyond the edges


def test_water_and_loads_within_the_model():
    d = slope()
    with pytest.raises(ValueError, match="outside the model"):
        d.add_piezometric_line([(-5, 12), (50, 4)])
    with pytest.raises(ValueError, match="left to right"):
        d.add_piezometric_line([(0, 12), (30, 6), (20, 5), (50, 4)])
    with pytest.raises(TypeError):
        d.add_piezometric_line([(0, 12), (50, 4)], free_water="yes")
    d.add_piezometric_line([(0, 12), (50, 4)])
    with pytest.raises(ValueError, match="already"):
        d.add_piezometric_line([(0, 12), (50, 4)])
    with pytest.raises(ValueError, match="outside the model"):
        d.add_distributed_load(x=(45, 55), q=10)
    with pytest.raises(ValueError, match="left to right"):
        d.add_distributed_load(x=(12, 5), q=10)
    with pytest.raises(ValueError):
        d.add_distributed_load(x=(5, 12), q=-10)
    with pytest.raises(ValueError, match="outside the model"):
        d.add_line_load(x=60, p=10)
    with pytest.raises(ValueError, match="outside the model"):
        d.search_limits(entry=(-2, 10), exit=(30, 48))


# ── options and partial factors ─────────────────────────────────────────


def test_options_have_fixed_attributes():
    o = Options()
    with pytest.raises(AttributeError, match="no attribute 'slice'"):
        o.slice = 40
    with pytest.raises(AttributeError):
        o.minFOS = 1.0
    with pytest.raises(ValueError, match="method"):
        o.method = "bishop"
    with pytest.raises(ValueError):
        o.slices = 0
    with pytest.raises(TypeError):
        o.composite_surfaces = 1
    d = Definition()
    with pytest.raises(AttributeError):
        d.options.iteration = 10
    o.method = "Bishop"
    o.slices = 40
    assert o.to_dict()["method"] == "Bishop" and o.to_dict()["slices"] == 40
    assert Options(method="Janbu").method == "Janbu"
    with pytest.raises(AttributeError):
        Options(methd="Janbu")


def test_swedish_partial_factors_have_no_defaults():
    with pytest.raises(TypeError):
        swedish_partial_factors(2, 1.1, 1.0)  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        swedish_partial_factors(safety_class=2, eta_drained=1.0, variable_load_base=1.3)  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        swedish_partial_factors()  # type: ignore[call-arg]


def test_swedish_partial_factors_values():
    # as the engine's own test (types/swedish-factors.test.ts)
    f = swedish_partial_factors(safety_class=2, eta_cu=1.1, eta_drained=1.0, variable_load_base=1.4)
    assert [f["cu"], f["cohesion"], f["tanPhi"], f["variableLoad"]] == [1.364, 1.3, 1.3, 1.274]
    f = swedish_partial_factors(3, 1.0, 1.0, 1.3)
    assert [f["cu"], f["cohesion"], f["tanPhi"], f["variableLoad"]] == [1.5, 1.3, 1.3, 1.3]
    with pytest.raises((ValueError, cslope.EngineError), match="Safety class"):
        swedish_partial_factors(4, 1.0, 1.0, 1.3)
    with pytest.raises((ValueError, cslope.EngineError), match="(?i)eta"):
        swedish_partial_factors(1, 0.0, 1.0, 1.3)


def test_partial_factors_make_an_over_design_factor():
    d = slope()
    d.options.partial_factors = swedish_partial_factors(
        safety_class=3, eta_cu=1.0, eta_drained=1.0, variable_load_base=1.3
    )
    doc = d.to_dict()
    assert doc["options"]["partialFactors"]["cohesion"] == 1.3
    summary = cslope.summarize(cslope.analyse(doc), doc)
    assert summary["fosLabel"] == "over-design factor"
    assert summary["valueBasis"] == "design"
    with pytest.raises(ValueError):
        d.options.partial_factors = {"cu": 1.5}


def test_save_refuses_a_region_without_material(tmp_path):
    d = slope()
    d.add_material("Clay", su=20, gamma=17, gamma_sat=17)
    d.add_interior_boundary([(0, 8), (29, 8)])
    d.assign("Sand", at=(5, 12))
    path = tmp_path / "unassigned.json"
    with pytest.raises(InvalidDefinition) as e:
        d.save(path)
    assert all(i["path"].startswith("/definition") for i in e.value.issues)
    assert not path.exists()
