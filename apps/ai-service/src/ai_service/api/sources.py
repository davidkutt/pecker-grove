from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel

from ai_service.core.auth import require_api_service

router = APIRouter(prefix="/v1", tags=["sources"])


class Skipped(BaseModel):
    source: str
    reason: str


class Failed(BaseModel):
    source: str
    error: str


class FolderGit(BaseModel):
    commit: str | None
    branch: str | None
    reason: str | None = None
    pull: Literal["ok", "failed", "off"]
    pull_error: str | None = None


class FolderDocuments(BaseModel):
    ready: int
    in_progress: int
    failed: list[Failed]


class FolderStatus(BaseModel):
    label: str
    git: FolderGit | None
    excluded: list[str]
    notes: int
    added: list[str]
    updated: list[str]
    deleted: list[str]
    unchanged: int
    skipped: list[Skipped]
    documents: FolderDocuments


class UrlsStatus(BaseModel):
    refreshed: list[str]
    skipped: list[Skipped]


class SourcesStatus(BaseModel):
    """The API's last notes and URL sync (D127)."""

    started_at: datetime
    finished_at: datetime
    interval_minutes: float
    error: str | None = None
    folders: list[FolderStatus]
    urls: UrlsStatus


class IndexStatus(BaseModel):
    reported_at: datetime | None
    status: SourcesStatus | None
    note: str | None = None


def unreported() -> IndexStatus:
    started = datetime.now(UTC).isoformat(timespec="seconds")
    return IndexStatus(
        reported_at=None,
        status=None,
        note=f"No sync reported since the AI service started at {started}; "
        "the API reports after every sync.",
    )


@router.put(
    "/sources/status",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_api_service)],
)
def report_status(request: Request, body: SourcesStatus) -> None:
    """The API pushes the status after every sync; the MCP tool `index_status` returns it."""
    request.app.state.sources = IndexStatus(reported_at=datetime.now(UTC), status=body)
