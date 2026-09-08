#!/bin/sh
# Build dev/site: a copy of public/ with an import map that swaps the Firebase SDK for the in-memory mock.
cd "$(dirname "$0")"; mkdir -p site
cp ../public/* site/ && cp firebase-mock.js site/
sed -i '' 's#<script type="module" src="/app.js"></script>#<script type="importmap">{"imports":{"https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js":"./firebase-mock.js","https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js":"./firebase-mock.js","https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js":"./firebase-mock.js"}}</script><script type="module" src="/app.js"></script>#' site/index.html
echo "dev site ready in dev/site — serve with: python3 -m http.server 8765 --directory dev/site"
