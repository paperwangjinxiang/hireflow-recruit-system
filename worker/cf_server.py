"""异步 select 版 OAuth 回调接收器：单线程同时监听 IPv4+IPv6，替代 wrangler 的回调服务。"""
import select
import socket
import sys
import time
import urllib.parse

PORT = 8976


def main():
    socks = []
    s4 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s4.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s4.bind(("0.0.0.0", PORT))
    s4.listen(8)
    s4.setblocking(False)
    socks.append(s4)
    print("IPv4 listening")

    try:
        s6 = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        s6.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s6.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        s6.bind(("::1", PORT))
        s6.listen(8)
        s6.setblocking(False)
        socks.append(s6)
        print("IPv6 listening")
    except Exception as e:
        print("IPv6 skipped:", e)

    deadline = time.time() + 270
    while time.time() < deadline:
        try:
            readable, _, _ = select.select(socks, [], [], 1.0)
        except OSError:
            continue
        for s in readable:
            try:
                conn, addr = s.accept()
            except OSError:
                continue
            conn.settimeout(3)
            try:
                data = conn.recv(8192).decode("latin-1", "replace")
                path = data.split(" ")[1] if " " in data else ""
                params = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
                if "code" in params:
                    with open("cf-code.txt", "w") as f:
                        f.write(params["code"][0])
                    body = b"<h2>OK - you can close this tab</h2>"
                    print("GOT CODE from", addr)
                else:
                    body = b"no code"
                    print("request without code:", path[:60])
                resp = (b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n"
                        b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
                conn.sendall(resp)
            except OSError:
                pass
            finally:
                conn.close()
        try:
            if len(open("cf-code.txt").read().strip()) > 10:
                print("DONE")
                return
        except OSError:
            pass
    print("TIMEOUT")


if __name__ == "__main__":
    main()
