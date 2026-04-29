"""
GET /api/releases  — proxy to GitHub.
Tries the formal Releases API first (assets attached).
Falls back to the Tags API + constructing local /downloads/ URLs
for repos that only have lightweight tags.

GET /api/releases/check  — diagnostic endpoint to verify GitHub connectivity.
"""

import asyncio
import httpx
from fastapi import APIRouter, HTTPException

from config import settings

router = APIRouter(prefix="/api", tags=["releases"])

_BASE = "https://api.github.com"


def _headers():
    if not settings.GITHUB_TOKEN:
        raise HTTPException(503, "GITHUB_TOKEN is not configured on the server.")
    return {
        "Authorization": f"Bearer {settings.GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _exe_name(tag: str) -> str:
    """v1.0.0  ->  LicentaApp-Setup-1.0.0.exe"""
    version = tag.lstrip("v")
    return f"LicentaApp-Setup-{version}.exe"


async def _commit_date(client: httpx.AsyncClient, sha: str) -> str:
    try:
        r = await client.get(
            f"{_BASE}/repos/{settings.GITHUB_REPO}/commits/{sha}",
            headers=_headers(),
        )
        return r.json()["commit"]["committer"]["date"]
    except Exception:
        return ""


@router.get("/releases/check")
async def check_github():
    """Diagnostic: verify the GITHUB_TOKEN and repo access."""
    result: dict = {"token_configured": bool(settings.GITHUB_TOKEN), "repo": settings.GITHUB_REPO}

    if not settings.GITHUB_TOKEN:
        result["error"] = "GITHUB_TOKEN is not set in .env"
        return result

    headers = _headers()
    async with httpx.AsyncClient(timeout=10) as client:
        # Check token is valid
        user_r = await client.get(f"{_BASE}/user", headers=headers)
        result["token_valid"] = user_r.status_code == 200
        if user_r.status_code == 200:
            result["authenticated_as"] = user_r.json().get("login")
        else:
            result["token_error"] = f"GitHub /user returned {user_r.status_code}: {user_r.text[:200]}"

        # Check repo access
        repo_r = await client.get(f"{_BASE}/repos/{settings.GITHUB_REPO}", headers=headers)
        result["repo_accessible"] = repo_r.status_code == 200
        if repo_r.status_code == 200:
            repo_data = repo_r.json()
            result["repo_private"] = repo_data.get("private", False)
            result["repo_full_name"] = repo_data.get("full_name")
        elif repo_r.status_code == 404:
            result["repo_error"] = (
                "404 Not Found — either the repo does not exist or your token lacks "
                "'Contents: Read' permission for private repos. "
                "Go to GitHub → Settings → Developer Settings → Personal access tokens "
                "→ regenerate the token and grant 'Contents' read access to this repo."
            )
        else:
            result["repo_error"] = f"GitHub returned {repo_r.status_code}: {repo_r.text[:200]}"

        # Check releases endpoint
        rel_r = await client.get(f"{_BASE}/repos/{settings.GITHUB_REPO}/releases", headers=headers)
        result["releases_status"] = rel_r.status_code
        if rel_r.status_code == 200:
            result["releases_count"] = len(rel_r.json())
        else:
            result["releases_error"] = rel_r.text[:200]

    return result


@router.get("/releases")
async def get_releases():
    headers = _headers()
    repo = settings.GITHUB_REPO

    async with httpx.AsyncClient(timeout=15) as client:
        # ── Try formal GitHub Releases first ─────────────────────────────
        r = await client.get(f"{_BASE}/repos/{repo}/releases", headers=headers)

        if r.status_code == 401:
            raise HTTPException(401, "GitHub token is invalid or expired. Check GITHUB_TOKEN in .env.")
        if r.status_code == 403:
            raise HTTPException(403, "GitHub token lacks permission to access this repository.")
        if r.status_code == 404:
            # 404 means the repo is not found OR the token has no access to it.
            # A repo with zero releases returns 200 + []. This 404 is always an access error.
            raise HTTPException(
                404,
                f"Repository '{repo}' not found or token lacks repo access. "
                "Visit /api/releases/check for a detailed diagnosis. "
                "You may need to regenerate the GITHUB_TOKEN with 'Contents: Read' permission."
            )

        if r.status_code == 200:
            data = r.json()
            if data:
                # Formal releases with assets — return as-is
                return data
            # 200 + [] means the repo exists but has no formal releases → fall through to tags

        # ── Fall back to lightweight Tags ────────────────────────────────
        r = await client.get(f"{_BASE}/repos/{repo}/tags", headers=headers)
        if r.status_code == 401:
            raise HTTPException(401, "GitHub token is invalid or expired.")
        if r.status_code == 403:
            raise HTTPException(403, "GitHub token lacks permission to read tags.")
        if r.status_code == 404:
            raise HTTPException(404, f"Repository '{repo}' not found or token lacks access.")
        if r.status_code != 200:
            raise HTTPException(r.status_code, f"GitHub API error: {r.text[:300]}")

        tags = r.json()  # [{name, commit: {sha}, ...}]
        if not tags:
            return []

        # Fetch commit dates in parallel
        dates = await asyncio.gather(
            *[_commit_date(client, t["commit"]["sha"]) for t in tags]
        )

    # Build a releases-shaped response so the frontend needs no changes
    result = []
    for tag, date in zip(tags, dates):
        exe = _exe_name(tag["name"])
        result.append({
            "id": tag["name"],
            "tag_name": tag["name"],
            "name": tag["name"],
            "published_at": date,
            "prerelease": False,
            "html_url": f"https://github.com/{repo}/releases/tag/{tag['name']}",
            # Point directly to the server-hosted binary
            "assets": [
                {
                    "name": exe,
                    "browser_download_url": f"/release-files/{exe}",
                    "size": 0,   # unknown without stat; hidden in UI when 0
                }
            ],
        })

    return result
