FROM python:3.13-slim

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY luciq_client.py luciq_fetch.py luciq_server.py luciq_mcp_server.py index.html favicon.svg ./

RUN useradd --create-home --uid 1000 luciq \
    && mkdir -p /data \
    && chown -R luciq:luciq /app /data

USER luciq
WORKDIR /data

EXPOSE 8080
# Default: run the MCP server (streamable-http on :8080/mcp).
# Override CMD/entrypoint to run the REST server or the one-shot CLI:
#   command: ["python", "/app/luciq_server.py"]      # REST
#   entrypoint: ["python","/app/luciq_fetch.py"]     # CLI one-shot
ENV MCP_TRANSPORT=streamable-http \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8080 \
    MCP_PATH=/mcp
CMD ["python", "/app/luciq_mcp_server.py"]
