# Role prompts

Agents Crew ships focused prompts for:

- `manager.md` — plans, delegates, reviews, and follows runtime-issued actions
- `planner.md` — decomposes goals into bounded tasks
- `researcher.md` — reads and reports repository facts
- `implementer.md` — performs scoped code changes
- `tester.md` — executes and reports verification
- `reviewer.md` — independently checks correctness and evidence
- `integrator.md` — resolves bounded integration work

Role prompts cannot grant capabilities. The TypeScript policy engine, task envelope, approval state, write scope, and host sandbox remain authoritative.
