# Native installer validation

These standalone tests exercise installed Akashic binaries on disposable standard
GitHub-hosted Windows and Ubuntu runners. They do not require local VM storage,
make the private application source public, or publish an application release.

The workflows currently live on `codex/public-installer-validation`. A push to a
workflow or its matching harness starts that workflow. Read the workflow's exact
matrix before dispatch: investigation runs may target Windows only.

## Suites

- `public-installer-validation.yml`: public download availability, published
  checksum, native installation, onboarding, interactive composer, normal quit
  and restart, profile and theme persistence.
- `real-model.yml`: public installer, custom-provider onboarding, real model
  response, saved conversation, and installed-runtime extension checks. It records
  automatic conversation restoration separately from opening saved history.
- `candidate-upgrade.yml`: existing private 9001/9002 candidates, real updater
  download, HTTP failure, SHA-512 rejection, retry, independent-worker refusal,
  normal worker exit, visible installation confirmation, automatic new-version
  startup and retained state. Its loopback feed is deliberately not production.
- `windows-gate-diagnostic.yml`: disposable instrumentation of the safety gate.
  It records why a worker was excluded or blocked without bypassing that gate.

## Temporary test inputs

`VM_MODEL_URL` and `VM_MODEL_KEY` must refer to a dedicated, authenticated model
endpoint with no personal data or administrative routes. Never supply a user's
account credential. Revoke both secrets and shut down the endpoint after testing.

`UPGRADE_WINDOWS_ASSET_URL` and `UPGRADE_LINUX_ASSET_URL` are short-lived artifact
download URLs for previously built candidates. The workflow verifies the fixed
ZIP digest before extraction. Renew an expired link before dispatch; do not copy
a general source-repository token into this public repository. Remove the
secrets after testing. Candidate installers must never be published to users.

## Evidence and limits

Each job uploads receipts, native logs, screenshots and recordings for three
days. A green job alone is insufficient: inspect `receipt.json`, the actual
recording and platform-specific limitations. Preserve failed attempts as evidence.

The public alpha.0 packages have updating disabled. Candidate update success
cannot change that. Public-feed delivery, code signing, SmartScreen reputation,
Windows 10/11 desktop behavior and desktop Linux authorization prompts require
separate release-environment checks. The extension suite tests synthetic skill
and plugin fixtures through production handlers plus real stdio and HTTPS MCP
calls; it is not a test of every plugin, OAuth account or browser-control tool.

Do not execute the installed Python runtime while its installer replaces it.
Post-handoff diagnostics must use the runner's Python so instrumentation does not
hold application files open. Never weaken worker protection to pass a test.
