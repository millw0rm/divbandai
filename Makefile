.DEFAULT_GOAL := help

.PHONY: help infra-preflight kubectl-install kube kube-check deploy-production

help: ## List available commands.
	@printf 'Available commands:\n'
	@printf '  make infra-preflight [ANSIBLE_INVENTORY=<path>] [GITHUB_REPOSITORY=<owner/repo>] [EXPECTED_GITHUB_ACCOUNT=<login>]\n'
	@printf '      Check GitHub, repository, Actions setup, inventory hosts, and VM SSH access.\n'
	@printf '  make kubectl-install [KUBECTL_VERSION=v1.30.14]\n'
	@printf '      Install a repo-local kubectl under .tools/ for k3s operator access.\n'
	@printf '  make kube ARGS="get nodes -o wide"\n'
	@printf '      Run kubectl against infra/ansible/artifacts/kubeconfig.\n'
	@printf '  make kube-check [PROJECT_SLUG=<slug>]\n'
	@printf '      Verify k3s access, platform add-ons, backend kubeconfig hand-off, and optional project resources.\n'
	@printf '  make deploy-production REGISTRY=<registry/project> [TAG=<tag>] [ANSIBLE_INVENTORY=<path>] [ANSIBLE_EXTRA_ARGS=<args>]\n'
	@printf '      Build, push, and deploy the production control plane via Ansible.\n'

infra-preflight: ## Check local GitHub, Actions, inventory, and VM SSH readiness.
	ANSIBLE_INVENTORY="$(ANSIBLE_INVENTORY)" \
	GITHUB_REPOSITORY="$(GITHUB_REPOSITORY)" \
	EXPECTED_GITHUB_ACCOUNT="$(EXPECTED_GITHUB_ACCOUNT)" \
	DIVBAND_PREFLIGHT_SKIP_SSH="$(DIVBAND_PREFLIGHT_SKIP_SSH)" \
	./scripts/preflight-infrastructure.sh

kubectl-install: ## Install repo-local kubectl under .tools/.
	./scripts/install-kubectl.sh

kube: ## Run kubectl against the collected k3s kubeconfig. Example: make kube ARGS="get nodes -o wide"
	./scripts/kubectl-k3s.sh $(ARGS)

kube-check: ## Verify k3s/operator access and optional project resources. Example: make kube-check PROJECT_SLUG=demo
	./scripts/check-k3s-cluster.sh "$(PROJECT_SLUG)"

deploy-production: ## Build, push, and deploy the production control plane.
	REGISTRY="$(REGISTRY)" \
	TAG="$(TAG)" \
	ANSIBLE_INVENTORY="$(ANSIBLE_INVENTORY)" \
	ANSIBLE_EXTRA_ARGS="$(ANSIBLE_EXTRA_ARGS)" \
	./scripts/deploy-production.sh
