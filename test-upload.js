const http = require('http');
const fs = require('fs');
const nodePath = require('path');

const API_HOST = 'localhost';
const API_PORT = 8080;

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: API_HOST,
      port: API_PORT,
      path,
      method,
      headers: {
        'Content-Type': body ? 'application/json' : undefined,
        ...headers,
      },
    };
    // Remove undefined headers
    Object.keys(opts.headers).forEach(k => opts.headers[k] === undefined && delete opts.headers[k]);

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function multipartRequest(apiPath, filePath, token) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    const filename = nodePath.basename(filePath);
    const fileContent = fs.readFileSync(filePath);

    const header = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      `Content-Type: application/octet-stream`,
      '',
      '',
    ].join('\r\n');

    const footer = `\r\n--${boundary}--\r\n`;

    // Build body as Buffer
    const headerBuf = Buffer.from(header, 'utf-8');
    const footerBuf = Buffer.from(footer, 'utf-8');
    const body = Buffer.concat([headerBuf, fileContent, footerBuf]);

    const opts = {
      hostname: API_HOST,
      port: API_PORT,
      path: apiPath,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'Authorization': `Bearer ${token}`,
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('=== Test 1: Health Check ===');
  const health = await request('GET', '/api/health');
  console.log(`Status: ${health.status}`, JSON.stringify(health.body).substring(0, 200));

  console.log('\n=== Test 2: Login as Admin ===');
  const login = await request('POST', '/api/auth/login', {
    email: 'admin@example.com',
    password: 'admin12345',
  });
  console.log(`Status: ${login.status}`);
  if (login.status !== 200) {
    console.log('Login failed!', JSON.stringify(login.body));
    return;
  }
  console.log(`Token: ${login.body.token.substring(0, 30)}...`);
  console.log(`User: ${login.body.user.email} (${login.body.user.role})`);

  const token = login.body.token;
  const authHeaders = { Authorization: `Bearer ${token}` };

  console.log('\n=== Test 3: Create a new splat ===');
  const slug = 'test-upload-' + Date.now();
  const newSplat = await request('POST', '/api/admin/splats', {
    title: 'Test Upload Splat',
    slug,
    description: 'A test splat for upload flow',
  }, authHeaders);
  console.log(`Status: ${newSplat.status}`);

  if (newSplat.status >= 400) {
    console.log('Create splat failed:', JSON.stringify(newSplat.body));
    return;
  }

  const splatId = newSplat.body.splat ? newSplat.body.splat.id : newSplat.body.id;
  console.log(`Created splat: ${splatId} (slug: ${slug})`);

  // Create a small test PLY file
  console.log('\n=== Test 4: Create test .ply file and upload ===');
  const testFilePath = nodePath.join(__dirname, 'test-splat.ply');
  const testPly = [
    'ply',
    'format ascii 1.0',
    'element vertex 4',
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'end_header',
    '0 0 0 255 0 0',
    '1 0 0 0 255 0',
    '0 1 0 0 0 255',
    '1 1 0 255 255 255',
  ].join('\n');
  fs.writeFileSync(testFilePath, testPly);

  const upload = await multipartRequest(`/api/admin/splats/${splatId}/upload`, testFilePath, token);
  console.log(`Status: ${upload.status}`);
  console.log(JSON.stringify(upload.body, null, 2));

  if (upload.status === 200 && upload.body.version) {
    console.log(`\nVersion ID: ${upload.body.version.id}`);
    console.log(`Version: ${upload.body.version.version}`);
    console.log(`Status: ${upload.body.version.status}`);
  }

  // Wait a few seconds for worker to process
  console.log('\n=== Test 5: Wait for worker to process ===');
  await new Promise(r => setTimeout(r, 6000));

  console.log('\n=== Test 6: Check splat status after processing ===');
  const splatDetail = await request('GET', `/api/admin/splats/${splatId}`, null, authHeaders);
  console.log(`Status: ${splatDetail.status}`);
  const s = splatDetail.body.splat || splatDetail.body;
  console.log(`Title: ${s.title}`);
  console.log(`Status: ${s.status}`);
  console.log(`Source format: ${s.sourceFormat}`);
  console.log(`Production format: ${s.productionFormat}`);
  console.log(`Splat count: ${s.splatCount}`);
  console.log(`Versions: ${s.versionCount}`);

  console.log('\n=== Test 7: Get admin splats list ===');
  const adminSplats = await request('GET', '/api/admin/splats', null, authHeaders);
  console.log(`Status: ${adminSplats.status}`);
  const items = adminSplats.body.items || [];
  items.forEach((item, i) => {
    console.log(`  ${i + 1}. "${item.title}" [${item.status}]`);
  });

  console.log('\n=== Test 8: Publish the splat ===');
  const publish = await request('POST', `/api/admin/splats/${splatId}/publish`, null, authHeaders);
  console.log(`Status: ${publish.status}`, JSON.stringify(publish.body, null, 2));

  console.log('\n=== Test 9: Public splats list ===');
  const publicSplats = await request('GET', '/api/splats');
  console.log(`Status: ${publicSplats.status}`);
  console.log(`Total public: ${publicSplats.body.total}`);

  console.log('\n=== Test 10: Get manifest for published splat ===');
  const manifest = await request('GET', `/api/splats/${slug}/manifest`);
  console.log(`Status: ${manifest.status}`, JSON.stringify(manifest.body, null, 2));

  console.log('\n=== Test 11: Get annotations ===');
  const annotations = await request('GET', `/api/splats/${slug}/annotations`);
  console.log(`Status: ${annotations.status}`, JSON.stringify(annotations.body, null, 2));

  // Add an annotation
  console.log('\n=== Test 12: Add annotation (admin) ===');
  const addAnnot = await request('POST', `/api/admin/splats/${splatId}/annotations`, {
    title: 'Test Marker',
    body: 'This is a test marker added via API',
    kind: 'info',
    positionX: 0.5,
    positionY: 0.5,
    positionZ: 0.5,
    color: '#ffffff',
    icon: 'info',
  }, authHeaders);
  console.log(`Status: ${addAnnot.status}`, JSON.stringify(addAnnot.body, null, 2));

  // Cleanup test file
  try { fs.unlinkSync(testFilePath); } catch {}

  console.log('\n=== ALL DONE ===');
}

main().catch(err => console.error('Error:', err));