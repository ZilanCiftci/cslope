"""The object API (issue #59): ``cslope.Project``, ``cslope.Model`` and
``cslope.Result`` build, open, run and save projects.

The app-saved project (tests/data/app-results.cslp, written by the app's
code with the F it computes: packages/desktop/scripts/make-export-fixture.ts)
holds the examples; the tests that need it are skipped without it (a wheel
test).
"""

from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

import pytest

import cslope
from cslope import Model, Project, Result
from cslope.build import _ALL_OPTION_FIELDS, _OPTION_FIELDS, Definition, InvalidDefinition, Options
from cslope.model import _PILE_FIELDS, _REINFORCEMENT_FIELDS

HERE = Path(__file__).resolve().parent
APP_RESULTS = HERE / "data" / "app-results.cslp"
needs_app_results = pytest.mark.skipif(not APP_RESULTS.is_file(), reason="the app-saved project is not in this checkout")

EXAMPLES = (
    "T-ACADS Simple",
    "T-ACADS Non-Homogeneous",
    "Arai & Tagyo (1985)",
    "Arai & Tagyo (1985), weak layer",
    "Talbingo Dam",
    "Talbingo Dam (Single Circle)",
)


def slope(name: str = "Section A") -> Model:
    m = Model(name)
    m.exterior = [(0, 0), (0, 15), (15, 15), (35, 5), (50, 5), (50, 0)]
    m.add_material("Sand", c=5, phi=30, gamma=19, gamma_sat=20)
    return m


def quick(m: Model) -> Model:
    m.options.iterations = 500
    m.options.refined_iterations = 100
    return m


def rebuild(app: Model) -> Model:
    """``app`` built again from nothing with the public API only."""
    d = app.data
    m = Model(app.name, d["orientation"])
    m.exterior = d["coordinates"]
    names = {}
    for row in d["materials"]:
        names[row["id"]] = m.add_material(row["name"], model=row["model"], color=row["color"]).name
    for b in sorted(d["materialBoundaries"], key=lambda b: b["id"]):
        m.add_interior_boundary(b["coordinates"])
    for a in d["regionMaterials"]:
        m.assign(names[a["materialId"]], at=a["point"])
    piezo = d["piezometricLine"]
    for line in piezo["lines"]:
        users = [names[k] for k, v in piezo["materialAssignment"].items() if v == line["id"]]
        m.add_piezometric_line(line["coordinates"], name=line["name"], materials=users, free_water=piezo.get("freeWater", True))
    lim = d["analysisLimits"]
    if lim["enabled"]:
        m.search_limits(
            entry=sorted((lim["entryLeftX"], lim["entryRightX"])), exit=sorted((lim["exitLeftX"], lim["exitRightX"]))
        )
    for s in d["customSearchPlanes"]:
        m.add_custom_surface(center=(s["cx"], s["cy"]), radius=s["radius"])
    m.custom_surfaces_only = d["customPlanesOnly"]
    attr_of = {key: attr for attr, (key, _) in _ALL_OPTION_FIELDS.items()}
    for key, v in d["options"].items():
        setattr(m.options, attr_of[key], v)
    return m


# ── the app's examples ──────────────────────────────────────────────────


@needs_app_results
@pytest.mark.parametrize("name", EXAMPLES)
def test_every_example_built_in_python_gives_the_apps_f(name):
    app = Project.open(APP_RESULTS).model(name)
    m = rebuild(app)
    r = m.analyse(threads=4)
    assert r.fos == pytest.approx(app.result.fos, abs=1e-6)
    assert r.is_current and m.result is r


@needs_app_results
def test_a_saved_result_reads_without_a_run():
    p = Project.open(APP_RESULTS)
    m = p.model("T-ACADS Simple")
    assert m.result_is_current and m.result.is_current
    assert m.result.fos == pytest.approx(0.9844937943075049, abs=1e-12)
    assert m.result.fos_label == "factor of safety" and m.result.method == "Morgenstern-Price"
    assert m.result.critical_surface["shape"] == "circle"
    assert m.min_fos == m.result.fos and m.result.saved["runState"] == "done"
    assert len(m.result.slices) == 30


