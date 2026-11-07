/**
 * 把 Astro 产物打包成可直接「加载已解压的扩展程序」的目录。
 *
 * MV3 扩展页面的 CSP 禁止内联脚本，而 Astro 会把 astro-island 运行时间内联进
 * index.html，直接加载会白屏。这里把内联脚本抽成外部文件并原位替换，保持执行顺序。
 */
import { cp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';

const DIST = 'dist';
const OUT = process.env.EXT_OUT || 'extension';

await rm(OUT, { recursive: true, force: true });
await cp(DIST, OUT, { recursive: true });

/**
 * Chrome / Edge 不允许扩展里有以 "_" 开头的文件或目录（保留给系统），
 * 而 Astro 的产物目录叫 `_assets`，这里改名并同步所有文本引用。
 * 浏览器开着扩展页时目录可能被占用，重试几次并给出可操作的提示。
 */
async function renameDir(from, to) {
  for (let i = 0; i < 3; i += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (i === 2) {
        throw new Error(
          `重命名 ${from} 失败（多半是浏览器还占用着 extension/ 目录）：请先在扩展页移除旧扩展或关闭浏览器，再重新执行 pnpm build:ext。原始错误：${error.message}`,
          { cause: error },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}
await renameDir(`${OUT}/_assets`, `${OUT}/assets`);

async function rewrite(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      await rewrite(full);
      continue;
    }
    if (!/\.(html|js|css|webmanifest)$/.test(entry.name)) continue;
    const text = await readFile(full, 'utf8');
    if (!text.includes('/_assets/')) continue;
    await writeFile(full, text.split('/_assets/').join('/assets/'));
  }
}
await rewrite(OUT);

let html = await readFile(`${OUT}/index.html`, 'utf8');

const extracted = [];
let seq = 0;
html = html.replace(/<script>([\s\S]*?)<\/script>/g, (_match, code) => {
  const name = `assets/inline-${seq}.js`;
  seq += 1;
  extracted.push({ name, code });
  // 保持同步执行顺序：不加 defer / async，位置不变
  return `<script src="/${name}"></script>`;
});

for (const item of extracted) {
  await writeFile(`${OUT}/${item.name}`, item.code);
}
await writeFile(`${OUT}/index.html`, html);

// 版本号跟随 package.json，避免 manifest 与页脚不一致
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const manifestPath = `${OUT}/manifest.json`;
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.version = pkg.version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// PWA manifest 在扩展里没有意义，去掉引用避免无谓报错
const cleaned = await readFile(`${OUT}/index.html`, 'utf8');
await writeFile(
  `${OUT}/index.html`,
  cleaned.replace(/\s*<link rel="manifest" href="\/manifest\.webmanifest">/, ''),
);

// Service Worker 与 PWA manifest 属于网页版功能，扩展里用不到，
// 一并删除，避免审核时被误认为在加载远程/后台脚本
for (const file of ['sw.js', 'manifest.webmanifest']) {
  await rm(`${OUT}/${file}`, { force: true });
}

console.log(
  `[ext] ${OUT}/ 已生成：抽出 ${extracted.length} 段内联脚本，manifest v${manifest.version}`,
);
