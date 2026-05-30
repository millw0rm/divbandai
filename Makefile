.DEFAULT_GOAL := help

.PHONY: help deploy-production

help: ## List available commands.
	@printf 'Available commands:\n'
	@printf '  make deploy-production REGISTRY=<registry/project> [TAG=<tag>] [ANSIBLE_INVENTORY=<path>] [ANSIBLE_EXTRA_ARGS=<args>]\n'
	@printf '      Build, push, and deploy the production control plane via Ansible.\n'

deploy-production: ## Build, push, and deploy the production control plane.
	REGISTRY="$(REGISTRY)" \
	TAG="$(TAG)" \
	ANSIBLE_INVENTORY="$(ANSIBLE_INVENTORY)" \
	ANSIBLE_EXTRA_ARGS="$(ANSIBLE_EXTRA_ARGS)" \
	./scripts/deploy-production.sh
