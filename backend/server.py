"""
Smart File Scan & Dedup Backend
- JWT Auth
- Storage source connections (Internal device, Google Drive, Dropbox, OneDrive)
- File metadata storage + content hashing + text extraction
- AI-powered duplicate detection (Claude, via direct Anthropic API)
- AI-powered file rename suggestions
- File deletion across sources
"""
from fastapi import FastAPI, APIRouter, HTTPException, status, Depends, UploadFile, File, Form, Request
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import io
import uuid
import hashlib
import hmac
import json
import logging
import asyncio
import httpx
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Annotated, Dict, Any
from pydantic import BaseModel, EmailStr, Field
from passlib.context import CryptContext
from jose import jwt, JWTError

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("ravensharp-smartcleaner")

# --- Self-healing startup config, matching every other RavenSharp backend ---
# (This file previously used bare os.environ[...] for MONGO_URL/DB_NAME/
# JWT_SECRET_KEY with zero error handling — a missing var crashed with a raw
# KeyError and no indication of what to actually fix.)
_startup_warnings = []

MONGO_URL = os.environ.get("MONGO_URL")
if not MONGO_URL:
    logger.critical(
        "STARTUP FAILURE: MONGO_URL is not set on this deployment. "
        "The app cannot start without a database connection string. "
        "Set MONGO_URL in Railway's environment variables for this service and redeploy."
    )
    raise RuntimeError("Missing required environment variable: MONGO_URL")

DB_NAME = os.environ.get("DB_NAME")
if not DB_NAME:
    DB_NAME = "ravensharp_smartcleaner"
    _startup_warnings.append(f"DB_NAME was not set — defaulting to '{DB_NAME}'.")

JWT_SECRET = os.environ.get("JWT_SECRET_KEY")
if not JWT_SECRET:
    import secrets as _secrets
    JWT_SECRET = _secrets.token_hex(32)
    _startup_warnings.append(
        "JWT_SECRET_KEY was not set — auto-generated a temporary one for this boot. "
        "Existing user sessions will be invalidated on every restart until a permanent "
        "JWT_SECRET_KEY is set in Railway's environment variables."
    )

JWT_ALG = os.environ.get('JWT_ALGORITHM', 'HS256')
TOKEN_EXPIRE_MIN = int(os.environ.get('ACCESS_TOKEN_EXPIRE_MINUTES', '1440'))

# Replaces EMERGENT_LLM_KEY / emergentintegrations, which is tied to Emergent's
# own platform and hard-crashed (raw os.environ[...]) outside it.
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
if not ANTHROPIC_API_KEY:
    _startup_warnings.append(
        "ANTHROPIC_API_KEY was not set — AI rename suggestions and AI dedup picking will "
        "fall back to non-AI defaults (largest-file-wins) instead of failing outright."
    )
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5")

OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "ascensiondigitalagency@outlook.com")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")
STRIPE_KEY = os.environ.get("STRIPE_API_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
if STRIPE_KEY and not STRIPE_WEBHOOK_SECRET:
    _startup_warnings.append(
        "STRIPE_WEBHOOK_SECRET was not set — /billing/webhook will REJECT all events (fail-closed) "
        "until this is set. Get it from Stripe Dashboard -> Developers -> Webhooks."
    )
# TODO: replace with the real Stripe Price ID once created
STRIPE_PRO_PRICE_ID = os.environ.get("STRIPE_PRO_PRICE_ID", "price_REPLACE_PRO")

# Free tier: 1 storage source connected, 20 scans/month. Pro: unlimited
# sources, unlimited scans. (First tier design for this app — adjust freely,
# nothing else in the codebase assumes these specific numbers.)
TIERS = {
    "free": {"max_sources": 1, "scans_per_month": 20, "price": 0},
    "pro":  {"max_sources": 999, "scans_per_month": 99999, "price": 9},
    "owner": {"max_sources": 999, "scans_per_month": 99999, "price": 0},
}

for _w in _startup_warnings:
    logger.warning("STARTUP: %s", _w)

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
users_col = db.users
files_col = db.files
sources_col = db.sources  # Google Drive / Dropbox connections

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

app = FastAPI(title="Smart File Scan API")
api = APIRouter(prefix="/api")

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


class ConnectOneDrive(BaseModel):
    access_token: str
    account_label: str = "My OneDrive"


class ConnectGPhotos(BaseModel):
    access_token: str
    account_label: str = "My Google Photos"


class RenameApprove(BaseModel):
    new_name: str


class FileRecord(BaseModel):
    id: str
    name: str
    source: str  # internal | gdrive | dropbox | onedrive | gphotos
    source_id: Optional[str] = None  # for gdrive/dropbox/onedrive/gphotos link
    external_id: Optional[str] = None  # file id in external source
    size: int = 0
    mime_type: str = ""
    sha256: str = ""
    phash: Optional[str] = None  # perceptual hash, images only — see compute_image_phash()
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
    if user.get("email", "").lower() == OWNER_EMAIL.lower() and user.get("tier") != "owner":
        await users_col.update_one({"id": uid}, {"$set": {"tier": "owner"}})
        user["tier"] = "owner"
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


def compute_image_phash(data: bytes) -> Optional[str]:
    """Perceptual hash (average hash) — lets us cluster visually similar
    images (resized, recompressed, slightly cropped/re-edited) even when
    they're NOT byte-identical, unlike sha256 which only catches exact
    duplicates. Returns a 64-char '0'/'1' string, or None if the image
    can't be decoded (e.g. a partial/truncated download sample)."""
    try:
        from PIL import Image, ImageFile
        ImageFile.LOAD_TRUNCATED_IMAGES = True  # best-effort on partial samples
        img = Image.open(io.BytesIO(data)).convert("L").resize((8, 8))
        pixels = list(img.getdata())
        avg = sum(pixels) / len(pixels)
        return "".join("1" if p >= avg else "0" for p in pixels)
    except Exception as e:
        logger.info(f"phash computation skipped (not a decodable image or truncated sample): {e}")
        return None


def phash_hamming_distance(hash_a: str, hash_b: str) -> int:
    """Lower = more visually similar. 0 = identical hash. For a 64-bit hash,
    a distance of ~10 or less is a reasonable 'probably the same photo'
    threshold — tune based on real-world results once this is live."""
    if not hash_a or not hash_b or len(hash_a) != len(hash_b):
        return 64  # max distance — treat as "not similar" if unusable
    return sum(a != b for a, b in zip(hash_a, hash_b))


# ---------- AI helpers ----------
async def _call_claude(system_message: str, user_text: str, max_tokens: int = 300) -> str:
    """Direct call to Anthropic's API — replaces Emergent's emergentintegrations
    wrapper, which is tied to Emergent's own EMERGENT_LLM_KEY and hard-crashes
    on startup outside their platform (os.environ['EMERGENT_LLM_KEY'] with no
    default). This needs ANTHROPIC_API_KEY set on Railway instead."""
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")
    async with httpx.AsyncClient(timeout=30) as client_http:
        res = await client_http.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": CLAUDE_MODEL,
                "max_tokens": max_tokens,
                "system": system_message,
                "messages": [{"role": "user", "content": user_text}],
            },
        )
        if res.status_code != 200:
            raise RuntimeError(f"Claude API error {res.status_code}: {res.text[:300]}")
        data = res.json()
        return "".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")


async def ai_suggest_filename(name: str, text_preview: str, mime: str) -> Optional[str]:
    """Use Claude to suggest a meaningful filename."""
    if not text_preview and not mime.startswith("image/"):
        return None
    try:
        system_message = (
            "You are a file naming assistant. Given a file's current name, mime type and content preview, "
            "suggest a concise descriptive filename (no extension, max 50 chars, kebab or snake case, "
            "no special chars). Return ONLY the suggested filename, nothing else."
        )
        prompt = f"Current name: {name}\nMime: {mime}\nContent preview:\n{text_preview[:2000] or '(no text content - likely an image)'}\n\nSuggest a better filename:"
        resp = await _call_claude(system_message, prompt, max_tokens=60)
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


def text_shingles(text: str, k: int = 5) -> set:
    """Generate k-word shingles from normalized text for content-similarity clustering."""
    if not text or len(text) < 20:
        return set()
    words = re.findall(r'\w+', text.lower())
    if len(words) < k:
        return set()
    return {' '.join(words[i:i + k]) for i in range(len(words) - k + 1)}


