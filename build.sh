#!/bin/sh
# Build the single self-contained file. This is for handing someone one HTML
# file to open locally; hosting serves the directory (index.html + the JS), so
# a deploy does not need this script.
#
# Everything between the SCRIPTS markers is the loader that fetches the three
# JS files; here they are pasted in instead, so the file needs nothing beside it.
set -e
cd "$(dirname "$0")"
out=dist/hoopla.html
mkdir -p dist
{ sed -n '1,/<!--SCRIPTS-->/p' index.html | sed '$d'
  echo '<script>'
  cat engine.js; echo; cat logic.js; echo; cat ui.js
  echo '</script>'
  sed -n '/<!--\/SCRIPTS-->/,$p' index.html | sed '1d'
} > "$out"
echo "wrote $out"
