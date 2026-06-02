.DEFAULT_GOAL := help
INVENTORY ?= infra/ansible/inventory.yml
ANSIBLE_PLAYBOOK ?= .venv-ansible/bin/ansible-playbook
ANSIBLE_LOCAL_TEMP ?= /tmp/ansible-local
ANSIBLE_REMOTE_TEMP ?= /tmp/ansible-remote
KIND ?= static
API_HOST ?= 127.0.0.1
API_PORT ?= 8080

.PHONY: help up down restart ps logs smoke project project-delete api test-api test-all test-ci setup-ansible-sudo setup-github-actions install-vps-deploy vps-deploy ansible-local ansible-local-validate ansible-remote ansible-remote-arvan ansible-remote-revert ansible-remote-validate ansible-remote-validate-revert ansible-arvan ansible-revert ansible-validate-arvan ansible-validate-revert ansible-toggle-smoke

help:
	@printf 'Available commands:\n'
	@printf '  make up       Start HAProxy and test Nginx\n'
	@printf '  make down     Stop and remove containers\n'
	@printf '  make restart  Recreate the stack\n'
	@printf '  make ps       Show container status\n'
	@printf '  make logs     Follow container logs\n'
	@printf '  make smoke    Verify Divband public host routing locally\n'
	@printf '  make test-api Run Python unit tests\n'
	@printf '  make test-ci  Install CI deps and run unit tests (matches GitHub Actions)\n'
	@printf '  make test-all Run unit tests, smoke checks, and local Ansible validation\n'
	@printf '  make setup-ansible-sudo\n'
	@printf '      Install passwordless sudo for local Ansible playbooks (run once)\n'
	@printf '  make setup-github-actions\n'
	@printf '      Configure webhook deploy secrets on GitHub via gh CLI\n'
	@printf '  make install-vps-deploy\n'
	@printf '      Install pull-deploy webhook on the VPS (run on server with sudo)\n'
	@printf '  make project NAME=test\n'
	@printf '      Create or refresh a project and route NAME.divbandai.ir; set KIND=nextjs for Next.js\n'
	@printf '  make project-delete NAME=test\n'
	@printf '      Delete a project, regenerate routing, and clean up containers\n'
	@printf '  make api\n'
	@printf '      Run the local project creation API on API_HOST:API_PORT\n'
	@printf '  make ansible-local\n'
	@printf '      Install Docker if needed, render configs, and run the local stack\n'
	@printf '  make ansible-local-validate\n'
	@printf '      Validate Docker, Compose, HAProxy, and routing on localhost\n'
	@printf '  make ansible-remote INVENTORY=infra/ansible/inventory.yml\n'
	@printf '      Install Docker and deploy the VPS stack (no Arvan/DNS)\n'
	@printf '  make ansible-remote-arvan INVENTORY=infra/ansible/inventory.yml\n'
	@printf '      Same as ansible-remote plus Arvan mirror/registry and image prefixes\n'
	@printf '  make ansible-remote-revert INVENTORY=infra/ansible/inventory.yml\n'
	@printf '      Remove Arvan mirror/host pins and redeploy with normal image names\n'
	@printf '  make ansible-remote-validate INVENTORY=infra/ansible/inventory.yml\n'
	@printf '      Validate the VPS is in Arvan mode and serving traffic\n'
	@printf '  make ansible-remote-validate-revert INVENTORY=infra/ansible/inventory.yml\n'
	@printf '      Validate the VPS is in non-Arvan mode and serving traffic\n'
	@printf '  make ansible-toggle-smoke INVENTORY=infra/ansible/inventory.yml\n'
	@printf '      Run destructive on/off/on toggle validation; requires CONFIRM=true\n'

up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose up -d --force-recreate

ps:
	docker compose ps

logs:
	docker compose logs -f

smoke:
	scripts/smoke-projects.sh

project:
	@test -n "$(NAME)" || (printf 'NAME is required, e.g. make project NAME=test\n' >&2; exit 2)
	scripts/create-project.py "$(NAME)" --kind "$(KIND)"

project-delete:
	@test -n "$(NAME)" || (printf 'NAME is required, e.g. make project-delete NAME=demo\n' >&2; exit 2)
	scripts/delete-project.py "$(NAME)"

test-api:
	python3 -m unittest discover -s tests -p 'test_*.py' -v