def jaccard(a: set, b: set) -> float:
    """Jaccard similarity between two shingle sets."""
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def cluster_by_content(files: List[dict], threshold: float = 0.35) -> List[List[dict]]:
    """Cluster files whose text content overlaps (Jaccard >= threshold).
    Uses union-find on the similarity graph."""
    n = len(files)
    if n < 2:
        return []
    shingles = [text_shingles(f.get("text_preview", "")) for f in files]
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in range(n):
        if not shingles[i]:
            continue
        for j in range(i + 1, n):
            if not shingles[j]:
                continue
            if jaccard(shingles[i], shingles[j]) >= threshold:
                union(i, j)

    groups: Dict[int, List[dict]] = {}
    for i in range(n):
        if shingles[i]:
            groups.setdefault(find(i), []).append(files[i])
    return [g for g in groups.values() if len(g) > 1]


def cluster_by_image_similarity(files: List[dict], max_distance: int = 10) -> List[List[dict]]:
    """Cluster visually-similar images (resized, recompressed, lightly
    edited/cropped) using perceptual-hash Hamming distance, regardless of
    filename — mirrors cluster_by_content()'s approach for text files.
    Uses union-find on the similarity graph, same as cluster_by_content."""
    n = len(files)
    if n < 2:
        return []
    hashes = [f.get("phash") for f in files]
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in range(n):
        if not hashes[i]:
            continue
        for j in range(i + 1, n):
            if not hashes[j]:
                continue
            if phash_hamming_distance(hashes[i], hashes[j]) <= max_distance:
                union(i, j)

    groups: Dict[int, List[dict]] = {}
    for i in range(n):
        if hashes[i]:
            groups.setdefault(find(i), []).append(files[i])
    return [g for g in groups.values() if len(g) > 1]


def filename_root(name: str) -> str:
    """Strip versioning/draft suffixes & extensions to get a 'root' for clustering near-duplicates.
    e.g. 'report-v2 (1).docx', 'report_draft.docx', 'report final.docx' -> 'report'."""
    base = os.path.splitext(name)[0].lower().strip()
    # Strip trailing patterns iteratively
    patterns = [
        r"\s*\(\d+\)$",            # " (1)"
        r"[\s_\-]*copy(\s*\d*)?$",  # "_copy", "-copy 2"
        r"[\s_\-]*v\d+$",           # "-v2"
        r"[\s_\-]*version\s*\d+$",  # " version 3"
        r"[\s_\-]*draft\d*$",       # "_draft", "draft2"
        r"[\s_\-]*final\d*$",       # " final"
        r"[\s_\-]*\d{4}[-_]\d{2}[-_]\d{2}$",  # date suffix
        r"[\s_\-]*\d{1,2}$",        # trailing number
        r"[\s_\-]*edited$",         # "edited"
        r"[\s_\-]*unfinished$",
        r"[\s_\-]*partial$",
        r"[\s_\-]*wip$",
    ]
    changed = True
    while changed:
        changed = False
        for p in patterns:
            new = re.sub(p, "", base, flags=re.IGNORECASE).strip()
            if new and new != base:
                base = new
                changed = True
    return base


async def ai_pick_most_comprehensive(files: List[dict]) -> dict:
    """Given list of similar files, ask Claude which is most comprehensive."""
    if len(files) <= 1:
        return {"keep_id": files[0]["id"] if files else None, "reason": "single file"}
    try:
        system_message = (
            "You are a file deduplication assistant for RavenSharp by Ascension Digital. "
            "Given several files that may be exact duplicates, drafts, partial/unfinished versions, "
            "or revisions of the same underlying document, identify which ONE has the MOST COMPREHENSIVE "
            "content — longest, most complete, most recent if tied. Watch out for: 'draft', 'v2', "
            "'(1)', 'final', or shorter sizes indicating partial/unfinished versions. "
            "Respond in this exact format on two lines:\n"
            "KEEP: <file_id>\nREASON: <one-sentence reason mentioning if others are drafts/partial/identical>"
        )
        payload = "\n\n".join([
            f"FILE_ID: {f['id']}\nName: {f['name']}\nSize: {f['size']} bytes\nDate: {f.get('created_at','')}\nPreview:\n{(f.get('text_preview') or '')[:800]}"
            for f in files
        ])
        resp = await _call_claude(system_message, f"Files:\n{payload}\n\nWhich should we KEEP?", max_tokens=150)
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
    import json
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Dropbox-API-Arg": json.dumps({"path": path}),
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


