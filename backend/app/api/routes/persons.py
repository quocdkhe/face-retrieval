from datetime import datetime, timezone
from itertools import count

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.person import Person, PersonCreate, PersonPage

router = APIRouter(prefix="/persons", tags=["persons"])

_id_seq = count(1)


def _seed() -> list[Person]:
    names = [
        "Nguyen Van A",
        "Tran Thi B",
        "Le Van C",
        "Pham Thi D",
        "Hoang Van E",
        "Vu Thi F",
        "Dang Van G",
    ]
    now = datetime.now(timezone.utc)
    return [
        Person(
            id=next(_id_seq),
            name=name,
            email=f"user{i}@example.com",
            avatar_url=f"https://i.pravatar.cc/120?img={i + 1}",
            created_at=now,
        )
        for i, name in enumerate(names)
    ]


# Dummy in-memory store — thay bằng database khi tích hợp thật.
_DB: list[Person] = _seed()


@router.get("", response_model=PersonPage)
def list_persons(
    q: str | None = Query(None, description="Tìm theo tên hoặc email"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
) -> PersonPage:
    items = _DB
    if q:
        needle = q.lower()
        items = [
            p for p in items if needle in p.name.lower() or needle in p.email.lower()
        ]

    start = (page - 1) * page_size
    return PersonPage(
        items=items[start : start + page_size],
        total=len(items),
        page=page,
        page_size=page_size,
    )


@router.get("/{person_id}", response_model=Person)
def get_person(person_id: int) -> Person:
    for p in _DB:
        if p.id == person_id:
            return p
    raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Person not found")


@router.post("", response_model=Person, status_code=status.HTTP_201_CREATED)
def create_person(payload: PersonCreate) -> Person:
    person = Person(
        id=next(_id_seq),
        created_at=datetime.now(timezone.utc),
        **payload.model_dump(),
    )
    _DB.append(person)
    return person


@router.delete("/{person_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_person(person_id: int) -> None:
    for i, p in enumerate(_DB):
        if p.id == person_id:
            del _DB[i]
            return
    raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Person not found")
