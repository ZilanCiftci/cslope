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


@needs_corpus
def test_model_to_definition_gives_the_apps_definition():
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    for m in corpus["models"]:
        same(cslope.model_to_definition(m["model"]), m["definition"], m["name"])


def test_model_to_definition_names_what_it_cannot_read():
    with pytest.raises(ValueError, match=r"materials\[0\]"):
        cslope.model_to_definition({"id": "m", "coordinates": [[0, 0], [1, 1]], "materials": [{"id": "a"}]})


@needs_fixtures
def test_export_writes_the_active_model(tmp_path):
    code, out, err = run("export", FIXTURES / "cslp-v1.cslp")
    assert code == 0, err
    doc = json.loads(out)
    assert doc["format"] == "cslope-analysis" and doc["formatVersion"] == 1
    p = project.read(FIXTURES / "cslp-v1.cslp")
    active = p.active_model
    # the model's own orientation (model-2 faces left), and its options as saved
    assert doc["definition"]["orientation"] == active.data["orientation"] == "rtl"
    assert doc["options"] == active.data["options"]
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
    assert code == 0 and len(json.loads(out)) == 2
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