async def onedrive_list_files(access_token: str, page_size: int = 100) -> List[dict]:
    """List files from OneDrive via Microsoft Graph API."""
    headers = {"Authorization": f"Bearer {access_token}"}
    params = {"$top": page_size, "$select": "id,name,file,size,createdDateTime"}
    async with httpx.AsyncClient(timeout=30) as ac:
        r = await ac.get(
            "https://graph.microsoft.com/v1.0/me/drive/root/children",
            headers=headers, params=params,
        )
        if r.status_code != 200:
            raise HTTPException(400, f"OneDrive API error: {r.text[:200]}")
        # Filter out folders — only files have a "file" facet
        return [f for f in r.json().get("value", []) if "file" in f]


async def onedrive_download_sample(access_token: str, file_id: str, max_bytes: int = 200000) -> bytes:
    headers = {"Authorization": f"Bearer {access_token}", "Range": f"bytes=0-{max_bytes-1}"}
    async with httpx.AsyncClient(timeout=30) as ac:
        r = await ac.get(
            f"https://graph.microsoft.com/v1.0/me/drive/items/{file_id}/content",
            headers=headers,
        )
        if r.status_code not in (200, 206):
            raise HTTPException(400, f"OneDrive download error: {r.status_code}")
        return r.content


async def onedrive_delete(access_token: str, file_id: str) -> bool:
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=15) as ac:
        r = await ac.delete(f"https://graph.microsoft.com/v1.0/me/drive/items/{file_id}", headers=headers)
        return r.status_code in (200, 204)


async def onedrive_rename(access_token: str, file_id: str, new_name: str) -> bool:
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15) as ac:
        r = await ac.patch(
            f"https://graph.microsoft.com/v1.0/me/drive/items/{file_id}",
            headers=headers, json={"name": new_name},
        )
        return r.status_code == 200


async def gphotos_list_files(access_token: str, page_size: int = 100) -> List[dict]:
    """List media items from Google Photos via the Photos Library API.
    NOTE: this needs the photoslibrary.readonly (or .appendonly / .sharing)
    OAuth scope in addition to Drive's scope — a separate consent screen
    permission from regular Drive access."""
    headers = {"Authorization": f"Bearer {access_token}"}
    params = {"pageSize": page_size}
    async with httpx.AsyncClient(timeout=30) as ac:
        r = await ac.get(
            "https://photoslibrary.googleapis.com/v1/mediaItems",
            headers=headers, params=params,
        )
        if r.status_code != 200:
            raise HTTPException(400, f"Google Photos API error: {r.text[:200]}")
        items = r.json().get("mediaItems", [])
        # Normalize to the same shape used elsewhere (id/name/mimeType/size)
        return [
            {
                "id": item["id"],
                "name": item.get("filename", item["id"]),
                "mimeType": item.get("mimeType", "image/jpeg"),
                "size": None,  # Photos API doesn't expose file size directly
                "createdTime": item.get("mediaMetadata", {}).get("creationTime"),
                "_base_url": item.get("baseUrl"),
            }
            for item in items
        ]


async def gphotos_download_sample(access_token: str, media_item: dict, max_bytes: int = 200000) -> bytes:
    """Google Photos requires appending a size/download parameter to the
    item's baseUrl (which itself expires after ~60 minutes) rather than
    hitting a stable per-item content endpoint like Drive/OneDrive."""
    base_url = media_item.get("_base_url")
    if not base_url:
        raise HTTPException(400, "Google Photos media item missing baseUrl")
    async with httpx.AsyncClient(timeout=30) as ac:
        r = await ac.get(f"{base_url}=d")  # "=d" requests full download
        if r.status_code != 200:
            raise HTTPException(400, f"Google Photos download error: {r.status_code}")
        return r.content[:max_bytes]


