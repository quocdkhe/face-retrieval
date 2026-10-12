from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.qdrant_service import qdrant_service

FIXTURES_DIR = Path(__file__).parent / "fixtures"
INGEST_URL = "/api/v1/faces/ingest"
LIST_URL = "/api/v1/faces"


class _FakeResponse:
    def __init__(self, content: bytes, content_type: str = "image/jpeg") -> None:
        self.content = content
        self.status_code = 200
        self.headers = {"content-type": content_type}

    @property
    def is_success(self) -> bool:
        return True


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def isolated_collections():
    """Dùng collection tạm trên Qdrant thật, không đụng dữ liệu dev. Skip nếu Qdrant không chạy."""
    suffix = uuid4().hex[:8]
    originals = (settings.QDRANT_IMAGES_COLLECTION_NAME, settings.QDRANT_FACES_COLLECTION_NAME)
    settings.QDRANT_IMAGES_COLLECTION_NAME = f"test_images_{suffix}"
    settings.QDRANT_FACES_COLLECTION_NAME = f"test_faces_{suffix}"
    qdrant_service._collections_ready = False
    try:
        qdrant_service._client.get_collections()
    except Exception:
        settings.QDRANT_IMAGES_COLLECTION_NAME, settings.QDRANT_FACES_COLLECTION_NAME = originals
        pytest.skip("Qdrant không chạy")
    yield
    for name in (settings.QDRANT_IMAGES_COLLECTION_NAME, settings.QDRANT_FACES_COLLECTION_NAME):
        qdrant_service._client.delete_collection(name)
    settings.QDRANT_IMAGES_COLLECTION_NAME, settings.QDRANT_FACES_COLLECTION_NAME = originals
    qdrant_service._collections_ready = False


@pytest.fixture(scope="module")
def seeded(client, isolated_collections):
    """img-a và img-b là cùng 1 ảnh nhiều mặt (nên các mặt khớp nhau), img-c là ảnh khác."""
    multi = (FIXTURES_DIR / "multi_face.jpg").read_bytes()
    single = (FIXTURES_DIR / "single_face.png").read_bytes()
    by_url = {
        "https://example.com/a.jpg": multi,
        "https://example.com/b.jpg": multi,
        "https://example.com/c.png": single,
    }
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(httpx, "get", lambda url, *a, **k: _FakeResponse(by_url[url]))
        resp = client.post(
            INGEST_URL,
            json={
                "items": [
                    {"id": "11111111-0000-0000-0000-000000000001", "image_url": "https://example.com/a.jpg"},
                    {"id": "22222222-0000-0000-0000-000000000002", "image_url": "https://example.com/b.jpg"},
                    {"id": "33333333-0000-0000-0000-000000000003", "image_url": "https://example.com/c.png"},
                ]
            },
        )
    assert resp.status_code == 200
    assert all(r["error"] is None for r in resp.json()["results"])
    return {"a": "11111111-0000-0000-0000-000000000001", "b": "22222222-0000-0000-0000-000000000002"}


def _faces_of(client, image_id: str) -> list[dict]:
    items = client.get(LIST_URL, params={"limit": 50}).json()["items"]
    return next(i for i in items if i["id"] == image_id)["faces"]


def test_list_exposes_face_id(client, seeded):
    faces = _faces_of(client, seeded["a"])
    assert len(faces) > 1
    assert all(isinstance(f["face_id"], str) and f["face_id"] for f in faces)


def test_search_finds_other_images_and_excludes_source(client, seeded):
    face = _faces_of(client, seeded["a"])[0]

    resp = client.get(f"{LIST_URL}/{face['face_id']}/search")

    assert resp.status_code == 200
    data = resp.json()
    assert data["query_face"]["face_id"] == face["face_id"]
    assert data["query_face"]["image_id"] == seeded["a"]
    image_ids = [item["image"]["id"] for item in data["items"]]
    assert seeded["a"] not in image_ids
    assert image_ids == [seeded["b"]]  # đúng 1 lần, ảnh single_face không đủ giống
    item = data["items"][0]
    assert item["score"] > 0.9
    assert item["matched_face_id"] in {f["face_id"] for f in item["image"]["faces"]}
    assert data["total"] == 1


def test_search_unknown_face_returns_404(client, seeded):
    resp = client.get(f"{LIST_URL}/{uuid4()}/search")
    assert resp.status_code == 404


def test_search_invalid_face_id_returns_404(client, seeded):
    resp = client.get(f"{LIST_URL}/not-a-uuid/search")
    assert resp.status_code == 404


def test_ingest_saves_image_without_faces(client, isolated_collections, monkeypatch):
    import cv2
    import numpy as np

    ok, buf = cv2.imencode(".jpg", np.full((200, 200, 3), 127, dtype=np.uint8))
    assert ok
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(buf.tobytes()))
    image_id = "44444444-0000-0000-0000-000000000004"

    resp = client.post(
        INGEST_URL, json={"items": [{"id": image_id, "image_url": "https://example.com/blank.jpg"}]}
    )

    assert resp.status_code == 200
    result = resp.json()["results"][0]
    assert result["error"] is None
    assert result["face_count"] == 0
    items = client.get(LIST_URL, params={"limit": 50}).json()["items"]
    record = next(i for i in items if i["id"] == image_id)
    assert record["face_count"] == 0
    assert record["faces"] == []
