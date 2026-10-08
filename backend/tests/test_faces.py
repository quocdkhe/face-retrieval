from pathlib import Path

import cv2
import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app

FIXTURES_DIR = Path(__file__).parent / "fixtures"
EXTRACT_URL = "/api/v1/faces/extract"


class _FakeResponse:
    def __init__(self, content: bytes, status_code: int = 200, content_type: str = "image/jpeg") -> None:
        self.content = content
        self.status_code = status_code
        self.headers = {"content-type": content_type}

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300


def _no_face_image_bytes() -> bytes:
    image = np.full((200, 200, 3), 127, dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", image)
    assert ok
    return buf.tobytes()


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_extract_single_face(client, monkeypatch):
    image_bytes = (FIXTURES_DIR / "single_face.png").read_bytes()
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(image_bytes, content_type="image/png"))

    resp = client.post(EXTRACT_URL, json={"image_url": "https://example.com/single_face.png"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["image_width"] == 290
    assert data["image_height"] == 340
    assert data["face_count"] == 1
    assert len(data["faces"]) == 1
    face = data["faces"][0]
    assert face["face_id"] == 0
    assert len(face["bbox"]) == 4
    assert 0.0 <= face["det_score"] <= 1.0
    assert len(face["embedding"]) > 0
    assert all(isinstance(x, float) for x in face["embedding"])


def test_extract_multiple_faces(client, monkeypatch):
    image_bytes = (FIXTURES_DIR / "multi_face.jpg").read_bytes()
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(image_bytes))

    resp = client.post(EXTRACT_URL, json={"image_url": "https://example.com/multi_face.jpg"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["face_count"] > 1
    assert len(data["faces"]) == data["face_count"]
    face_ids = [f["face_id"] for f in data["faces"]]
    assert face_ids == list(range(data["face_count"]))


def test_extract_no_face(client, monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(_no_face_image_bytes()))

    resp = client.post(EXTRACT_URL, json={"image_url": "https://example.com/no_face.jpg"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["face_count"] == 0
    assert data["faces"] == []


def test_invalid_url_rejected(client):
    resp = client.post(EXTRACT_URL, json={"image_url": "not-a-valid-url"})
    assert resp.status_code == 400


def test_download_failure(client, monkeypatch):
    def _raise(*a, **k):
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(httpx, "get", _raise)

    resp = client.post(EXTRACT_URL, json={"image_url": "https://example.com/unreachable.jpg"})
    assert resp.status_code == 400


def test_non_200_status(client, monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(b"", status_code=404))

    resp = client.post(EXTRACT_URL, json={"image_url": "https://example.com/missing.jpg"})
    assert resp.status_code == 400


def test_invalid_image_bytes(client, monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(b"not an image"))

    resp = client.post(EXTRACT_URL, json={"image_url": "https://example.com/broken.jpg"})
    assert resp.status_code == 400
