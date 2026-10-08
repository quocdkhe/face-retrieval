from datetime import datetime

from pydantic import BaseModel, Field


class PersonBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    email: str
    avatar_url: str | None = None


class PersonCreate(PersonBase):
    pass


class Person(PersonBase):
    id: int
    created_at: datetime


class PersonPage(BaseModel):
    items: list[Person]
    total: int
    page: int
    page_size: int
