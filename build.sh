#!/bin/sh
# Build the single self-contained file that gets published or hosted.
{ sed 's|<script src="engine.js"></script>||; s|<script src="logic.js"></script>||; s|<script src="ui.js"></script>||' index.html \
    | sed -n '1,/<script>/p'
  cat engine.js; echo; cat logic.js; echo; cat ui.js
  echo '</script></body></html>'
} > hoopla.html