@needs_app_results
def test_open_change_one_material_run_save(tmp_path):
    target = Path(shutil.copy(APP_RESULTS, tmp_path / "site.cslp"))
    p = Project.open(target)
    m = p.model("T-ACADS Non-Homogeneous")
    before = m.result.fos
    m.material("Soil #2").c = 8
    assert not m.result_is_current and not m.result.is_current
    r = m.analyse(threads=4)
    assert r.fos > before and m.result_is_current
    assert p.save() == {"droppedResults": [], "droppedThumbnail": False}

    again = Project.open(target)
    changed = again.model("T-ACADS Non-Homogeneous")
    assert changed.result_is_current and changed.result.fos == r.fos
    # the hash the app compares (the Rust hash is the app's: tests/golden.rs)
    assert changed.result.saved["inputHash"] == changed.input_hash
    assert changed.material("Soil #2").c == 8
    # every other model as the app saved it, its result current
    old, new = _entries(APP_RESULTS), _entries(target)
    for model in again.models:
        assert model.result_is_current, model.name
        if model.id == changed.id:
            continue
        for entry in ("model.json", "result.json"):
            name = "models/{}/{}".format(model.id, entry)
            assert new[name] == old[name], name


def _entries(path):
    with zipfile.ZipFile(path) as z:
        return {n: json.loads(z.read(n)) for n in z.namelist() if n.endswith(".json")}


# ── a project from nothing ──────────────────────────────────────────────


def test_a_new_project_saves_and_opens(tmp_path):
    p = Project()
    m = p.add_model("Section A")
    m.exterior = [(0, 0), (0, 15), (15, 15), (35, 5), (50, 5), (50, 0)]
    sand = m.add_material("Sand", c=0, phi=32, gamma=19, gamma_sat=20)
    clay = m.add_material("Clay", su=25, gamma=17, gamma_sat=18)
    m.add_interior_boundary([(0, 8), (50, 8)])
    m.assign(sand, at=(5, 12))
    m.assign(clay, at=(25, 3))
    m.add_piezometric_line([(0, 12), (15, 11), (35, 5), (50, 5)])
    m.add_distributed_load(x=(3, 10), q=20)
    m.search_limits(entry=(2, 14), exit=(20, 45))
    quick(m)
    r = m.analyse(threads=2)
    p.add_model("Section B")
    with pytest.raises(ValueError, match="no exterior"):
        p.save(tmp_path / "site.cslp")
    p.remove_model("Section B")
    p.save(tmp_path / "site.cslp")
    q = Project.open(tmp_path / "site.cslp")
    assert [x.name for x in q.models] == ["Section A"] and q.active_model.name == "Section A"
    assert q.model("Section A").result.fos == r.fos and q.model("Section A").result_is_current
    assert [x.name for x in q.model("Section A").materials] == ["Sand", "Clay"]


def test_the_defaults_are_the_apps():
    m = Model("A")
    assert m.options.method == "Morgenstern-Price" and m.options.slices == 30
    assert (m.options.iterations, m.options.refined_iterations, m.options.composite_surfaces) == (1000, 500, True)
    assert m.data["analysisLimits"]["enabled"] is False and m.orientation == "ltr"


def test_the_result():
    m = quick(slope())
    m.search_limits(entry=(5, 15), exit=(35, 45))
    r = m.analyse(threads=2)
    assert isinstance(r, Result) and r.fos == r.data["minFOS"]
    assert r.summary["fos"] == r.fos and r.warnings == []
    row = r.slices[0]
    assert row["slice"] == 1 and row["material"] == "Sand" and row["c"] == 5
    assert 0 < row["alpha"] < 90  # degrees
    csv = r.to_csv()
    lines = csv.split("\r\n")
    assert lines[0] == "Model,Section A" and lines[2].startswith("Min F,")
    assert lines.count("") == 2 and len(lines) == len(r.slices) + 2 + lines.index("") + 1
    assert ";" in r.to_csv(decimal_comma=True).split("\r\n")[2]


