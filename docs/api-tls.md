# API TLS Termination

The Divband Project API (`scripts/project-api.py`) serves plain HTTP by default on
`127.0.0.1:8080`. Do **not** expose it directly on the public internet.

## Recommended pattern

Terminate TLS in front of the API with a reverse proxy:

```text
Client --HTTPS--> Caddy / Nginx / HAProxy --HTTP--> 127.0.0.1:8080
```

### Example: Caddy

```caddy
api.divbandai.ir {
    reverse_proxy 127.0.0.1:8080
}
```

### Example: Nginx

```nginx
server {
    listen 443 ssl;
    server_name api.divbandai.ir;

    ssl_certificate     /etc/ssl/certs/api.pem;
    ssl_certificate_key /etc/ssl/private/api.key;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-Request-Id $request_id;
    }
}
```

## Application project TLS

Project traffic TLS is configured per project with `"tls": true` in the API body.
Place combined PEM files in `config/certs/` named by domain, for example:

```text
config/certs/demo.divbandai.ir.pem
```

HAProxy binds `:443` when any project has TLS enabled.

## Security checklist

- Set `DIVBAND_API_TOKEN` or `DIVBAND_API_SCOPED_TOKENS` when binding beyond loopback.
- Prefer scoped read-only tokens for monitoring integrations.
- Keep `DIVBAND_API_RATE_LIMIT` enabled for public-facing deployments.
