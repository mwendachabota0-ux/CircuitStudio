---
name: Vite package firewall
description: Recovery when the Replit package firewall blocks the workspace's locked Vite release.
---

The Replit package firewall rejected the Vite 7.3.7 tarball even though package metadata remained accessible. Vite 8.3.8 installed successfully and was compatible with the workspace's Vite React and Tailwind plugins.

**Why:** A blocked locked tarball can prevent all workspace dependencies from installing, leaving the app workflow unable to find Vite.

**How to apply:** Check the latest Vite release and existing plugin peer ranges, then update the shared workspace catalog and regenerate the lockfile. Do not bypass the package firewall.
