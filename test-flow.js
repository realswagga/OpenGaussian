const http = require('http');
const fs = require('fs');
const nodePath = require('path');

function req(method, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (extraHeaders) Object.assign(headers, extraHeaders);
    
    const opts = {
      hostname: 'localhost',
      port: 8080,
      path,
      method,
      headers,
    };
    
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ s: res.statusCode, b: JSON.parse(d) }); }
        catch { resolve({ s: res.statusCode, b: d }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function uploadFile(splatId, fileContent, filename, token) {
  return new Promise((resolve, reject) => {
    const boundary = '----Boundary' + Math.random().toString(36).substring(2);
    const header = '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: application/octet-stream\r\n\r\n';
    const footer = '\r\n--' + boundary + '--\r\n';
    
    const body = Buffer.concat([
      Buffer.from(header, 'utf-8'),
      Buffer.from(fileContent, 'utf-8'),
      Buffer.from(footer, 'utf-8'),
    ]);
    
    const opts = {
      hostname: 'localhost',
      port: 8080,
      path: '/api/admin/splats/' + splatId + '/upload',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
        'Authorization': 'Bearer ' + token,
      },
    };
    
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ s: res.statusCode, b: JSON.parse(d) }); }
        catch { resolve({ s: res.statusCode, b: d }); }
      });
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

async function main() {
  // 1. Login
  console.log('1. Login...');
  const login = await req('POST', '/api/auth/login', { email: 'admin@example.com', password: 'admin12345' });
  if (login.s !== 200) { console.log('FAIL:', login.b); return; }
  const token = login.b.token;
  const auth = { Authorization: 'Bearer ' + token };
  console.log('   OK, token:', token.substring(0, 30) + '...');

  // 2. Create splat
  const slug = 'flow-test-' + Date.now();
  console.log('2. Create splat (slug: ' + slug + ')...');
  const create = await req('POST', '/api/admin/splats', { title: 'Full Flow Test', slug, description: 'Integration test' }, auth);
  if (create.s >= 400) { console.log('FAIL:', JSON.stringify(create.b)); return; }
  const splatId = (create.b.splat || create.b).id;
  console.log('   OK, id:', splatId);

  // 3. Upload test PLY file
  console.log('3. Upload test PLY...');
  const testPly = 'ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n0 0 0 255 0 0\n1 0 0 0 255 0\n0 1 0 0 0 255\n1 1 0 255 255 255\n';
  const upload = await uploadFile(splatId, testPly, 'test-splat.ply', token);
  console.log('   Status:', upload.s, JSON.stringify(upload.b));
  if (upload.s !== 200) { console.log('FAIL'); return; }

  // 4. Manually trigger processing
  console.log('4. Trigger processing...');
  const proc = await req('POST', '/api/admin/splats/' + splatId + '/process', null, auth);
  console.log('   Status:', proc.s, JSON.stringify(proc.b).substring(0, 400));

  // 5. Wait for worker
  console.log('5. Waiting 8 seconds for worker...');
  await new Promise(r => setTimeout(r, 8000));

  // 6. Check splat status
  console.log('6. Check splat status...');
  const chk = await req('GET', '/api/admin/splats/' + splatId, null, auth);
  const splat = chk.b.splat || chk.b;
  console.log('   Status:', splat.status);
  console.log('   Production format:', splat.productionFormat);
  console.log('   Production key:', splat.productionObjectKey);
  console.log('   Splat count:', splat.splatCount);
  console.log('   Size bytes:', splat.sizeBytes);

  // 7. Try to publish
  if (splat.status === 'READY') {
    console.log('7. Publishing...');
    const pub = await req('POST', '/api/admin/splats/' + splatId + '/publish', null, auth);
    console.log('   Status:', pub.s, JSON.stringify(pub.b));
  }

  // 8. Check public
  console.log('8. Public manifest...');
  const manifest = await req('GET', '/api/splats/' + slug + '/manifest');
  console.log('   Status:', manifest.s, JSON.stringify(manifest.b).substring(0, 300));

  console.log('\n=== FLOW TEST DONE ===');
}

main().catch(e => console.error('Error:', e));