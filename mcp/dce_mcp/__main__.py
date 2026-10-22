from __future__ import annotations

import os
import sys


def main() -> None:
    base_url = os.environ.get("DCE_API_URL", "").strip()
    api_key = os.environ.get("DCE_API_KEY", "").strip()
    if not base_url or not api_key:
        print("DCE_API_URL and DCE_API_KEY are required", file=sys.stderr)
        raise SystemExit(1)
    transport = os.environ.get("MCP_TRANSPORT", "stdio").strip() or "stdio"
    from dce_mcp.server import build_server

    server = build_server(base_url, api_key, http_auth=transport == "streamable-http")
    if transport == "stdio":
        server.run(transport="stdio")
        return
    if transport == "streamable-http":
        server.run(transport="streamable-http")
        return
    print("MCP_TRANSPORT must be stdio or streamable-http", file=sys.stderr)
    raise SystemExit(1)


if __name__ == "__main__":
    main()
