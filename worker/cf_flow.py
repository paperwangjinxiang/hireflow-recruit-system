"""一体化 Cloudflare OAuth 流程：回调服务 + 浏览器驱动 + 令牌交换在同一进程内完成。"""
import json
import select
import socket
import threading
import time
import urllib.parse
import urllib.request

PORT = 8976
CODE_FILE = "cf-code.txt"


def wb(action, args, timeout=45):
    body = json.dumps({"action": action, "args": args, "session": "cf-login"}, ensure_ascii=False).encode()
    req = urllib.request.Request("http://127.0.0.1:10086/command", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode())
    except Exception as e:
        return {"ok": False, "err": str(e)}


def server_loop(stop):
    socks = []
    s4 = socket.socket()
    s4.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s4.bind(("0.0.0.0", PORT))
    s4.listen(8)
    s4.setblocking(False)
    socks.append(s4)
    try:
        s6 = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        s6.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s6.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        s6.bind(("::1", PORT))
        s6.listen(8)
        s6.setblocking(False)
        socks.append(s6)
        print("[srv] dual-stack listening", flush=True)
    except OSError as e:
        print("[srv] ipv6 skipped:", e, flush=True)

    while not stop.is_set():
        try:
            readable, _, _ = select.select(socks, [], [], 0.5)
        except OSError:
            continue
        for s in readable:
            try:
                conn, addr = s.accept()
                conn.settimeout(3)
                data = conn.recv(8192).decode("latin-1", "replace")
                path = data.split(" ")[1] if " " in data else ""
                params = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
                if "code" in params:
                    with open(CODE_FILE, "w") as f:
                        f.write(params["code"][0])
                    print("[srv] GOT CODE from", addr, flush=True)
                    body = b"<h2>OK</h2>"
                else:
                    body = b"no code"
                    print("[srv] req:", path[:50], flush=True)
                conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: "
                             + str(len(body)).encode() + b"\r\n\r\n" + body)
                conn.close()
            except OSError:
                pass
    for s in socks:
        s.close()


def main():
    stop = threading.Event()
    t = threading.Thread(target=server_loop, args=(stop,), daemon=True)
    t.start()
    time.sleep(1)

    url = open("cf-auth-url.txt").read().strip()
    print("[wb] navigate:", wb("navigate", {"url": url, "newTab": False}).get("ok"), flush=True)

    clicked = False
    got = False
    for attempt in range(90):
        time.sleep(2)
        try:
            got = len(open(CODE_FILE).read().strip()) > 10
        except OSError:
            got = False
        if got:
            print("[wb] code file present", flush=True)
            break
        if not clicked:
            r = wb("evaluate", {"code": """(()=>{const b=[...document.querySelectorAll('button, a')].find(x=>/^authorize$/i.test((x.textContent||'').trim()));if(b){b.click();return 'CLICKED'}return 'WAIT|'+document.title.slice(0,25)})()"""})
            v = str((r.get("data") or {}).get("value", r.get("err", "?")))
            if attempt % 5 == 0 or "CLICKED" in v:
                print(f"[wb] {attempt}: {v[:50]}", flush=True)
            if "CLICKED" in v:
                clicked = True

    stop.set()
    if not got:
        print("RESULT: NO CODE", flush=True)
        return

    import subprocess, sys
    r = subprocess.run([sys.executable, "cf_oauth.py", "exchange"], capture_output=True, text=True)
    print(r.stdout, r.stderr, flush=True)


if __name__ == "__main__":
    main()
