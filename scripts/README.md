# Scripts

- `build.mjs` strips TypeScript types with Node and copies local UI assets into `dist/`.
- `clean.mjs` removes generated output.
- `typecheck.mjs` uses an available global `tsc`; the build always performs syntax transformation.
- `lint.mjs` checks that Rust/Cargo files are absent and source files do not disable checking.
- `verify-delivery.mjs` validates the npm-native package/release contract.
- `verify-version.mjs` compares a release tag with `package.json`.
- `check-file-lengths.mjs` reports oversized source files.
- `check-lint.mjs` and `check-coverage.mjs` are compatibility wrappers around npm scripts.
