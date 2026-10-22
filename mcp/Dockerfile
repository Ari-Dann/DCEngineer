# syntax=docker/dockerfile:1.7

FROM python:3.12-slim
WORKDIR /opt/dce-mcp

RUN useradd --create-home --uid 1000 --shell /usr/sbin/nologin mcp

COPY requirements.txt /opt/dce-mcp/requirements.txt
RUN pip install --no-cache-dir -r /opt/dce-mcp/requirements.txt

COPY dce_mcp /opt/dce-mcp/dce_mcp
RUN chown -R mcp:mcp /opt/dce-mcp

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/opt/dce-mcp \
    MCP_TRANSPORT=stdio

USER mcp
ENTRYPOINT ["python", "-m", "dce_mcp"]
