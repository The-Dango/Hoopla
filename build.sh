#!/bin/sh
# Build the single self-contained file. This is for handing someone one HTML
# file to open locally; hosting serves the directory (index.html + the JS), so
# a deploy does not need this script.
#
# The icon and manifest links stay relative, so they resolve only when this file
# sits next to the icons/ directory. The game itself does not depend on them.
set -e
out="$(dirname "$0")/dist/hoopla.html"
mkdir -p "$(dirname "$out")"
{ sed 's|<script src="engine.js"></script>||; s|<script src="logic.js"></script>||; s|<script src="ui.js"></script>||' index.html \
    | sed -n '1,/<script>/p'
  cat engine.js; echo; cat logic.js; echo; cat ui.js
  echo '</script></body></html>'
} > "$out"
echo "wrote $out"
