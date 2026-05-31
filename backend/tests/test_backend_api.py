"""Smart File Scan & Dedup - Backend API tests.

Covers auth, sources, file upload/list/delete/rename, duplicate analysis (AI),
rename candidates (AI), dashboard stats and security guards.
"""
import io
import time
import uuid
import pytest
import requests

from conftest import BASE_URL

# ----- Module-level shared state -----
TEST_EMAIL = f"test_{uuid.uuid4().hex[:8]}@filescan.app"
TEST_PASSWORD = "Test1234!"
STATE = {}  # token, user_id, file_id_a, file_id_b, generic_file_id


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ===================== Auth =====================
class TestAuth:
    def test_root(self):
        r = requests.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert "Smart File Scan" in r.json().get("message", "")

    def test_signup(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "full_name": "Test User"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["user"]["email"] == TEST_EMAIL.lower()
        assert "id" in data["user"]
        STATE["token"] = data["access_token"]
        STATE["user_id"] = data["user"]["id"]

    def test_signup_duplicate_email(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        )
        assert r.status_code == 400

    def test_login_success(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data
        # refresh token
        STATE["token"] = data["access_token"]

    def test_login_wrong_password(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": "WrongPass!"},
        )
        assert r.status_code == 401

    def test_me_authenticated(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers(STATE["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == TEST_EMAIL.lower()
        assert body["id"] == STATE["user_id"]
        assert "_id" not in body  # no Mongo ObjectId leak

    def test_me_no_token(self):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_me_bad_token(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": "Bearer notavalidtoken"})
        assert r.status_code == 401


# ===================== Sources =====================
class TestSources:
    def test_sources_initially_empty(self):
        r = requests.get(f"{BASE_URL}/api/sources", headers=auth_headers(STATE["token"]))
        assert r.status_code == 200
        body = r.json()
        assert body == {"sources": []} or body.get("sources") == []

    def test_sources_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/sources")
        assert r.status_code == 401

    def test_connect_gdrive_invalid_token(self):
        r = requests.post(
            f"{BASE_URL}/api/sources/gdrive",
            headers=auth_headers(STATE["token"]),
            json={"access_token": "invalid_token_xyz", "account_label": "Bad"},
        )
        assert r.status_code in (400, 401), r.text

    def test_connect_dropbox_invalid_token(self):
        r = requests.post(
            f"{BASE_URL}/api/sources/dropbox",
            headers=auth_headers(STATE["token"]),
            json={"access_token": "invalid_token_xyz", "account_label": "Bad"},
        )
        assert r.status_code in (400, 401), r.text


# ===================== Files: upload/list/delete/rename =====================
class TestFiles:
    def test_upload_generic_named_text_file(self):
        # IMG_0042.txt with content -> should mark is_generic_name=true
        content = b"Meeting notes about project alpha and budget planning for Q1"
        files = {"file": ("IMG_0042.txt", io.BytesIO(content), "text/plain")}
        r = requests.post(
            f"{BASE_URL}/api/files/upload",
            headers=auth_headers(STATE["token"]),
            files=files,
        )
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["name"] == "IMG_0042.txt"
        assert rec["sha256"] and len(rec["sha256"]) == 64
        assert rec["is_generic_name"] is True
        assert "meeting notes" in rec["text_preview"].lower()
        assert "_id" not in rec
        STATE["generic_file_id"] = rec["id"]
        STATE["file_a_sha"] = rec["sha256"]
        STATE["file_a_id"] = rec["id"]

    def test_upload_duplicate_content(self):
        # Same content, different filename -> same sha256 -> creates a duplicate group
        content = b"Meeting notes about project alpha and budget planning for Q1"
        files = {"file": ("IMG_0043.txt", io.BytesIO(content), "text/plain")}
        r = requests.post(
            f"{BASE_URL}/api/files/upload",
            headers=auth_headers(STATE["token"]),
            files=files,
        )
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["sha256"] == STATE["file_a_sha"]
        STATE["file_b_id"] = rec["id"]

    def test_upload_non_generic_file(self):
        content = b"Quarterly business strategy v2 final"
        files = {"file": ("quarterly_strategy_final.txt", io.BytesIO(content), "text/plain")}
        r = requests.post(
            f"{BASE_URL}/api/files/upload",
            headers=auth_headers(STATE["token"]),
            files=files,
        )
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["is_generic_name"] is False
        STATE["file_c_id"] = rec["id"]

    def test_list_files(self):
        r = requests.get(f"{BASE_URL}/api/files", headers=auth_headers(STATE["token"]))
        assert r.status_code == 200
        body = r.json()
        assert body["count"] >= 3
        # No _id, no user_id leakage
        for f in body["files"]:
            assert "_id" not in f
            assert "user_id" not in f

    def test_files_requires_auth(self):
        assert requests.get(f"{BASE_URL}/api/files").status_code == 401
        assert requests.post(f"{BASE_URL}/api/files/upload").status_code == 401


# ===================== AI: duplicate detection =====================
class TestAnalyze:
    def test_analyze_returns_duplicate_group(self):
        r = requests.post(
            f"{BASE_URL}/api/scan/analyze",
            headers=auth_headers(STATE["token"]),
            timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total_files"] >= 3
        assert body["duplicate_groups_count"] >= 1
        # Find the group containing our two duplicates
        group = next(
            (g for g in body["duplicate_groups"] if any(f["id"] == STATE["file_a_id"] for f in g["files"])),
            None,
        )
        assert group is not None, "duplicate group missing"
        assert len(group["files"]) == 2
        ids = {f["id"] for f in group["files"]}
        assert STATE["file_a_id"] in ids and STATE["file_b_id"] in ids
        assert group["keep_id"] in ids
        assert group["reason"], "AI reason missing"
        assert group["space_recoverable"] > 0


# ===================== AI: rename candidates =====================
class TestRenameCandidates:
    def test_rename_candidates_ai_suggestion(self):
        r = requests.get(
            f"{BASE_URL}/api/scan/rename-candidates",
            headers=auth_headers(STATE["token"]),
            timeout=90,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # We uploaded two IMG_00*.txt files (generic) -> at least 1 candidate w/ AI suggestion
        assert body["count"] >= 1, f"no AI suggestions returned: {body}"
        first = body["candidates"][0]
        assert first.get("ai_suggested_name")
        # Sanitization check
        assert all(c.isalnum() or c in "_-." for c in first["ai_suggested_name"])


# ===================== Rename file =====================
class TestRename:
    def test_rename_file(self):
        new_name = "renamed_meeting_notes_q1.txt"
        r = requests.post(
            f"{BASE_URL}/api/files/{STATE['file_a_id']}/rename",
            headers=auth_headers(STATE["token"]),
            json={"new_name": new_name},
        )
        assert r.status_code == 200, r.text
        assert r.json()["new_name"] == new_name

        # verify via list
        lr = requests.get(f"{BASE_URL}/api/files", headers=auth_headers(STATE["token"]))
        files = lr.json()["files"]
        rec = next((f for f in files if f["id"] == STATE["file_a_id"]), None)
        assert rec is not None
        assert rec["name"] == new_name
        assert rec["is_generic_name"] is False

    def test_rename_empty_name_rejected(self):
        r = requests.post(
            f"{BASE_URL}/api/files/{STATE['file_a_id']}/rename",
            headers=auth_headers(STATE["token"]),
            json={"new_name": "   "},
        )
        assert r.status_code == 400

    def test_rename_unknown_file_404(self):
        r = requests.post(
            f"{BASE_URL}/api/files/{uuid.uuid4()}/rename",
            headers=auth_headers(STATE["token"]),
            json={"new_name": "x.txt"},
        )
        assert r.status_code == 404


# ===================== Dashboard =====================
class TestDashboard:
    def test_dashboard_stats(self):
        r = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=auth_headers(STATE["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        for k in [
            "total_files", "sources_count", "internal_files",
            "gdrive_files", "dropbox_files", "generic_named_files",
            "duplicate_groups_count", "space_recoverable",
        ]:
            assert k in body, f"missing key {k}"
        assert body["total_files"] >= 3
        assert body["internal_files"] >= 3
        assert body["duplicate_groups_count"] >= 1
        assert body["sources_count"] == 0


# ===================== Delete =====================
class TestDelete:
    def test_delete_file(self):
        # Delete file_b (duplicate)
        r = requests.delete(
            f"{BASE_URL}/api/files/{STATE['file_b_id']}",
            headers=auth_headers(STATE["token"]),
        )
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] is True

        # verify gone
        lr = requests.get(f"{BASE_URL}/api/files", headers=auth_headers(STATE["token"]))
        files = lr.json()["files"]
        assert not any(f["id"] == STATE["file_b_id"] for f in files)

    def test_delete_unknown_404(self):
        r = requests.delete(
            f"{BASE_URL}/api/files/{uuid.uuid4()}",
            headers=auth_headers(STATE["token"]),
        )
        assert r.status_code == 404


# ===================== Security =====================
class TestSecurity:
    @pytest.mark.parametrize("path,method", [
        ("/api/sources", "GET"),
        ("/api/files", "GET"),
        ("/api/scan/analyze", "POST"),
        ("/api/scan/rename-candidates", "GET"),
        ("/api/dashboard/stats", "GET"),
    ])
    def test_endpoints_require_auth(self, path, method):
        r = requests.request(method, f"{BASE_URL}{path}")
        assert r.status_code == 401, f"{path} not protected: {r.status_code}"
