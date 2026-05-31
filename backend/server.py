"""
Smart File Scan & Dedup Backend
- JWT Auth
- Storage source connections (Internal device, Google Drive, Dropbox)
- File metadata storage + content hashing + text extraction
- AI-powered duplicate detection (Claude Sonnet 4.5)
- AI-powered file rename suggestions
- File deletion across sources
"""
from fastapi import FastAPI, APIRouter, HTTPException, status, Depends, UploadFile, File, Form
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import io
import uuid
import hashlib
import logging
import asyncio
import httpx
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Annotated, Dict, Any
from pydantic import BaseModel, EmailStr, Field
from passlib.context import CryptContext
from jose import jwt, JWTError

from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET_KEY']
JWT_ALG = os.environ.get('JWT_ALGORITHM', 'HS256')
TOKEN_EXPIRE_MIN = int(os.environ.get('ACCESS_TOKEN_EXPIRE_MINUTES', '1440'))
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
CLAUDE_MODEL = "claude-sonnet-4-5-20250929"

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
users_col = db.users
files_col = db.files
sources_col = db.sources  # Google Drive / Dropbox connections

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

app = FastAPI(title="Smart File Scan API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ---------- Models ----------
class UserSignup(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    full_name: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Dict[str, Any]


class UserOut(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None


class ConnectDrive(BaseModel):
    access_token: str
    account_label: str = "My Drive"


class ConnectDropbox(BaseModel):
    access_token: str
    account_label: str = "My Dropbox"


class RenameApprove(BaseModel):
    new_name: str


class FileRecord(BaseModel):
    id: str
    name: str
    source: str  # internal | gdrive | dropbox
    source_id: Optional[str] = None  # for gdrive/dropbox link
    external_id: Optional[str] = None  # file id in external source
    size: int = 0
    mime_type: str = ""
    sha256: str = ""
    text_preview: str = ""
    is_generic_name: bool = False
    ai_suggested_name: Optional[str] = None
    created_at: str = ""


# ---------- Auth helpers ----------
def hash_pw(p: str) -> str:
    return pwd_ctx.hash(p)


def verify_pw(p: str, h: str) -> bool:
    try:
        return pwd_ctx.verify(p, h)
    except Exception:
        return False


def create_token(uid: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE_MIN)
    return jwt.encode({"sub": uid, "exp": expire}, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_user(token: Annotated[str, Depends(oauth2)]) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        uid = payload.get("sub")
        if not uid:
            raise HTTPException(401, "Invalid token")
    except JWTError:
        raise HTTPException(401, "Invalid token")
    user = await users_col.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user


# ---------- File analysis helpers ----------
GENERIC_PATTERNS = [
    re.compile(r"^IMG[_\-]?\d+", re.I),
    re.compile(r"^DSC[_\-]?\d+", re.I),
    re.compile(r"^PHOTO[_\-]?\d+", re.I),
    re.compile(r"^PXL[_\-]?\d+", re.I),
    re.compile(r"^Screenshot[_\-]", re.I),
    re.compile(r"^VID[_\-]?\d+", re.I),
    re.compile(r"^MOV[_\-]?\d+", re.I),
    re.compile(r"^Document[_\-]?\d*", re.I),
    re.compile(r"^Untitled", re.I),
    re.compile(r"^New[ _]Document", re.I),
    re.compile(r"^Copy of", re.I),
    re.compile(r"^scan[_\-]?\d*", re.I),
    re.compile(r"^file[_\-]?\d+", re.I),
    re.compile(r"^\d{8}[_\-]?\d{6}", re.I),  # timestamp-style names
]


def is_generic_name(name: str) -> bool:
    base = os.path.splitext(name)[0].strip()
    if len(base) < 4:
        return True
    for p in GENERIC_PATTERNS:
        if p.match(base):
            return True
    return False


def extract_text_from_bytes(data: bytes, mime: str, name: str) -> str:
    """Best-effort text extraction. Returns at most ~4000 chars."""
    name_lower = name.lower()
    try:
        if mime.startswith("text/") or name_lower.endswith((".txt", ".md", ".csv", ".json", ".log")):
            return data.decode("utf-8", errors="ignore")[:4000]
        if name_lower.endswith(".pdf") or mime == "application/pdf":
            try:
                from pypdf import PdfReader
                reader = PdfReader(io.BytesIO(data))
                texts = []
                for page in reader.pages[:5]:
                    texts.append(page.extract_text() or "")
                return ("\n".join(texts))[:4000]
            except Exception as e:
                logger.warning(f"PDF extract failed: {e}")
                return ""
        if name_lower.endswith(".docx"):
            try:
                from docx import Document
                doc = Document(io.BytesIO(data))
                return ("\n".join(p.text for p in doc.paragraphs))[:4000]
            except Exception as e:
                logger.warning(f"DOCX extract failed: {e}")
                return ""
    except Exception as e:
        logger.warning(f"Text extract failed: {e}")
    return ""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------- AI helpers ----------
async def ai_suggest_filename(name: str, text_preview: str, mime: str) -> Optional[str]:
    """Use Claude to suggest a meaningful filename."""
    if not text_preview and not mime.startswith("image/"):
        return None
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"rename-{uuid.uuid4()}",
            system_message=(
                "You are a file naming assistant. Given a file's current name, mime type and content preview, "
                "suggest a concise descriptive filename (no extension, max 50 chars, kebab or snake case, "
                "no special chars). Return ONLY the suggested filename, nothing else."
            ),
        ).with_model("anthropic", CLAUDE_MODEL)

        prompt = f"Current name: {name}\nMime: {mime}\nContent preview:\n{text_preview[:2000] or '(no text content - likely an image)'}\n\nSuggest a better filename:"
        resp = await chat.send_message(UserMessage(text=prompt))
        suggestion = (resp or "").strip().split("\n")[0].strip()
        # sanitize
        suggestion = re.sub(r'[^A-Za-z0-9_\-]', '_', suggestion)[:50]
        if not suggestion or suggestion.lower() == name.lower():
            return None
        ext = os.path.splitext(name)[1]
        return f"{suggestion}{ext}"
    except Exception as e:
        logger.warning(f"AI rename failed: {e}")
        return None


async def ai_pick_most_comprehensive(files: List[dict]) -> dict:
    """Given list of similar files, ask Claude which is most comprehensive."""
    if len(files) <= 1:
        return {"keep_id": files[0]["id"] if files else None, "reason": "single file"}
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"dedup-{uuid.uuid4()}",
            system_message=(
                "You are a file deduplication assistant. Given several files with similar content, "
                "identify which ONE has the MOST COMPREHENSIVE content (longest, most complete, most recent if tied). "
                "Respond in this exact format on two lines:\n"
                "KEEP: <file_id>\nREASON: <one-sentence reason>"
            ),
        ).with_model("anthropic", CLAUDE_MODEL)

        payload = "\n\n".join([
            f"FILE_ID: {f['id']}\nName: {f['name']}\nSize: {f['size']} bytes\nDate: {f.get('created_at','')}\nPreview:\n{(f.get('text_preview') or '')[:800]}"
            for f in files
        ])
        resp = await chat.send_message(UserMessage(text=f"Files:\n{payload}\n\nWhich should we KEEP?"))
        keep_id = None
        reason = ""
        for line in (resp or "").splitlines():
            if line.upper().startswith("KEEP:"):
                keep_id = line.split(":", 1)[1].strip()
            if line.upper().startswith("REASON:"):
                reason = line.split(":", 1)[1].strip()
        if keep_id not in [f["id"] for f in files]:
            # fallback: pick largest
            keep_id = max(files, key=lambda x: x.get("size", 0))["id"]
            reason = reason or "Selected largest file as most comprehensive."
        return {"keep_id": keep_id, "reason": reason or "AI selected most comprehensive version."}
    except Exception as e:
        logger.warning(f"AI dedup failed: {e}")
        keep = max(files, key=lambda x: x.get("size", 0))
        return {"keep_id": keep["id"], "reason": "Fallback: kept largest file."}


# ---------- External source helpers ----------
async def drive_list_files(access_token: str, page_size: int = 100) -> List[dict]:
    """List files from Google Drive."""
    headers = {"Authorization": f"Bearer {access_token}"}
    params = {
        "pageSize": page_size,
        "fields": "files(id,name,mimeType,size,createdTime,md5Checksum)",
        "q": "trashed=false and mimeType != 'application/vnd.google-apps.folder'",
    }
    async with httpx.AsyncClient(timeout=30) as ac:
        r = await ac.get("https://www.googleapis.com/drive/v3/files", headers=headers, params=params)
        if r.status_code != 200:
            raise HTTPException(400, f"Drive API error: {r.text[:200]}")
        return r.json().get("files", [])


async def drive_download_sample(access_token: str, file_id: str, max_bytes: int = 200000) -> bytes:
    """Download up to max_bytes of a Drive file."""
    headers = {"Authorization": f"Bearer {access_token}", "Range": f"bytes=0-{max_bytes-1}"}
    async with httpx.AsyncClient(timeout=30) as ac:
        r = await ac.get(f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media", headers=headers)
        if r.status_code not in (200, 206):
            return b""
        return r.content


async def drive_delete(access_token: str, file_id: str) -> bool:
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=15) as ac:
        r = await ac.delete(f"https://www.googleapis.com/drive/v3/files/{file_id}", headers=headers)
        return r.status_code in (200, 204)


async def drive_rename(access_token: str, file_id: str, new_name: str) -> bool:
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15) as ac:
        r = await ac.patch(
            f"https://www.googleapis.com/drive/v3/files/{file_id}",
            headers=headers,
            json={"name": new_name},
        )
        return r.status_code == 200


async def dropbox_list_files(access_token: str) -> List[dict]:
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    out: List[dict] = []
    cursor = None
    async with httpx.AsyncClient(timeout=30) as ac:
        # initial
        body = {"path": "", "recursive": True, "limit": 1000}
        r = await ac.post("https://api.dropboxapi.com/2/files/list_folder", headers=headers, json=body)
        if r.status_code != 200:
            raise HTTPException(400, f"Dropbox API error: {r.text[:200]}")
        data = r.json()
        for e in data.get("entries", []):
            if e.get(".tag") == "file":
                out.append(e)
        cursor = data.get("cursor") if data.get("has_more") else None
        # one continuation only to limit
        if cursor:
            r = await ac.post(
                "https://api.dropboxapi.com/2/files/list_folder/continue",
                headers=headers,
                json={"cursor": cursor},
            )
            if r.status_code == 200:
                for e in r.json().get("entries", []):
                    if e.get(".tag") == "file":
                        out.append(e)
    return out[:200]


async def dropbox_download_sample(access_token: str, path: str, max_bytes: int = 200000) -> bytes:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Dropbox-API-Arg": f'{{"path":"{path}"}}',
        "Range": f"bytes=0-{max_bytes-1}",
    }
    async with httpx.AsyncClient(timeout=30) as ac:
        r = await ac.post("https://content.dropboxapi.com/2/files/download", headers=headers)
        if r.status_code not in (200, 206):
            return b""
        return r.content