def test_threads_do_not_change_the_result():
    m = quick(slope())
    one, three = m.analyse(threads=1).data, m.analyse(threads=3).data
    one.pop("elapsedMs"), three.pop("elapsedMs")
    assert one == three


def test_changes_are_checked_where_they_are_made():
    m = slope()
    sand = m.material("Sand")
    with pytest.raises(ValueError, match="phi must be less than 90"):
        sand.phi = 95
    with pytest.raises(AttributeError, match="has no su"):
        sand.su = 20
    with pytest.raises(ValueError, match="exists already"):
        m.add_material("Sand", c=1, phi=30, gamma=18)
    with pytest.raises(LookupError, match="No material named 'Rock'"):
        m.assign("Rock", at=(5, 5))
    with pytest.raises(ValueError, match="inside the model"):
        m.add_interior_boundary([(5, 5), (50, 3)])
    with pytest.raises(ValueError, match="outside the model"):
        m.add_line_load(x=60, p=10)
    with pytest.raises(AttributeError, match="no attribute 'slice'"):
        m.options.slice = 20  # type: ignore[attr-defined]
    with pytest.raises(ValueError, match="free_water holds for every line"):
        m.add_piezometric_line([(0, 10), (50, 4)])
        m.add_piezometric_line([(0, 9), (50, 3)], free_water=False)
    with pytest.raises(ValueError, match="not a value the app keeps"):
        m.options.seismic_horizontal = -0.1
    assert m.options.seismic_horizontal == 0


def test_items_change_in_place_and_go():
    m = slope()
    clay = m.add_material("Clay", su=30, gamma=18)
    m.add_interior_boundary([(0, 8), (50, 8)])
    m.assign("Sand", at=(5, 12))
    m.assign(clay, at=(25, 3))
    # assigning a region again replaces its assignment
    m.assign("Sand", at=(40, 2))
    assert m.assignments == [((5.0, 12.0), "Sand"), ((40.0, 2.0), "Sand")]
    load = m.add_distributed_load(x=(3, 10), q=20, excess_pore_pressure={clay: 0.5})
    load.q = 25
    load.x = (2, 9)
    assert (m.data["udls"][0]["magnitude"], load.x, load.excess_pore_pressure) == (25, (2, 9), {"Clay": 0.5})
    line = m.add_piezometric_line([(0, 12), (50, 5)], materials=["Clay"])
    assert line.materials == ["Clay"] and line.name == "Line 1"
    clay.remove()
    assert [x.name for x in m.materials] == ["Sand"] and line.materials == []
    assert m.assignments == [((5.0, 12.0), "Sand"), ((40.0, 2.0), "Sand")]
    load.remove()
    assert m.distributed_loads == []
    with pytest.raises(LookupError, match="removed"):
        load.q = 3


def test_reinforcement_and_piles_take_the_apps_presets():
    m = slope()
    nail = m.add_reinforcement((20, 12), (12, 9), kind="nail")
    assert (nail.tensile_capacity, nail.spacing, nail.pullout, nail.application) == (100, 1.5, "bond", "passive")
    tie = m.add_reinforcement((20, 12), (10, 8), kind="tieback", tensile_capacity=250)
    assert tie.tensile_capacity == 250 and tie.bonded_length == 5
    with pytest.raises(TypeError, match="Unknown reinf field"):
        m.add_reinforcement((20, 12), (10, 8), capacity=3)
    pile = m.add_pile((30, 7.5), (30, 0), mode="force", force=50)
    assert (pile.kind, pile.mode, pile.force, pile.start) == ("pile", "force", 50, (30, 7.5))
    pile.force = 80
    assert m.data["piles"][0]["force"] == 80


