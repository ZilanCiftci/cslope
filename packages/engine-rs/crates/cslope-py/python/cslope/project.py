"""Open, change and save cSlope project files (.cslp).

A ``.cslp`` file is a ZIP archive (the specification is docs/file-format.md
in the repository)::

    manifest.json                  the format and its version, who wrote the file and when
    project.json                   schema version, the models' order, the active model, units
    models/<id>/model.json         one model, without the outcome of its run
    models/<id>/result.json        the outcome of its run (optional), with the hash of its input
    models/<id>/backgrounds.json   the drawings placed under it (optional)
    assets/index.json              the attachments (optional)
    assets/<id>.<ext>              the attachments themselves
    thumbnail.png                  a small picture of the active model's result (optional)

``Project.open(path)`` (or ``open(path)``) reads one with the engine's
reader (the crate cslope-project); ``Project()`` is a new one. Its models
are ``cslope.Model`` objects (cslope/model.py): build, change and run them
with the app's names; ``model.data`` is the model's dict as the app holds it
after opening the file (missing members filled, out-of-range values
clamped, as the app does), in the app's JSON shape (camelCase keys).
``Project.save(path)`` writes what the app would write, so the app opens it
as it was saved.

::

    import cslope
    p = cslope.Project.open("slope.cslp")
    m = p.model("Section A")
    m.material("Clay").c = 12
    print(m.result_is_current)    # False
    m.analyse()
    p.save()

The reader is strict, unlike the app's: a file the app saved with this
schema version opens; a file of an earlier version (a JSON project, the
first .cslp layout, an older schema) is refused with a message to open it
in the app and save it (the app migrates it), a newer one with a message to
update; a member or entry the format does not define is an error naming
it, never carried over. A model dict changed in Python is checked the same
way when the project is saved. A saved result the reader cannot read (one
a newer cSlope wrote with a member this version does not know) is left out
with a warning; the model opens without it.

Results: a result belongs to the input it was computed for (its
``inputHash``). A model whose input changed since its result keeps no
result when the project is saved, and the project then drops its
thumbnail, unless the model was run again (``Model.analyse``;
``cslope analyse site.cslp --write`` does it for you).
"""

from __future__ import annotations

import builtins
import hashlib
import os
import warnings
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, Union

from . import _native  # type: ignore[attr-defined]
from .model import Model

__all__ = [
    "FORMAT",
    "FORMAT_VERSION",
    "SCHEMA_VERSION",
    "Asset",
    "Model",
    "Placement",
    "Project",
    "open",
    "read",
]

#: The manifest's ``format``.
FORMAT = "cslope-project"
#: The layout this package reads and writes (the app's ``CSLP_FORMAT_VERSION``).
FORMAT_VERSION: int = _native.PROJECT_FORMAT_VERSION
#: The project schema version it reads and writes (the app's ``PROJECT_FILE_VERSION``).
SCHEMA_VERSION: int = _native.PROJECT_SCHEMA_VERSION

_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/tiff": "tif",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "image/vnd.dwg": "dwg",
    "image/vnd.dxf": "dxf",
}


@dataclass
class Asset:
    """An attachment (an entry of ``assets/index.json``)."""

    id: str
    mime: str
    original_name: str
    added_at: str
    data: bytes = field(repr=False, default=b"")

    @property
    def path(self) -> str:
        return "assets/{}.{}".format(self.id, _EXTENSIONS.get(self.mime.lower(), "bin"))

    @property
    def bytes(self) -> int:
        return len(self.data)

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


@dataclass
class Placement:
    """A drawing placed under a model (an entry of ``backgrounds.json``).

    The drawing's own coordinates (``source``: pixels of an image, points of a
    PDF page, origin at the top left, y downwards; a DWG or DXF drawing's
    model space coordinates with y turned downwards, ``(x, -y)``) map to the
    model's (m, y upwards) by the affine ``transform`` ``(a, b, c, d, e, f)``:
    ``x = a*u + c*v + e``, ``y = b*u + d*v + f``.
    """

    id: str
    asset_id: str
    transform: Tuple[float, float, float, float, float, float]
    #: ``mode`` ("points", "axes", "scale" or "drawing") and its inputs.
    calibration: Dict[str, Any]
    opacity: float = 1.0
    visible: bool = True
    order: float = 0
    #: The PDF page (1-based), or None (the first page).
    page: Optional[int] = None
    #: The part of the page shown, ``(x0, y0, x1, y1)`` in source units, or None (the whole page).
    crop: Optional[Tuple[float, float, float, float]] = None
    name: Optional[str] = None
    show_in_results: bool = False
    #: Locked on the canvas (the model's ``locks.backgrounds``).
    locked: bool = False
    #: A DWG or DXF drawing: the names of its layers not shown.
    hidden_layers: Tuple[str, ...] = ()

    def to_model(self, u: float, v: float) -> Tuple[float, float]:
        """The model point (m) of a point of the drawing."""
        a, b, c, d, e, f = self.transform
        return (a * u + c * v + e, b * u + d * v + f)


