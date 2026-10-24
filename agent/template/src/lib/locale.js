/**
 * 产物文案语言:平台默认文案的中英双份。
 *
 * 为什么需要它:平台自带的组件与 SDK 里有不少默认文案(空状态「暂无内容」、Modal 的
 * 「确认/取消」、接口报错「加载失败」…),而这些文件是**平台资产,模型不许改**。
 * 没有这层机制的话,一个英文应用里就会到处漏出中文。
 *
 * 怎么用(应用侧,一行):
 *   import { setLocale } from './lib/locale.js'
 *   setLocale('en')          // 'zh'(默认) | 'en'
 *
 * setLocale 还会顺手把 <html lang> 改掉 —— index.html 是平台文件,模型改不了,
 * 靠这一步让屏幕阅读器与浏览器翻译提示知道页面到底是什么语言。
 *
 * 平台文件(平台文件内部)统一用 t('key') 取文案,不要写死中文字面量。
 */

/** 当前语言;默认简体中文 —— 不调用 setLocale 时行为与从前完全一致 */
let current = 'zh'

const DICT = {
  zh: {
    loading: '正在加载…',
    empty: '暂无内容',
    loadFailed: '加载失败',
    updateFailed: '更新失败',
    deleteFailed: '删除失败',
    saveFailed: '保存失败',
    uploadFailed: '上传失败',
    requestFailed: '请求失败',
    requestFailedWith: '请求失败({status})',
    fileTooLarge: '文件太大,请压缩到 2MB 以内再上传',
    retry: '重试',
    close: '关闭',
    closeHint: '关闭提示',
    confirm: '确认',
    cancel: '取消',
    confirmTitle: '确认操作',
    irreversible: '此操作不可撤销,请确认后继续。',
    viewSwitch: '视图切换',
    segmentedSwitch: '分段切换',
    toastProviderMissing: '请在根组件包一层 <ToastProvider>',
  },
  en: {
    loading: 'Loading…',
    empty: 'Nothing here yet',
    loadFailed: 'Could not load',
    updateFailed: 'Could not update',
    deleteFailed: 'Could not delete',
    saveFailed: 'Could not save',
    uploadFailed: 'Upload failed',
    requestFailed: 'Request failed',
    requestFailedWith: 'Request failed ({status})',
    fileTooLarge: 'File is too large — keep it under 2MB and try again',
    retry: 'Retry',
    close: 'Close',
    closeHint: 'Dismiss notification',
    confirm: 'Confirm',
    cancel: 'Cancel',
    confirmTitle: 'Confirm',
    irreversible: 'This cannot be undone. Please confirm to continue.',
    viewSwitch: 'Switch view',
    segmentedSwitch: 'Switch segment',
    toastProviderMissing: 'Wrap your app in <ToastProvider>',
  },
}

/**
 * 切换界面语言。非法值按 'zh' 处理。
 * 顺带把 <html lang> 设成对应值(index.html 是平台文件,只能运行时改)。
 */
export function setLocale(lang) {
  current = DICT[lang] ? lang : 'zh'
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en'
  }
  return current
}

/** 当前语言 */
export function getLocale() {
  return current
}

/** 取平台默认文案;没有这个 key 就原样返回 key(便于暴露问题) */
export function t(key) {
  const table = DICT[current] ?? DICT.zh
  return table[key] ?? key
}
