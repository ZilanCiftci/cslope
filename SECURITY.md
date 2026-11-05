# Security policy

## Reporting a vulnerability

Please report security problems **privately**, never in a public issue or discussion:

- Use GitHub's private reporting: [Report a vulnerability](https://github.com/ZilanCiftci/cslope/security/advisories/new).

Include what you found, how to reproduce it (a proof-of-concept file if relevant) and the version you tested. You will get an acknowledgement within 5 working days, and we aim to ship a fix or a mitigation within 30 days for confirmed issues. We will credit you in the release notes unless you prefer otherwise.

## In scope

- The desktop app (installer, Electron main process, renderer, dialog windows and their IPC).
- File handling: project files (.cslp, .json/.cslope), imports (.gsz, .stix, .sli/.slim/.slmd, DXF, DWG) and drawings (PDF, PNG, JPEG, TIFF): crashes, hangs, excessive memory use or code execution from a crafted file.
- The analysis engine (Rust/WebAssembly) and the Python package.
- The project website.

Wrong analysis results are not security issues: report them with the **Wrong result** issue form.

## Supported versions

During the beta, only the latest release receives fixes.
