.DEFAULT_GOAL := help
INVENTORY ?= infra/ansible/inventory.yml
ANSIBLE_LOCAL_TEMP ?= /tmp/ansible-local
ANSIBLE_REMOTE_TEMP ?= /tmp/ansible-remote

.PHONY: help up down restart ps logs smoke ansible-arvan ansible-revert ansible-validate-arvan ansible-validate-revert ansible-toggle-smoke

help:
	@printf 'Available commands:\n'
	@printf '  make up       Start HAProxy and test Nginx\n'
	@printf '  make down     Stop and remove containers\n'
	@printf '  make restart  Recreate the stack\n'
	@printf '  make ps       Show container status\n'
	@printf '  make logs     Follow container logs\n'
	@printf '  make smoke    Verify test.divband.com routing locally\n'
	@printf '  make ansible-arvan INVENTORY=infra/ansible/inventory.yml\n'
	@printf '      Apply Arvan apt/registry settings and deploy the VPS stack\n'
	@printf '  make ansible-revert INVENTORY=infra/ansible/inventory.yml\n'
	@printf '      Revert Arvan apt/registry settings and redeploy with normal image names\n'
	@printf '  make ansible-validate-arvan INVENTORY=infra/ansible/inventory.yml\n'
	@printf '      Validate the VPS is in Arvan mode and serving traffic\n'
	@printf '  make ansible-validate-revert INVENTORY=infra/ansible/inventory.yml\n'
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
	curl -fsS -H "Host: test.divband.com" http://127.0.0.1/ | grep -q "Welcome to test"

ansible-arvan:
	ANSIBLE_LOCAL_TEMP="$(ANSIBLE_LOCAL_TEMP)" ANSIBLE_REMOTE_TEMP="$(ANSIBLE_REMOTE_TEMP)" \
	ansible-playbook -i "$(INVENTORY)" infra/ansible/playbooks/vps-docker.yml -e divband_arvan_enabled=true

ansible-revert:
	ANSIBLE_LOCAL_TEMP="$(ANSIBLE_LOCAL_TEMP)" ANSIBLE_REMOTE_TEMP="$(ANSIBLE_REMOTE_TEMP)" \
	ansible-playbook -i "$(INVENTORY)" infra/ansible/playbooks/vps-docker.yml -e divband_arvan_enabled=false

ansible-validate-arvan:
	ANSIBLE_LOCAL_TEMP="$(ANSIBLE_LOCAL_TEMP)" ANSIBLE_REMOTE_TEMP="$(ANSIBLE_REMOTE_TEMP)" \
	ansible-playbook -i "$(INVENTORY)" infra/ansible/playbooks/validate-vps.yml -e divband_arvan_enabled=true

ansible-validate-revert:
	ANSIBLE_LOCAL_TEMP="$(ANSIBLE_LOCAL_TEMP)" ANSIBLE_REMOTE_TEMP="$(ANSIBLE_REMOTE_TEMP)" \
	ansible-playbook -i "$(INVENTORY)" infra/ansible/playbooks/validate-vps.yml -e divband_arvan_enabled=false

ansible-toggle-smoke:
	ANSIBLE_LOCAL_TEMP="$(ANSIBLE_LOCAL_TEMP)" ANSIBLE_REMOTE_TEMP="$(ANSIBLE_REMOTE_TEMP)" \
	ansible-playbook -i "$(INVENTORY)" infra/ansible/playbooks/toggle-smoke.yml -e divband_confirm_toggle_cycle="$(CONFIRM)"
