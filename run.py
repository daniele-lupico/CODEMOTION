import sys
import os

# Change into the backend directory so uvicorn can find main:app
# and all relative imports work correctly in both the main process
# and reload worker subprocesses.
_backend = os.path.join(os.path.dirname(os.path.abspath(__file__)), "CODEMOTION", "backend")
os.chdir(_backend)
sys.path.insert(0, _backend)

import uvicorn

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
