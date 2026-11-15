# Running Postern for a team on an internal network

You do not need another application. Postern already runs as an always-on service (`sudo ./deploy/install.sh --service`
from the source tarball). Two ordinary, separate tools give it a friendly name and HTTPS: **DNS** (a name for the machine) and a
**reverse proxy** (HTTPS in front of Postern). Use whatever your network already has.

## 1. Give the machine a name (internal DNS)
Pick one that suits you. Any of these makes `postern.lan` point to the server's address (example `192.168.1.20`):
- **Your router or office DNS / Active Directory DNS:** add an A record `postern.lan → 192.168.1.20`. This is the best option for a team.
- **dnsmasq / Pi-hole:** `address=/postern.lan/192.168.1.20`
- **Only for yourself:** add `192.168.1.20 postern.lan` to your hosts file (`/etc/hosts`, or `C:\Windows\System32\drivers\etc\hosts`).

## 2. Put HTTPS in front (reverse proxy)
Keep Postern on `127.0.0.1` (the default) and let the proxy face the network. With **Caddy** and its built-in internal CA:
```
postern.lan {
  tls internal
  reverse_proxy 127.0.0.1:3210
}
```
Then in `/etc/devhub/devhub.env` set `DEVHUB_SECURE_COOKIE=1` and `DEVHUB_TRUST_PROXY=1`, and `sudo systemctl restart devhub`.
Each user's computer must trust Caddy's root certificate once (Caddy creates it; copy `root.crt` from its data folder and import it).
`deploy/nginx.conf.example` shows the same with nginx. Without a proxy you can set `HOST=0.0.0.0`, but then traffic is plain HTTP: only do that on a trusted network.

## 3. Mock servers and the sample ERP
Mock URLs look like `https://postern.lan/mock/<id>/…` and the dummy ERP is `https://postern.lan/sample/workday/…`, so colleagues' tools and
extractors can call them by that name from anywhere that can reach the server. They are **not** reachable from the internet unless you publish the proxy there.

## 4. Team tips
- After your accounts exist, set `DEVHUB_ALLOW_REGISTER=0`. Each user's data is separate, but all of it lives in one database and one `master.key`: back both up and protect the server.
- Postern's own outbound calls use the machine's network and DNS. Set `DEVHUB_BLOCK_PRIVATE=1` if users must not be able to reach internal addresses through it.
- Behind a corporate proxy? Set it in Settings → Network (per user), or start the service with `HTTPS_PROXY` and choose "System (env)".
- Turn the dummy ERP off with `DEVHUB_SAMPLES=0` if you do not want it served.