def test_an_expression_is_not_overwritten():
    m = slope()
    m.data["materials"][0]["modelExpressions"] = {"cohesion": "c0 + 1"}
    with pytest.raises(ValueError, match="set by the expression 'c0 \\+ 1'"):
        m.material("Sand").c = 3
    m.material("Sand").phi = 31  # another field is free


def test_options_are_the_builders():
    m = slope()
    m.options.method = "Bishop"
    m.options.janbu_correction = True
    m.options.partial_factors = cslope.swedish_partial_factors(
        safety_class=2, eta_cu=1.0, eta_drained=1.0, variable_load_base=1.3
    )
    assert m.data["options"]["method"] == "Bishop" and m.data["options"]["janbuCorrection"] is True
    assert m.definition["options"]["partialFactors"]["cu"] == 1.5
    m.options.partial_factors = None
    assert "partialFactors" not in m.data["options"]
    # the builder writes the options it always wrote, and the others when set
    assert set(Options().to_dict()) == {key for key, d in _OPTION_FIELDS.values() if d is not None}
    o = Options(max_iterations=20)
    assert o.to_dict()["maxIterations"] == 20 and "janbuCorrection" not in o.to_dict()


# ── the review's cases ─────────────────────────────────────────────────


def test_a_change_during_the_run_leaves_the_result_out_of_date():
    m = quick(slope())
    changed = []

    def progress(event):
        if not changed:
            changed.append(1)
            m.material("Sand").c = 50

    m.analyse(threads=2, progress=progress)
    assert changed and not m.result_is_current and not m.result.is_current


def test_a_saved_result_keeps_the_options_it_ran_with(tmp_path):
    m = quick(slope())
    m.analyse(threads=2)
    m.options.partial_factors = cslope.swedish_partial_factors(
        safety_class=3, eta_cu=1.0, eta_drained=1.0, variable_load_base=1.3
    )
    assert m.result.fos_label == "factor of safety" and m.result.to_csv().split("\r\n")[2].startswith("Min F,")
    p = Project()
    p.add_model(m)
    m.analyse(threads=2)
    p.save(tmp_path / "x.cslp")
    m.options.partial_factors = None
    assert Project.open(tmp_path / "x.cslp").models[0].result.fos_label == "over-design factor"


def test_options_are_checked_before_the_model_is_complete():
    m = Model("A")
    with pytest.raises(ValueError, match="the app takes more than 0 and at most 1"):
        m.options.seismic_horizontal = -0.1
    with pytest.raises(ValueError, match="the app takes 10 to 500; it would hold 500"):
        m.options.slices = 100000
    m.exterior = [(0, 0), (0, 15), (15, 15), (35, 5), (50, 5), (50, 0)]
    assert m.options.slices == 30 and m.materials == []


def test_a_model_keeps_one_material():
    m = slope()
    with pytest.raises(ValueError, match="only material"):
        m.material("Sand").remove()


def test_models_in_projects():
    a, b = quick(slope("A")), quick(slope("B"))
    a.analyse(threads=2)
    b.analyse(threads=2)
    p = Project()
    p.add_model(a)
    p.add_model(b)  # renumbered: its result stays (the hash does not include the id)
    assert b.id != a.id and b.result is not None and b.result_is_current
    with pytest.raises(ValueError, match="exists already"):
        b.name = "A"
    with pytest.raises(ValueError, match="another project"):
        Project().add_model(a)
    p.remove_model(a)
    Project().add_model(a)


