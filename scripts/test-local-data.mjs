/**
 * 本地数据管理模块测试（纯 Node，不依赖浏览器 / 网络）。
 * 运行：pnpm test:local-data
 */
import {
  LOCAL_DATA_KEY,
  LOCAL_DATA_SCOPES,
  LOCAL_DATA_VERSION,
  LocalDataError,
  LocalDataManager,
  appLocalData,
  inspectLocalData,
  normalizeSnapshot,
} from '../src/lib/storage/localData.ts';
import {
  DEFAULT_SETTINGS,
  loadLastEndpoint,
  loadSettings,
  loadShelfFilter,
  saveLastEndpoint,
  saveSettings,
  saveShelfFilter,
} from '../src/lib/storage/settings.ts';

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
const section = (name) => console.log(`\n${name}：`);

/** 可控时钟与 id，便于断言时间戳变化与去重 */
let clock = 1_700_000_000_000;
let seq = 0;
const options = (storage) => ({ storage, now: () => clock, id: () => `gen-${++seq}` });

/** 可注入故障的内存 Storage，模拟隐私模式 / 配额耗尽 */
function makeStorage(initial = {}, opts = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) {
      if (opts.throwOnGet) throw new Error('read denied');
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      if (opts.throwOnSet) throw new Error('quota exceeded');
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

const throws = (fn, code) => {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof LocalDataError && (!code || e.code === code);
  }
};

/* ------------------------------ 空数据 ------------------------------ */
section('空数据');
{
  const m = new LocalDataManager(options(makeStorage()));
  const v = m.view();
  ok('全新环境返回默认快照', v.version === LOCAL_DATA_VERSION && v.updatedAt > 0);
  ok('所有集合为空', v.endpoints.length === 0 && v.tokens.length === 0 && v.progress.length === 0);
  ok('偏好取默认值', v.preferences.filter === 'all' && v.preferences.endpoint === '');
  ok('空数据不算降级', m.isDegraded === false);
  ok('查看空列表 / 单条', m.list('tokens').length === 0 && m.get('tokens', 'x') === undefined);
  ok('删除不存在的记录返回 false', m.remove('tokens', 'x') === false);
  ok('初始没有未保存改动', m.isDirty === false);
}

/* ------------------------- 新增 / 查看 / 编辑 / 删除 ------------------------- */
section('记录增删改查');
{
  const m = new LocalDataManager(options(makeStorage()));
  const ep = m.create('endpoints', { base: 'http://192.168.1.5:1122', label: '手机' });
  ok('新增生成 id 与时间戳', !!ep.id && ep.createdAt === clock && ep.updatedAt === clock);
  ok('新增保留业务字段', ep.base === 'http://192.168.1.5:1122' && ep.label === '手机');
  ok('新增后有未保存改动', m.isDirty === true);

  const listed = m.list('endpoints');
  listed[0].label = '被外部改掉';
  ok('查看返回副本', m.get('endpoints', ep.id)?.label === '手机');
  ok('按 id 查看', m.get('endpoints', ep.id)?.base === ep.base);
  ok('查看不存在的记录', m.get('endpoints', 'none') === undefined);

  m.create('tokens', { id: 'tok-1', base: 'http://192.168.1.5:1122', token: 'abc' });
  m.create('progress', { bookId: 'local:1', index: 2, pos: 120, title: '第二章' });
  ok(
    '三类集合各自独立',
    m.list('endpoints').length === 1 &&
      m.list('tokens').length === 1 &&
      m.list('progress').length === 1,
  );

  const before = m.get('endpoints', ep.id);
  clock += 1000;
  const edited = m.update('endpoints', ep.id, { label: '书房手机', lastUsedAt: clock });
  ok('编辑生效', edited.label === '书房手机' && edited.lastUsedAt === clock);
  ok('编辑不改 id / createdAt', edited.id === ep.id && edited.createdAt === before.createdAt);
  ok('编辑刷新 updatedAt', edited.updatedAt > before.updatedAt);
  ok('编辑不允许篡改 id', m.update('endpoints', ep.id, { id: 'hacked' }).id === ep.id);
  ok(
    '编辑不存在抛 not-found',
    throws(() => m.update('tokens', 'none', { token: 'x' }), 'not-found'),
  );

  ok('删除返回 true', m.remove('progress', m.list('progress')[0].id) === true);
  ok('删除后列表为空', m.list('progress').length === 0);
  m.clear('tokens');
  ok('clear 清空整类记录', m.list('tokens').length === 0);
}

