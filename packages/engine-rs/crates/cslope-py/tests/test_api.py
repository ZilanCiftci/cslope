"""The API of the binding: results of the demo models, threads, progress,
cancellation, errors, the Slope class and the finite element arrays.

Needs only the installed package (no fixtures, no cargo): the wheels
workflow runs it on every wheel as its smoke test.
"""

from __future__ import annotations

import _thread
import array
import math
import threading

import pytest

import cslope
from cslope import examples

# The demo models' factors of safety (Linux x86_64, glibc). Another libm
# may change the last bits, so they are compared within the tolerance
# policy's 1e-6 (PORTING.md). The two with a material boundary drawn 5 cm
# past the outline moved with #93 (PR #95): such an end now crosses the
# outline where the line does, instead of being snapped to the nearest
# point of the sloping face (clay_crust_with_load 1.303919 -> 1.304217 and
# 1.303936 -> 1.304235, two_layer_cut_left 1.833078 -> 1.832632 and
# 1.804630 -> 1.804133).
EXPECTED = {
    ("simple_slope", "Bishop"): 1.6225110637396323,
    ("simple_slope", "Morgenstern-Price"): 1.620713156398642,
    ("slope_with_water_table", "Bishop"): 1.3659823197741354,
    ("slope_with_water_table", "Morgenstern-Price"): 1.3673458256223812,
    ("clay_crust_with_load", "Bishop"): 1.3041718488281702,
    ("clay_crust_with_load", "Morgenstern-Price"): 1.3041768931980282,
    ("two_layer_cut_left", "Bishop"): 1.833429728065641,
    ("two_layer_cut_left", "Morgenstern-Price"): 1.8033185044681899,
}

# The engine's own defaults where the public ones (D-23, analyse without
# options) differ: the values above were computed with them.
ENGINE_DEFAULTS = {"slices": 25, "compositeSurfaces": False}

# A longer search (more batches) for the progress and cancellation tests.
LONG = {"method": "Morgenstern-Price", "iterations": 3000, "refinedIterations": 3000, "slices": 60}


def strip(r):
    r = dict(r)
    r.pop("elapsedMs", None)
    return r


def test_version():
    assert cslope.__version__.count(".") == 2
    assert cslope.ENGINE_BUILD.startswith(cslope.__version__ + "+")


@pytest.mark.parametrize("name,method", sorted(EXPECTED))
def test_examples(name, method):
    r = cslope.analyse(getattr(examples, name)(), {"method": method, **ENGINE_DEFAULTS})
    assert r["method"] == method
    assert math.isclose(r["minFOS"], EXPECTED[(name, method)], rel_tol=1e-6, abs_tol=0)
    assert r["criticalSurface"]["fos"] == r["minFOS"]
    assert r["criticalSlices"] and r["allSurfaces"]
    # Bishop's critical circle of the loaded clay crust enters at 77°; with
    # chord bases (2026-11-10) its steepest slice has N' < 0, which the
    # engine reports. Every other example runs without a warning.
    steep = (name, method) == ("clay_crust_with_load", "Bishop")
    codes = {w["code"] for w in r["warnings"]}
    assert codes == ({"negative-effective-normal", "steep-entry-tension"} if steep else set())


def test_left_sliding_model_in_model_coordinates():
    r = cslope.analyse(examples.two_layer_cut_left())
    s = r["criticalSurface"]
    # the crest is on the right: the slip enters there and exits towards the left
    assert s["entryPoint"][0] > s["exitPoint"][0]
    assert all(0 <= p[0] <= 44 for p in (s["entryPoint"], s["exitPoint"]))


def test_both_directions():
    r = cslope.analyse(examples.simple_slope(), {"method": "Bishop"}, both_directions=True)
    assert r["slidingDirection"] == "ltr"
    assert r["otherDirectionMinFOS"] is None or r["otherDirectionMinFOS"] >= r["minFOS"]


def test_parameter_study_is_monotonic():
    fs = [cslope.analyse(examples.simple_slope(friction_angle=phi), {"method": "Bishop"})["minFOS"] for phi in (20, 25, 30, 35)]
    assert fs == sorted(fs)


@pytest.mark.parametrize("name", examples.ALL)
def test_threads_give_identical_results(name):
    d = getattr(examples, name)()
    runs = [strip(cslope.analyse(d, {"method": "Morgenstern-Price"}, threads=t)) for t in (1, 2, 3, None)]
    for r in runs[1:]:
        assert r == runs[0]


