import sys
import os

# Ensure the backend package root is on sys.path so relative imports work
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.documents import router as documents_router
from routes.chat import router as chat_router
from routes.analytics import router as analytics_router
from routes.projects import router as projects_router
from routes.auth import router as auth_router
from routes.chats import router as chats_router
from routes.folders import router as folders_router

app = FastAPI(title="ContractIQ API", version="1.0.0")

from fastapi import Request
from fastapi.responses import JSONResponse
import traceback

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    print("TRACEBACK:\n", tb)
    return JSONResponse(status_code=500, content={"detail": str(exc), "traceback": tb})

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents_router)
app.include_router(chat_router)
app.include_router(analytics_router)
app.include_router(projects_router)
app.include_router(auth_router)
app.include_router(chats_router)
app.include_router(folders_router)


@app.get("/")
def health():
    return {"status": "ok", "service": "ContractIQ API"}


if __name__ == "__main__":
    import uvicorn
    from config import PORT
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
