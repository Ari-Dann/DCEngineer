from __future__ import annotations

import re

from sqlalchemy import func, or_

_SEP = re.compile(r"[\s._-]+")
_SEP_CHARS = (" ", "-", "_", ".")


def fold_separators(value: str) -> str:
    """Treat space, hyphen, underscore, and dot as the same tag placeholder."""
    return _SEP.sub("", value or "")


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")


def like_pattern(value: str) -> str:
    return f"%{_escape_like(value)}%"


def fold_separators_sql(column):
    expr = column
    for ch in _SEP_CHARS:
        expr = func.replace(expr, ch, "")
    return expr


def matches_text(needle: str, *columns):
    """Match columns with a substring, ignoring differences among space / - / _ / ."""
    needle = (needle or "").strip()
    if not needle or not columns:
        return False
    clauses = []
    raw = like_pattern(needle)
    folded = fold_separators(needle)
    folded_like = like_pattern(folded) if folded else None
    for col in columns:
        clauses.append(col.ilike(raw, escape="\\"))
        if folded_like:
            clauses.append(fold_separators_sql(col).ilike(folded_like, escape="\\"))
    return or_(*clauses)


def text_matches(haystack: str | None, needle: str) -> bool:
    n = (needle or "").strip()
    if not n:
        return False
    hay = haystack or ""
    if n.lower() in hay.lower():
        return True
    folded_n = fold_separators(n).lower()
    return bool(folded_n) and folded_n in fold_separators(hay).lower()
