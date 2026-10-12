from fastapi import FastAPI, APIRouter, HTTPException, status, Depends, UploadFile, File, Form, Request
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Annotated, Dict, Any
from datetime import datetime, timezone
import uuid
import hashlib
import os
import re

# ---- Existing imports/config remain as-is above -----

# NOTE: This addition is intentionally scoped to internal/local scan support.
# It complements the existing /files/register internal flow without disturbing
# the later cloud-source additions (Google Drive, Dropbox, OneDrive, Google Photos).

class DeviceFolderScanItem(BaseModel):
    name: str
    size: int = 0
    mime_type: str = ""
    sha256: str
    external_id: Optional[str] = None
    path: Optional[str] = None
    created_at: Optional[str] = None


class DeviceFolderScanRequest(BaseModel):
    folder_path: str
    folder_type: str = "local"
    files: List[DeviceFolderScanItem] = []


@api.post("/scan/device-folder")
async def scan_device_folder(
    body: DeviceFolderScanRequest,
    current: dict = Depends(get_current_user),
):
    """Register device-local files from a chosen folder (Downloads, Documents,
    Pictures, gallery, or a user-selected local folder). This is the internal
    source path and does not affect cloud-source scans.
    """
    if not body.folder_path:
        raise HTTPException(400, "folder_path is required")
    if not body.files:
        raise HTTPException(400, "No files supplied for local scan")

    added = 0
    for item in body.files:
        if not item.sha256:
            continue

        existing = await files_col.find_one({
            "user_id": current["id"],
            "sha256": item.sha256,
            "source": "internal",
            "external_id": item.external_id or item.path,
        })
        if existing:
            continue

        rec = {
            "id": str(uuid.uuid4()),
            "user_id": current["id"],
            "source": "internal",
            "source_id": body.folder_type,
            "external_id": item.external_id or item.path,
            "name": item.name,
            "size": item.size,
            "mime_type": item.mime_type,
            "sha256": item.sha256,
            "phash": None,
            "text_preview": "",
            "is_generic_name": is_generic_name(item.name),
            "ai_suggested_name": None,
            "created_at": item.created_at or datetime.now(timezone.utc).isoformat(),
        }
        await files_col.insert_one(rec)
        added += 1

    return {
        "added": added,
        "submitted": len(body.files),
        "folder_path": body.folder_path,
        "folder_type": body.folder_type,
    }


@api.post("/scan/device-gallery")
async def scan_device_gallery(
    body: Dict[str, Any],
    current: dict = Depends(get_current_user),
):
    """Convenience route for device gallery scanning. This accepts a list of
    photo/video metadata items from the client and registers them as internal
    files only.
    """
    items = body.get("files") or []
    if not items:
        raise HTTPException(400, "No gallery files supplied")

    added = 0
    for item in items:
        sha = item.get("sha256")
        name = item.get("name")
        if not sha or not name:
            continue

        existing = await files_col.find_one({
            "user_id": current["id"],
            "sha256": sha,
            "source": "internal",
            "external_id": item.get("external_id"),
        })
        if existing:
            continue

        rec = {
            "id": str(uuid.uuid4()),
            "user_id": current["id"],
            "source": "internal",
            "source_id": "gallery",
            "external_id": item.get("external_id"),
            "name": name,
            "size": int(item.get("size") or 0),
            "mime_type": item.get("mime_type") or "",
            "sha256": sha,
            "phash": item.get("phash"),
            "text_preview": "",
            "is_generic_name": is_generic_name(name),
            "ai_suggested_name": None,
            "created_at": item.get("created_at") or datetime.now(timezone.utc).isoformat(),
        }
        await files_col.insert_one(rec)
        added += 1

    return {"added": added, "submitted": len(items), "source": "gallery"}
