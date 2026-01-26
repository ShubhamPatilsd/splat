import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const hasImage = typeof body?.imageData === 'string' && body.imageData.length > 0;
  let savedPath: string | null = null;

  if (hasImage) {
    const match = body.imageData.match(/^data:image\/png;base64,(.+)$/);
    if (match) {
      const buffer = Buffer.from(match[1], 'base64');
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      const filename = `frame-${Date.now()}.png`;
      const filePath = path.join(UPLOAD_DIR, filename);
      await fs.writeFile(filePath, buffer);
      savedPath = `/uploads/${filename}`;
    }
  }

  const prompt =
    'This is triangle at (320, 220) radius 80, then rectangle at (820, 420) size 220x140, then circle at (520, 560) radius 60.';

  const matterBodies = [
    {
      method: 'polygon',
      args: [320, 220, 3, 80, { restitution: 0.6, friction: 0.1 }]
    },
    {
      method: 'rectangle',
      args: [820, 420, 220, 140, { restitution: 0.5, friction: 0.2 }]
    },
    {
      method: 'circle',
      args: [520, 560, 60, { restitution: 0.7, friction: 0.05 }]
    }
  ];

  const matterScript =
    'Matter.Bodies.polygon(320, 220, 3, 80, { restitution: 0.6, friction: 0.1 });\n' +
    'Matter.Bodies.rectangle(820, 420, 220, 140, { restitution: 0.5, friction: 0.2 });\n' +
    'Matter.Bodies.circle(520, 560, 60, { restitution: 0.7, friction: 0.05 });';

  return NextResponse.json({
    ok: true,
    receivedImage: hasImage,
    savedPath,
    prompt,
    matterBodies,
    matterScript
  });
}
