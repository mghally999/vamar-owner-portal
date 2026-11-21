#!/usr/bin/env bash
# Installs Chromium for the Playwright tests on a GitHub runner. Run from apps/dashboard.
#
# `playwright install --with-deps` also installs Ubuntu packages through apt, and the Ubuntu
# mirrors are often unreachable from the runners: in 4 of 8 CI runs on 11 Nov 2026 the apt step
# hung until its 5-minute timeout (up to 9 minutes lost per run), after which the browser alone
# was installed and every test passed, because the runner image already carries Chromium's
# libraries. So the browser is installed first (Playwright's CDN, no apt), a real launch checks
# that it starts, and the system packages are installed only when it does not.
set -euo pipefail

npx playwright install chromium

launch() {
  node -e "require('@playwright/test').chromium.launch().then((b) => b.close())"
}

if launch; then
  echo "Chromium starts with the runner's own libraries; no system packages needed."
  exit 0
fi

echo "::warning::Chromium does not start with the runner's libraries; installing system packages"
for attempt in 1 2; do
  # Each attempt is capped: an unreachable mirror makes apt wait for many minutes.
  if timeout 300 npx playwright install-deps chromium; then
    launch
    exit 0
  fi
  echo "system packages failed (attempt $attempt)"
  sleep 15
done
echo "::error::Chromium does not start and its system packages could not be installed"
exit 1