async def dropbox_delete(access_token: str, path: str) -> bool:
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15) as ac:
        r = await ac.post("https://api.dropboxapi.com/2/files/delete_v2", headers=headers, json={"path": path})
        return r.status_code == 200


async def dropbox_rename(access_token: str, path: str, new_name: str) -> bool:
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    new_path = "/".join(path.split("/")[:-1] + [new_name])
    if not new_path.startswith("/"):
        new_path = "/" + new_path
    async with httpx.AsyncClient(timeout=15) as ac:
        r = await ac.post(
            "https://api.dropboxapi.com/2/files/move_v2",
            headers=headers,
            json={"from_path": path, "to_path": new_path},
        )
        return r.status_code == 200


# ---------- Routes ----------
@api.get("/")
async def root():
    return {"message": "Smart File Scan API", "version": "1.0"}


@api.post("/auth/signup", response_model=Token)
async def signup(payload: UserSignup):
    existing = await users_col.find_one({"email": payload.email.lower()})
    if existing:
        raise HTTPException(400, "Email already registered")
    uid = str(uuid.uuid4())
    user_doc = {
        "id": uid,
        "email": payload.email.lower(),
        "full_name": payload.full_name,
        "password_hash": hash_pw(payload.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await users_col.insert_one(user_doc)
    return Token(
        access_token=create_token(uid),
        user={"id": uid, "email": user_doc["email"], "full_name": user_doc.get("full_name")},
    )


@api.post("/auth/login", response_model=Token)
async def login(payload: UserLogin):
    user = await users_col.find_one({"email": payload.email.lower()})
    if not user or not verify_pw(payload.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    return Token(
        access_token=create_token(user["id"]),
        user={"id": user["id"], "email": user["email"], "full_name": user.get("full_name")},
    )


@api.get("/auth/me", response_model=UserOut)
async def me(current: dict = Depends(get_current_user)):
    return UserOut(id=current["id"], email=current["email"], full_name=current.get("full_name"))


# ----- Sources -----
@api.get("/sources")
async def list_sources(current: dict = Depends(get_current_user)):
    srcs = await sources_col.find(
        {"user_id": current["id"]},
        {"_id": 0, "access_token": 0},
    ).to_list(100)
    return {"sources": srcs}


@api.post("/sources/gdrive")
async def connect_gdrive(body: ConnectDrive, current: dict = Depends(get_current_user)):
    # validate token by calling drive
    try:
        await drive_list_files(body.access_token, page_size=1)
    except HTTPException as e:
        raise e
    sid = str(uuid.uuid4())
    doc = {
        "id": sid,
        "user_id": current["id"],
        "type": "gdrive",
        "label": body.account_label,
        "access_token": body.access_token,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await sources_col.insert_one(doc)
    return {"id": sid, "type": "gdrive", "label": body.account_label}


@api.post("/sources/dropbox")
async def connect_dropbox(body: ConnectDropbox, current: dict = Depends(get_current_user)):
    try:
        await dropbox_list_files(body.access_token)
    except HTTPException as e:
        raise e
    sid = str(uuid.uuid4())
    doc = {
        "id": sid,
        "user_id": current["id"],
        "type": "dropbox",
        "label": body.account_label,
        "access_token": body.access_token,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await sources_col.insert_one(doc)
    return {"id": sid, "type": "dropbox", "label": body.account_label}


@api.delete("/sources/{source_id}")
async def disconnect_source(source_id: str, current: dict = Depends(get_current_user)):
    res = await sources_col.delete_one({"id": source_id, "user_id": current["id"]})
    # delete associated files
    await files_col.delete_many({"user_id": current["id"], "source_id": source_id})
    return {"deleted": res.deleted_count}


# ----- Files -----
@api.post("/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    current: dict = Depends(get_current_user),
):
    """Upload a single device file. Computes hash + text preview, stores metadata."""
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, "File too large (>25MB)")
    sha = sha256_bytes(data)
    name = file.filename or "unnamed"
    mime = file.content_type or ""
    text = extract_text_from_bytes(data, mime, name)
    fid = str(uuid.uuid4())
    rec = {
        "id": fid,
        "user_id": current["id"],
        "source": "internal",
        "source_id": None,
        "external_id": None,
        "name": name,
        "size": len(data),
        "mime_type": mime,
        "sha256": sha,
        "text_preview": text,
        "is_generic_name": is_generic_name(name),
        "ai_suggested_name": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await files_col.insert_one(rec)
    rec.pop("_id", None)
    return rec


@api.get("/files")
async def list_files(current: dict = Depends(get_current_user)):
    files = await files_col.find(
        {"user_id": current["id"]},
        {"_id": 0, "user_id": 0},
    ).to_list(2000)
    return {"files": files, "count": len(files)}


@api.delete("/files/{file_id}")
async def delete_file(file_id: str, current: dict = Depends(get_current_user)):
    rec = await files_col.find_one({"id": file_id, "user_id": current["id"]})
    if not rec:
        raise HTTPException(404, "File not found")

    # If external source, delete remotely
    if rec["source"] in ("gdrive", "dropbox") and rec.get("source_id"):
        src = await sources_col.find_one({"id": rec["source_id"], "user_id": current["id"]})
        if src:
            try:
                if rec["source"] == "gdrive":
                    await drive_delete(src["access_token"], rec["external_id"])
                elif rec["source"] == "dropbox":
                    await dropbox_delete(src["access_token"], rec["external_id"])
            except Exception as e:
                logger.warning(f"Remote delete failed: {e}")
    await files_col.delete_one({"id": file_id, "user_id": current["id"]})
    return {"deleted": True, "source": rec["source"]}


@api.post("/files/{file_id}/rename")
async def rename_file(file_id: str, body: RenameApprove, current: dict = Depends(get_current_user)):
    rec = await files_col.find_one({"id": file_id, "user_id": current["id"]})
    if not rec:
        raise HTTPException(404, "File not found")
    new_name = body.new_name.strip()
    if not new_name:
        raise HTTPException(400, "Name cannot be empty")

    if rec["source"] in ("gdrive", "dropbox") and rec.get("source_id"):
        src = await sources_col.find_one({"id": rec["source_id"], "user_id": current["id"]})
        if src:
            try:
                if rec["source"] == "gdrive":
                    await drive_rename(src["access_token"], rec["external_id"], new_name)
                elif rec["source"] == "dropbox":
                    await dropbox_rename(src["access_token"], rec["external_id"], new_name)
            except Exception as e:
                logger.warning(f"Remote rename failed: {e}")
    await files_col.update_one(
        {"id": file_id},
        {"$set": {"name": new_name, "is_generic_name": False, "ai_suggested_name": None}},
    )
    return {"renamed": True, "new_name": new_name}


# ----- Scanning -----
@api.post("/scan/gdrive/{source_id}")
async def scan_gdrive(source_id: str, current: dict = Depends(get_current_user)):
    src = await sources_col.find_one({"id": source_id, "user_id": current["id"], "type": "gdrive"})
    if not src:
        raise HTTPException(404, "Source not found")
    files = await drive_list_files(src["access_token"], page_size=100)
    added = 0
    for f in files:
        external_id = f["id"]
        # skip if already scanned
        if await files_col.find_one({"user_id": current["id"], "source_id": source_id, "external_id": external_id}):
            continue
        name = f.get("name", "unnamed")
        mime = f.get("mimeType", "")
        size = int(f.get("size", 0) or 0)
        sha = f.get("md5Checksum", "")  # Drive provides md5 for binary files
        text = ""
        # download sample to compute sha256 + text for textual files
        if size and size < 5 * 1024 * 1024 and (mime.startswith("text/") or name.lower().endswith((".txt", ".md", ".pdf", ".docx", ".csv", ".json"))):
            try:
                data = await drive_download_sample(src["access_token"], external_id, max_bytes=200000)
                if data:
                    sha = sha256_bytes(data) if not sha else sha
                    text = extract_text_from_bytes(data, mime, name)
            except Exception as e:
                logger.warning(f"Drive sample download failed: {e}")
        if not sha:
            # fallback: hash from metadata
            sha = hashlib.sha256(f"{name}-{size}-{external_id}".encode()).hexdigest()
        rec = {
            "id": str(uuid.uuid4()),
            "user_id": current["id"],
            "source": "gdrive",
            "source_id": source_id,
            "external_id": external_id,
            "name": name,
            "size": size,
            "mime_type": mime,
            "sha256": sha,
            "text_preview": text,
            "is_generic_name": is_generic_name(name),
            "ai_suggested_name": None,
            "created_at": f.get("createdTime") or datetime.now(timezone.utc).isoformat(),
        }
        await files_col.insert_one(rec)
        added += 1
    return {"added": added, "total_listed": len(files)}


@api.post("/scan/dropbox/{source_id}")
async def scan_dropbox(source_id: str, current: dict = Depends(get_current_user)):
    src = await sources_col.find_one({"id": source_id, "user_id": current["id"], "type": "dropbox"})
    if not src:
        raise HTTPException(404, "Source not found")
    files = await dropbox_list_files(src["access_token"])
    added = 0
    for f in files:
        external_id = f.get("path_lower") or f.get("path_display") or f.get("id")
        if not external_id:
            continue
        if await files_col.find_one({"user_id": current["id"], "source_id": source_id, "external_id": external_id}):
            continue
        name = f.get("name", "unnamed")
        size = int(f.get("size", 0) or 0)
        sha = f.get("content_hash", "")  # dropbox-specific hash
        text = ""
        mime = ""
        if size and size < 5 * 1024 * 1024 and name.lower().endswith((".txt", ".md", ".pdf", ".docx", ".csv", ".json")):
            try:
                data = await dropbox_download_sample(src["access_token"], external_id, max_bytes=200000)
                if data:
                    sha = sha256_bytes(data)
                    text = extract_text_from_bytes(data, mime, name)
            except Exception as e:
                logger.warning(f"Dropbox sample download failed: {e}")
        if not sha:
            sha = hashlib.sha256(f"{name}-{size}-{external_id}".encode()).hexdigest()
        rec = {
            "id": str(uuid.uuid4()),
            "user_id": current["id"],
            "source": "dropbox",
            "source_id": source_id,
            "external_id": external_id,
            "name": name,
            "size": size,
            "mime_type": mime,
            "sha256": sha,
            "text_preview": text,
            "is_generic_name": is_generic_name(name),
            "ai_suggested_name": None,
            "created_at": f.get("client_modified") or datetime.now(timezone.utc).isoformat(),
        }
        await files_col.insert_one(rec)
        added += 1
    return {"added": added, "total_listed": len(files)}


# ----- Dedup + rename suggestions -----
@api.post("/scan/analyze")
async def analyze(current: dict = Depends(get_current_user)):
    """Group duplicates by sha256, then for groups with size>1 ask AI which is most comprehensive."""
    files = await files_col.find(
        {"user_id": current["id"]},
        {"_id": 0, "user_id": 0},
    ).to_list(5000)

    # group by sha256
    groups: Dict[str, List[dict]] = {}
    for f in files:
        groups.setdefault(f["sha256"], []).append(f)

    dup_groups = [g for g in groups.values() if len(g) > 1]
    analyzed = []
    space_recoverable = 0
    for g in dup_groups:
        # for textual files use AI; for binary just pick most recent largest
        has_text = any(f.get("text_preview") for f in g)
        if has_text:
            decision = await ai_pick_most_comprehensive(g)
        else:
            keep = max(g, key=lambda x: (x.get("size", 0), x.get("created_at", "")))
            decision = {"keep_id": keep["id"], "reason": "Largest/most recent identical file kept."}
        group_size = sum(f.get("size", 0) for f in g if f["id"] != decision["keep_id"])
        space_recoverable += group_size
        analyzed.append({
            "files": g,
            "keep_id": decision["keep_id"],
            "reason": decision["reason"],
            "space_recoverable": group_size,
        })

    # Cache result
    await db.scan_results.update_one(
        {"user_id": current["id"]},
        {"$set": {
            "user_id": current["id"],
            "duplicate_groups": analyzed,
            "total_files": len(files),
            "duplicate_groups_count": len(analyzed),
            "space_recoverable": space_recoverable,
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )

    return {
        "total_files": len(files),
        "duplicate_groups_count": len(analyzed),
        "space_recoverable": space_recoverable,
        "duplicate_groups": analyzed,
    }


@api.get("/scan/rename-candidates")
async def rename_candidates(current: dict = Depends(get_current_user)):
    """List files with generic names and lazily fetch AI suggestions."""
    files = await files_col.find(
        {"user_id": current["id"], "is_generic_name": True},
        {"_id": 0, "user_id": 0},
    ).to_list(200)

    # Get AI suggestion for files that don't have one yet (limit per call to avoid timeout)
    to_process = [f for f in files if not f.get("ai_suggested_name")][:10]
    sem = asyncio.Semaphore(3)

    async def process(f):
        async with sem:
            suggestion = await ai_suggest_filename(f["name"], f.get("text_preview", ""), f.get("mime_type", ""))
            if suggestion:
                await files_col.update_one({"id": f["id"]}, {"$set": {"ai_suggested_name": suggestion}})
                f["ai_suggested_name"] = suggestion

    await asyncio.gather(*[process(f) for f in to_process])

    # Re-fetch updated
    files = await files_col.find(
        {"user_id": current["id"], "is_generic_name": True},
        {"_id": 0, "user_id": 0},
    ).to_list(200)
    files = [f for f in files if f.get("ai_suggested_name")]
    return {"candidates": files, "count": len(files)}


@api.get("/dashboard/stats")
async def stats(current: dict = Depends(get_current_user)):
    total_files = await files_col.count_documents({"user_id": current["id"]})
    sources_count = await sources_col.count_documents({"user_id": current["id"]})
    internal_files = await files_col.count_documents({"user_id": current["id"], "source": "internal"})
    gdrive_files = await files_col.count_documents({"user_id": current["id"], "source": "gdrive"})
    dropbox_files = await files_col.count_documents({"user_id": current["id"], "source": "dropbox"})
    generic_count = await files_col.count_documents({"user_id": current["id"], "is_generic_name": True})

    last_scan = await db.scan_results.find_one(
        {"user_id": current["id"]},
        {"_id": 0, "duplicate_groups": 0},
    )

    return {
        "total_files": total_files,
        "sources_count": sources_count,
        "internal_files": internal_files,
        "gdrive_files": gdrive_files,
        "dropbox_files": dropbox_files,
        "generic_named_files": generic_count,
        "duplicate_groups_count": (last_scan or {}).get("duplicate_groups_count", 0),
        "space_recoverable": (last_scan or {}).get("space_recoverable", 0),
        "last_scan_at": (last_scan or {}).get("analyzed_at"),
    }


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await users_col.create_index("email", unique=True)
    await files_col.create_index([("user_id", 1), ("sha256", 1)])
    await sources_col.create_index([("user_id", 1)])


@app.on_event("shutdown")
async def shutdown():
    client.close()
