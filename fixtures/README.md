# Deterministic Test Fixtures

## Mission

This folder contains local substitutes for external agent tools so tests can exercise process protocols without credentials or network access.

## Files

- `fake-agent.py` accepts bounded worker input and emits deterministic normalized worker results.

## Editing rules

Fixtures must be deterministic, offline, safe to run in CI, and representative of the real adapter contract.