/* --------------------- 保存 / 重新加载 / 重启恢复 --------------------- */
section('保存与重新加载');
{
  const storage = makeStorage();
  const a = new LocalDataManager(options(storage));
  a.create('endpoints', { id: 'ep-1', base: 'http://a:1122' });
  a.setPreferences({ endpoint: 'http://a:1122', filter: 'local' });
  ok('未保存时磁盘上没有快照', storage.getItem(LOCAL_DATA_KEY) === null);
  ok(
    '未保存的改动不会出现在新实例',
    new LocalDataManager(options(storage)).list('endpoints').length === 0,
  );

  a.save();
  ok('保存后写入版本化 key', typeof storage.getItem(LOCAL_DATA_KEY) === 'string');
  ok('保存后清除脏标记', a.isDirty === false);

  const b = new LocalDataManager(options(storage));
  ok('重启后记录可恢复', b.get('endpoints', 'ep-1')?.base === 'http://a:1122');
  ok(
    '重启后偏好可恢复',
    b.getPreferences().filter === 'local' && b.getPreferences().endpoint === 'http://a:1122',
  );

  b.create('tokens', { id: 'draft', base: 'http://b:1122', token: 'tmp' });
  b.setPreferences({ filter: 'remote' });
  const reloaded = b.reload();
  ok('重新加载丢弃未保存的记录', reloaded.tokens.length === 0 && !b.get('tokens', 'draft'));
  ok('重新加载还原偏好', b.getPreferences().filter === 'local');
  ok('重新加载后无脏标记', b.isDirty === false);

  const json = b.snapshotJSON();
  const c = new LocalDataManager(options(makeStorage()));
  c.restore(json);
  ok('备份导出 / 恢复往返', c.get('endpoints', 'ep-1')?.base === 'http://a:1122');
  ok('恢复后已落盘', c.isDirty === false);
  ok(
    '坏 JSON 拒绝恢复',
    throws(() => c.restore('{oops'), 'invalid'),
  );
  ok(
    '未来版本拒绝恢复',
    throws(() => c.restore(JSON.stringify({ version: 99 })), 'invalid'),
  );
}

/* ------------------------------ 重复记录 ------------------------------ */
section('重复记录');
{
  const m = new LocalDataManager(options(makeStorage()));
  m.create('endpoints', { id: 'ep-1', base: 'http://a:1122' });
  ok(
    '同 id 拒绝新增',
    throws(() => m.create('endpoints', { id: 'ep-1', base: 'http://b:1122' }), 'duplicate'),
  );
  ok(
    '同业务键（base）拒绝新增',
    throws(() => m.create('endpoints', { id: 'ep-2', base: 'http://a:1122' }), 'duplicate'),
  );
  m.create('endpoints', { id: 'ep-2', base: 'http://b:1122' });
  ok(
    '编辑成与别人相同 base 被拒绝',
    throws(() => m.update('endpoints', 'ep-2', { base: 'http://a:1122' }), 'duplicate'),
  );
  ok('编辑自己的其它字段不受影响', m.update('endpoints', 'ep-2', { label: 'OK' }).label === 'OK');
  m.create('progress', { bookId: 'local:1', index: 0, pos: 0 });
  ok(
    '同一本书只允许一条进度',
    throws(() => m.create('progress', { bookId: 'local:1', index: 1, pos: 3 }), 'duplicate'),
  );

  const dirty = {
    version: LOCAL_DATA_VERSION,
    preferences: {},
    endpoints: [
      { id: 'dup', base: 'http://a:1122', createdAt: 1 },
      { id: 'dup', base: 'http://a:1122', createdAt: 2 },
      { id: 'other', base: 'http://a:1122', createdAt: 3 },
    ],
  };
  const normalized = normalizeSnapshot(dirty, {
    now: () => clock,
    id: () => `n-${++seq}`,
  }).snapshot;
  ok(
    '落盘里重复 id 与重复 base 自动去重',
    normalized.endpoints.length === 1,
    JSON.stringify(normalized.endpoints),
  );
}

