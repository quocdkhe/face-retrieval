from fastapi import APIRouter

from app.api.routes import faces, health

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(faces.router)
