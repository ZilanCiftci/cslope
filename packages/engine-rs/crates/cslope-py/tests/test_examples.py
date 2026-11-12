"""Every example file runs as a reader would run it.

The website's Python and agent pages include these files as they are
(packages/website/src/docs/python.mdx and agents.mdx), so an example that
stops working fails here, not on the site. Each runs as a script in a
temporary folder (what it writes stays there), in the order a reader
follows: new_project.py writes the site.cslp that the next two open.
"""

from __future__ import annotations

import csv
import json
import runpy
import shutil
import sys
from pathlib import Path

import pytest

import cslope

CRATE = Path(__file__).resolve().parents[1]
EXAMPLES = CRATE / "examples"
SKILL_EXAMPLES = Path(__file__).resolve().parents[5] / "skills" / "cslope" / "examples"

# The crate's examples, each with its arguments, in the order they run.
CRATE_EXAMPLES = [
    ("new_project.py", []),
    ("change_and_rerun.py", ["site.cslp"]),
    ("read_results.py", ["site.cslp"]),
    ("parameter_study.py", []),
]

needs_examples = pytest.mark.skipif(not EXAMPLES.is_dir(), reason="the examples are not in this checkout")
needs_skill_examples = pytest.mark.skipif(
    not SKILL_EXAMPLES.is_dir(), reason="the skill's examples are not in this checkout"
)


def run_script(path: Path, args, monkeypatch, capsys) -> str:
    """Runs ``path`` as ``python path *args`` in the current folder; its output."""
    monkeypatch.setattr(sys, "argv", [str(path), *args])
    try:
        runpy.run_path(str(path), run_name="__main__")
    except SystemExit as e:
        assert e.code in (None, 0), "{} exited with {}".format(path.name, e.code)
    return capsys.readouterr().out


@needs_examples
def test_every_example_is_run():
    assert sorted(p.name for p in EXAMPLES.glob("*.py")) == sorted(name for name, _ in CRATE_EXAMPLES)


@needs_examples
def test_the_examples_in_order(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    out = {name: run_script(EXAMPLES / name, args, monkeypatch, capsys) for name, args in CRATE_EXAMPLES}

    # new_project.py: a project the app opens with its result current
    assert out["new_project.py"].startswith("F 1.140 ")
    assert "factor of safety, Morgenstern-Price" in out["new_project.py"]

    # change_and_rerun.py: the change makes the result out of date; the run makes it current
    lines = out["change_and_rerun.py"].splitlines()
    assert lines[0].endswith("current: True")
    assert lines[1] == "after the change, current: False"
    assert lines[2] == "F 1.279 (Bishop), current: True"
    p = cslope.Project.open(tmp_path / "site.cslp")
    m = p.model("Section A")
    assert m.result_is_current and m.material("Clay").su == 45
    assert abs(m.result.fos - 1.2785931420775443) < 1e-6

    # read_results.py: the saved result and the slice table
    assert "factor of safety Bishop" in out["read_results.py"]
    assert out["read_results.py"].rstrip().splitlines()[-1] == cslope.ENGINE_BUILD
    with open(tmp_path / "slices.csv", encoding="utf-8", newline="") as f:
        rows = list(csv.reader(f))
    assert len(rows) > 30 and rows[0] == ["Model", "Section A"]

    # parameter_study.py: a table of F against phi'
    assert "Morgenstern-Price" in out["parameter_study.py"]


@needs_skill_examples
@pytest.mark.parametrize("path", sorted(SKILL_EXAMPLES.glob("*.py")), ids=lambda p: p.stem)
def test_skill_example_as_a_script(path, tmp_path, monkeypatch, capsys):
    """``python examples/<name>.py`` writes the document next to it (here a
    copy) and analyzes it with the command; the document is the committed one."""
    copy = tmp_path / path.name
    shutil.copy(path, copy)
    monkeypatch.chdir(tmp_path)
    out = run_script(copy, [], monkeypatch, capsys)
    assert out.startswith("F "), out
    written = json.loads(copy.with_suffix(".json").read_text(encoding="utf-8"))
    assert written == json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))


def test_analyze_and_analyse_are_the_same():
    """``analyze`` is the name the docs use; ``analyse`` stays as an alias."""
    assert cslope.analyze is cslope.analyse
    assert {"analyze", "analyse"} <= set(cslope.__all__)
    assert cslope.Model.analyze is cslope.Model.analyse
