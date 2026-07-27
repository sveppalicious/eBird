#!/bin/sh
# Serve the site locally. Opening site/index.html straight from disk will not
# work: browsers block fetch() of local JSON over file://, and the site loads
# all of its data that way.
exec python3 "$(dirname "$0")/serve.py" "${1:-8777}"
