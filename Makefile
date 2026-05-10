.PHONY: help install dev build start typecheck clean \
        net docker-build up down restart logs ps health \
        mcp-add mcp-add-stdio mcp-remove mcp-list start-stack \
        vercel-dev vercel-deploy cf-dev cf-deploy \
        release

# ------------------------------------------------------------------ config
NPM           ?= npm
NETWORK       ?= reverse-proxy
MCP_NAME      ?= luciq
MCP_URL_LOCAL ?= http://localhost:8080/mcp
MCP_URL_PROXY ?= http://luciq.mcp.localhost/mcp
MCP_SCOPE     ?= user
MCP_STDIO_BIN ?= $(CURDIR)/dist/src/bin/mcp-stdio.js

# ------------------------------------------------------------------ mode
# MODE selects the Docker deploy shape. Override on the command line:
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

# ------------------------------------------------------------------ node
install: ## Install npm dependencies
	$(NPM) install

dev: ## Run dev server with watch (tsx)
	$(NPM) run dev

build: ## Build TypeScript → dist/
	$(NPM) run build

start: ## Run compiled server (requires `make build`)
	$(NPM) run serve

typecheck: ## Type-check without emitting
	$(NPM) run typecheck

clean: ## Remove build outputs and caches
	rm -rf dist node_modules .vercel .wrangler

# ------------------------------------------------------------------ docker
net: ## Create the external reverse-proxy docker network if missing
	@docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK)

docker-build: ## Build the docker image (respects MODE)
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

health: ## Probe /healthz on the current MODE
	@curl -sS -o /dev/null -w "HTTP %{http_code} @ $(MCP_URL)\n" $(MCP_URL) || true
	@curl -sS -w "HTTP %{http_code} @ $(subst /mcp,/healthz,$(MCP_URL))\n" $(subst /mcp,/healthz,$(MCP_URL)) || true

# ------------------------------------------------------------------ claude code cli
mcp-add: ## Register MCP in Claude CLI for the current MODE
	@echo "→ claude mcp add ... $(MCP_URL)"
	claude mcp add --transport http --scope $(MCP_SCOPE) $(MCP_NAME) $(MCP_URL)

mcp-add-stdio: ## Register MCP via Node stdio (absolute path to dist/)
	@test -f $(MCP_STDIO_BIN) || (echo "✗ $(MCP_STDIO_BIN) not found — run 'make build' first" && exit 1)
	@echo "→ claude mcp add ... node $(MCP_STDIO_BIN)"
	claude mcp add --scope $(MCP_SCOPE) $(MCP_NAME) -- node $(MCP_STDIO_BIN)

mcp-remove: ## Remove the MCP registration
	claude mcp remove $(MCP_NAME) -s $(MCP_SCOPE)

mcp-list: ## List configured MCP servers
	claude mcp list

# ------------------------------------------------------------------ all-in-one
start-stack: up health mcp-add mcp-list ## Build, run, register and verify (current MODE)

# ------------------------------------------------------------------ vercel
vercel-dev: ## Run Vercel dev server (auto-installs vercel CLI on demand)
	npx vercel dev

vercel-deploy: ## Deploy to Vercel (production)
	npx vercel deploy --prod

# ------------------------------------------------------------------ release
release: ## Cut a new release end-to-end (usage: make release VERSION=0.3.0)
	@test -n "$(VERSION)" || (echo "✗ VERSION required, e.g. make release VERSION=0.3.0" && exit 1)
	./scripts/release.sh $(VERSION)

# ------------------------------------------------------------------ cloudflare pages
cf-dev: ## Run Cloudflare Pages dev (wrangler)
	npx wrangler pages dev . --compatibility-flags=nodejs_compat

cf-deploy: ## Deploy to Cloudflare Pages
	npx wrangler pages deploy .
