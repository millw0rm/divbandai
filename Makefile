.DEFAULT_GOAL := help

.PHONY: help up down restart ps logs smoke

help:
	@printf 'Available commands:\n'
	@printf '  make up       Start HAProxy and test Nginx\n'
	@printf '  make down     Stop and remove containers\n'
	@printf '  make restart  Recreate the stack\n'
	@printf '  make ps       Show container status\n'
	@printf '  make logs     Follow container logs\n'
	@printf '  make smoke    Verify test.divband.com routing locally\n'

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
