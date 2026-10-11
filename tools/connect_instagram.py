"""Connect After Lectures to Instagram. Run it yourself in PowerShell:

    python C:\\Users\\aah24\\Projects\\society-events\\tools\\connect_instagram.py

It asks for three things from your Meta developer app (what you type is hidden):
the App ID, the App Secret, and the access token from the Graph API Explorer.
Then it:
  1. swaps the short-lived token (about an hour) for a long-lived one,
  2. finds your Facebook Page and the Instagram account linked to it,
  3. checks it can read society accounts through Business Discovery,
  4. saves what the scheduled job needs as GitHub secrets, plus a local .env.
Nothing secret is printed.
"""
from __future__ import annotations

import getpass
import json
import random
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

import requests

GRAPH = "https://graph.facebook.com/v25.0"
ROOT = Path(__file__).resolve().parent.parent
GH = Path.home() / "AppData" / "Local" / "Programs" / "gh" / "bin" / "gh.exe"
REPO = "hahaharfoush/after-lectures"


def graph(path: str, **params) -> dict:
    resp = requests.get(f"{GRAPH}/{path}", params=params, timeout=30)
    data = resp.json()
    if "error" in data:
        raise RuntimeError(data["error"].get("message", "unknown error"))
    return data


def discover(ig_id: str, token: str, username: str) -> dict:
    fields = f"business_discovery.username({username}){{username,media_count,media.limit(3){{timestamp,caption}}}}"
    return graph(ig_id, fields=fields, access_token=token)["business_discovery"]


def save_secret(name: str, value: str) -> None:
    result = subprocess.run([str(GH), "secret", "set", name, "--repo", REPO],
                            input=value, text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(f"could not save {name} to GitHub: {result.stderr.strip()[:200]}")


def save_env(values: dict[str, str]) -> None:
    env = ROOT / ".env"
    lines = env.read_text(encoding="utf-8").splitlines() if env.exists() else []
    lines = [l for l in lines if l.split("=", 1)[0] not in values]
    lines += [f"{k}={v}" for k, v in values.items()]
    env.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    print("Connect After Lectures to Instagram\n")
    app_id = input("App ID (App settings > Basic): ").strip()
    app_secret = getpass.getpass("App Secret (hidden): ").strip()
    short = getpass.getpass("Access token from the Graph API Explorer (hidden): ").strip()
    if not (app_id and app_secret and short):
        sys.exit("All three are needed. Nothing was saved.")

    print("\n1. Getting a long-lived token...")
    long = graph("oauth/access_token", grant_type="fb_exchange_token", client_id=app_id,
                 client_secret=app_secret, fb_exchange_token=short)
    user_token = long["access_token"]
    expires = datetime.now() + timedelta(seconds=int(long.get("expires_in", 60 * 86400)))

    print("2. Finding your Facebook Page and Instagram account...")
    pages = graph("me/accounts", fields="id,name,access_token,instagram_business_account{id,username}",
                  access_token=user_token).get("data", [])
    linked = [p for p in pages if p.get("instagram_business_account")]
    if not linked:
        sys.exit("No Facebook Page with a linked Instagram professional account came back.\n"
                 "In the Graph API Explorer, make sure you ticked both the Page and the Instagram\n"
                 "account when you approved, and that the Instagram account is linked to the Page.")
    page = linked[0]
    ig = page["instagram_business_account"]
    print(f"   Page: {page['name']}   Instagram: @{ig.get('username')}")

    print("3. Checking it can read society accounts...")
    # A Page token made from a long-lived user token doesn't expire, so try that
    # first. The Union's own account is certainly a business account.
    attempts = [(page["access_token"], "page token (doesn't expire)"),
                (user_token, f"user token (expires {expires:%d %b %Y})")]
    for token, kind in attempts:
        try:
            discover(ig["id"], token, "icunion")
            break
        except RuntimeError as err:
            last_error = err
    else:
        raise last_error
    societies = json.loads((ROOT / "pipeline" / "societies.json").read_text(encoding="utf-8"))
    handles = [h for s in societies for h in s["instagram"]]
    sample = random.Random(1).sample(handles, min(12, len(handles)))
    readable = 0
    for handle in sample:
        try:
            discover(ig["id"], token, handle)
            readable += 1
        except RuntimeError:
            pass   # personal (non-professional) accounts can't be read this way
    print(f"   Works, using a {kind}.")
    print(f"   {readable} of {len(sample)} sample society accounts are readable "
          "(the rest are personal accounts, which the API can't see).")

    print("4. Saving to GitHub secrets and the local .env...")
    values = {"INSTAGRAM_TOKEN": token, "INSTAGRAM_USER_ID": ig["id"],
              "META_APP_ID": app_id, "META_APP_SECRET": app_secret}
    for name, value in values.items():
        save_secret(name, value)
    save_env(values)
    print("\nDone. You can close this window and tell Claude it's connected.")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as err:
        sys.exit(f"\nMeta said: {err}\nNothing more was saved. Tell Claude what it said.")
