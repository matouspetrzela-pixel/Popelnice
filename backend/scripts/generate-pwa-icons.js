const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const outDir = path.join(__dirname, '..', '..', 'frontend', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const svg = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="100%" height="100%" fill="#1e40af"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="${size / 4}" fill="white">P</text>
</svg>`;

Promise.all([
  sharp(Buffer.from(svg(192))).png().toFile(path.join(outDir, 'icon-192.png')),
  sharp(Buffer.from(svg(512))).png().toFile(path.join(outDir, 'icon-512.png')),
])
  .then(() => console.log('PWA icons created in frontend/icons/'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
