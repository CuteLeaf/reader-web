/** 运行环境判断：扩展侧栏与普通网页的能力不同（跨域、权限） */

export function isExtension(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
}
