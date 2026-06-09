import { PrismaClient } from '@prisma/client';
import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// S3 client
// ---------------------------------------------------------------------------
function buildS3Client() {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  });
}

async function ensureBucket(s3: S3Client, bucket: string) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`Bucket "${bucket}" exists.`);
  } catch {
    console.log(`Creating bucket "${bucket}"...`);
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Bucket "${bucket}" created.`);
  }
}

async function main() {
  console.log('[seed] Starting...');

  const s3 = buildS3Client();
  const bucket = process.env.S3_BUCKET || 'gsplat-assets';

  // Ensure bucket exists
  await ensureBucket(s3, bucket);

  // ── Admin user ──
  const adminEmail = process.env.ADMIN_SEED_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || 'admin12345';
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: 'MASTER_ADMIN',
      passwordHash,
    },
    create: {
      email: adminEmail,
      passwordHash,
      role: 'MASTER_ADMIN',
    },
  });
  console.log(`Admin: ${admin.email}`);

  await prisma.user.updateMany({
    where: { role: 'ADMIN' },
    data: { role: 'MASTER_ADMIN' },
  });

  const defaultOrg = await prisma.organization.upsert({
    where: { slug: 'opengaussian' },
    update: {},
    create: {
      slug: 'opengaussian',
      name: 'OpenGaussian',
      description: 'Default organization for published Gaussian splats.',
      isPublic: true,
      createdByUserId: admin.id,
    },
  });

  await prisma.organizationMembership.upsert({
    where: {
      organizationId_userId: {
        organizationId: defaultOrg.id,
        userId: admin.id,
      },
    },
    update: {
      role: 'MANAGER',
      status: 'ACTIVE',
    },
    create: {
      organizationId: defaultOrg.id,
      userId: admin.id,
      role: 'MANAGER',
      status: 'ACTIVE',
      canCreateSplats: true,
      canUploadSplats: true,
      canEditSplats: true,
      canDeleteSplats: true,
      canPublishSplats: true,
      canEditMarkers: true,
    },
  });

  const attached = await prisma.splat.updateMany({
    where: { organizationId: null },
    data: { organizationId: defaultOrg.id },
  });
  if (attached.count > 0) {
    console.log(`Attached ${attached.count} unassigned splat(s) to ${defaultOrg.name}.`);
  }

  console.log('[seed] Done.');
}

main()
  .catch((e) => {
    console.error('[seed] Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
