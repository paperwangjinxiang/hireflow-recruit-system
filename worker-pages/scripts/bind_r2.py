"""为 Pages 项目 hireflow-store-api 添加 R2 绑定 BUCKET → hireflow-files

前置条件（一次性，必须在 Dashboard 手动完成，API 无法代办）：
  1. 登录 https://dash.cloudflare.com/ → R2 → 按提示开通 R2（需绑定支付方式，含免费额度）
  2. npx wrangler r2 bucket create hireflow-files

本脚本做的事：
  GET  /accounts/{account_id}/pages/projects/hireflow-store-api  读取现有 deployment_configs
  合并 PATCH：在 production 和 preview 的 r2_buckets 增加 {"BUCKET": {"name": "hireflow-files"}}
  （保留现有 d1_databases / kv_namespaces / 其它配置，不覆盖）

用法（在 网站开发 目录下）：
  python recruit-system/worker-pages/scripts/bind_r2.py
之后取消 wrangler.toml 中 r2_buckets 的注释并重新 deploy 一次即可。
"""
import json
import os
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
ROOT = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.normpath(os.path.join(ROOT, "..", "..", "worker"))
ACCOUNT_ID = open(os.path.join(WORKER, "cf-account-id.txt"), encoding="utf-8").read().strip()
TOKEN = json.load(open(os.path.join(WORKER, "cf-token.json"), encoding="utf-8"))["access_token"]
PROJECT = "hireflow-store-api"
BASE = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/pages/projects/{PROJECT}"


def cf(method, url, payload=None):
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Authorization": f"Bearer {TOKEN}",
                                          "Content-Type": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    proj = cf("GET", BASE)["result"]
    configs = proj.get("deployment_configs") or {}
    patch = {"deployment_configs": {}}
    for env_name in ("production", "preview"):
        cfg = dict(configs.get(env_name) or {})
        r2 = dict(cfg.get("r2_buckets") or {})
        r2["BUCKET"] = {"name": "hireflow-files"}
        cfg["r2_buckets"] = r2
        patch["deployment_configs"][env_name] = cfg
    resp = cf("PATCH", BASE, patch)
    assert resp.get("success"), resp
    for env_name in ("production", "preview"):
        got = (resp["result"]["deployment_configs"].get(env_name) or {}).get("r2_buckets")
        print(f"{env_name} r2_buckets = {json.dumps(got)}")
    print("✅ R2 绑定已写入。请取消 wrangler.toml 中 r2_buckets 注释并重新 pages deploy。")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode("utf-8")[:400])
        raise