/* ------------------------------ 无效输入 ------------------------------ */
section('无效输入');
{
  const m = new LocalDataManager(options(makeStorage()));
  ok(
    '空后端地址被拒绝',
    throws(() => m.create('endpoints', { base: '  ' }), 'invalid'),
  );
  ok(
    '空令牌被拒绝',
    throws(() => m.create('tokens', { base: 'http://a', token: '' }), 'invalid'),
  );
  ok(
    '空书籍 id 被拒绝',
    throws(() => m.create('progress', { bookId: '', index: 0, pos: 0 }), 'invalid'),
  );
  ok(
    '负数章节被拒绝',
    throws(() => m.create('progress', { bookId: 'b', index: -1, pos: 0 }), 'invalid'),
  );
  ok(
    '非数字位置被拒绝',
    throws(() => m.create('progress', { bookId: 'b', index: 0, pos: 'x' }), 'invalid'),
  );
  ok(
    '非法备注类型被拒绝',
    throws(() => m.create('endpoints', { base: 'http://a', label: 123 }), 'invalid'),
  );
  m.setPreferences({
    settings: {
      fontSize: 22,
      theme: null,
      scrollSpeed: Number.NaN,
      autoSave: false,
      bad: { x: 1 },
    },
  });
  const prefs = m.getPreferences().settings;
  ok(
    '偏好过滤 null / NaN / 嵌套对象',
    prefs.fontSize === 22 &&
      prefs.autoSave === false &&
      !('theme' in prefs) &&
      !('bad' in prefs) &&
      !('scrollSpeed' in prefs),
  );

  const messy = new LocalDataManager(
    options(
      makeStorage({
        [LOCAL_DATA_KEY]: JSON.stringify({
          version: LOCAL_DATA_VERSION,
          endpoints: [
            null,
            'oops',
            { id: 'bad' },
            { id: 'good', base: 'http://ok', createdAt: 'x' },
          ],
          tokens: 'not-an-array',
          preferences: { filter: 'unknown', endpoint: 42 },
        }),
      }),
    ),
  );
  ok(
    '坏记录被跳过、合法记录保留',
    messy.list('endpoints').length === 1 && messy.list('endpoints')[0].id === 'good',
  );
  ok('非数组集合退化为空', messy.list('tokens').length === 0);
  ok(
    '非法偏好回落默认值',
    messy.getPreferences().filter === 'all' && messy.getPreferences().endpoint === '',
  );
  ok('坏记录自动补齐时间戳', messy.list('endpoints')[0].createdAt === clock);
}

/* ------------------------------ 读写异常 ------------------------------ */
section('读写异常');
{
  const broken = new LocalDataManager(options(makeStorage({}, { throwOnGet: true })));
  ok('读取抛错时仍返回可用快照', broken.view().version === LOCAL_DATA_VERSION);
  ok('读取抛错标记为降级', broken.isDegraded === true);

  const full = new LocalDataManager(options(makeStorage({}, { throwOnSet: true })));
  full.create('endpoints', { base: 'http://a' });
  ok(
    '写入抛错为 LocalDataError(write)',
    throws(() => full.save(), 'write'),
  );
  ok('写入失败仍保留脏标记', full.isDirty === true);
  ok('写入失败不丢内存数据', full.list('endpoints').length === 1);

  const storage = makeStorage({ [LOCAL_DATA_KEY]: '{坏掉的 JSON' });
  const recovered = new LocalDataManager(options(storage));
  ok('坏 JSON 不会让启动崩溃', recovered.view().version === LOCAL_DATA_VERSION);
  ok('坏 JSON 标记为降级', recovered.isDegraded === true);
}

