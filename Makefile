# Continuous Evidence — developer and release commands.
# Run `make` or `make help` for the list. Requires GNU make 3.81+, Node and npm.

SHELL := /bin/bash
PACKAGE := continuous-evidence
SEMVER_RE := ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$$

.DEFAULT_GOAL := help
.PHONY: help install build typecheck test bundle smoke check \
	bump tag move-major release-status require-version

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Release flow: make bump VERSION=x.y.z -> PR -> merge -> make tag VERSION=x.y.z"
	@echo "              -> wait for the Release workflow -> make move-major VERSION=x.y.z"

# ---------------------------------------------------------------- daily dev

install: ## Install dependencies exactly from package-lock.json
	npm ci

build: ## Build all workspaces
	npm run build

typecheck: ## Typecheck all workspaces
	npm run typecheck

test: ## Run all workspace tests
	npm test

bundle: ## Rebuild the GitHub Action bundle in action/dist
	npm run build:action

smoke: ## Pack continuous-evidence and smoke-test the tarball
	node scripts/smoke-pack.mjs

check: typecheck test smoke ## Typecheck, test and smoke (run before a PR)

# ------------------------------------------------------------------ release

# VERSION must be given on the command line (not inherited from the
# environment) and must be semver without a leading "v".
require-version:
	@if [ "$(origin VERSION)" != "command line" ]; then \
		echo "error: pass VERSION on the command line, e.g. make $(MAKECMDGOALS) VERSION=0.1.1" >&2; exit 1; \
	fi
	@if ! echo "$(VERSION)" | grep -Eq '$(SEMVER_RE)'; then \
		echo "error: VERSION '$(VERSION)' is not semver (x.y.z or x.y.z-pre, no leading v)" >&2; exit 1; \
	fi

bump: require-version ## Set the package version: make bump VERSION=x.y.z
	@set -e; \
	npm version "$(VERSION)" --workspace $(PACKAGE) --no-git-tag-version; \
	node -e ' \
		const fs = require("node:fs"); \
		const file = "packages/ce/src/version.ts"; \
		const src = fs.readFileSync(file, "utf8"); \
		const re = /export const VERSION = '"'"'[^'"'"']*'"'"';/; \
		if (!re.test(src)) { console.error("error: VERSION constant not found in " + file); process.exit(1); } \
		fs.writeFileSync(file, src.replace(re, "export const VERSION = '"'"'" + process.argv[1] + "'"'"';")); \
	' "$(VERSION)"; \
	npm run build:action; \
	echo ""; \
	echo "Bumped $(PACKAGE) to $(VERSION). Next:"; \
	echo "  make check"; \
	echo "  git checkout -b release/v$(VERSION) && git commit -am 'chore(release): $(VERSION)'"; \
	echo "  open a PR, merge it, then: make tag VERSION=$(VERSION)"

tag: require-version ## Tag origin/main as vX.Y.Z and push it (runs the Release workflow)
	@set -e; \
	tag="v$(VERSION)"; \
	git fetch --quiet origin main; \
	branch="$$(git rev-parse --abbrev-ref HEAD)"; \
	if [ "$$branch" != "main" ]; then echo "error: on branch '$$branch'; switch to main" >&2; exit 1; fi; \
	if [ -n "$$(git status --porcelain)" ]; then echo "error: working tree is not clean" >&2; exit 1; fi; \
	sha="$$(git rev-parse HEAD)"; \
	if [ "$$sha" != "$$(git rev-parse origin/main)" ]; then \
		echo "error: local main ($$sha) differs from origin/main; run git pull" >&2; exit 1; \
	fi; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then echo "error: tag $$tag already exists locally" >&2; exit 1; fi; \
	if [ -n "$$(git ls-remote --tags origin "refs/tags/$$tag")" ]; then echo "error: tag $$tag already exists on origin" >&2; exit 1; fi; \
	dist_tag="$$(node scripts/release-tag.mjs "$$tag")"; \
	echo "About to push $$tag -> $$sha (npm dist-tag: $$dist_tag)."; \
	echo "This starts the Release workflow, which publishes $(PACKAGE)@$(VERSION) to npm."; \
	read -r -p "Push $$tag to origin? [y/N] " answer; \
	if [ "$$answer" != "y" ] && [ "$$answer" != "Y" ]; then echo "aborted"; exit 1; fi; \
	git tag -a "$$tag" -m "$$tag" "$$sha"; \
	git push origin "refs/tags/$$tag"; \
	echo ""; \
	echo "Pushed $$tag. Watch it with: make release-status"; \
	echo "If the run fails after publishing nothing, delete the tag and retry; if npm already"; \
	echo "has $(VERSION), bump to the next patch instead. When it succeeds:"; \
	echo "  make move-major VERSION=$(VERSION)"

move-major: require-version ## Point the major tag (e.g. v0) at vX.Y.Z after a successful release
	@set -e; \
	tag="v$(VERSION)"; \
	case "$(VERSION)" in *-*) echo "error: $(VERSION) is a prerelease; the major tag only follows stable releases" >&2; exit 1;; esac; \
	major="v$${tag#v}"; major="$${major%%.*}"; \
	git fetch --quiet origin main; \
	if [ -z "$$(git ls-remote --tags origin "refs/tags/$$tag")" ]; then echo "error: tag $$tag is not on origin" >&2; exit 1; fi; \
	git fetch --quiet --force origin "refs/tags/$$tag:refs/tags/$$tag"; \
	if ! git merge-base --is-ancestor "$$tag^{commit}" origin/main; then echo "error: $$tag is not on origin/main" >&2; exit 1; fi; \
	published="$$(npm view "$(PACKAGE)@$(VERSION)" version 2>/dev/null || true)"; \
	if [ "$$published" != "$(VERSION)" ]; then \
		echo "error: $(PACKAGE)@$(VERSION) is not on npm yet; wait for the Release workflow (make release-status) and retry" >&2; exit 1; \
	fi; \
	old="$$(git ls-remote origin "refs/tags/$$major" | awk '{print $$1}')"; \
	echo "About to move $$major to $$tag ($$(git rev-parse "$$tag^{commit}"))."; \
	read -r -p "Force-push $$major to origin? [y/N] " answer; \
	if [ "$$answer" != "y" ] && [ "$$answer" != "Y" ]; then echo "aborted"; exit 1; fi; \
	git tag -f -a "$$major" -m "$$major: moving major tag (currently $$tag)" "$$tag^{}"; \
	if [ -n "$$old" ]; then \
		git push --force-with-lease="refs/tags/$$major:$$old" origin "refs/tags/$$major"; \
	else \
		git push origin "refs/tags/$$major"; \
	fi; \
	echo "Moved $$major to $$tag."

release-status: ## Show recent Release workflow runs and npm dist-tags
	@command -v gh >/dev/null || { echo "error: gh (GitHub CLI) is required" >&2; exit 1; }
	gh run list --workflow release.yml --limit 5
	npm view $(PACKAGE) dist-tags
