.DEFAULT_GOAL := help

.PHONY: help infra-preflight deploy-production

help: ## List available commands.
	@printf 'Available commands:\n'
	@printf '  make infra-preflight [ANSIBLE_INVENTORY=<path>] [GITHUB_REPOSITORY=<owner/repo>] [EXPECTED_GITHUB_ACCOUNT=<login>]\n'
	@printf '      Check GitHub, repository, Actions setup, inventory hosts, and VM SSH access.\n'
	@printf '  make deploy-production REGISTRY=<registry/project> [TAG=<tag>] [ANSIBLE_INVENTORY=<path>] [ANSIBLE_EXTRA_ARGS=<args>]\n'
	@printf '      Build, push, and deploy the production control plane via Ansible.\n'

infra-preflight: ## Check local GitHub, Actions, inventory, and VM SSH readiness.
	ANSIBLE_INVENTORY="$(ANSIBLE_INVENTORY)" \
	GITHUB_REPOSITORY="$(GITHUB_REPOSITORY)" \
	EXPECTED_GITHUB_ACCOUNT="$(EXPECTED_GITHUB_ACCOUNT)" \
	DIVBAND_PREFLIGHT_SKIP_SSH="$(DIVBAND_PREFLIGHT_SKIP_SSH)" \
	./scripts/preflight-infrastructure.sh

deploy-production: ## Build, push, and deploy the production control plane.
	REGISTRY="$(REGISTRY)" \
	TAG="$(TAG)" \
	ANSIBLE_INVENTORY="$(ANSIBLE_INVENTORY)" \
	ANSIBLE_EXTRA_ARGS="$(ANSIBLE_EXTRA_ARGS)" \
	./scripts/deploy-production.sh