def test_threads_monte_carlo_identical():
    d = examples.simple_slope()
    variables = [{"material": 0, "field": "frictionAngle", "sd": 3.0}, {"material": 0, "field": "cohesion", "sd": 1.5}]
    ro = {"method": "monte-carlo", "samples": 300, "seed": 7}
    a = cslope.reliability(d, {"method": "Bishop"}, variables, ro, threads=1)
    b = cslope.reliability(d, {"method": "Bishop"}, variables, ro, threads=4)
    assert a == b
    assert a["samples"] and 0 <= a["pf"] <= 1


def test_taylor_reliability():
    d = examples.simple_slope()
    variables = [{"material": 0, "field": "frictionAngle", "sd": 3.0}]
    r = cslope.reliability(d, {"method": "Bishop"}, variables, {"method": "taylor"})
    assert r["method"] == "taylor"
    assert math.isclose(r["fos"], EXPECTED[("simple_slope", "Bishop")], rel_tol=1e-6)
    assert r["sdFOS"] > 0 and len(r["terms"]) == 1


def test_threads_invalid():
    with pytest.raises(ValueError):
        cslope.analyse(examples.simple_slope(), threads=0)


def test_progress_events():
    events = []
    r = cslope.analyse(examples.simple_slope(), LONG, progress=events.append)
    assert events, "no progress reported"
    assert {e["kind"] for e in events} == {"search"}
    assert events[0]["phase"] == "first"
    done = [e["done"] for e in events if e["phase"] == "first"]
    assert done == sorted(done)
    # reporting progress does not change the result
    assert strip(r) == strip(cslope.analyse(examples.simple_slope(), LONG))


def test_progress_false_cancels():
    calls = []

    def progress(e):
        calls.append(e)
        return False

    with pytest.raises(cslope.AnalysisCancelled):
        cslope.analyse(examples.simple_slope(), LONG, progress=progress)
    assert len(calls) == 1
    assert issubclass(cslope.AnalysisCancelled, cslope.EngineError)
    assert issubclass(cslope.EngineError, RuntimeError)


def test_progress_none_or_true_continues():
    r = cslope.analyse(examples.simple_slope(), {"method": "Bishop", **ENGINE_DEFAULTS}, progress=lambda e: True)
    assert math.isclose(r["minFOS"], EXPECTED[("simple_slope", "Bishop")], rel_tol=1e-6)


def test_progress_exception_is_raised():
    class Stop(Exception):
        pass

    def progress(e):
        raise Stop("from the callback")

    with pytest.raises(Stop, match="from the callback"):
        cslope.analyse(examples.simple_slope(), LONG, progress=progress)


def test_keyboard_interrupt():
    seen = []

    def progress(e):
        seen.append(e)
        if len(seen) == 1:
            _thread.interrupt_main()  # as Ctrl+C: seen at the next event

    with pytest.raises(KeyboardInterrupt):
        cslope.analyse(examples.simple_slope(), LONG, progress=progress)
    assert len(seen) == 1


def test_cancel_token_from_another_thread():
    token = cslope.CancelToken()
    started = threading.Event()
    outcome = {}

    def work():
        try:
            outcome["result"] = cslope.analyse(examples.simple_slope(), LONG, cancel=token, progress=lambda e: started.set())
        except BaseException as e:  # noqa: BLE001 - the test inspects it
            outcome["error"] = e

    t = threading.Thread(target=work)
    t.start()
    # the analysis runs without the GIL: this thread keeps running
    assert started.wait(30)
    token.cancel()
    t.join(60)
    assert token.cancelled
    assert isinstance(outcome.get("error"), cslope.AnalysisCancelled), outcome


def test_errors_map():
    d = examples.simple_slope()
    # an invalid model -> EngineError, with the engine's message
    d["materials"][0]["model"]["unitWeight"] = 600
    with pytest.raises(cslope.EngineError, match='Material "Soil" has invalid model'):
        cslope.analyse(d)
    # RangeError of the engine -> ValueError
    s = cslope.Slope(examples.simple_slope())
    with pytest.raises(ValueError, match="invalid elastic parameters"):
        s.fem({"elementSize": 3, "materialParameters": {"*": {"poissonsRatio": 0.6}}})
    # a circle that misses the slope -> no valid surface -> EngineError
    d = examples.simple_slope()
    d["customSearchPlanes"] = [{"cx": 200.0, "cy": 200.0, "radius": 1.0}]
    d["customPlanesOnly"] = True
    with pytest.raises(cslope.EngineError):
        cslope.analyse(d)
    # input of the wrong shape -> ValueError
    with pytest.raises(ValueError, match="slope definition"):
        cslope.analyse({"coordinates": "not a list", "materials": []})
    with pytest.raises(ValueError, match="analysis options"):
        cslope.analyse(examples.simple_slope(), "Bishop")


