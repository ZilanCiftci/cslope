"""Open a project, change a model, run it again and save it.

    python change_and_rerun.py site.cslp

Each model opens with the result saved in the file. A result whose model
has changed since is out of date: the app marks it so, and a save leaves it
out unless the model is run again.
"""

import sys

import cslope

p = cslope.Project.open(sys.argv[1] if len(sys.argv) > 1 else "site.cslp")
m = p.model("Section A")
print("saved:", m.result.fos, "current:", m.result_is_current)

m.material("Clay").su = 45  # the saved result is now out of date
m.options.method = "Bishop"  # the app's Options, snake_case
print("after the change, current:", m.result_is_current)

r = m.analyze(threads=4)  # as the app runs it; kept on the model
print(f"F {r.fos:.3f} ({r.method}), current: {m.result_is_current}")
p.save()  # back to the same file

for model in p.models:  # every model of a project
    print(model.name, model.result.fos if model.result else "no result")
