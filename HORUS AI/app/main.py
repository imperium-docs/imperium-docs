from fastapi import FastAPI

from app.api.routes import router
from app.core.service import get_context

app = FastAPI(title="HORUS AI")


@app.on_event("startup")
def _startup() -> None:
    get_context()


@app.on_event("shutdown")
def _shutdown() -> None:
    ctx = get_context()
    if ctx.health_scheduler:
        ctx.health_scheduler.stop()
    if ctx.queue:
        ctx.queue.stop()


app.include_router(router)