def test_engine_option_error_message():
    with pytest.raises(cslope.EngineError, match="slices"):
        cslope.analyse(examples.simple_slope(), {"slices": float("nan")})


def test_validate_material_model():
    assert cslope.validate_material_model({"kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 5, "frictionAngle": 30}) == []
    errors = cslope.validate_material_model({"kind": "mohr-coulomb", "unitWeight": 19, "cohesion": -5, "frictionAngle": 30})
    assert errors and all(isinstance(e, str) for e in errors)
    assert cslope.validate_material_model({"kind": "no-such-kind"})


def test_to_canonical():
    d = examples.two_layer_cut_left()
    c = cslope.to_canonical(d)
    assert c["orientation"] == "rtl"
    # mirrored about the middle of the model: x' = 44 - x
    assert sorted(x for x, _ in c["coordinates"]) == sorted(44 - x for x, _ in d["coordinates"])
    ltr = cslope.to_canonical(examples.simple_slope())
    # (points come back as tuples, as TypeScript's [x, y] tuple types)
    assert [list(p) for p in ltr["coordinates"]] == examples.simple_slope()["coordinates"]


def test_slope_class():
    s = cslope.Slope(examples.simple_slope())
    assert repr(s) == "Slope(not analysed)"
    with pytest.raises(cslope.EngineError):
        s.result()
    s.update_analysis_options({"method": "Bishop"})
    s.update_analysis_options({"slices": 50})
    assert s.analysis_options["method"] == "Bishop" and s.analysis_options["slices"] == 50
    fos = s.analyse(threads=2)
    assert fos == s.min_fos
    assert s.search[0]["fos"] == fos
    assert len(s.search) >= len(cslope.analyse(examples.simple_slope(), s.analysis_options)["allSurfaces"])
    r = s.result()
    assert r == {**cslope.analyse(examples.simple_slope(), s.analysis_options), "elapsedMs": r["elapsedMs"]}
    assert s.orientation == "ltr"
    # (an unknown method is TypeScript's error, with its message)
    with pytest.raises(cslope.EngineError, match="Method must be one of"):
        s.update_analysis_options({"method": 3})


def test_fem_summary_arrays():
    settings = {
        "enabled": True,
        "flowRule": "associated",
        "youngsModulus": 1e5,
        "poissonsRatio": 0.3,
        "dilationAngle": 0,
        "elementSize": 3,
        "tensionCutoff": False,
        "refinementLevels": 0,
    }
    trials = []
    s = cslope.fem_summary(examples.simple_slope(), settings, progress=trials.append)
    # (the stages, femStage, come between the trials since a720fdc1)
    assert any(t["kind"] == "femTrial" for t in trials)
    assert all(t["kind"] in ("femTrial", "femStage") for t in trials)
    lem = EXPECTED[("simple_slope", "Bishop")]
    assert abs(s["factorOfSafety"] - lem) < 0.15 * lem
    assert isinstance(s["x"], array.array) and s["x"].typecode == "d"
    assert isinstance(s["triangles"], array.array) and len(s["triangles"]) % 3 == 0
    assert len(s["displacement"]) == 2 * len(s["x"])
    lists = cslope.fem_summary(examples.simple_slope(), settings, arrays="list")
    assert lists["x"] == s["x"].tolist() and lists["factorOfSafety"] == s["factorOfSafety"]
    with pytest.raises(ValueError):
        cslope.fem_summary(examples.simple_slope(), settings, arrays="tuple")


def test_fem_numpy():
    np = pytest.importorskip("numpy")
    settings = {"enabled": True, "flowRule": "associated", "youngsModulus": 1e5, "poissonsRatio": 0.3,
                "dilationAngle": 0, "elementSize": 3, "tensionCutoff": False, "refinementLevels": 0}
    s = cslope.fem_summary(examples.simple_slope(), settings, arrays="numpy")
    assert s["x"].dtype == np.float64 and s["triangles"].dtype == np.int64


def test_slope_fem():
    s = cslope.Slope(examples.simple_slope())
    r = s.fem({"elementSize": 3, "flowRule": "associated", "fTolerance": 0.02})
    assert r["factorOfSafety"] > 1
    assert isinstance(r["mesh"]["x"], array.array)
    assert len(r["mesh"]["triangles"]) == 3 * len(r["plasticShearStrain"])
