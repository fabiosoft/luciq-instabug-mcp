.PHONY: help setup install sync net build up down restart logs ps health \
        mcp-add mcp-remove mcp-list start clean

# ------------------------------------------------------------------ config
PY            ?= python3
VENV          ?= .venv
UV            ?= uv
NETWORK       ?= reverse-proxy
MCP_NAME      ?= luciq
MCP_URL_LOCAL ?= http://localhost:8080/mcp
MCP_URL_PROXY ?= http://luciq.mcp.localhost/mcp
MCP_SCOPE     ?= user

# ------------------------------------------------------------------ mode
# MODE selects the deploy shape. Override on the command line:
#   make up MODE=local    → host port 8080 published
#   make up MODE=proxy    → join reverse-proxy network, Traefik routes :80
MODE          ?= local
VALID_MODES    = local proxy
ifeq ($(filter $(MODE),$(VALID_MODES)),)
$(error MODE must be one of: $(VALID_MODES) — got '$(MODE)')
endif

COMPOSE_FILES  = -f docker-compose.yml -f docker-compose.$(MODE).yml
COMPOSE        = docker compose $(COMPOSE_FILES)
MCP_URL        = $(if $(filter proxy,$(MODE)),$(MCP_URL_PROXY),$(MCP_URL_LOCAL))

ifeq ($(MODE),proxy)
NEED_NET := net
else
NEED_NET :=
endif

# ------------------------------------------------------------------ help
help:
	@awk 'BEGIN {FS = ":.*##"; printf "\nTargets (MODE=$(MODE)):\n"} \
	      /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ------------------------------------------------------------------ python (uv)
setup: install ## Create venv and install Python deps via uv

install: ## Create $(VENV) and install requirements with uv
	@command -v $(UV) >/dev/null || { echo "uv not found — install: curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1; }
	$(UV) venv $(VENV)
	$(UV) pip install -r requirements.txt --python $(VENV)/bin/python

sync: ## Re-sync deps into existing venv
	$(UV) pip sync requirements.txt --python $(VENV)/bin/python

# ------------------------------------------------------------------ docker
net: ## Create the external reverse-proxy docker network if missing
	@docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK)

build: ## Build the docker image (respects MODE)
	$(COMPOSE) build

up: $(NEED_NET) ## Start the MCP server in MODE=local|proxy (detached)
	@echo "→ starting in MODE=$(MODE) (URL: $(MCP_URL))"
	$(COMPOSE) up -d --build

down: ## Stop and remove containers (uses current MODE overrides)
	$(COMPOSE) down

restart: down up ## Restart the stack in current MODE

logs: ## Tail container logs
	$(COMPOSE) logs -f --tail=100

ps: ## Show container status
	$(COMPOSE) ps

health: ## Probe the MCP endpoint of the current MODE (406 = healthy)
	@curl -s -o /dev/null -w "HTTP %{http_code} @ $(MCP_URL)\n" $(MCP_URL) || true

# ------------------------------------------------------------------ claude code cli
mcp-add: ## Register MCP in Claude CLI for the current MODE
	@echo "→ claude mcp add ... $(MCP_URL)"
	claude mcp add --transport http --scope $(MCP_SCOPE) $(MCP_NAME) $(MCP_URL)

mcp-remove: ## Remove the MCP registration
	claude mcp remove $(MCP_NAME) -s $(MCP_SCOPE)

mcp-list: ## List configured MCP servers
	claude mcp list

# ------------------------------------------------------------------ all-in-one
start: up health mcp-add mcp-list ## Build, run, register and verify (current MODE)

# ------------------------------------------------------------------ misc
clean: ## Remove venv and Python caches
	rm -rf $(VENV) __pycache__ */__pycache__ .pytest_cache
