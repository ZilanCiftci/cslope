"""``cslope.model_to_definition`` and ``cslope export``: a model of a project
file as the engine's definition, as the app makes it (issue #57).

The conversion is the Rust port of the app's (crate cslope-project), held to
the app's own by its golden corpus (packages/engine-rs/golden); here the
binding and the command. The project fixtures are the desktop app's."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest

import cslope
from cslope import cli, project

HERE = Path(__file__).resolve().parent
ENGINE_RS = HERE.parents[2]
CORPUS = ENGINE_RS / "golden" / "project-corpus.json"
FIXTURES = ENGINE_RS.parent / "desktop" / "src" / "features" / "project" / "fixtures"

APP_RESULTS = HERE / "data" / "app-results.cslp"

needs_corpus = pytest.mark.skipif(not CORPUS.is_file(), reason="the golden corpus is not in this checkout")
needs_fixtures = pytest.mark.skipif(not FIXTURES.is_dir(), reason="the desktop fixtures are not in this checkout")


def run(*argv):
    out, err = io.StringIO(), io.StringIO()
    code = cli.main(list(map(str, argv)), out=out, err=err)
    return code, out.getvalue(), err.getvalue()


def same(a, b, path=""):
    """a equals b, numbers as floats (Rust writes 1.0 where JSON had 1),
    points as lists (the binding gives tuples)."""
    if isinstance(a, bool) or isinstance(b, bool) or a is None or b is None:
        assert a == b, path
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)):
        assert float(a) == float(b), path
    elif isinstance(a, dict):
        assert isinstance(b, dict) and set(a) == set(b), (path, sorted(set(a) ^ set(b)))
        for k in a:
            same(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, (list, tuple)):
        assert isinstance(b, (list, tuple)) and len(a) == len(b), path
        for i, (x, y) in enumerate(zip(a, b)):
            same(x, y, f"{path}[{i}]")
    else:
        assert a == b, path


def corpus():
    return json.loads(CORPUS.read_text(encoding="utf-8"))


@needs_corpus
def test_model_to_definition_gives_the_apps_definition():
    for m in corpus()["models"]:
        # (normalize=False takes the model as the app writes it, every member present)
        same(cslope.model_to_definition(m["parsed"], normalize=False), m["definition"], m["name"])
        same(cslope.model_to_definition(m["model"]), m["definition"], m["name"])


@needs_corpus
def test_a_saved_model_is_read_as_the_app_opens_it():
    # the app's load fills, clamps and drops fields (store/persistence.ts)
    for s in corpus()["saved"]:
        same(cslope.model_to_definition(s["raw"]), s["definition"], s["name"])
        same(cslope.normalize_model(s["raw"])["options"], s["options"], s["name"])
        doc = cli.export_document(s["raw"])
        same(doc["options"], s["options"], s["name"])


@needs_corpus
def test_exported_documents_are_valid_and_say_free_water():
    c = corpus()
    for name, raw in [(m["name"], m["model"]) for m in c["models"]] + [(s["name"], s["raw"]) for s in c["saved"]]:
        doc = cli.export_document(raw)
        issues = cslope.validate(doc)
        # (a corpus model may hold a material the app also rejects on purpose)
        errors = [(i["path"], i["code"]) for i in issues if i.get("severity", "error") == "error" and "/model" not in i["path"]]
        assert errors == [], (name, errors)
        assert "follow-boundary-inverted" not in {i["code"] for i in issues}, name
        for w in [doc["definition"].get("waterTable")] + list(doc["definition"].get("waterTables") or []):
            assert w is None or "followBoundary" not in w, name


@needs_corpus
def test_regions_left_to_the_first_material_are_assigned_with_the_same_f():
    # the app runs a model with a region without assignment (the first
    # material); the export says so explicitly (#85), with the same F
    c = corpus()
    added = computed = 0
    for name, raw in [(m["name"], m["model"]) for m in c["models"]] + [(s["name"], s["raw"]) for s in c["saved"]]:
        doc = cli.export_document(raw)
        plain = cslope.model_to_definition(raw)
        if len(doc["definition"].get("regionAssignments") or []) == len(plain.get("regionAssignments") or []):
            continue
        added += 1
        codes = {i["code"] for i in cslope.validate(plain, doc["options"])}
        assert codes & {"unassigned-region", "missing-region-assignments"}, name
        options = dict(doc["options"], iterations=500, refinedIterations=100)
        try:
            before = cslope.analyse(plain, options, threads=2)["minFOS"]
        except cslope.EngineError:
            before = None
        try:
            after = cslope.analyse(doc["definition"], options, threads=2)["minFOS"]
        except cslope.EngineError:
            after = None
        assert before == after, name
        computed += before is not None
    assert added >= 2 and computed >= 1


def test_a_hand_written_document_with_an_unassigned_region_is_still_an_error():
    clay = {"kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 5, "frictionAngle": 30}
    d = {
        "coordinates": [[0, 0], [0, 10], [20, 10], [40, 0]],
        "materials": [{"name": "A", "model": clay}, {"name": "B", "model": clay}],
        "materialBoundaries": [{"coordinates": [[0, 5], [30, 5]]}],
        "regionAssignments": [{"point": [5, 7], "materialName": "B"}],
    }
    assert "unassigned-region" in {i["code"] for i in cslope.validate(d) if i["severity"] == "error"}


def test_model_to_definition_names_what_it_cannot_read():
    with pytest.raises(ValueError, match=r"The model cannot be read at materials\[0\]: missing field"):
        cslope.model_to_definition({"id": "m", "coordinates": [[0, 0], [1, 1]], "materials": [{"id": "a"}]}, normalize=False)
    # read as the app reads it: the app's messages
    with pytest.raises(ValueError, match=r"Model m must include coordinates"):
        cslope.model_to_definition({"id": "m", "coordinates": [[0, 0], [1, 1]], "materials": [{"id": "a"}]})
    with pytest.raises(ValueError, match=r"Coordinate #2 must be numbers"):
        cslope.model_to_definition({"id": "m", "coordinates": [[0, 0], [1, "x"], [2, 2]], "materials": [{"id": "a"}]})


@needs_fixtures
def test_export_writes_the_active_model(tmp_path):
    code, out, err = run("export", FIXTURES / "cslp-v1.cslp")
    assert code == 0, err
    doc = json.loads(out)
    assert doc["format"] == "cslope-analysis" and doc["formatVersion"] == 1
    p = project.open(FIXTURES / "cslp-v1.cslp")
    active = p.active_model
    # the model's own orientation (model-2 faces left), and its options as saved
    assert doc["definition"]["orientation"] == active.data["orientation"] == "rtl"
    # the options as the app holds them after opening the file: complete
    assert doc["options"] == cslope.normalize_model(active.data)["options"]
    assert set(doc["options"]) >= set(cslope.default_options())
    same(doc["definition"], cslope.model_to_definition(active.data))
    assert [i for i in cslope.validate(doc) if i.get("severity", "error") == "error"] == []
    assert cslope.analyse(doc, threads=1)["minFOS"] > 0
    # -o writes the same document
    target = tmp_path / "out.json"
    assert run("export", FIXTURES / "cslp-v1.cslp", "-o", target)[0] == 0
    assert json.loads(target.read_text(encoding="utf-8")) == doc
    code, out, err = run("validate", target)
    assert code == 0 and out == "Valid.\n", (out, err)


@needs_fixtures
def test_export_a_model_by_name_or_every_model(tmp_path):
    code, out, err = run("export", FIXTURES / "cslp-v1-drawings.cslp", "--model", "Legacy v3 slope")
    assert code == 0, err
    assert json.loads(out)["definition"]["udls"] == [{"magnitude": 10.0, "x1": 22.0, "x2": 28.0}]
    code, out, err = run("export", FIXTURES / "cslp-v1.cslp", "--model", "model-2")
    assert code == 0 and json.loads(out)["definition"]["orientation"] == "rtl"
    code, out, err = run("export", FIXTURES / "cslp-v1.cslp", "--all")
    listed = json.loads(out)
    assert code == 0 and [(e["id"], e["name"]) for e in listed] == [("model-1", "Legacy v3 slope"), ("model-2", "Second model")]
    assert all(e["document"]["format"] == "cslope-analysis" for e in listed)
    code, out, err = run("export", FIXTURES / "cslp-v1.cslp", "--all", "-o", tmp_path / "all")
    assert code == 0, err
    assert sorted(f.name for f in (tmp_path / "all").iterdir()) == ["model-1.json", "model-2.json"]
    code, out, err = run("export", FIXTURES / "cslp-v1.cslp", "--model", "Nope")
    assert code == 2 and "No model named 'Nope'" in err and "'Second model'" in err


@needs_fixtures
@pytest.mark.parametrize("name", ["cslp-3file.cslp", "legacy-json-v3.json", "legacy-json-v1.json"])
def test_export_refuses_a_file_of_an_earlier_version(name):
    code, out, err = run("export", FIXTURES / name)
    assert code == 2 and out == ""
    assert "earlier cSlope" in err and "open it in the cSlope app and save it" in err


@needs_fixtures
def test_export_refuses_an_older_or_newer_schema(tmp_path):
    def with_version(version):
        src = zipfile.ZipFile(FIXTURES / "cslp-v1.cslp")
        target = tmp_path / f"v{version}.cslp"
        with zipfile.ZipFile(target, "w") as z:
            for info in src.infolist():
                data = src.read(info)
                if info.filename == "project.json":
                    p = json.loads(data)
                    p["version"] = version
                    data = json.dumps(p).encode()
                z.writestr(info, data)
        return target

    code, _, err = run("export", with_version(2))
    assert code == 2 and "project schema version 2" in err and "save it" in err
    code, _, err = run("export", with_version(4))
    assert code == 2 and "newer cSlope" in err


def test_export_of_a_file_that_is_not_there(tmp_path):
    code, _, err = run("export", tmp_path / "none.cslp")
    assert code == 2 and "Cannot read" in err


@needs_fixtures
def test_export_reports_what_it_cannot_write(tmp_path):
    code, out, err = run("export", FIXTURES / "cslp-v1.cslp", "-o", tmp_path / "missing" / "out.json")
    assert code == 2 and "Cannot write" in err
    (tmp_path / "file").write_text("x")
    code, out, err = run("export", FIXTURES / "cslp-v1.cslp", "--all", "-o", tmp_path / "file")
    assert code == 2 and "is a file" in err


def test_export_of_an_analysis_document_points_to_analyse(tmp_path):
    doc = tmp_path / "a.json"
    doc.write_text(json.dumps({"format": "cslope-analysis", "formatVersion": 1, "definition": {}}))
    code, out, err = run("export", doc)
    assert code == 2 and "analysis document" in err and "cslope analyse" in err


def test_export_file_names_are_safe():
    used: set = set()
    assert cli._file_name("model-1", 0, used) == "model-1.json"
    assert cli._file_name("../x", 1, used) == "model-2.json"
    assert cli._file_name("a/b", 2, used) == "model-3.json"
    assert cli._file_name("model-1", 3, used) == "model-1-2.json"


@pytest.mark.skipif(not APP_RESULTS.is_file(), reason="the app-saved project is not in this checkout")
def test_export_runs_to_the_f_the_app_saved():
    # a project saved by the app with its results (packages/desktop/scripts/make-export-fixture.ts)
    p = project.open(APP_RESULTS)
    compared = 0
    for m in p.models:
        assert m.result and m.result["runState"] == "done", m.name
        doc = cli.export_document(m.data)
        assert [i for i in cslope.validate(doc) if i.get("severity", "error") == "error"] == [], m.name
        f = cslope.analyse(doc, threads=4)["minFOS"]
        assert f == pytest.approx(m.min_fos, rel=1e-9), m.name
        compared += 1
    assert compared == 8
