#!/usr/bin/env bash
# Builds the Windows installer: build/JewelleryApp-Setup-<version>.exe
# Needs Go (version from server/go.mod), NSIS (makensis) and pandoc. Works on Linux, macOS or Windows (Git Bash).
#   VERSION=1.0.0 ./build.sh
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${VERSION:-1.0.0}"
DIST=build/dist

rm -rf build
mkdir -p "$DIST/docs"

echo "== server (jewellery-server.exe)"
(cd server && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath \
  -ldflags "-s -w -X main.version=$VERSION" -o "../$DIST/jewellery-server.exe" .)

echo "== launcher (JewelleryApp.exe)"
(cd launcher && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath \
  -ldflags "-s -w -H=windowsgui" -o "../$DIST/JewelleryApp.exe" .)

echo "== docs"
for md in docs/*.md; do
  name="$(basename "$md" .md)"
  title="$(head -1 "$md" | sed 's/^# //')"
  nav='<nav class="top"><a href="index.html">JewelleryApp guides</a></nav>'
  [ "$name" = index ] && nav=''
  sed 's/(\([A-Z-]*\)\.md)/(\1.html)/g' "$md" |
    pandoc -f gfm -t html5 -s --metadata pagetitle="$title - JewelleryApp" \
      -H docs/style.html -B <(echo "$nav") -o "$DIST/docs/$name.html"
  cp "$md" "$DIST/docs/"
done

echo "== installer"
makensis -V2 -DVERSION="$VERSION" -DDIST=../build/dist installer/jewelleryapp.nsi
ls -la build/*.exe
