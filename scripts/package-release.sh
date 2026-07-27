#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:?usage: package-release.sh <target> <version> [out-dir]}"
VERSION="${2:?usage: package-release.sh <target> <version> [out-dir]}"
OUT_DIR="${3:-dist}"
SOURCE_DIR="${CARGO_TARGET_DIR:-target}/${TARGET}/release"
ASSET="agents-crew-v${VERSION#v}-${TARGET}.tar.gz"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

install -m 0755 "${SOURCE_DIR}/crew" "${STAGE}/crew"
install -m 0755 "${SOURCE_DIR}/agents-crew" "${STAGE}/agents-crew"
install -m 0644 LICENSE "${STAGE}/LICENSE"
mkdir -p "$OUT_DIR"
tar -C "$STAGE" -czf "${OUT_DIR}/${ASSET}" crew agents-crew LICENSE
printf '%s\n' "${OUT_DIR}/${ASSET}"
