/**
 * 把 build-extension.mjs 生成的扩展目录打包成 zip（商店上传 / 分发用）。
 *
 * Chrome / Edge 商店要求 manifest.json 位于压缩包根目录，所以这里以扩展目录为根
 * 写相对路径，不额外套一层文件夹。用项目已有的 fflate，跨平台且无需新增依赖。
 * 也可以单独执行 pnpm ext:zip，把已有的 extension/ 重新打包而不重新构建。
 */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

/** 系统生成的垃圾文件，不进压缩包 */
const EXCLUDE = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** 递归收集扩展目录里的文件，路径统一成 zip 要求的 POSIX 形式 */
export async function collectFiles(root) {
  const entries = [];

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (EXCLUDE.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const path = relative(root, full).split(sep).join('/');
        entries.push({ path, data: new Uint8Array(await readFile(full)) });
      }
    }
  }

  await walk(root);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

/** 生成 zip 字节；显式写目录条目，兼容要求目录项的解压器与商店校验 */
export function createZip(entries, level = 6) {
  if (!entries.length) throw new Error('扩展目录为空，没有可压缩的文件');

  const data = {};
  const dirs = new Set();
  for (const { path } of entries) {
    const parts = path.split('/');
    parts.pop();
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      dirs.add(`${cur}/`);
    }
  }
  for (const dir of [...dirs].sort()) data[dir] = new Uint8Array(0);
  for (const { path, data: bytes } of entries) data[path] = bytes;

  return zipSync(data, { level });
}

export function zipName(version) {
  return `reader-web-${version}.zip`;
}

async function main() {
  const root = resolve(process.env.EXT_OUT || 'extension');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const name = process.env.EXT_ZIP || zipName(pkg.version);
  const out = resolve(name);

  try {
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error('不是目录');
  } catch {
    throw new Error(`找不到扩展目录 ${root}，请先执行 pnpm build:ext`);
  }

  const entries = await collectFiles(root);
  const bytes = createZip(entries);
  await writeFile(out, bytes);

  const source = entries.reduce((sum, item) => sum + item.data.length, 0);
  console.log(
    `[ext] ${name} 已生成：${entries.length} 个文件，${(bytes.length / 1024).toFixed(0)} KB` +
      `（原始 ${(source / 1024).toFixed(0)} KB）`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[ext] 打包失败：${error.message}`);
    process.exit(1);
  });
}
