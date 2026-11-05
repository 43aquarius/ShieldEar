#!/usr/bin/env python3
"""gh-connect-proxy.py — 本地 HTTPS CONNECT 代理（绕过损坏的 github.com DNS 路由）
监听 127.0.0.1:9443，把 CONNECT github.com:443 的 TCP 流原样转发到指定可用边缘 IP。
用法: gh-connect-proxy.py <目标IP> [端口]
"""
import socket, threading, sys

TARGET_IP = sys.argv[1]
LISTEN_PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 9443


def pipe(a, b):
    try:
        while True:
            d = a.recv(65536)
            if not d:
                break
            b.sendall(d)
    except OSError:
        pass
    finally:
        try: a.close()
        except OSError: pass
        try: b.close()
        except OSError: pass


def handle(cli):
    try:
        req = b""
        while b"\r\n\r\n" not in req:
            d = cli.recv(4096)
            if not d:
                cli.close(); return
            req += d
        line = req.split(b"\r\n")[0].decode()
        # CONNECT host:port HTTP/1.1
        parts = line.split()
        if len(parts) < 2 or parts[0].upper() != "CONNECT":
            cli.close(); return
        host, port = parts[1].rsplit(":", 1)
        port = int(port)
        # github.com → 转发到指定 IP；其他直连（按域名解析）
        ip = TARGET_IP if host == "github.com" else socket.gethostbyname(host)
        up = socket.create_connection((ip, port), timeout=15)
        cli.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        t1 = threading.Thread(target=pipe, args=(cli, up), daemon=True)
        t2 = threading.Thread(target=pipe, args=(up, cli), daemon=True)
        t1.start(); t2.start()
        t1.join(); t2.join()
    except OSError:
        try: cli.close()
        except OSError: pass


srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", LISTEN_PORT))
srv.listen(16)
print(f"[proxy] 127.0.0.1:{LISTEN_PORT} → github.com ⇒ {TARGET_IP}:443", flush=True)
while True:
    c, _ = srv.accept()
    threading.Thread(target=handle, args=(c,), daemon=True).start()
