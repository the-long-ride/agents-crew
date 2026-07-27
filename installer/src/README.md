# TypeScript Installer Source

## Mission

This folder implements the npm bootstrapper that selects a platform asset, downloads it from GitHub Releases, verifies its checksum, installs the Rust binary, and invokes manager-host plugin generation.

## Files

| File | Mission |
| --- | --- |
| `cli.ts` | Installer entry point and user-visible flow. |
| `args.ts` | Command-line parsing and defaults. |
| `platform.ts` | OS/CPU detection and release-target mapping. |
| `release.ts` | Release asset names and download URL construction. |
| `download.ts` | HTTPS download operations. |
| `checksum.ts` | SHA-256 parsing and verification. |
| `archive.ts` | Platform archive extraction. |
| `install.ts` | Atomic binary installation and host integration calls. |
| `process.ts` | Safe child-process execution. |
| `prompt.ts` | Interactive manager-host selection. |

## Editing rules

Keep Node.js 20 compatibility, avoid shell expansion, verify checksums before extraction, and keep platform naming aligned with `.github/workflows/release.yml`.
