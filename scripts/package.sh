#!/usr/bin/env bash
# Builds dist/github-qol.zip: just the files Chrome needs, inside a
# github-qol/ folder so "unzip, then Load unpacked" works as-is.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

mkdir -p "$stage/github-qol" dist
cp -r manifest.json src popup "$stage/github-qol/"
mkdir -p "$stage/github-qol/icons"
cp icons/icon-*.png "$stage/github-qol/icons/"

rm -f dist/github-qol.zip
(cd "$stage" && zip -qr "$OLDPWD/dist/github-qol.zip" github-qol)
echo "dist/github-qol.zip (v$version)"
