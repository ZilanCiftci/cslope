# Lens: tests

Paths: any change to source code.

- Every new behavior and every fixed bug has a test that fails without the change (read the test and the code; say which assertion would fail).
- Tests query by role and name (testing-library), never by class, color or test id when a role exists.
- No test was skipped, deleted, loosened (a wider tolerance, a removed assertion) or made to pass by changing expected values without a reason in the PR.
- Tests are deterministic: no real timers without fake timers, no order dependence, no network.
