#!/bin/sh
# Volumes (Railway, Docker named volumes, etc.) mount fresh at container
# start with root ownership, overwriting whatever chown happened at image
# build time — so /app/data ends up unwritable by the non-root "app" user
# every time, even though the Dockerfile already chowned it once. Fix
# ownership here, after the mount but before the app runs, then drop
# privileges for the actual process.
mkdir -p /app/data /app/logs
chown -R app:app /app/data /app/logs
exec su app -c "node server.js"
