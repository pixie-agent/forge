平台已为每个应用内置一套开箱即用的后端能力(数据库 / 键值 / 原子计数 / 对象存储),无需任何密钥、无需自己搭后端。**生成时必须优先用它把功能做完整,而不是做静态假数据、或只把数据存在内存里**。

覆盖要求(核心目标:把后端能力**用足**,而不是只挂一个 db 上去):
  先判断本应用能用到哪几类能力,再据此设计功能——凡是能用上的都要用上(正常应用 ≥2 类,通常是 db + counter;有上传就加 blob,有设置就加 kv)。逐类判据:
  · 文档集合 db —— 一切"需要保存/回显的业务明细"(留言、报名、评论、待办、记录、订单、菜品、物料、流水…)。
    **只要应用有持久化数据就必须用**,并做完整的"新增 / 查询 / 修改 / 删除"与刷新回显。
  · 原子计数 counter —— 一切"累计口径"的汇总数字:今日营收/杯数/订单数、累计访问量、浏览量、点赞数、下载次数、参与人数。
    判据:**只要应用里出现"今日 X / 累计 X / 已售 X / 共 X 次"这类汇总数字,就必须用 counter 维护该汇总值**
    (明细写 db、汇总走 counter.incr,而不是每次都把全部明细拉下来现算)。这是本平台最容易漏用的一环,务必检查。
  · 键值 kv —— 少量全局配置/开关/公告/门店信息/营业时间/主题偏好。
    判据:**只要应用里有"设置 / 偏好 / 公告 / 开关 / 门店资料"这类概念,就必须用 kv 真实落库**(不要只放内存 state)。
  · 对象存储 blob —— 任何图片/文件:菜单图、商品图、头像、附件、作品图、相册。
    判据:**只要应用允许上传或展示用户提供的图片/文件,就必须用 blob**(禁止外链图片、禁止把 base64 塞进 db)。

硬性要求(功能完整性):
  - 在 plan.json 里用 "data" 字段写明本应用用到的数据能力(见下方规划步骤),实现时与之保持一致。
  - 只要功能需要持久化,就必须真实落库;禁止只用内存 state 假装持久化,禁止留 TODO 或写死假数据。
  - 列表、"共 N 条"等统计必须来自真实数据(服务端 total、counter 汇总值,或由同一份 items 派生),并随增删改联动更新。
  - 列表超过一屏就必须做分页或"加载更多";有检索价值的数据必须提供搜索框(q 走服务端)。
  - 允许"首次打开写入一份贴近真实的种子数据"(用 db.add 写若干条 + kv 记录 seeded 标记,只写一次),让页面一进来就有内容;
    但种子之后的每一次增删改都必须真实落库,不能是假的。
  - 只有"纯静态展示、完全没有任何提交/保存/上传/计数/设置"的应用才可以不调用。

用法(全部来自 `src/lib/store.js` 与 `src/lib/forge.js`,不要自己写 fetch):
  A) 列表 + 统计型应用(最常见,首选):
     import { useCollection } from './lib/store.js'
     const { items, total, loading, error, reload, add, update, toggle, remove,
             query, setQuery, hasMore, loadMore, loadingMore } = useCollection('todos', { pageSize: 12 })
       add({ text, done: false })      新增 → 列表与所有统计随之更新
       update(id, { 字段: 新值 })      改任意字段(本地先生效,失败回滚)
       toggle(id, 'done', t.done)      切换布尔字段
       remove(id)                      删除
     // 列表 items.map(...)  总条数 total(服务端真实总数,不要用 items.length 冒充)
     // 搜索 <Input value={query} onChange={e => setQuery(e.target.value)} />(内置 300ms 防抖)
     // 列表渲染与所有统计都必须从同一份数据派生,禁止另建 count 之类的并行 state。

  B) 需要更底层控制时:import { db, kv, counter, blob, uploadKey } from './lib/forge.js'
     - 文档集合:db.list('todos', { limit:10, offset:0, order:'desc', q:'关键词' }) → { items:[{id,data,created_at}], total, limit, offset }
                db.count('todos', { q }) → 总数;db.add / db.update(合并式) / db.remove
     - 键值:await kv.get('settings', {}) ; await kv.set('settings', {...}) ; await kv.remove('settings')
     - 原子计数:const n = await counter.incr('pageviews') → 新值;counter.incr(key, -1) 取消;await counter.get(key)
     - 对象:blob.url(key) 可直接 <img src={blob.url(key)} />;await blob.put(key, file, file.type)(单文件 ≤2MB,超限会报错,前端要提示);
             await blob.list('uploads/') → { items:[{key,size,uploaded}] }(相册/附件列表);await blob.remove(key)
     - 上传键:uploadKey(file, 'uploads') 生成不易重复的 key

  C) 二次封装好的 hooks(优先用它们,省得自己管三态):
     useCollectionStats(collection, { done: t => t.done }) → { items, total, stats, loading, error, reload }
     useKv('settings', { theme:'light' })                 → { value, set, loading, error }
     useCounter('pageviews', { autoIncr: true })          → { value, loading, incr, refresh }
     useUpload('uploads')                                 → { put, uploading, error, progress, url }
     useBlobs('uploads/')                                 → { items, loading, error, reload, remove, url }

集合名/键名用小写英文(如 guestbook、signups、todos);只保存访问者主动提交或运行产生的数据。**支付分档**:可以做「外链支付按钮」——按钮指向 Stripe Payment Link / 收银台等外部付款页(target="_blank" 打开),付款结果由对方页面处理;但**禁止**在本应用里收集或存储卡号、有效期、CVC、银行账户等支付凭证,也禁止收集密码。所有请求都要处理失败:给出友好提示(Toast 或 ErrorState),不要让页面崩溃或白屏。
