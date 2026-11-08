/**
 * 扩展 zip 打包测试（纯 Node，不依赖浏览器与网络）。
 * 运行：pnpm test:ext-zip
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { collectFiles, createZip, zipName } from './zip-extension.mjs';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ''}`);
  }
};

const root = mkdtempSync(join(tmpdir(), 'reader-ext-zip-'));
const put = (path, text) => {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text);
};

try {
  put('manifest.json', JSON.stringify({ manifest_version: 3, version: '1.0.3' }));
  put('index.html', '<html><script src="/assets/inline-0.js"></script></html>');
  put('assets/inline-0.js', 'console.log("reader");');
  put('_locales/zh_CN/messages.json', '{"extName":{"message":"Reader-Web"}}');
  put('icons/icon-16.png', 'fake-png-bytes');
  put('.DS_Store', 'junk');
  put('Thumbs.db', 'junk');

  console.log('文件收集：');
  const entries = await collectFiles(root);
  const paths = entries.map((item) => item.path);
  ok('收齐 5 个有效文件', entries.length === 5, JSON.stringify(paths));
  ok('系统垃圾文件被排除', !paths.includes('.DS_Store') && !paths.includes('Thumbs.db'));
  ok(
    '路径是 POSIX 相对路径',
    paths.every((p) => !p.includes('\\') && !p.startsWith('/') && !p.includes('..')),
  );
  ok('保留多级目录结构', paths.includes('_locales/zh_CN/messages.json'), JSON.stringify(paths));

  console.log('\nzip 结构：');
  const bytes = createZip(entries);
  const unpacked = unzipSync(bytes);
  const names = Object.keys(unpacked);
  ok('manifest.json 在压缩包根目录', names.includes('manifest.json'));
  ok('manifest 内容未被改动', JSON.parse(strFromU8(unpacked['manifest.json'])).version === '1.0.3');
  ok('嵌套文件内容完整', strFromU8(unpacked['assets/inline-0.js']) === 'console.log("reader");');
  ok('中文语言包在包内', names.includes('_locales/zh_CN/messages.json'));
  ok(
    '显式写入目录条目',
    ['assets/', '_locales/', '_locales/zh_CN/', 'icons/'].every((d) => names.includes(d)),
    JSON.stringify(names),
  );
  ok('压缩包里没有垃圾文件', !names.some((n) => n.endsWith('.DS_Store') || n === 'Thumbs.db'));

  ok('生成的是可解压的 zip 字节', bytes.length > 0 && bytes[0] === 0x50 && bytes[1] === 0x4b);
  const repetitive = new TextEncoder().encode('reader-web '.repeat(2000));
  const deflated = createZip([{ path: 'big.txt', data: repetitive }]);
  ok(
    '重复内容确实被 deflate 压缩',
    deflated.length < repetitive.length / 4,
    `${deflated.length} / ${repetitive.length}`,
  );

  console.log('\n边界与命名：');
  ok('命名带版本号且是 zip', zipName('1.0.3') === 'reader-web-1.0.3.zip');
  let emptyThrew = false;
  try {
    createZip([]);
  } catch {
    emptyThrew = true;
  }
  ok('空目录拒绝生成空包', emptyThrew);

  // 构建产物存在时顺带验证集成链路（CI 未构建则跳过）
  if (existsSync('extension/manifest.json')) {
    console.log('\n真实扩展产物：');
    const realZip = unzipSync(createZip(await collectFiles('extension')));
    const realNames = Object.keys(realZip);
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    const realManifest = JSON.parse(strFromU8(realZip['manifest.json']));
    ok(
      '产物 manifest 在根目录且版本与 package.json 一致',
      realManifest.version === pkg.version,
      `${realManifest.version} / ${pkg.version}`,
    );
    ok('商店包里没有 PWA Service Worker', !realNames.includes('sw.js'));
    ok('商店包里没有 PWA manifest', !realNames.includes('manifest.webmanifest'));
    ok('没有以下划线开头的 _assets 目录', !realNames.some((n) => n.startsWith('_assets')));
    const html = strFromU8(realZip['index.html']);
    ok(
      'index.html 没有内联脚本与旧资源引用',
      !/<script>/.test(html) && !html.includes('/_assets/'),
    );
    ok('包含中文语言包', realNames.includes('_locales/zh_CN/messages.json'));
  } else {
    console.log('\n真实扩展产物：跳过（先执行 pnpm build:ext 会一并验证）');
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