async def gphotos_delete(access_token: str, media_item_id: str) -> bool:
    """IMPORTANT: the Google Photos Library API has no delete/trash endpoint
    for media items created outside your own app (i.e. photos the user took
    with their camera, not uploaded through this app) — Google intentionally
    restricts this to protect users' photo libraries. Deletion for
    non-app-created items has to be done by the user in the Google Photos
    app itself; this function will only work for items this app uploaded."""
    logger.warning(
        "gphotos_delete called — Google Photos API cannot delete items not "
        "created by this app. This will likely fail for pre-existing photos."
    )
    return False


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
    tier = "owner" if payload.email.lower() == OWNER_EMAIL.lower() else "free"
    user_doc = {
        "id": uid,
        "email": payload.email.lower(),
        "full_name": payload.full_name,
        "password_hash": hash_pw(payload.password),
        "tier": tier,
        "scans_this_month": 0,
        "subscription_id": None,
        "payment_failed_at": None,
        "payment_failure_count": 0,
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


@api.post("/sources/onedrive")
async def connect_onedrive(body: ConnectOneDrive, current: dict = Depends(get_current_user)):
    try:
        await onedrive_list_files(body.access_token, page_size=1)
    except HTTPException as e:
        raise e
    sid = str(uuid.uuid4())
    doc = {
        "id": sid,
        "user_id": current["id"],
        "type": "onedrive",
        "label": body.account_label,
        "access_token": body.access_token,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await sources_col.insert_one(doc)
    return {"id": sid, "type": "onedrive", "label": body.account_label}


@api.post("/sources/gphotos")
async def connect_gphotos(body: ConnectGPhotos, current: dict = Depends(get_current_user)):
    try:
        await gphotos_list_files(body.access_token, page_size=1)
    except HTTPException as e:
        raise e
    sid = str(uuid.uuid4())
    doc = {
        "id": sid,
        "user_id": current["id"],
        "type": "gphotos",
        "label": body.account_label,
        "access_token": body.access_token,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await sources_col.insert_one(doc)
    return {"id": sid, "type": "gphotos", "label": body.account_label}


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
    phash = compute_image_phash(data) if mime.startswith("image/") else None
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
        "phash": phash,
        "text_preview": text,
        "is_generic_name": is_generic_name(name),
        "ai_suggested_name": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await files_col.insert_one(rec)
    rec.pop("_id", None)
    return rec


class FileRegisterItem(BaseModel):
    name: str
    size: int = 0
    mime_type: str = ""
    sha256: str
    external_id: Optional[str] = None  # device asset id
    created_at: Optional[str] = None


class FileRegisterBatch(BaseModel):
    items: List[FileRegisterItem]


@api.post("/files/register")
async def register_files(body: FileRegisterBatch, current: dict = Depends(get_current_user)):
    """Register device media (photos/videos) by metadata + hash only — no upload.
    Skips already-registered (same sha256 + external_id) records."""
    added = 0
    for item in body.items:
        # dedupe by (user, sha256, external_id) to avoid re-adding the same asset
        existing = await files_col.find_one({
            "user_id": current["id"],
            "sha256": item.sha256,
            "source": "internal",
            "external_id": item.external_id,
        })
        if existing:
            continue
        rec = {
            "id": str(uuid.uuid4()),
            "user_id": current["id"],
            "source": "internal",
            "source_id": None,
            "external_id": item.external_id,
            "name": item.name,
            "size": item.size,
            "mime_type": item.mime_type,
            "sha256": item.sha256,
            "text_preview": "",
            "is_generic_name": is_generic_name(item.name),
            "ai_suggested_name": None,
            "created_at": item.created_at or datetime.now(timezone.utc).isoformat(),
        }
        await files_col.insert_one(rec)
        added += 1
    return {"added": added, "submitted": len(body.items)}


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
    if rec["source"] in ("gdrive", "dropbox", "onedrive", "gphotos") and rec.get("source_id"):
        src = await sources_col.find_one({"id": rec["source_id"], "user_id": current["id"]})
        if src:
            try:
                if rec["source"] == "gdrive":
                    await drive_delete(src["access_token"], rec["external_id"])
                elif rec["source"] == "dropbox":
                    await dropbox_delete(src["access_token"], rec["external_id"])
                elif rec["source"] == "onedrive":
                    await onedrive_delete(src["access_token"], rec["external_id"])
                elif rec["source"] == "gphotos":
                    # Will return False — Google Photos API can't delete
                    # items this app didn't create. See gphotos_delete()'s
                    # docstring. We still remove it from OUR records below
                    # so it stops showing as a duplicate here, even though
                    # it isn't actually deleted from the user's Photos library.
                    deleted = await gphotos_delete(src["access_token"], rec["external_id"])
                    if not deleted:
                        logger.info(f"gphotos_delete returned False for {rec['external_id']} (expected — see docstring)")
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

    if rec["source"] in ("gdrive", "dropbox", "onedrive") and rec.get("source_id"):
        src = await sources_col.find_one({"id": rec["source_id"], "user_id": current["id"]})
        if src:
            try:
                if rec["source"] == "gdrive":
                    await drive_rename(src["access_token"], rec["external_id"], new_name)
                elif rec["source"] == "dropbox":
                    await dropbox_rename(src["access_token"], rec["external_id"], new_name)
                elif rec["source"] == "onedrive":
                    await onedrive_rename(src["access_token"], rec["external_id"], new_name)
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
    # Batch existence check to avoid N+1
    existing_ids = {
        doc["external_id"]
        async for doc in files_col.find(
            {"user_id": current["id"], "source_id": source_id},
            {"external_id": 1, "_id": 0},
        )
    }
    added = 0
    for f in files:
        external_id = f["id"]
        if external_id in existing_ids:
            continue
        name = f.get("name", "unnamed")
        mime = f.get("mimeType", "")
        size = int(f.get("size", 0) or 0)
        sha = f.get("md5Checksum", "")  # Drive provides md5 for binary files
        text = ""
        phash = None
        # download sample to compute sha256 + text for textual files
        if size and size < 5 * 1024 * 1024 and (mime.startswith("text/") or name.lower().endswith((".txt", ".md", ".pdf", ".docx", ".csv", ".json"))):
            try:
                data = await drive_download_sample(src["access_token"], external_id, max_bytes=200000)
                if data:
                    sha = sha256_bytes(data) if not sha else sha
                    text = extract_text_from_bytes(data, mime, name)
            except Exception as e:
                logger.warning(f"Drive sample download failed: {e}")
        elif mime.startswith("image/") and size and size < 8 * 1024 * 1024:
            # NOTE: this is a best-effort partial download (200KB) — enough to
            # decode many JPEGs/PNGs for phash purposes, but not guaranteed
            # for every image. A full-file download would be more reliable
            # but costs more bandwidth per file across a large scan.
            try:
                data = await drive_download_sample(src["access_token"], external_id, max_bytes=200000)
                if data:
                    phash = compute_image_phash(data)
            except Exception as e:
                logger.warning(f"Drive image sample download failed: {e}")
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
            "phash": phash,
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
    # Batch existence check to avoid N+1
    existing_ids = {
        doc["external_id"]
        async for doc in files_col.find(
            {"user_id": current["id"], "source_id": source_id},
            {"external_id": 1, "_id": 0},
        )
    }
    added = 0
    for f in files:
        external_id = f.get("path_lower") or f.get("path_display") or f.get("id")
        if not external_id:
            continue
        if external_id in existing_ids:
            continue
        name = f.get("name", "unnamed")
        size = int(f.get("size", 0) or 0)
        sha = f.get("content_hash", "")  # dropbox-specific hash
        text = ""
        phash = None
        mime = ""
        name_lower = name.lower()
        if size and size < 5 * 1024 * 1024 and name_lower.endswith((".txt", ".md", ".pdf", ".docx", ".csv", ".json")):
            try:
                data = await dropbox_download_sample(src["access_token"], external_id, max_bytes=200000)
                if data:
                    sha = sha256_bytes(data)
                    text = extract_text_from_bytes(data, mime, name)
            except Exception as e:
                logger.warning(f"Dropbox sample download failed: {e}")
        elif size and size < 8 * 1024 * 1024 and name_lower.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic")):
            # Dropbox's list API doesn't return a mime type, so this branches
            # on extension instead. Same best-effort partial-download caveat
            # as the Drive scan above — see that comment for details.
            try:
                data = await dropbox_download_sample(src["access_token"], external_id, max_bytes=200000)
                if data:
                    phash = compute_image_phash(data)
                    mime = f"image/{name_lower.rsplit('.', 1)[-1].replace('jpg', 'jpeg')}"
            except Exception as e:
                logger.warning(f"Dropbox image sample download failed: {e}")
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
            "phash": phash,
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
    """Four-phase dedup:
    1. Exact duplicates by sha256 → AI picks most comprehensive.
    2. Near-duplicates / drafts: cluster by filename root + same extension.
       AI confirms they're variants and picks the most comprehensive.
    3. Content-similar text files regardless of filename (shingle/Jaccard).
       AI picks the most comprehensive.
    4. Visually-similar images regardless of filename (perceptual hash) —
       largest/most recent kept as the likely original/highest quality."""
    files = await files_col.find(
        {"user_id": current["id"]},
        {"_id": 0, "user_id": 0},
    ).to_list(5000)

    seen_in_group: set = set()

    # ----- Phase 1: exact hash duplicates -----
    hash_groups: Dict[str, List[dict]] = {}
    for f in files:
        hash_groups.setdefault(f["sha256"], []).append(f)

    analyzed = []
    space_recoverable = 0
    for g in hash_groups.values():
        if len(g) <= 1:
            continue
        has_text = any(f.get("text_preview") for f in g)
        if has_text:
            decision = await ai_pick_most_comprehensive(g)
        else:
            keep = max(g, key=lambda x: (x.get("size", 0), x.get("created_at", "")))
            decision = {"keep_id": keep["id"], "reason": "Largest/most recent identical file kept."}
        group_size = sum(f.get("size", 0) for f in g if f["id"] != decision["keep_id"])
        space_recoverable += group_size
        for f in g:
            seen_in_group.add(f["id"])
        analyzed.append({
            "kind": "exact_duplicate",
            "files": g,
            "keep_id": decision["keep_id"],
            "reason": decision["reason"],
            "space_recoverable": group_size,
        })

    # ----- Phase 2: near-duplicates / drafts by filename root -----
    # Only consider document-like files for draft clustering
    doc_exts = {".pdf", ".docx", ".doc", ".txt", ".md", ".rtf", ".odt", ".pages"}
    doc_files = [
        f for f in files
        if f["id"] not in seen_in_group
        and os.path.splitext(f.get("name", ""))[1].lower() in doc_exts
    ]
    root_groups: Dict[str, List[dict]] = {}
    for f in doc_files:
        root = filename_root(f.get("name", ""))
        if len(root) < 3:
            continue  # too short to cluster meaningfully
        ext = os.path.splitext(f.get("name", ""))[1].lower()
        key = f"{root}|{ext}"
        root_groups.setdefault(key, []).append(f)

    for g in root_groups.values():
        if len(g) <= 1:
            continue
        # Has text content? use AI; otherwise pick largest as most comprehensive
        has_text = any(f.get("text_preview") for f in g)
        if has_text:
            decision = await ai_pick_most_comprehensive(g)
        else:
            keep = max(g, key=lambda x: (x.get("size", 0), x.get("created_at", "")))
            decision = {"keep_id": keep["id"], "reason": "Largest variant kept as most comprehensive."}
        group_size = sum(f.get("size", 0) for f in g if f["id"] != decision["keep_id"])
        space_recoverable += group_size
        for f in g:
            seen_in_group.add(f["id"])
        analyzed.append({
            "kind": "draft_cluster",
            "files": g,
            "keep_id": decision["keep_id"],
            "reason": decision["reason"],
            "space_recoverable": group_size,
        })

    # ----- Phase 3: content-based partial / draft detection -----
    # For text-bearing files not yet clustered, find content-similar groups
    # regardless of filename — catches drafts with different names.
    remaining_text_files = [
        f for f in files
        if f["id"] not in seen_in_group
        and f.get("text_preview")
        and len(f.get("text_preview", "")) > 50
    ]
    content_clusters = cluster_by_content(remaining_text_files, threshold=0.35)
    for g in content_clusters:
        decision = await ai_pick_most_comprehensive(g)
        group_size = sum(f.get("size", 0) for f in g if f["id"] != decision["keep_id"])
        space_recoverable += group_size
        for f in g:
            seen_in_group.add(f["id"])
        analyzed.append({
            "kind": "partial_content",
            "files": g,
            "keep_id": decision["keep_id"],
            "reason": decision["reason"],
            "space_recoverable": group_size,
        })

    # ----- Phase 4: visually-similar images (perceptual hash) -----
    # Catches resized/recompressed/lightly-edited duplicate photos regardless
    # of filename or exact byte match — mirrors phase 3's approach for text.
    remaining_images = [
        f for f in files
        if f["id"] not in seen_in_group and f.get("phash")
    ]
    image_clusters = cluster_by_image_similarity(remaining_images, max_distance=10)
    for g in image_clusters:
        keep = max(g, key=lambda x: (x.get("size", 0), x.get("created_at", "")))
        group_size = sum(f.get("size", 0) for f in g if f["id"] != keep["id"])
        space_recoverable += group_size
        for f in g:
            seen_in_group.add(f["id"])
        analyzed.append({
            "kind": "similar_image",
            "files": g,
            "keep_id": keep["id"],
            "reason": "Visually similar images detected (perceptual hash) — kept the largest/most recent as likely the original or highest quality.",
            "space_recoverable": group_size,
        })

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


# ---------- Billing ----------
class CheckoutIn(BaseModel):
    tier: str = "pro"

@api.post("/billing/checkout")
async def create_checkout(payload: CheckoutIn, current: dict = Depends(get_current_user)):
    if not STRIPE_KEY:
        raise HTTPException(503, "Stripe is not configured.")
    if payload.tier != "pro":
        raise HTTPException(400, "Invalid tier")
    async with httpx.AsyncClient(timeout=30) as c:
        res = await c.post("https://api.stripe.com/v1/checkout/sessions",
            headers={"Authorization": f"Bearer {STRIPE_KEY}"},
            data={"mode": "subscription",
                  "line_items[0][price]": STRIPE_PRO_PRICE_ID,
                  "line_items[0][quantity]": "1",
                  "success_url": f"{FRONTEND_URL}/account?session_id={{CHECKOUT_SESSION_ID}}",
                  "cancel_url": f"{FRONTEND_URL}/pricing",
                  "customer_email": current["email"],
                  "metadata[user_id]": current["id"],
                  "metadata[tier]": payload.tier})
        if res.status_code != 200:
            logger.error(f"Stripe checkout error: {res.text[:500]}")
            raise HTTPException(500, "Unable to create checkout session.")
        return {"checkout_url": res.json()["url"]}


def verify_stripe_signature(payload: bytes, sig_header: str, secret: str, tolerance_sec: int = 300) -> bool:
    """Same implementation as the other 5 RavenSharp apps.
    https://docs.stripe.com/webhooks#verify-manually"""
    if not sig_header or not secret:
        return False
    try:
        parts = dict(item.split("=", 1) for item in sig_header.split(",") if "=" in item)
        timestamp = parts.get("t")
        v1 = parts.get("v1")
        if not timestamp or not v1:
            return False
        if abs(datetime.now(timezone.utc).timestamp() - int(timestamp)) > tolerance_sec:
            logger.warning("Stripe webhook rejected: timestamp outside tolerance (possible replay)")
            return False
        signed_payload = f"{timestamp}.".encode() + payload
        expected = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, v1)
    except Exception as e:
        logger.warning(f"Stripe signature verification error: {e}")
        return False


@api.post("/billing/webhook")
async def stripe_webhook(request: Request):
    raw_body = await request.body()

    if not STRIPE_WEBHOOK_SECRET:
        logger.error("Webhook rejected: STRIPE_WEBHOOK_SECRET is not configured")
        raise HTTPException(503, "Webhook not configured — set STRIPE_WEBHOOK_SECRET")

    sig_header = request.headers.get("stripe-signature", "")
    if not verify_stripe_signature(raw_body, sig_header, STRIPE_WEBHOOK_SECRET):
        logger.error("Webhook rejected: invalid or missing Stripe-Signature header")
        raise HTTPException(400, "Invalid signature")

    try:
        event = json.loads(raw_body)
        if event["type"] == "checkout.session.completed":
            s = event["data"]["object"]
            await users_col.update_one(
                {"id": s["metadata"]["user_id"]},
                {"$set": {"tier": s["metadata"]["tier"], "scans_this_month": 0,
                          "subscription_id": s.get("subscription"),
                          "payment_failed_at": None, "payment_failure_count": 0}})
        elif event["type"] in ["customer.subscription.deleted", "customer.subscription.paused"]:
            sub_id = event["data"]["object"]["id"]
            await users_col.update_one({"subscription_id": sub_id}, {"$set": {"tier": "free"}})
        elif event["type"] == "invoice.payment_failed":
            invoice = event["data"]["object"]
            sub_id = invoice.get("subscription")
            if sub_id:
                await users_col.update_one(
                    {"subscription_id": sub_id},
                    {"$set": {"payment_failed_at": datetime.now(timezone.utc).isoformat()},
                     "$inc": {"payment_failure_count": 1}})
                logger.warning(f"Payment failed for subscription {sub_id}")
    except Exception as e:
        logger.error(f"Webhook error: {e}")
    return {"ok": True}


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
