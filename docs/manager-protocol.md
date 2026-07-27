# Manager Protocol

The installed host is a manager interface, not the workflow authority.

1. `manager start` creates a durable run and a one-time planning action.
2. `manager step` returns outstanding actions and compact run state.
3. The host performs only those actions.
4. `manager submit` validates the action ID, task ID, capability envelope, and normalized JSON result.
5. Consumed, forged, stale, or capability-expanding submissions fail.

Native dispatch actions include role, model, fallback rule, workspace, context path, output schema, and capabilities. A host that cannot satisfy exact-model routing must fail clearly when fallback is denied.


Manager actions expire after 24 hours. Expired unconsumed actions remain visible in `status` under `expired_actions`; the run becomes `blocked` so the operator can inspect possible partial workspace changes before starting fresh work.
