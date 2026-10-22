from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Query, Response

MAX_LIMIT = 500


@dataclass
class Page:
    limit: Optional[int]
    offset: int


def get_page(
    limit: Optional[int] = Query(default=None, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
) -> Page:
    return Page(limit=limit, offset=offset)


def apply_page(query, page: Page, response: Response):
    total = query.order_by(None).count()
    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Offset"] = str(page.offset)
    if page.offset:
        query = query.offset(page.offset)
    if page.limit is not None:
        query = query.limit(page.limit)
        response.headers["X-Limit"] = str(page.limit)
    return query


def page_list(rows: list, page: Page, response: Response):
    response.headers["X-Total-Count"] = str(len(rows))
    response.headers["X-Offset"] = str(page.offset)
    if page.limit is not None:
        response.headers["X-Limit"] = str(page.limit)
        return rows[page.offset : page.offset + page.limit]
    if page.offset:
        return rows[page.offset :]
    return rows
