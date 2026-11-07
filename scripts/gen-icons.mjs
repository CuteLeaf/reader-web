/**
 * 生成扩展 PNG 图标：直接从 public/favicon.svg 光栅化，保证与站点 favicon 完全一致。
 *
 * 先在 1024px 下渲染 SVG（librsvg 按 viewBox 等比缩放），再逐级降采样到目标尺寸，
 * 这样 16px 这种极小尺寸也能保留圆角与书页轮廓的抗锯齿，不会出现毛刺。
 * 改过 favicon.svg 后执行 `pnpm icons` 重新生成即可。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const SRC = 'public/favicon.svg';
const OUT = 'public/icons';
const SIZES = [16, 32, 48, 128];
/** favicon 的 viewBox 是 64，渲染到 1024 需要 16 倍密度 */
const RENDER = 1024;

const svg = readFileSync(SRC);

const base = await sharp(svg, { density: Math.round((72 * RENDER) / 64) })
  .resize(RENDER, RENDER, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

mkdirSync(OUT, { recursive: true });

for (const size of SIZES) {
  const png = await sharp(base)
    .resize(size, size, {
      kernel: 'lanczos3',
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(`${OUT}/icon-${size}.png`, png);
  console.log(`icons/icon-${size}.png ${png.length}B`);
}
