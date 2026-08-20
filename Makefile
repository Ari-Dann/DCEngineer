.PHONY: test build up-dev

test:
	cd backend && python3 -m pytest -q

build:
	docker compose -f docker-compose.dev.yml build

up-dev:
	docker compose -f docker-compose.dev.yml up -d --build

icons:
	python3 scripts/generate_icons.py
