const http = require('http');

function req(m, u, b, h) {
  return new Promise((r, j) => {
    const o = {
      hostname: 'localhost',
      port: 8080,
      path: u,
      method: m,
      headers: Object.assign({}, b ? { 'Content-Type': 'application/json' } : {}, h || {}),
    };
    const q = http.request(o, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          r({ s: res.statusCode, b: JSON.parse(d) });
        } catch {
          r({ s: res.statusCode, b: d });
        }
      });
    });
    q.on('error', (e) => {
      console.error('REQ ERR', e.message);
      r({ s: 0, b: e.message });
    });
    if (b) q.write(JSON.stringify(b));
    q.end();
  });
}

(async () => {
  console.log('=== Full Integration Flow Test ===\n');

  // 1. Login
  console.log('1. Login...');
  const l = await req('POST', '/api/auth/login', {
    email: 'admin@example.com',
    password: 'admin12345',
  });
  if (l.s !== 200) {
    console.log('LOGIN FAILED:', l.s, JSON.stringify(l.b));
    return;
  }
  const t = l.b.token;
  const h = { Authorization: 'Bearer ' + t };
  console.log('   OK, got token');

  // 2. Create splat
  console.log('2. Create splat...');
  const slug = 'integration-test-' + Date.now();
  const s = await req(
    'POST',
    '/api/admin/splats',
    { title: 'Integration Test Scene', slug: slug, description: 'Full flow test' },
    h,
  );
  const id = s.b.splat ? s.b.splat.id : s.b.id;
  console.log('   ID=' + id + ' slug=' + slug);

  // 3. Upload test ply
  console.log('3. Upload test PLY...');
  const ply =
    'ply\nformat ascii 1.0\nelement vertex 10\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n0 0 0 255 0 0\n1 0 0 0 255 0\n0 1 0 0 0 255\n1 1 0 255 255 255\n0 0 1 255 0 255\n1 0 1 255 255 0\n0 1 1 0 255 255\n0.5 0.5 0.5 128 128 128\n0.2 0.3 0.7 200 100 50\n0.8 0.6 0.4 50 200 100\n';
  const randomBoundary = '----Boundary' + Math.random().toString(36).substring(2);
  const fieldName = 'file';
  const fileName = 'test.ply';
  const bodyStart = Buffer.from(
    '--' +
      randomBoundary +
      '\r\nContent-Disposition: form-data; name="' +
      fieldName +
      '"; filename="' +
      fileName +
      '"\r\nContent-Type: application/octet-stream\r\n\r\n',
    'utf-8',
  );
  const bodyEnd = Buffer.from('\r\n--' + randomBoundary + '--\r\n', 'utf-8');
  const buf = Buffer.concat([bodyStart, Buffer.from(ply), bodyEnd]);

  const up = await new Promise((r, j) => {
    const o = {
      hostname: 'localhost',
      port: 8080,
      path: '/api/admin/splats/' + id + '/upload',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + randomBoundary,
        'Content-Length': String(buf.length),
        Authorization: 'Bearer ' + t,
      },
    };
    const qq = http.request(o, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          r({ s: res.statusCode, b: JSON.parse(d) });
        } catch {
          r({ s: res.statusCode, b: d });
        }
      });
    });
    qq.on('error', (e) => {
      r({ s: 0, b: e.message });
    });
    qq.write(buf);
    qq.end();
  });
  console.log('   Status=' + up.s + ' resp=' + JSON.stringify(up.b).substring(0, 300));

  // 4. Process
  console.log('4. Trigger processing...');
  const proc = await req('POST', '/api/admin/splats/' + id + '/process', null, h);
  console.log('   Status=' + proc.s + ' resp=' + JSON.stringify(proc.b).substring(0, 300));

  // 5. Wait for worker
  console.log('5. Waiting for worker (10s)...');
  await new Promise((r) => setTimeout(r, 10000));

  // 6. Check result
  console.log('6. Check splat status...');
  const chk = await req('GET', '/api/admin/splats/' + id, null, h);
  const splat = chk.b.splat || chk.b;
  console.log('   Status=' + splat.status + ' fmt=' + splat.productionFormat + ' splatCount=' + splat.splatCount + ' prodKey=' + splat.productionObjectKey);

  // 7. Publish
  if (splat.status === 'READY') {
    console.log('7. Publish...');
    const pub = await req('POST', '/api/admin/splats/' + id + '/publish', null, h);
    console.log('   Status=' + pub.s + ' resp=' + JSON.stringify(pub.b).substring(0, 200));
  }

  // 8. Check public API
  console.log('8. Check public splats list...');
  const pubList = await req('GET', '/api/splats');
  const published = (pubList.b?.items || []).filter((i) => i.slug === slug);
  console.log('   Found in public list: ' + published.length + ' splats');
  if (published.length > 0) {
    console.log('   Published scene: ' + published[0].title);
  }

  console.log('\n=== Integration test complete ===');
})().catch((e) => console.error('ERROR:', e));