"""Docker Hub tag check: does the image the fix PR points at actually exist?"""

from __future__ import annotations

from typing import Any

import httpx

_cache: dict[str, dict[str, Any]] = {}


def check_docker_tag(repository: str, tag: str) -> dict[str, Any]:
    repository = repository.strip().lower()
    tag = tag.strip()
    namespace, _, name = repository.rpartition("/")
    namespace = namespace or "library"
    key = f"{namespace}/{name}:{tag}"
    if key in _cache:
        return _cache[key]
    url = f"https://hub.docker.com/v2/repositories/{namespace}/{name}/tags/{tag}"
    try:
        response = httpx.get(url, timeout=10)
    except httpx.HTTPError as exc:
        return {"image": f"{repository}:{tag}", "exists": None, "error": f"Docker Hub unreachable: {exc}"}
    if response.status_code == 404:
        result: dict[str, Any] = {"image": f"{repository}:{tag}", "exists": False}
    elif response.status_code == 200:
        data = response.json()
        result = {
            "image": f"{repository}:{tag}",
            "exists": True,
            "last_updated": data.get("last_updated"),
            "digest": data.get("digest") or next((i.get("digest") for i in data.get("images", []) if i.get("digest")), None),
            "url": f"https://hub.docker.com/layers/{namespace}/{name}/{tag}" if namespace != "library"
            else f"https://hub.docker.com/_/{name}/tags?name={tag}",
        }
    else:
        return {"image": f"{repository}:{tag}", "exists": None, "error": f"Docker Hub returned HTTP {response.status_code}"}
    _cache[key] = result
    return result