def test_a_removed_item_cannot_be_changed():
    m = slope()
    r = m.add_reinforcement((20, 12), (12, 9), kind="nail")
    pile = m.add_pile((30, 7.5), (30, 0))
    line = m.add_piezometric_line([(0, 12), (50, 5)])
    second = m.add_piezometric_line([(0, 10), (50, 4)])
    r.remove()
    pile.remove()
    second.remove()
    for change in (
        lambda: setattr(r, "start", (21, 12)),
        lambda: setattr(pile, "end", (30, 1)),
        lambda: setattr(second, "materials", ["Sand"]),
        lambda: setattr(r, "spacing", 2),
    ):
        with pytest.raises(LookupError, match="removed"):
            change()
    assert m.data["piezometricLine"]["materialAssignment"] == {} and line.materials == []


def test_setters_check_as_the_add_methods_do():
    m = slope()
    with pytest.raises(ValueError, match="#rrggbb"):
        m.material("Sand").color = "red"
    with pytest.raises(ValueError, match="#rrggbb"):
        m.add_material("X", c=1, phi=20, gamma=18, color="notacolor")
    load = m.add_line_load(x=20, p=10)
    with pytest.raises(ValueError, match="outside the model"):
        load.x = 500
    with pytest.raises(ValueError, match="cannot be None"):
        load.p = None
    udl = m.add_distributed_load(x=(3, 10), q=20)
    with pytest.raises(ValueError, match="cannot be None"):
        udl.q = None
    assert (load.x, m.data["udls"][0]["magnitude"]) == (20, 20)


def test_assigning_many_regions_is_quick():
    import time

    m = Model("Layers")
    m.exterior = [(0, -50), (0, 50), (1000, 50), (1000, -50)]
    for i in range(40):
        m.add_material("M{}".format(i), c=5 + i, phi=25, gamma=19)
    for i in range(39):
        m.add_interior_boundary([(-1, 45 - 2.4 * i), (1001, 45 - 2.4 * i)])
    t = time.perf_counter()
    for i in range(40):
        m.assign("M{}".format(i), at=(500, 46 - 2.4 * i))
    assert time.perf_counter() - t < 5
    assert len(m.assignments) == 40


# ── JSON, the agents' path ──────────────────────────────────────────────


def test_definition_round_trip(tmp_path):
    m = quick(slope())
    m.search_limits(entry=(5, 15), exit=(35, 45))
    doc = m.definition
    assert doc["format"] == "cslope-analysis" and "followBoundary" not in json.dumps(doc)
    m.save_definition(tmp_path / "a.json")
    back = Model.from_definition(tmp_path / "a.json", name="Copy")
    assert back.name == "Copy" and back.definition == doc
    assert cslope.analyse(doc, threads=2)["minFOS"] == m.analyse(threads=2).fos


def test_a_builder_document_opens_as_a_model():
    d = Definition()
    d.exterior = [(0, 0), (0, 15), (15, 15), (35, 5), (50, 5), (50, 0)]
    d.add_material("Sand", c=5, phi=30, gamma=19, gamma_sat=20)
    d.add_piezometric_line([(0, 12), (50, 4)])
    d.options.iterations = 500
    d.options.refined_iterations = 100
    m = Model.from_definition(d.to_dict())
    assert m.analyse(threads=2).fos == pytest.approx(cslope.analyse(d.to_dict(), threads=2)["minFOS"], abs=1e-12)


def test_save_definition_refuses_errors(tmp_path):
    m = slope()
    m.data["regionMaterials"] = [{"point": [500, 500], "materialId": m.materials[0]._id}]
    with pytest.raises(InvalidDefinition):
        m.save_definition(tmp_path / "x.json")
    assert not (tmp_path / "x.json").exists()


# ── coverage: every field of the engine's definition has a way in ─────

