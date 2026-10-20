# Test policy

Starter policy, copied from the orch skill's `templates/TEST-POLICY.md`. Edit it, then freeze it: the
text below is yours. Acceptance criteria in `.orch/tasks/*.md` stay binding and untouched: the AC is
the spec. This policy governs HOW MUCH testing an AC costs, not whether it gets verified. It binds
implementers (authoring), test-planner (matrix granularity) and the verify-coordinator (test-quality audit standard).

1. **One test per AC: the cheapest test that would fail if the AC were broken.**
   No case matrices. One representative happy path, plus only those edge cases the AC names
   explicitly. If the AC does not name an edge, it is not tested.

2. **A mechanism is tested once; its variants shift to `code` modality.**
   When several named variants (degrade reasons, error names, dispatch keys) share one
   fallback/dispatch mechanism, tests prove the mechanism on 1 or 2 representatives. The remaining
   variants are verified by the reviewer reading the diff (modality `code`), not by additional
   tests. The AC still binds; only the verification modality of the variants changes.

3. **Test at the seams, not the internals.**
   Assert at route / wire-body / public-module level. Private helpers reachable through a seam get
   no dedicated tests. Pure standalone modules are the exception: test them directly.

4. **Never assert your own mock.**
   A test whose only assertion is that a mock was called as configured proves nothing and must not
   be written. Mocks are legitimate as isolation (fake engine, fake clock), never as the assertion
   target.

5. **A green existing suite is free verification.**
   "Existing suite X stays green" satisfies its AC with zero new tests. New tests cover NEW
   behaviour only; never duplicate what an existing test already pins.

6. **UI tests assert the DOM/behaviour contract, not markup.**
   Assert visible text, presence/absence of content, and user-observable behaviour. Never assert
   class names, element structure, or styling.

7. **Every binding rule of CLAUDE.md has a test or a `standing_checks_extra` row.**
   A task that adds a binding rule (a "never", "always", "must" or "only" in CLAUDE.md / AGENTS.md) adds its check in the same branch.
   The check is a test that pins the rule, or a row in `standing_checks_extra` with a concrete tool recipe.
   A rule that no tool can check is marked as prose in the review, not left silently unchecked.

## Precedence

Where this policy conflicts with an agent definition's default test expectations (mandatory
floors, every-code-path matrices, mutant sweeps), the policy wins. Where a task file's AC
explicitly demands a specific test, the AC wins.