class Project:
    """A project: its models, attachments and thumbnail.

    ``Project()`` is a new, empty project; ``Project.open(path)`` (or
    ``cslope.project.open``) opens a ``.cslp`` file. ``save(path)`` writes
    what the app would write.

    ::

        p = Project()
        m = p.add_model("Section A")
        ...                                                # build m (see cslope.Model)
        p.save("site.cslp")
    """

    def __init__(self) -> None:
        #: ``manifest.json`` (written again on save).
        self.manifest: Dict[str, Any] = {
            "format": FORMAT,
            "formatVersion": FORMAT_VERSION,
            "minReaderVersion": 1,
            "appVersion": "",
            "created": "",
            "modified": "",
            "generator": "",
        }
        #: The models, in the app's order (``add_model``, ``remove_model``).
        self.models: List[Model] = []
        self.assets: List[Asset] = []
        #: ``thumbnail.png``'s bytes, or None.
        self.thumbnail_png: Optional[bytes] = None
        self.active_model_id = ""
        #: The project schema version (``project.json`` ``version``).
        self.version: int = SCHEMA_VERSION
        self.units = "SI"
        #: The layout read; only "cslp" (this one) is read.
        self.layout = "cslp"
        #: The file it was opened from or last saved to, or None.
        self.path: Optional[str] = None

    def __repr__(self) -> str:
        return "Project({})".format(", ".join(repr(m.name) for m in self.models))

    @classmethod
    def open(cls, path: Union[str, "os.PathLike[str]"]) -> "Project":  # noqa: A003
        """Open a ``.cslp`` file (``cslope.project.open``)."""
        return _open(path)

    # ── models ──

    def model(self, name: str) -> Model:
        """The model of this name (an error when there are none or several)."""
        found = [m for m in self.models if m.name == name]
        if len(found) != 1:
            names = ", ".join(repr(m.name) for m in self.models)
            raise KeyError("{} models are named {!r} (the models: {})".format(len(found), name, names))
        return found[0]

    def model_named(self, name: str) -> Model:
        """``model(name)`` (kept for earlier code)."""
        return self.model(name)

    def _by_id(self, model_id: str) -> Model:
        for m in self.models:
            if m.id == model_id:
                return m
        raise KeyError(model_id)

    def add_model(self, model: Union[str, Model], orientation: str = "ltr") -> Model:
        """Add a new, empty model of this name (or the ``Model`` given) and
        return it; the first model added becomes the active one."""
        m = Model(model, orientation) if isinstance(model, str) else model
        if not isinstance(m, Model):
            raise TypeError("add_model takes a name or a Model, not {!r}".format(model))
        if any(x is m for x in self.models):
            raise ValueError("{!r} is in the project already".format(m))
        if m._project is not None:
            raise ValueError("{!r} is a model of another project; remove it there first".format(m))
        if any(x.name == m.name for x in self.models):
            raise ValueError("A model named {!r} exists already".format(m.name))
        used = {x.id for x in self.models}
        if not m.id or m.id in used:
            n = len(self.models) + 1
            while "model-{}".format(n) in used:
                n += 1
            m.data["id"] = "model-{}".format(n)  # the input hash does not include the id: a result stays
        self.models.append(m)
        m._project = self
        if not self.active_model_id:
            self.active_model_id = m.id
        return m

    def remove_model(self, model: Union[str, Model]) -> None:
        """Remove a model (by name or the ``Model``)."""
        m = self.model(model) if isinstance(model, str) else model
        self.models = [x for x in self.models if x is not m]
        m._project = None
        if self.active_model_id == m.id:
            self.active_model_id = self.models[0].id if self.models else ""

    @property
    def active_model(self) -> Model:
        """The model the app shows when it opens the project."""
        return self._by_id(self.active_model_id)

    @active_model.setter
    def active_model(self, model: Union[str, Model]) -> None:
        m = self.model(model) if isinstance(model, str) else model
        if not any(x is m for x in self.models):
            raise ValueError("{!r} is not a model of this project".format(m))
        self.active_model_id = m.id

    # ── attachments ──

    def asset(self, asset_id: str) -> Asset:
        for a in self.assets:
            if a.id == asset_id:
                return a
        raise KeyError(asset_id)

    def read_asset(self, asset_id: str) -> bytes:
        """An attachment's bytes (checked against the index's SHA-256 when the file was opened)."""
        return self.asset(asset_id).data

    def thumbnail(self) -> Optional[bytes]:
        """``thumbnail.png``, or None without one."""
        return self.thumbnail_png

    def placements(self, model: Union[Model, str]) -> List[Placement]:
        """The drawings placed under a model (by name or the ``Model``), in
        drawing order (as the app reads them: an entry of the first form is
        converted to the affine transform)."""
        m = self.model(model) if isinstance(model, str) else model
        locks = m.data.get("locks") or {}
        locked = set(locks.get("backgrounds") or [])
        out = []
        for b in m.backgrounds:
            t = b["transform"]
            crop = b.get("crop")
            out.append(
                Placement(
                    id=b["id"],
                    asset_id=b["assetId"],
                    transform=tuple(float(t[k]) for k in "abcdef"),  # type: ignore[arg-type]
                    calibration=b["calibration"],
                    opacity=float(b["opacity"]),
                    visible=bool(b["visible"]),
                    order=b["order"],
                    page=int(b["page"]) if b.get("page") is not None else None,
                    crop=(crop["x0"], crop["y0"], crop["x1"], crop["y1"]) if crop else None,
                    name=b.get("name"),
                    show_in_results=b.get("showInResults") is True,
                    locked=b["id"] in locked,
                    hidden_layers=tuple(b.get("hiddenLayers") or ()),
                )
            )
        return sorted(out, key=lambda p: p.order)

    # ── saving ──

    def save(self, path: Union[str, "os.PathLike[str]", None] = None) -> Dict[str, Any]:
        """Write the project to ``path`` (default: the file it was opened
        from or last saved to), atomically (a temporary file renamed over
        it), as the app writes it, after the save policy: a model whose
        input changed since its result keeps no result, and then the
        thumbnail goes too. Returns ``{"droppedResults": [model ids],
        "droppedThumbnail": bool}``; the project in memory follows."""
        from . import __version__

        if path is None:
            if self.path is None:
                raise ValueError("Give the path: the project was not opened from a file")
            path = self.path
        if not self.models:
            raise ValueError("A project needs at least one model")
        for m in self.models:
            m._need_ready("saving the project")
        doc = {
            "manifest": self.manifest,
            "activeModelId": self.active_model_id,
            "models": [{"id": m.id, "model": m.data, "result": m._saved, "backgrounds": m.backgrounds} for m in self.models],
            "assets": [{"id": a.id, "mime": a.mime, "originalName": a.original_name, "addedAt": a.added_at} for a in self.assets],
        }
        bad = _lone_surrogate(doc, "")
        if bad is not None:
            raise ValueError("{} holds a lone surrogate (text that is not valid Unicode); a project file is UTF-8".format(bad or "the project"))
        report = _native.project_write(
            doc,
            {a.id: a.data for a in self.assets},
            self.thumbnail_png,
            os.fspath(path),
            __version__,
            "cslope {} (Python)".format(__version__),
        )
        self.manifest = report["manifest"]
        self.path = os.fspath(path)
        for model_id in report["droppedResults"]:
            self._by_id(model_id)._saved = None
        if report["droppedThumbnail"]:
            self.thumbnail_png = None
        return {"droppedResults": list(report["droppedResults"]), "droppedThumbnail": report["droppedThumbnail"]}

    def close(self) -> None:
        """Nothing to release (the file is read whole); kept for ``with``."""

    def __enter__(self) -> "Project":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def _lone_surrogate(value: Any, path: str) -> Optional[str]:
    """The path of the first string (or key) in ``value`` that cannot be UTF-8, or None."""
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            return path
        return None
    if isinstance(value, dict):
        for k, v in value.items():
            p = "{}.{}".format(path, k) if path else str(k)
            if isinstance(k, str) and _lone_surrogate(k, p) is not None:
                return p
            found = _lone_surrogate(v, p)
            if found is not None:
                return found
    elif isinstance(value, (list, tuple)):
        for i, v in enumerate(value):
            found = _lone_surrogate(v, "{}[{}]".format(path, i))
            if found is not None:
                return found
    return None


