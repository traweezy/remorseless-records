# Fixing the "Invalid File Key" Error in Medusa 2.11.0 (Railway + MinIO)

## Root Cause

The `invalid file key` error occurs when the **product import job** cannot resolve the `fileKey` provided from your MinIO storage. In Medusa, this key must be created by `/admin/uploads` and passed exactly as `context.fileKey` when creating the batch job. Imports also require a **private bucket** configuration, and for **MinIO**, the private and public buckets must be identical.

---

## Step-by-Step Fix

### 1. Verify MinIO Plugin Configuration

Use the official plugin `medusa-file-minio` with these environment variables:

```bash
MINIO_ENDPOINT=<your-minio-endpoint>
MINIO_BUCKET=<your-bucket-name>
MINIO_ACCESS_KEY=<your-access-key>
MINIO_SECRET_KEY=<your-secret-key>
```

In `medusa-config.js`:

```js
module.exports = {
  projectConfig: {
    fileService: {
      resolve: "medusa-file-minio",
      options: {
        bucket: process.env.MINIO_BUCKET,
        private_bucket: process.env.MINIO_BUCKET, // must match for imports
        endpoint: process.env.MINIO_ENDPOINT,
        access_key_id: process.env.MINIO_ACCESS_KEY,
        secret_access_key: process.env.MINIO_SECRET_KEY,
      },
    },
  },
}
```

**Notes:**
- On Railway, ensure `MINIO_ENDPOINT` is reachable from the Medusa service (no `localhost`).
- Use the internal Railway host and port for MinIO.
- If MinIO runs without HTTPS, use `http://` and not `https://`.

---

### 2. Correct Upload → Import Sequence

**Step 1: Upload CSV**

```bash
POST /admin/uploads
```

Use multipart upload. The response includes:

```json
{
  "uploads": [
    {
      "key": "uploads/12345-products.csv"
    }
  ]
}
```

Save the `uploads[0].key` value.

**Step 2: Create the Batch Job**

Use the same key, and **use camelCase** for `fileKey`:

```bash
POST /admin/batch-jobs
```

```json
{
  "type": "product-import",
  "context": {
    "fileKey": "uploads/12345-products.csv"
  },
  "dry_run": true
}
```

---

### 3. Use the Correct Property Casing

Admin APIs expect **camelCase** keys. Do **not** send `file_key`. Only use `fileKey`.

```json
"context": {
  "fileKey": "..."
}
```

---

### 4. Confirm MinIO Bucket Access

- Bucket exists and both public/private settings match.
- MinIO credentials have permission to `getObject` and `putObject`.
- Medusa container can reach the MinIO endpoint (no 403 or DNS errors).

---

### 5. Quick cURL Test (to Rule Out UI Issues)

**Upload CSV:**

```bash
curl -H "Authorization: Bearer <token>" \
     -F 'files=@/path/to/products.csv' \
     https://<backend>/admin/uploads
```

Copy the `uploads[0].key` value.

**Create Import Job:**

```bash
curl -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"type":"product-import","context":{"fileKey":"<KEY>"},"dry_run":true}' \
     https://<backend>/admin/batch-jobs
```

If this works, your frontend or automation is passing the wrong key or incorrect property name.

---

### 6. Plugin Version Requirement

Use `medusa-file-minio` version **≥ 1.1.0**. Earlier versions have known issues with import compatibility.

```bash
pnpm add medusa-file-minio@latest
```

---

### 7. Admin Panel Imports

If importing via the Admin UI, ensure:
- The file upload succeeds and returns a valid key.
- Storage plugin is correctly set in your Medusa backend.

Misconfigured storage plugins cause the Admin panel’s import modal to silently fail with an `invalid file key` message.

---

## Debug Checklist

| Step | Check | Expected |
|------|--------|-----------|
| 1 | `/admin/uploads` works | Returns a `key` |
| 2 | `/admin/batch-jobs` request | Uses `context.fileKey` with same key |
| 3 | Bucket access | Medusa container can `GET` object |
| 4 | Env variables | Correct Railway MinIO host and credentials |
| 5 | Plugin version | `medusa-file-minio >= 1.1.0` |

---

### Logging Tips

Add debug logs in your backend before creating batch jobs:

```js
console.log("FileKey sent:", req.body.context.fileKey);
```

Ensure it matches exactly what `/admin/uploads` returned.

---

### Summary

The `invalid file key` error means the import job could not find the uploaded file in your storage service. Fixing it requires:
- Correct MinIO configuration (same private/public bucket)
- Using the exact upload key from `/admin/uploads`
- Correct JSON shape (`context.fileKey`)
- Valid storage connectivity from Railway

Following these steps resolves the error consistently for Medusa 2.11.0 + Railway + MinIO setups.