# What the object API does not write, and why. A field added to the engine
# (and so to the schema) fails the test until it gets a method here or is
# listed on purpose.
NOT_WRITTEN = {
    "definition": {
        "waternet": "model.data['waternet'] (pore pressure from head lines)",
        "earlierStage": "model.data['earlierStage'] (staged analysis)",
        "rapidDrawdown": "model.data['piezometricLine']['rapidDrawdown']",
        "topRegionMaterialName": "legacy: regions are assigned (assign)",
    },
    "SlopeMaterialDefinition": {
        # the flat material fields before material models existed
        "unitWeight": "legacy", "frictionAngle": "legacy", "cohesion": "legacy", "cohesionRefDepth": "legacy",
        "cohesionRateOfChange": "legacy", "cohesionUndrained": "legacy",
    },
    "MaterialBoundary": {"materialName": "deprecated (D-24)"},
    "WaterTableDefinition": {"followBoundary": "deprecated (D-24): freeWater"},
    "WaterTableEntry": {"followBoundary": "deprecated (D-24): freeWater"},
    "CustomSurface": {"axis": "not written by the app"},
    "Pile": {"axialStiffness": "not written by the app"},
    "Reinforcement": {},
    "UdlDefinition": {},
    "LineLoadDefinition": {},
    "AnalysisLimits": {},
    "CustomSearchPlane": {},
    "BlockSearchObject": {},
    "RegionAssignment": {},
    "UdlExcessPorePressure": {},
    "options": {},
}


def every_field() -> Model:
    m = Model("Every field", "ltr")
    m.exterior = [(0, 0), (0, 15), (15, 15), (35, 5), (50, 5), (50, 0)]
    sand = m.add_material("Sand", c=5, phi=30, gamma=19, gamma_sat=20, depth_range=(0, 20), color="#123456")
    clay = m.add_material("Clay", su=25, gamma=17, gamma_sat=18)
    m.add_interior_boundary([(0, 8), (50, 8)])
    m.assign(sand, at=(5, 12))
    m.assign(clay, at=(25, 3))
    m.add_piezometric_line([(0, 12), (15, 11), (35, 5), (50, 5)], free_water=False)
    m.add_piezometric_line([(0, 6), (50, 4)], materials=[clay], free_water=False)
    m.add_distributed_load(x=(3, 10), q=20, direction="normal", excess_pore_pressure={clay: 0.3})
    m.add_line_load(x=12, p=30, angle=10, y=15)
    m.add_reinforcement((20, 12), (10, 8), kind="tieback", prestress=50)
    m.add_reinforcement((22, 11), (14, 9), kind="anchor", pullout="development", development_length1=1, development_length2=2)
    m.add_pile((30, 7.5), (30, 0), mode="force", force=50, shear_capacity=10, moment_capacity=5,
               bending_stiffness=1e4, direction="angle", location="slip-surface")
    m.add_pile((40, 5), (40, 0), kind="sheet-pile")
    m.search_limits(entry=(2, 14), exit=(20, 45))
    m.add_custom_surface(center=(30, 30), radius=25)
    m.add_custom_surface(points=[(5, 15), (20, 4), (40, 5)])
    m.custom_surfaces_only = False
    m.add_block_search_object([(10, 6), (30, 6)])
    o = m.options
    o.search_method = "block"
    o.both_directions = True
    o.partial_factors = cslope.swedish_partial_factors(safety_class=2, eta_cu=1.0, eta_drained=1.0, variable_load_base=1.3)
    o.seismic_horizontal, o.seismic_vertical = 0.1, 0.05
    o.min_slip_depth, o.tension_crack_depth, o.tension_crack_water = 0.5, 1.0, 0.5
    o.tension_crack_auto, o.tension_crack_angle = True, 60
    o.max_iterations, o.min_failure_dist, o.min_slip_area = 20, 0.1, 0.1
    o.janbu_correction = o.non_circular_optimization = o.composite_base = True
    o.interslice_function = "data-point-specified"
    o.interslice_data_points = [(0, 0), (0.5, 1), (1, 0)]
    o.pore_pressure_head = "phreatic-correction"
    o.block_active_angle, o.block_passive_angle = (40, 60), (20, 30)
    o.fem = {"enabled": False}
    o.sgi3d = {"enabled": False}
    return m


