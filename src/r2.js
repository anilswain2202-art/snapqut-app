'use strict';
// Cloudflare R2 (S3-compatible) using presigned URLs: AWS Signature Version 4, query-string auth.
// No SDK needed. The kit stays in a PRIVATE bucket; every upload/download gets its own short-lived signed link.
const crypto = require('node:crypto');

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID || '';
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const BUCKET = process.env.R2_BUCKET || '';

const enabled = () => Boolean(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET);
const host = () => `${ACCOUNT_ID}.r2.cloudflarestorage.com`;

// RFC 3986 encoding, as SigV4 requires
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

// Generic SigV4 presigner (also used by the self-test against AWS's published example)
function presign({ method, hostName, path, region, service = 's3', accessKey, secretKey, expires, query = {}, date = new Date() }) {
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // YYYYMMDDTHHMMSSZ
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const params = {
    ...query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host'
  };
  const canonicalQuery = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  const canonicalUri = path.split('/').map(enc).join('/');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${hostName}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac('AWS4' + secretKey, day);
  const kSigning = hmac(hmac(hmac(kDate, region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return `https://${hostName}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// Presigned link for one object in the kit bucket
function signedUrl(method, objectKey, expires, query = {}) {
  return presign({
    method, hostName: host(), path: `/${BUCKET}/${objectKey}`, region: 'auto',
    accessKey: ACCESS_KEY, secretKey: SECRET_KEY, expires, query
  });
}

// 10-minute download link that saves under a friendly file name
function downloadUrl(objectKey, fileName, expires = 600) {
  const safe = String(fileName || 'SnapQut.zip').replace(/["\\\r\n]/g, '');
  return signedUrl('GET', objectKey, expires, { 'response-content-disposition': `attachment; filename="${safe}"` });
}

// Upload link for the admin's browser to PUT the zip straight into the bucket
function uploadUrl(objectKey, expires = 3600) {
  return signedUrl('PUT', objectKey, expires);
}

// Confirm an object exists and get its size
async function head(objectKey) {
  const fail = (msg) => Object.assign(new Error(msg), { status: 502, expose: true });
  let res;
  try {
    res = await fetch(signedUrl('HEAD', objectKey, 60), { method: 'HEAD' });
  } catch {
    throw fail('Couldn’t reach Cloudflare R2. Check R2_ACCOUNT_ID in .env and the server’s internet connection.');
  }
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw fail(`Cloudflare R2 refused the keys (${res.status}). Check R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and that the token can read and write the “${BUCKET}” bucket.`);
  if (!res.ok) throw fail(`Cloudflare R2 answered ${res.status}. Check the bucket name (R2_BUCKET) in .env.`);
  return { size: Number(res.headers.get('content-length') || 0) };
}

module.exports = { enabled, presign, downloadUrl, uploadUrl, head, bucket: () => BUCKET };