def open(path: Union[str, "os.PathLike[str]"]) -> Project:  # noqa: A001 - the module's verb
    """Open a ``.cslp`` project file saved by the cSlope app (this schema version).

    Raises ``ValueError`` with a message for a file it does not read (an
    earlier or newer version, an unknown member, a damaged archive) and
    ``OSError`` when the file cannot be read."""
    return _open(path, stacklevel=3)


def _open(path: Union[str, "os.PathLike[str]"], stacklevel: int = 4) -> Project:
    doc, data, thumbnail = _native.project_read(os.fspath(path))
    # a result.json this reader cannot read (damaged, or with a member a
    # newer cSlope added) is left out; the model opens without it
    for message in doc.get("warnings") or []:
        warnings.warn(message, stacklevel=stacklevel)
    p = Project()
    p.manifest = doc["manifest"]
    p.models = [Model._of(m["model"], m.get("result"), list(m.get("backgrounds") or [])) for m in doc["models"]]
    for m in p.models:
        m._project = p
    p.assets = [Asset(a["id"], a["mime"], a["originalName"], a["addedAt"], builtins.bytes(data[a["id"]])) for a in doc["assets"]]
    p.thumbnail_png = builtins.bytes(thumbnail) if thumbnail is not None else None
    p.active_model_id = doc["activeModelId"]
    p.path = os.fspath(path)
    return p


def read(path: Union[str, "os.PathLike[str]"]) -> Project:
    """Deprecated alias of ``open`` (``read`` read the files with the standard
    library, as they were; ``open`` reads them as the app does and refuses
    earlier versions: open those in the app and save them)."""
    warnings.warn("cslope.project.read is deprecated; use cslope.project.open", DeprecationWarning, stacklevel=2)
    return open(path)