def _keys(value):
    """The keys of a dict, or of the dicts of a list (their own keys only:
    a nested key never stands in for a missing one)."""
    if isinstance(value, dict):
        return set(value)
    return set().union(*(set(v) for v in value or [] if isinstance(v, dict)))


def test_the_api_covers_every_field_of_the_definition():
    m = every_field()
    doc = m.definition
    definition = doc["definition"]
    schema = cslope.schema("slope-definition")
    defs = schema["$defs"]

    def missing(shape, props, written):
        allowed = NOT_WRITTEN.get(shape, {})
        return sorted(set(props) - set(written) - set(allowed))

    gaps = {"definition": missing("definition", schema["properties"], definition)}
    for shape, key in (
        ("SlopeMaterialDefinition", "materials"),
        ("MaterialBoundary", "materialBoundaries"),
        ("RegionAssignment", "regionAssignments"),
        ("WaterTableEntry", "waterTables"),
        ("UdlDefinition", "udls"),
        ("LineLoadDefinition", "lineLoads"),
        ("Reinforcement", "reinforcements"),
        ("Pile", "piles"),
        ("CustomSearchPlane", "customSearchPlanes"),
        ("CustomSurface", "customSurfaces"),
        ("BlockSearchObject", "blockSearchObjects"),
        ("AnalysisLimits", "analysisLimits"),
        ("WaterTableDefinition", "waterTable"),
    ):
        gaps[shape] = missing(shape, defs[shape].get("properties", {}), _keys(definition.get(key)))
    excess = [e for u in definition["udls"] for e in u.get("excessPorePressure") or []]
    gaps["UdlExcessPorePressure"] = missing("UdlExcessPorePressure", defs["UdlExcessPorePressure"]["properties"], _keys(excess))
    # every option of the engine has an attribute of Options (the model's
    # options dict holds every option whatever the API does, so it proves nothing)
    option_keys = {key for key, _ in _ALL_OPTION_FIELDS.values()}
    gaps["options"] = missing("options", cslope.schema("analysis-options")["properties"], option_keys)
    # every field of the app's reinforcement and pile rows has a property
    ends = {"id", "type", "x1", "y1", "x2", "y2"}
    gaps["reinforcement rows"] = sorted(_keys(m.data["reinforcements"]) - ends - set(_REINFORCEMENT_FIELDS.values()))
    gaps["pile rows"] = sorted(_keys(m.data["piles"]) - ends - set(_PILE_FIELDS.values()))
    assert {k: v for k, v in gaps.items() if v} == {}
    # the main line carries freeWater (D-24), never the inverted followBoundary
    assert definition["waterTable"]["freeWater"] is False and "followBoundary" not in definition["waterTable"]
    assert all("waterTableId" in m for m in definition["materials"] if m["name"] == "Clay")


def test_the_unit_weight_of_water_is_an_option_of_the_model(tmp_path):
    m = quick(slope())
    m.add_piezometric_line([(0, 10), (50, 4)])
    assert m.options.water_unit_weight is None and "waterUnitWeight" not in m.data["options"]
    f_default = m.analyse(threads=2).fos
    m.options.water_unit_weight = 9.807
    assert m.definition["options"]["waterUnitWeight"] == 9.807
    assert m.analyse(threads=2).fos == f_default
    # more pore pressure, a lower F
    m.options.water_unit_weight = 10.5
    assert m.analyse(threads=2).fos < f_default
    with pytest.raises(ValueError, match="water_unit_weight must be greater than 0"):
        m.options.water_unit_weight = 0
    assert m.options.water_unit_weight == 10.5
    p = Project()
    p.add_model(m)
    p.save(tmp_path / "w.cslp")
    assert Project.open(tmp_path / "w.cslp").models[0].options.water_unit_weight == 10.5
    m.options.water_unit_weight = None
    assert "waterUnitWeight" not in m.data["options"]
    assert Options(water_unit_weight=9.82).to_dict()["waterUnitWeight"] == 9.82
