.PHONY: test build up-dev render-traefik

test:
	cd backend && python3 -m pytest -q

build:
	docker compose -f docker-compose.dev.yml build

up-dev:
	docker compose -f docker-compose.dev.yml up -d --build

render-traefik:
	bash scripts/render-traefik.sh

icons:
	python3 scripts/generate_icons.py