/* ------------------------------ 旧数据兼容 ------------------------------ */
section('旧数据兼容');
{
  const legacy = makeStorage({
    'reader:settings:v2': JSON.stringify({ theme: 0, fontSize: 20 }),
    'reader:endpoint': 'http://old:1122',
    'reader:shelf-filter': 'remote',
    'reader:sourceTokens': JSON.stringify({ 'http://old:1122': 'tok-old' }),
    'reader:sourceToken': 'tok-single',
    'reader:theme-migrated:beige': '1',
  });
  const m = new LocalDataManager(options(legacy));
  ok('旧设置迁移', m.getPreferences().settings.fontSize === 20);
  ok('旧后端地址迁移', m.getPreferences().endpoint === 'http://old:1122');
  ok('旧筛选迁移', m.getPreferences().filter === 'remote');
  ok('旧令牌表迁移', m.tokenMap()['http://old:1122'] === 'tok-old');
  ok('旧迁移标记保留', m.getPreferences().themeMigrated === true);
  ok('迁移结果立刻落盘', typeof legacy.getItem(LOCAL_DATA_KEY) === 'string');
  ok('不删旧 key（可回退旧版本）', legacy.getItem('reader:endpoint') === 'http://old:1122');

  const single = new LocalDataManager(options(makeStorage({ 'reader:sourceToken': 'only-one' })));
  ok('只有旧单令牌时兼容 __legacy', single.tokenMap().__legacy === 'only-one');

  const oldSnapshot = new LocalDataManager(
    options(
      makeStorage({
        [LOCAL_DATA_KEY]: JSON.stringify({
          version: 0,
          tokens: [{ id: 't', base: 'http://a', token: 'x' }],
        }),
      }),
    ),
  );
  ok('旧版本快照补齐到当前版本', oldSnapshot.view().version === LOCAL_DATA_VERSION);
  ok('旧版本快照保留记录', oldSnapshot.get('tokens', 't')?.token === 'x');
  ok('旧版本快照标记为降级', oldSnapshot.isDegraded === true);

  const future = new LocalDataManager(
    options(
      makeStorage({
        [LOCAL_DATA_KEY]: JSON.stringify({
          version: 99,
          tokens: [{ id: 't', base: 'a', token: 'x' }],
        }),
      }),
    ),
  );
  ok('未来版本不强行解析', future.list('tokens').length === 0 && future.isDegraded === true);
}

/* --------------------- 现有 settings.ts 对外行为 --------------------- */
section('现有设置 API 回归');
{
  appLocalData.setPreferences({ settings: {}, themeMigrated: false, endpoint: '', filter: 'all' });
  appLocalData.save();
  const defaults = loadSettings();
  ok(
    '无存档时返回完整默认设置',
    defaults.fontSize === DEFAULT_SETTINGS.fontSize && defaults.theme === 1,
  );

  appLocalData.setPreferences({ settings: { theme: 0, fontSize: 24 }, themeMigrated: false });
  appLocalData.save();
  const migrated = loadSettings();
  ok('老用户 theme=0 一次性迁移成米黄', migrated.theme === 1 && migrated.fontSize === 24);
  saveSettings({ ...migrated, theme: 0 });
  ok('迁移过一次后用户可改回纯白', loadSettings().theme === 0);

  saveSettings({ ...DEFAULT_SETTINGS, fontSize: 26 });
  ok('saveSettings 落盘并可重新加载', appLocalData.reload().preferences.settings.fontSize === 26);
  ok('loadLastEndpoint 无值时为 undefined', loadLastEndpoint() === undefined);
  saveLastEndpoint('http://last:1122');
  ok('save/loadLastEndpoint 往返', loadLastEndpoint() === 'http://last:1122');
  ok('默认筛选为 all', loadShelfFilter() === 'all');
  saveShelfFilter('local');
  ok('save/loadShelfFilter 往返', loadShelfFilter() === 'local');

  appLocalData.setToken('http://last:1122', 'secret');
  ok('setToken 新增', appLocalData.tokenMap()['http://last:1122'] === 'secret');
  appLocalData.setToken('http://last:1122', 'changed');
  ok(
    'setToken 更新不产生重复',
    appLocalData.list('tokens').filter((t) => t.base === 'http://last:1122').length === 1 &&
      appLocalData.tokenMap()['http://last:1122'] === 'changed',
  );
  appLocalData.setToken('http://last:1122', '');
  ok('setToken 空值删除', appLocalData.tokenMap()['http://last:1122'] === undefined);
  ok(
    'setToken 空 base 被拒绝',
    throws(() => appLocalData.setToken('  ', 'x'), 'invalid'),
  );
}

