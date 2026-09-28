#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "  SurfInspect: Fetching latest svr-roughness wheel"
echo "=========================================================="

mkdir -p tmp_wheel
rm -f tmp_wheel/*.whl

# 1. Try downloading latest wheel from PyPI
echo "--> Checking PyPI for svr-roughness..."
python3 -m pip download --no-deps svr-roughness -d tmp_wheel/ 2>/dev/null || true

# 2. If not on PyPI or newer release needed, build directly from GitHub repository
if [ -z "$(ls tmp_wheel/*.whl 2>/dev/null)" ]; then
  echo "--> Fetching and building from source repository..."
  rm -rf tmp_svr
  git clone --depth 1 https://github.com/SullivanHart/svr-roughness.git tmp_svr
  python3 -m pip install --upgrade build setuptools setuptools-scm
  python3 -m build --wheel --outdir tmp_wheel/ tmp_svr/
  rm -rf tmp_svr
fi

WHL_FILE=$(ls tmp_wheel/*.whl 2>/dev/null | head -n 1)
if [ -n "$WHL_FILE" ]; then
  cp "$WHL_FILE" ./svr_roughness-latest-py3-none-any.whl
  rm -rf tmp_wheel
  echo "==> Successfully bundled: $WHL_FILE -> svr_roughness-latest-py3-none-any.whl"
else
  echo "ERROR: Could not obtain svr-roughness wheel!" >&2
  exit 1
fi
