"""The ``cslope`` command: analyze, validate and describe analysis documents.

    cslope analyse slope.json [--json] [--threads N]
    cslope validate slope.json
    cslope schema [name]
    cslope info

Exit status: 0 done, 1 the analysis failed, 2 the input is not valid.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import sys
from typing import Any, Dict, List, Optional, Sequence, TextIO

EXIT_OK = 0
EXIT_ANALYSIS = 1
EXIT_INVALID = 2

# Partial factor keys -> symbols, as the app shows them.
_FACTOR_SYMBOLS = (("cu", "γcu"), ("cohesion", "γc′"), ("tanPhi", "γφ′"), ("variableLoad", "γQ"))


def _utf8(stream: TextIO) -> TextIO:
    """The stream as UTF-8 (model names on Windows consoles)."""
    reconfigure = getattr(stream, "reconfigure", None)
    if reconfigure is not None:
        try:
            reconfigure(encoding="utf-8")
            return stream
        except (ValueError, io.UnsupportedOperation):  # pragma: no cover - unusual streams
            pass
    buffer = getattr(stream, "buffer", None)
    if buffer is not None:  # pragma: no cover - streams without reconfigure
        return io.TextIOWrapper(buffer, encoding="utf-8", line_buffering=True)
    return stream


class _Invalid(Exception):
    """The input is not valid; ``issues`` are path/message dicts."""

    def __init__(self, issues: List[Dict[str, Any]]):
        super().__init__("invalid input")
        self.issues = issues


def _read(path: str) -> Dict[str, Any]:
    from .build import split_document

    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except OSError as e:
        raise _Invalid([{"path": "", "message": "Cannot read {}: {}".format(path, e.strerror or e)}]) from None
    except ValueError as e:
        raise _Invalid([{"path": "", "message": "{} is not valid JSON: {}".format(path, e)}]) from None
    try:
        split_document(doc)
    except (TypeError, ValueError) as e:
        raise _Invalid([{"path": "", "message": str(e)}]) from None
    return doc


def _print_issues(issues: List[Dict[str, Any]], out: TextIO) -> None:
    for i in issues:
        severity = i.get("severity", "error")
        where = " " + i["path"] if i.get("path") else ""
        out.write("{}{}: {}\n".format(severity, where, i.get("message")))


def _errors(issues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [i for i in issues if i.get("severity", "error") == "error"]


def _finite(value: Any) -> Any:
    """``value`` with every non-finite number as None (JSON has no NaN)."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _finite(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_finite(v) for v in value]
    return value


def _fmt_point(p: Any) -> str:
    if not p or len(p) != 2:
        return "?"
    return "({:.2f}, {:.2f})".format(p[0], p[1])


def format_summary(summary: Dict[str, Any]) -> str:
    """The summary as a few lines of text for a person."""
    lines = []
    fos = summary.get("fos")
    label = summary.get("fosLabel", "factor of safety")
    basis = summary.get("valueBasis", "characteristic")
    f_text = "none (no valid slip surface)" if fos is None else "{:.3f}".format(fos)
    lines.append("F {}: {} on {} values".format(f_text, label, basis))
    pf = summary.get("partialFactors")
    if pf:
        factors = ", ".join("{} {:g}".format(sym, pf[k]) for k, sym in _FACTOR_SYMBOLS if k in pf)
        lines.append("Partial factors: {}".format(factors))
    if summary.get("method"):
        lines.append("Method: {}".format(summary["method"]))
    cs = summary.get("criticalSurface")
    if isinstance(cs, dict):
        entry = cs.get("entry", cs.get("entryPoint"))
        exit_ = cs.get("exit", cs.get("exitPoint"))
        lines.append("Critical surface: entry {}, exit {} (m)".format(_fmt_point(entry), _fmt_point(exit_)))
    nc = summary.get("nonConverged")
    if nc:
        lines.append("Surfaces that did not converge: {}".format(nc))
    warnings = summary.get("warnings") or []
    if warnings:
        lines.append("Warnings:")
        lines.extend("- {}".format(w.get("message", w)) for w in warnings)
    else:
        lines.append("Warnings: none")
    if summary.get("engineBuild"):
        lines.append("Engine: {}".format(summary["engineBuild"]))
    return "\n".join(lines) + "\n"


