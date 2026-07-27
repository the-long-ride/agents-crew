# Installer Tests

## Mission

This folder verifies the compiled npm installer using Node.js built-in tests.

## Files

Tests cover argument parsing, platform mapping, release URLs, checksum validation, and archive safety.

## Running

```bash
npm --prefix installer test
```

Tests import compiled files from `installer/dist`; the package test command builds first.
