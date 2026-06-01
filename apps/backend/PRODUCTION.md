# Backend production persistence and object storage

The production backend can run with durable PostgreSQL persistence and an
S3-compatible object-storage bucket. Runtime selection is automatic from the
same environment variables used by `src/config.ts`:

- `PERSISTENCE_DRIVER=memory` keeps all application state inside one process and
  should not be used for durable or multi-replica production workloads.
- `DATABASE_URL=postgres://...` or `postgresql://...` selects PostgreSQL unless
  `PERSISTENCE_DRIVER` is set explicitly.
- `DATABASE_URL=sqlite://...` or `file:...` selects the SQLite snapshot adapter
  and should not be used for multi-replica production workloads.
- `OBJECT_STORAGE_PROVIDER=s3` forces S3-compatible storage.
- `OBJECT_STORAGE_PROVIDER=auto` (the default) selects S3 when both
  `OBJECT_STORAGE_ACCESS_KEY_ID` and `OBJECT_STORAGE_SECRET_ACCESS_KEY` are
  present; otherwise it uses the in-memory development adapter.
- `OBJECT_STORAGE_PROVIDER=memory` forces the in-memory development adapter.

## PostgreSQL

1. Create a dedicated database and least-privilege application role.
2. Set `DATABASE_URL` to the application role connection string, for example:

   ```sh
   DATABASE_URL=postgresql://divband_backend:change-me@postgres.example.com:5432/divband_backend?sslmode=require
   ```

3. Install dependencies and run migrations from the repository root. The MVP
   relational schema is documented in `migrations/001_initial_schema.sql`; the
   production snapshot adapter requires `migrations/002_postgres_snapshot_persistence.sql`.

   ```sh
   npm install
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/backend/migrations/001_initial_schema.sql
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/backend/migrations/002_postgres_snapshot_persistence.sql
   ```

4. Start the backend. The adapter also creates the snapshot table if it is
   missing so a newly provisioned environment can self-heal, but migrations
   should remain part of deployment for auditable schema changes.

## S3-compatible object storage

Create a private bucket for staged and live published-site objects. The backend
presigns browser `PUT` uploads, checks object metadata during finalization, and
copies approved objects from the staging prefix to the live prefix.

Required environment for production S3-compatible storage:

| Variable | Example | Notes |
| --- | --- | --- |
| `OBJECT_STORAGE_PROVIDER` | `s3` | Use `s3` in production so missing credentials fail fast. |
| `OBJECT_STORAGE_BUCKET` | `divband-sites-prod` | Private bucket used for staged uploads and live versions. |
| `OBJECT_STORAGE_REGION` | `us-east-1` | AWS region or the region expected by the S3-compatible provider. |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | `AKIA...` | Access key for the backend service account. |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | `...` | Secret key for the backend service account. |
| `OBJECT_STORAGE_ENDPOINT` | `https://s3.us-east-1.amazonaws.com` | Optional for AWS S3; required for MinIO, R2, Ceph, and other S3-compatible providers. |
| `OBJECT_STORAGE_FORCE_PATH_STYLE` | `false` | Use `true` for MinIO and providers that do not support virtual-hosted bucket names. |
| `OBJECT_STORAGE_STAGING_PREFIX` | `staging` | Prefix for pending uploads. |
| `OBJECT_STORAGE_LIVE_PREFIX` | `sites` | Prefix for immutable published versions. |

The service account needs these bucket permissions, scoped to the configured
staging and live prefixes:

- `s3:PutObject`
- `s3:GetObject`
- `s3:HeadObject`
- `s3:DeleteObject`

When uploads are performed directly from browsers, configure bucket CORS to
allow `PUT` from the frontend origin and expose the checksum metadata headers:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT", "HEAD", "GET"],
    "AllowedHeaders": [
      "content-type",
      "x-amz-checksum-sha256",
      "x-amz-meta-divband-sha256",
      "x-divband-content-sha256"
    ],
    "ExposeHeaders": [
      "x-amz-checksum-sha256",
      "x-amz-meta-divband-sha256"
    ],
    "MaxAgeSeconds": 300
  }
]
```

## Kubernetes tenant auto-provision

On k3s/VPS control planes, configure the backend to apply tenant manifests when users create projects:

| Variable | Production example | Notes |
| --- | --- | --- |
| `KUBERNETES_CONFIG_MODE` | `kubeconfig` or `in_cluster` | `disabled` for local dev only |
| `KUBERNETES_APPLY` | `true` | Backend runs `kubectl apply` for tenant manifests |
| `KUBERNETES_TEMPLATE_DIR` | `/app/infra/k8s/base` | Mounted in the backend container image |
| `DIVBAND_AUTO_PROVISION_PROJECTS` | `true` | Set `0`/`false` to disable auto welcome stack on `POST /projects` |
| `KUBERNETES_WELCOME_IMAGE` | `nginx:1.27-alpine` | Default welcome page container |
| `CERT_MANAGER_CLUSTER_ISSUER` | `letsencrypt-prod` | Rendered into tenant ingress/certificate templates |

Ansible sets these via [`infra/ansible/roles/divband_app/defaults/main.yml`](../infra/ansible/roles/divband_app/defaults/main.yml). See [`README.md`](../../README.md#project-auto-provision-on-k3s) and [`infra/k8s/README.md`](../../infra/k8s/README.md).

## Production startup example

```sh
API_BASE_URL=https://api.example.com \
PUBLIC_SITE_DOMAIN=sites.example.com \
UPLOAD_DOMAIN=uploads.example.com \
DATABASE_URL=postgresql://divband_backend:change-me@postgres.example.com:5432/divband_backend?sslmode=require \
GITLAB_URL=https://gitlab.com \
KUBERNETES_CONFIG_MODE=kubeconfig \
KUBERNETES_APPLY=true \
DIVBAND_AUTO_PROVISION_PROJECTS=true \
KUBERNETES_TEMPLATE_DIR=/app/infra/k8s/base \
OBJECT_STORAGE_PROVIDER=s3 \
OBJECT_STORAGE_BUCKET=divband-sites-prod \
OBJECT_STORAGE_REGION=us-east-1 \
OBJECT_STORAGE_ACCESS_KEY_ID="$OBJECT_STORAGE_ACCESS_KEY_ID" \
OBJECT_STORAGE_SECRET_ACCESS_KEY="$OBJECT_STORAGE_SECRET_ACCESS_KEY" \
DNS_PROVIDER=http \
DNS_PROVIDER_ENDPOINT=https://dns-provider-adapter.example.com \
DNS_PROVIDER_TOKEN="$DNS_PROVIDER_TOKEN" \
DNS_PROVIDER_DEFAULT_TTL_SECONDS=300 \
DNS_PROVIDER_PLATFORM_INGRESS_TARGET=sites.example.com \
npm run start --workspace @divband/backend
```