/* --------------------- 连接窗口联动：rememberEndpoint --------------------- */
section('连接后端自动记录地址');
{
  const storage = makeStorage();
  const m = new LocalDataManager(options(storage));
  clock += 1000;
  const first = m.rememberEndpoint('http://192.168.1.5:1122', '书房手机');
  ok(
    '连接成功写入一条后端地址',
    m.list('endpoints').length === 1 && first.base === 'http://192.168.1.5:1122',
  );
  ok('备注与最近连接时间都写入', first.label === '书房手机' && first.lastUsedAt === clock);
  ok('立即落盘（重启可恢复）', JSON.parse(storage.map.get(LOCAL_DATA_KEY)).endpoints.length === 1);
  ok('写盘后脏标记清除', m.isDirty === false);

  clock += 5000;
  const again = m.rememberEndpoint('http://192.168.1.5:1122', '不要覆盖');
  ok('同地址重复连接不产生新记录', m.list('endpoints').length === 1);
  ok('已有备注不被覆盖', again.label === '书房手机');
  ok('最近连接时间更新', again.lastUsedAt === clock);

  clock += 1000;
  m.rememberEndpoint('http://192.168.1.8:1122');
  ok('不同地址另存一条', m.list('endpoints').length === 2);
  ok('无备注时不会写入 undefined 字段', !('label' in m.list('endpoints')[1]));
  ok(
    '空地址被拒绝',
    throws(() => m.rememberEndpoint('   '), 'invalid'),
  );
  ok('拒绝后记录数不变', m.list('endpoints').length === 2);

  const reopened = new LocalDataManager(options(storage));
  ok('重启后已保存地址可恢复', reopened.list('endpoints').length === 2);
  ok(
    '重启后备注与最近连接时间仍在',
    reopened.list('endpoints')[0].label === '书房手机' &&
      reopened.list('endpoints')[0].lastUsedAt > 0,
  );

  const bad = new LocalDataManager(options(makeStorage({}, { throwOnSet: true })));
  ok(
    '写盘失败抛 write 错误',
    throws(() => bad.rememberEndpoint('http://192.168.1.9:1122'), 'write'),
  );
  ok('写盘失败仍保留内存记录', bad.list('endpoints').length === 1);
}

/* ------------------------------ 数据总览 ------------------------------ */
section('本地数据总览');
{
  const overview = await inspectLocalData({
    listBooks: async () => [{ id: 'b1' }, { id: 'b2' }],
    listFonts: async () => [{ id: 'f1' }],
  });
  ok(
    '总览带版本与 key',
    overview.key === LOCAL_DATA_KEY && overview.version === LOCAL_DATA_VERSION,
  );
  ok('总览汇总书籍与字体数量', overview.counts.books === 2 && overview.counts.fonts === 1);
  ok(
    '总览汇总快照记录数',
    Number.isFinite(overview.counts.tokens) && Number.isFinite(overview.counts.endpoints),
  );
  ok(
    '总览列出全部本地数据职责',
    overview.scopes.length === LOCAL_DATA_SCOPES.length && overview.scopes.length === 5,
  );
  ok(
    '职责清单覆盖 IndexedDB 大体积数据',
    overview.scopes.some((s) => s.store === 'IndexedDB'),
  );
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
