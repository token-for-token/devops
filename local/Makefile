# Hosted gateway — local dev + test orchestration.
# Mirrors cipherdolls/devops/local/Makefile.

PROJECT      := hosted-gateway
COMPOSE_DEV  := docker-compose.yaml
COMPOSE_TEST := docker-compose-test.yaml
DC           := docker compose -p $(PROJECT) -f $(COMPOSE_TEST)
DC_DEV       := docker compose -p $(PROJECT)-dev -f $(COMPOSE_DEV)
TEST_CONTAINER := $(PROJECT)-bun
LOG_DIR := /tmp/hosted-gateway-test-logs

SPEC ?= accounts
SPECS := health auth models gateway ledger cancellation concurrency
TIMEOUT ?= 600

SERVICES := postgres redis prisma api worker

# Specs that need the gnosis-fork stack (anvil + bee) and/or a registered
# provider → activate the `gateway` compose profile. `models` only needs the
# fork (read-only chain calls); `gateway`/`concurrency`/`cancellation` also
# need the t4t-provider + mock-ollama containers.
GATEWAY_SPECS := models gateway concurrency cancellation
gateway_profile = $(if $(filter $(1),$(GATEWAY_SPECS)),--profile gateway,)

.PHONY: dev-up dev-down dev-watch up up-detached down logs build clean test test-all $(addprefix test-,$(SPECS)) help lock

# ---------- dev ----------

dev-up:
	$(DC_DEV) up

dev-down:
	$(DC_DEV) down -v --remove-orphans -t 0

dev-watch:
	$(DC_DEV) watch

# ---------- test ----------

# Generate / refresh bun.lock inside the hosted-gateway repo via a one-shot
# container. Mirrors cipherdolls' approach so no host-side Bun install is
# required.
lock:
	@echo "========== Generating bun.lock =========="
	docker run --rm -v ../../hosted-gateway:/app -w /app oven/bun:1.2-alpine bun install
	@echo "========== bun.lock updated =========="

# Run a single spec by name. Example: `make test SPEC=accounts`
define run_test
	bash -c '\
		set +e; \
		mkdir -p $(LOG_DIR); \
		cleanup() { \
			echo ""; \
			echo "========== Cleaning up =========="; \
			docker rm -f $(TEST_CONTAINER) 2>/dev/null; \
			$(DC) kill 2>/dev/null; \
			$(DC) down -v --remove-orphans -t 0 2>/dev/null; \
		}; \
		trap cleanup EXIT; \
		echo "========== Updating bun.lock =========="; \
		docker run --rm -v ../../hosted-gateway:/app -w /app oven/bun:1.2-alpine bun install --frozen-lockfile 2>/dev/null || \
		docker run --rm -v ../../hosted-gateway:/app -w /app oven/bun:1.2-alpine bun install; \
		echo "========== Starting services =========="; \
		$(DC) $(call gateway_profile,$(1)) up -d --build --wait $(SERVICES); \
		if [ "$(call gateway_profile,$(1))" != "" ]; then \
			echo "========== Starting gateway profile (anvil) =========="; \
			$(DC) $(call gateway_profile,$(1)) up -d --build --wait anvil || { echo "gateway profile failed to start"; exit 1; }; \
			if [ "$(1)" != "models" ]; then \
				echo "========== Starting t4t-provider + mock-ollama =========="; \
				$(DC) $(call gateway_profile,$(1)) up -d --build --wait t4t-provider mock-ollama || { echo "provider profile failed to start"; exit 1; }; \
			fi; \
		fi; \
		echo "========== Running $(1) =========="; \
		$(DC) build --no-cache bun; \
		$(DC) $(call gateway_profile,$(1)) run -d --no-deps --name $(TEST_CONTAINER) \
			-e SPEC_GLOB="./test/$(1).e2e-spec.ts" \
			bun; \
		\
		docker wait $(TEST_CONTAINER) &>/dev/null & \
		WAIT_PID=$$!; \
		stdbuf -oL docker logs -f $(TEST_CONTAINER) 2>&1 \
			| stdbuf -oL sed "s/\x1b\[[0-9;]*m//g" \
			> $(LOG_DIR)/$(1).log & \
		LOGS_PID=$$!; \
		\
		if ! timeout $(TIMEOUT) tail --pid=$$WAIT_PID -f /dev/null 2>/dev/null; then \
			echo "========== TIMEOUT after $(TIMEOUT)s =========="; \
			docker kill $(TEST_CONTAINER) 2>/dev/null; \
		fi; \
		wait $$WAIT_PID 2>/dev/null; \
		rc=$$(docker inspect -f "{{.State.ExitCode}}" $(TEST_CONTAINER) 2>/dev/null || echo 1); \
		kill $$LOGS_PID 2>/dev/null; \
		wait $$LOGS_PID 2>/dev/null; \
		echo "========== Tests finished (rc=$$rc) — log: $(LOG_DIR)/$(1).log =========="; \
		exit $$rc'
endef

test:
	$(call run_test,$(SPEC))

test-all:
	@failed=""; \
	for spec in $(SPECS); do \
		echo ""; \
		echo "========== Suite: $$spec =========="; \
		$(MAKE) --no-print-directory test SPEC=$$spec; \
		if [ $$? -ne 0 ]; then failed="$$failed $$spec"; fi; \
	done; \
	if [ -n "$$failed" ]; then \
		echo ""; \
		echo "Failed specs:$$failed"; exit 1; \
	else \
		echo ""; \
		echo "All specs passed"; \
	fi

$(addprefix test-,$(SPECS)):
	$(call run_test,$(subst test-,,$@))

up:
	$(DC) up

up-detached:
	$(DC) up -d

down:
	$(DC) kill 2>/dev/null || true
	$(DC) down -v --remove-orphans -t 0

logs:
	$(DC) logs -f

build:
	$(DC) build

clean:
	$(DC) kill 2>/dev/null || true
	$(DC) down -v --remove-orphans --rmi local -t 0
	@docker ps -aq --filter "label=com.docker.compose.project=$(PROJECT)" | xargs -r docker rm -f 2>/dev/null || true
	@docker volume ls -q --filter "label=com.docker.compose.project=$(PROJECT)" | xargs -r docker volume rm -f 2>/dev/null || true
	@docker network ls -q --filter "label=com.docker.compose.project=$(PROJECT)" | xargs -r docker network rm 2>/dev/null || true

help:
	@echo "Usage:"
	@echo "  make dev-up                 Start dev stack (postgres, redis, anvil, bee, api, worker)"
	@echo "  make dev-down               Stop and clean dev stack"
	@echo "  make dev-watch              Dev with file sync"
	@echo "  make test SPEC=accounts     Run one e2e spec inside docker"
	@echo "  make test-accounts          Same as `make test SPEC=accounts`"
	@echo "  make test-all               Run every spec sequentially"
	@echo "  make up                     Start test stack (no test runner)"
	@echo "  make down                   Tear down test stack"
	@echo "  make logs                   Tail test stack logs"
	@echo "  make lock                   Regenerate bun.lock via docker"
	@echo "  make clean                  Nuclear cleanup"
	@echo ""
	@echo "Available specs:"
	@echo "  $(SPECS)" | fold -s -w 70