test-ci:
	@test -x .venv-ci/bin/pip || python3 -m venv .venv-ci
	.venv-ci/bin/pip install -q -r requirements-ci.txt
	.venv-ci/bin/python -m unittest discover -s tests -p 'test_*.py' -v

test-all: test-api smoke ansible-local-validate

setup-ansible-sudo:
	scripts/setup-ansible-sudo.sh

setup-github-actions:
	scripts/setup-github-actions.sh

install-vps-deploy:
	scripts/install-vps-deploy.sh

vps-deploy:
	@test -n "$(SHA)" || (printf 'SHA is required, e.g. make vps-deploy SHA=$(git rev-parse HEAD)\n' >&2; exit 2)
	bash scripts/vps-deploy.sh "$(SHA)"

api:
	DIVBAND_API_HOST="$(API_HOST)" DIVBAND_API_PORT="$(API_PORT)" scripts/project-api.py

ansible-local:
	ANSIBLE_LOCAL_TEMP="$(ANSIBLE_LOCAL_TEMP)" ANSIBLE_REMOTE_TEMP="$(ANSIBLE_REMOTE_TEMP)" \
	"$(ANSIBLE_PLAYBOOK)" infra/ansible/playbooks/local-docker.yml

ansible-local-validate:
	ANSIBLE_LOCAL_TEMP="$(ANSIBLE_LOCAL_TEMP)" ANSIBLE_REMOTE_TEMP="$(ANSIBLE_REMOTE_TEMP)" \
	"$(ANSIBLE_PLAYBOOK)" infra/ansible/playbooks/validate-local.yml

ansible-remote:
	ANSIBLE_LOCAL_TEMP="$(ANSIBLE_LOCAL_TEMP)" ANSIBLE_REMOTE_TEMP="$(ANSIBLE_REMOTE_TEMP)" \
	"$(ANSIBLE_PLAYBOOK)" -i "$(INVENTORY)" infra/ansible/playbooks/remote-docker.yml

ansible-remote-arvan:
	ANSIBLE_LOCAL_TEMP="$(ANSIBLE_LOCAL_TEMP)" ANSIBLE_REMOTE_TEMP="$(ANSIBLE_REMOTE_TEMP)" \
	"$(ANSIBLE_PLAYBOOK)" -i "$(INVENTORY)" infra/ansible/playbooks/remote-docker.yml \
		-e divband_configure_arvan=true -e divband_arvan_enabled=true

ansible-remote-revert:
	ANSIBLE_LOCAL_TEMP="$(ANSIBLE_LOCAL_TEMP)" ANSIBLE_REMOTE_TEMP="$(ANSIBLE_REMOTE_TEMP)" \
	"$(ANSIBLE_PLAYBOOK)" -i "$(INVENTORY)" infra/ansible/playbooks/remote-docker.yml \
		-e divband_configure_arvan=false -e divband_arvan_enabled=false

ansible-remote-validate:
	ANSIBLE_LOCAL_TEMP="$(ANSIBLE_LOCAL_TEMP)" ANSIBLE_REMOTE_TEMP="$(ANSIBLE_REMOTE_TEMP)" \
	"$(ANSIBLE_PLAYBOOK)" -i "$(INVENTORY)" infra/ansible/playbooks/validate-vps.yml -e divband_arvan_enabled=true

ansible-remote-validate-revert:
	ANSIBLE_LOCAL_TEMP="$(ANSIBLE_LOCAL_TEMP)" ANSIBLE_REMOTE_TEMP="$(ANSIBLE_REMOTE_TEMP)" \
	"$(ANSIBLE_PLAYBOOK)" -i "$(INVENTORY)" infra/ansible/playbooks/validate-vps.yml -e divband_arvan_enabled=false

ansible-arvan: ansible-remote-arvan

ansible-revert: ansible-remote-revert

ansible-validate-arvan: ansible-remote-validate

ansible-validate-revert: ansible-remote-validate-revert

ansible-toggle-smoke:
	ANSIBLE_LOCAL_TEMP="$(ANSIBLE_LOCAL_TEMP)" ANSIBLE_REMOTE_TEMP="$(ANSIBLE_REMOTE_TEMP)" \
	"$(ANSIBLE_PLAYBOOK)" -i "$(INVENTORY)" infra/ansible/playbooks/toggle-smoke.yml -e divband_confirm_toggle_cycle="$(CONFIRM)"