def _cmd_analyse(args: argparse.Namespace, out: TextIO, err: TextIO) -> int:
    import cslope

    from .build import _analyse, _summarize, _validate, split_document

    doc = _read(args.document)
    errors = _errors(_validate(doc))
    if errors:
        raise _Invalid(errors)
    try:
        result = _analyse(doc, threads=args.threads)
    except cslope.EngineError as e:
        err.write("The analysis failed: {}\n".format(e))
        return EXIT_ANALYSIS
    except (TypeError, ValueError) as e:  # the engine could not read the input
        raise _Invalid([{"path": "", "message": str(e)}]) from None
    _, options = split_document(doc)
    summary = _summarize(result, options)
    if args.json:
        json.dump(_finite({"summary": summary, "result": result}), out, ensure_ascii=False, allow_nan=False)
        out.write("\n")
    else:
        out.write(format_summary(summary))
    return EXIT_OK


def _cmd_validate(args: argparse.Namespace, out: TextIO, err: TextIO) -> int:
    import cslope

    from .build import _validate

    doc = _read(args.document)
    if not hasattr(cslope, "validate"):
        err.write("This version of cslope cannot validate; update it.\n")
        return EXIT_ANALYSIS
    issues = _validate(doc)
    _print_issues(issues, out)
    if _errors(issues):
        return EXIT_INVALID
    out.write("Valid{}.\n".format(" (with warnings)" if issues else ""))
    return EXIT_OK


def _cmd_schema(args: argparse.Namespace, out: TextIO, err: TextIO) -> int:
    import cslope

    fn = getattr(cslope, "schema", None)
    if fn is None:
        err.write("This version of cslope has no schemas; update it.\n")
        return EXIT_ANALYSIS
    try:
        schema = fn(args.name) if args.name else fn()
    except (KeyError, ValueError) as e:
        err.write("{}\n".format(e.args[0] if e.args else e))
        return EXIT_INVALID
    json.dump(schema, out, ensure_ascii=False, indent=2)
    out.write("\n")
    return EXIT_OK


def _cmd_info(args: argparse.Namespace, out: TextIO, err: TextIO) -> int:
    import cslope

    out.write("cslope {}\n".format(cslope.__version__))
    out.write("Engine build: {}\n".format(cslope.ENGINE_BUILD))
    out.write("Schema version: {}\n".format(getattr(cslope, "SCHEMA_VERSION", "not available")))
    out.write("Python: {}\n".format(sys.version.split()[0]))
    return EXIT_OK


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="cslope",
        description="Slope stability analysis with the cSlope engine.",
        epilog="Exit status: 0 done, 1 the analysis failed, 2 the input is not valid.",
    )
    sub = p.add_subparsers(dest="command", metavar="command")
    sub.required = True
    a = sub.add_parser("analyse", aliases=["analyze"], help="analyze a document and print the summary")
    a.add_argument("document", help="an analysis document (JSON)")
    a.add_argument("--json", action="store_true", help="print the summary and the full result as JSON")
    a.add_argument("--threads", type=int, default=None, metavar="N", help="threads (default: every core)")
    a.set_defaults(run=_cmd_analyse)
    v = sub.add_parser("validate", help="check a document and list its issues")
    v.add_argument("document", help="an analysis document (JSON)")
    v.set_defaults(run=_cmd_validate)
    s = sub.add_parser("schema", help="print the JSON schema of the input or the result")
    s.add_argument("name", nargs="?", help="the schema's name (default: the analysis document)")
    s.set_defaults(run=_cmd_schema)
    i = sub.add_parser("info", help="print the versions")
    i.set_defaults(run=_cmd_info)
    return p


def main(argv: Optional[Sequence[str]] = None, out: Optional[TextIO] = None, err: Optional[TextIO] = None) -> int:
    """Run the command with ``argv`` (default: the command line); returns the
    exit status."""
    out = out if out is not None else _utf8(sys.stdout)
    err = err if err is not None else _utf8(sys.stderr)
    parser = _parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as e:  # argparse: --help (0) or a usage error (2)
        return int(e.code or 0)
    if getattr(args, "threads", None) is not None and args.threads < 1:
        err.write("--threads must be 1 or more\n")
        return EXIT_INVALID
    try:
        return args.run(args, out, err)
    except _Invalid as e:
        _print_issues(e.issues, err)
        return EXIT_INVALID
    except BrokenPipeError:  # the reader stopped early (| head): not an error
        try:  # and Python must not fail flushing stdout at exit
            devnull = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, sys.stdout.fileno())
        except (OSError, ValueError, io.UnsupportedOperation):  # pragma: no cover
            pass
        return EXIT_OK


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
