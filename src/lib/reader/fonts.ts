/**
 * 本地字体：用户可以从自己电脑里选字体文件导入，只存在这台设备的 IndexedDB。
 *
 * 注册用 FontFace API（不入 CSS 文件、不需要 Blob URL 泄漏）：
 *   new FontFace(family, arrayBuffer) → load() → document.fonts.add()
 * 族名由 id 派生，避免与系统字体同名冲突。
 */
import { deleteFont as dbDeleteFont, listFonts, putFont, type StoredFont } from '../storage/db';

export interface LocalFont {
  id: string;
  name: string;
  family: string;
  size: number;
  createdAt: number;
}

const FONT_EXT = /\.(ttf|otf|woff2?|ttc)$/i;
const MAX_SIZE = 48 * 1024 * 1024;

const registered = new Map<string, FontFace>();

export function isFontFile(name: string): boolean {
  return FONT_EXT.test(name);
}

export function fontDisplayName(fileName: string): string {
  return fileName.replace(FONT_EXT, '').trim() || '自定义字体';
}

/** 选中自定义字体时用的 font-family 值，带上系统字体兜底 */
export function customFontStack(family: string): string {
  return `'${family}', 'Microsoft YaHei', 'PingFang SC', -apple-system, sans-serif`;
}

export function isCustomStack(stack: string, family: string): boolean {
  return stack.trim().startsWith(`'${family}'`);
}

async function register(row: StoredFont): Promise<boolean> {
  if (registered.has(row.id)) return true;
  try {
    // FontFace 支持 ArrayBuffer；不支持的数据（如部分 ttc）会在这里抛错
    const face = new FontFace(row.family, row.data);
    await face.load();
    document.fonts.add(face);
    registered.set(row.id, face);
    return true;
  } catch (e) {
    console.warn('[fonts] 注册失败', row.name, e);
    return false;
  }
}

/** 启动时把所有已存字体注册回 document.fonts */
export async function loadStoredFonts(): Promise<LocalFont[]> {
  const rows = await listFonts();
  const out: LocalFont[] = [];
  for (const row of rows) {
    if (await register(row)) {
      out.push({
        id: row.id,
        name: row.name,
        family: row.family,
        size: row.size,
        createdAt: row.createdAt,
      });
    }
  }
  return out;
}

export async function importFontFile(file: File): Promise<LocalFont> {
  if (!isFontFile(file.name)) throw new Error('只支持 ttf / otf / woff / woff2 字体文件');
  if (file.size > MAX_SIZE) throw new Error('字体文件超过 48MB，浏览器读取会很慢');

  const data = await file.arrayBuffer();
  const id = crypto.randomUUID();
  const row: StoredFont = {
    id,
    name: fontDisplayName(file.name),
    family: `reader-font-${id.slice(0, 8)}`,
    size: file.size,
    createdAt: Date.now(),
    data,
  };

  if (!(await register(row))) throw new Error('这个字体文件无法被浏览器解析，换一个试试');

  await putFont(row);
  return {
    id: row.id,
    name: row.name,
    family: row.family,
    size: row.size,
    createdAt: row.createdAt,
  };
}

export async function removeFont(id: string): Promise<void> {
  const face = registered.get(id);
  if (face) {
    document.fonts.delete(face);
    registered.delete(id);
  }
  await dbDeleteFont(id);
}
