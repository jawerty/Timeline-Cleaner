#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
MANIFEST_PATH="${ROOT_DIR}/manifest.json"
EXT_NAME_SLUG="timeline-cleaner"

if [[ ! -f "${MANIFEST_PATH}" ]]; then
  echo "manifest.json not found at ${MANIFEST_PATH}" >&2
  exit 1
fi

VERSION="$(python3 -c 'import json, pathlib, sys; data=json.loads(pathlib.Path(sys.argv[1]).read_text()); print(data.get("version","0.0.0"))' "${MANIFEST_PATH}")"

mkdir -p "${DIST_DIR}"

detect_chrome() {
  if [[ -n "${CHROME_BIN:-}" && -x "${CHROME_BIN}" ]]; then
    return 0
  fi

  local candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "google-chrome"
    "chromium"
    "chromium-browser"
  )

  for candidate in "${candidates[@]}"; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      CHROME_BIN="$(command -v "${candidate}")"
      export CHROME_BIN
      return 0
    elif [[ -x "${candidate}" ]]; then
      CHROME_BIN="${candidate}"
      export CHROME_BIN
      return 0
    fi
  done

  return 1
}

if ! detect_chrome; then
  echo "Unable to locate Chrome/Chromium binary. Set CHROME_BIN to the browser executable." >&2
  exit 1
fi

KEY_PATH_DEFAULT="${DIST_DIR}/${EXT_NAME_SLUG}.pem"
KEY_PATH="${KEY_PATH:-${KEY_PATH_DEFAULT}}"

PACK_ARGS=( "--pack-extension=${ROOT_DIR}" )

if [[ -f "${KEY_PATH}" ]]; then
  PACK_ARGS+=( "--pack-extension-key=${KEY_PATH}" )
  echo "Packing extension with existing key ${KEY_PATH}"
else
  echo "Packing extension without key (new key will be generated)."
fi

"${CHROME_BIN}" "${PACK_ARGS[@]}"

RAW_CRX="${ROOT_DIR}.crx"
RAW_PEM="${ROOT_DIR}.pem"

if [[ ! -f "${RAW_CRX}" ]]; then
  echo "Chrome failed to produce ${RAW_CRX}" >&2
  exit 1
fi

OUTPUT_NAME="${EXT_NAME_SLUG}-v${VERSION}.crx"
mv -f "${RAW_CRX}" "${DIST_DIR}/${OUTPUT_NAME}"
echo "CRX saved to dist/${OUTPUT_NAME}"

if [[ -f "${RAW_PEM}" ]]; then
  mv -f "${RAW_PEM}" "${KEY_PATH}"
  echo "Key saved to ${KEY_PATH}"
fi

echo "Done."
