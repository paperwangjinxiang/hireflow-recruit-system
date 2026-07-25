"""自建 Cloudflare OAuth 回调接收器（绕开 wrangler 在 Windows 上的回调服务 bug）。

用法：
  阶段1: python cf_oauth.py url      → 生成 PKCE 授权链接写入 cf-auth-url.txt
  阶段2: python cf_oauth.py serve    → 监听 8976(IPv4+IPv6)，收到回调写 cf-code.txt 后退出
  阶段3: python cf_oauth.py exchange → 用 cf-code.txt 换令牌写 cf-token.json
"""
import base64
import hashlib
import json
import secrets
import string
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
import socket

CLIENT_ID = "54d11594-84e4-41aa-b438-e81b8fa78ee7"  # wrangler 官方公共 client_id
REDIRECT_URI = "http://localhost:8976/oauth/callback"
AUTH_URL = "https://dash.cloudflare.com/oauth2/auth"
TOKEN_URL = "https://dash.cloudflare.com/oauth2/token"
SCOPES = ("account:read user:read workers:write workers_kv:write workers_routes:write "
          "workers_scripts:write workers_tail:read d1:write pages:write zone:read offline_access")

PKCE_CHARSET = string.ascii_letters + string.digits


def gen_url():
    verifier = "".join(secrets.choice(PKCE_CHARSET) for _ in range(64))
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = "".join(secrets.choice(PKCE_CHARSET) for _ in range(32))
    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    url = f"{AUTH_URL}?{urllib.parse.urlencode(params)}"
    with open("cf-pkce.json", "w") as f:
        json.dump({"verifier": verifier, "state": state}, f)
    with open("cf-auth-url.txt", "w") as f:
        f.write(url)
    print("URL written, length:", len(url))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(q)
        if "code" in params:
            with open("cf-code.txt", "w") as f:
                f.write(params["code"][0])
            body = b"<h2>Authorization received. You can close this tab.</h2>"
            self.send_response(200)
        else:
            body = b"waiting..."
            self.send_response(400)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(body)
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def log_message(self, *a):
        pass


class V6Server(ThreadingMixIn, HTTPServer):
    address_family = socket.AF_INET6
    daemon_threads = True


def serve():
    # 双栈监听：IPv4 + IPv6，覆盖浏览器对 localhost 的两种解析
    srv4 = HTTPServer(("0.0.0.0", 8976), Handler)
    srv4.timeout = 1
    try:
        srv6 = V6Server(("::", 8976), Handler)
        srv6.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    except Exception as e:
        print("IPv6 bind failed (ok if IPv4 works):", e)
        srv6 = None
    deadline = time.time() + 280
    while time.time() < deadline and not _got_code():
        srv4.handle_request()
        if _got_code():
            break
        if srv6:
            srv6.timeout = 0.2
            srv6.handle_request()
    print("GOT CODE" if _got_code() else "TIMEOUT")


def _got_code():
    try:
        return len(open("cf-code.txt").read().strip()) > 10
    except OSError:
        return False


def exchange():
    pkce = json.load(open("cf-pkce.json"))
    code = open("cf-code.txt").read().strip()
    params = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": CLIENT_ID,
        "code_verifier": pkce["verifier"],
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=params,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    if "access_token" not in data:
        print("TOKEN ERROR:", data)
        sys.exit(1)
    with open("cf-token.json", "w") as f:
        json.dump(data, f)
    print("TOKEN OK, expires_in:", data.get("expires_in"), "| refresh:", bool(data.get("refresh_token")))


if __name__ == "__main__":
    {"url": gen_url, "serve": serve, "exchange": exchange}[sys.argv[1]]()
