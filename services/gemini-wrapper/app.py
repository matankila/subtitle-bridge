import asyncio
import hmac
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from gemini_webapi import GeminiClient

TOKEN = os.environ.get("WRAPPER_TOKEN", "")
TIMEOUT = min(180, max(20, int(os.environ.get("GEMINI_TIMEOUT_SECONDS", "100"))))
MAX_PROMPT = min(100_000, max(5_000, int(os.environ.get("MAX_PROMPT_CHARS", "50000"))))


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=MAX_PROMPT)


class Guest:
    def __init__(self):
        self.client = None
        self.lock = asyncio.Lock()

    async def close(self):
        if self.client:
            await self.client.close()
            self.client = None

    async def initialize(self):
        await self.close()
        client = GeminiClient()
        await asyncio.wait_for(
            client.init(timeout=30, auto_refresh=False, auto_close=False, verbose=False),
            timeout=45,
        )
        self.client = client

    async def generate(self, prompt: str) -> str:
        async with self.lock:
            if self.client is None:
                await self.initialize()
            try:
                response = await asyncio.wait_for(
                    self.client.generate_content(prompt, temporary=True), timeout=TIMEOUT
                )
            except Exception:
                # One clean guest session retry handles stale private web protocol state.
                await self.initialize()
                response = await asyncio.wait_for(
                    self.client.generate_content(prompt, temporary=True), timeout=TIMEOUT
                )
            return response.text


guest = Guest()


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await guest.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def authorize(value: str | None):
    if not TOKEN or not value or not hmac.compare_digest(value, f"Bearer {TOKEN}"):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
async def health():
    return {"ok": True, "mode": "anonymous-guest", "initialized": guest.client is not None}


@app.post("/v1/generate")
async def generate(body: GenerateRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    try:
        text = await guest.generate(body.prompt)
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Gemini guest timeout") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Gemini guest unavailable: {type(exc).__name__}") from exc
    return {"text": text}
