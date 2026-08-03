#!/usr/bin/env python3
"""Native LightRAG launcher — loads lightrag.native.env properly (KEY=VALUE,
docker env_file style, not bash-sourceable due to spaces/JSON values) then
execs lightrag-server in this same venv/process.
"""
import os
import sys
from pathlib import Path

from dotenv import dotenv_values

here = Path(__file__).parent
env_path = here / "lightrag.native.env"
values = dotenv_values(env_path)
os.environ.update({k: v for k, v in values.items() if v is not None})

from lightrag.api.lightrag_server import main

if __name__ == "__main__":
    sys.exit(main())
