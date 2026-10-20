#!/usr/bin/env node
/**
 * 在 Creem 后台批量创建 Forge 的商品目录(3 个一次性充值包 + 2 个月付订阅)。
 *
 * 本地目录的**唯一权威**是 `src/lib/plans.ts`,本脚本是它的镜像 —— 改档位时两边一起改,
 * 否则 webhook 对账口径会漂(金额/周期以 Creem 商品为准,发多少积分以本地目录为准)。
 *
 * 为什么用脚本而不是后台点:商品只能在 Creem 侧建,后台没有批量入口;用 API 建可以**幂等**
 * (每个商品带固定 Idempotency-Key,重复运行返回已建的那个,不会重复创建),也避免手填
 * 价格/周期时打错 —— 商品建歪了只能归档重建。
 *
 * 用法(密钥只走环境变量:不落盘、不进命令历史、本脚本也绝不打印它):
 *   CREEM_API_KEY=creem_test_xxx node scripts/creem-seed-products.mjs
 *   CREEM_API_KEY=creem_xxx CREEM_ENV=live node scripts/creem-seed-products.mjs
 * 不设 CREEM_API_KEY 时用掩码提示输入(默认 test 环境,密钥不回显)。
 *
 * 建完把 stdout 里那段 `CREEM_PRODUCTS=<json>` 填进 wrangler.jsonc 对应环境,再重新部署。
 * 见 docs/FORGE2.md §20.7。
 */

/** 目录镜像。顺序与 src/lib/plans.ts 一致;id 必须与本地目录 id 完全相同 */
const PRODUCTS = [
  {
    catalogId: 'pack_20',
    name: 'Forge Credits · 20',
    price: 900,
    billingType: 'onetime',
    description:
      '20 generation credits for Forge. 1 credit = 1 app generation or edit. One-time purchase, credits never expire. Redeemable only inside the Forge app and not transferable.',
  },
  {
    catalogId: 'pack_60',
    name: 'Forge Credits · 60',
    price: 2500,
    billingType: 'onetime',
    description:
      '60 generation credits for Forge. 1 credit = 1 app generation or edit. One-time purchase, credits never expire. Redeemable only inside the Forge app and not transferable.',
  },
  {
    catalogId: 'pack_200',
    name: 'Forge Credits · 200',
    price: 7900,
    billingType: 'onetime',
    description:
      '200 generation credits for Forge, best value per credit. 1 credit = 1 app generation or edit. One-time purchase, credits never expire. Redeemable only inside the Forge app and not transferable.',
  },
  {
    catalogId: 'plan_plus',
    name: 'Forge Plus',
    price: 1900,
    billingType: 'recurring',
    description:
      'Monthly subscription: 50 generation credits delivered every month. 1 credit = 1 app generation or edit. Billed monthly, cancel anytime; credits already granted stay usable. Redeemable only inside the Forge app and not transferable.',
  },
  {
    catalogId: 'plan_pro',
    name: 'Forge Pro',
    price: 4900,
    billingType: 'recurring',
    description:
      'Monthly subscription: 150 generation credits delivered every month. 1 credit = 1 app generation or edit. Billed monthly, cancel anytime; credits already granted stay usable. Redeemable only inside the Forge app and not transferable.',
  },
]

const TEST_BASE = 'https://test-api.creem.io'
const LIVE_BASE = 'https://api.creem.io'

/** 掩码读取一行(不回显)。非 TTY 时直接报错,避免密钥落到管道/日志里 */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('当前不是交互终端:请改用 CREEM_API_KEY=... 传入密钥'))
      return
    }
    process.stdout.write(question)
    const stdin = process.stdin
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let buf = ''
    const finish = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      process.stdout.write('\n')
      resolve(buf.trim())
    }
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish()
        if (ch === '\u0003') {
          // Ctrl-C
          stdin.setRawMode(false)
          process.stdout.write('\n')
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1)
        else buf += ch
      }
    }
    stdin.on('data', onData)
  })
}

async function createProduct(base, key, p) {
  const res = await fetch(`${base}/v1/products`, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'content-type': 'application/json',
      // 固定幂等键:重跑不会重复建(同一商品改动要走 products update,不是再建一个)
      'Idempotency-Key': `forge-seed-${p.catalogId}-v1`,
    },
    body: JSON.stringify({
      name: p.name,
      description: p.description,
      price: p.price,
      currency: 'USD',
      billing_type: p.billingType,
      ...(p.billingType === 'recurring' ? { billing_period: 'every-month' } : {}),
      // 价内含税:用户看到的 $9 就是实付,不结账时再加一刀(与前端展示一致)
      tax_mode: 'inclusive',
      tax_category: 'saas',
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${p.catalogId} 创建失败(${res.status}):${text.slice(0, 300)}`)
  const data = JSON.parse(text)
  if (!data || typeof data.id !== 'string' || !data.id) throw new Error(`${p.catalogId} 响应缺少 id`)
  return data.id
}

async function main() {
  const envName = (process.env.CREEM_ENV || 'test').toLowerCase()
  if (envName !== 'test' && envName !== 'live') {
    throw new Error(`CREEM_ENV 只能是 test 或 live,收到 ${envName}`)
  }
  let key = (process.env.CREEM_API_KEY || '').trim()
  if (!key) key = await askHidden(`Creem ${envName} API key(输入不回显):`)
  if (!key) throw new Error('未提供 API key')

  // 密钥自身决定环境:test key 只能打 test 门店,反过来也一样(两套数据完全隔离)
  const keyIsTest = key.startsWith('creem_test_')
  if (envName === 'test' && !keyIsTest) {
    throw new Error('CREEM_ENV=test 但密钥不是 creem_test_ 前缀 —— 停手,避免误建到 live 门店')
  }
  if (envName === 'live' && keyIsTest) {
    throw new Error('CREEM_ENV=live 但拿到的是 test 密钥')
  }

  const base = envName === 'live' ? LIVE_BASE : TEST_BASE
  console.log(`→ 目标:${envName} 门店(${base}),共 ${PRODUCTS.length} 个商品\n`)

  const mapping = {}
  for (const p of PRODUCTS) {
    const id = await createProduct(base, key, p)
    mapping[p.catalogId] = id
    const price = `$${(p.price / 100).toFixed(2)}`
    const kind = p.billingType === 'recurring' ? '订阅 / 月' : '一次性'
    console.log(`  ✓ ${p.catalogId.padEnd(10)} ${price.padStart(7)}  ${kind.padEnd(8)} ${id}`)
  }

  console.log('\n把下面这一行填进 wrangler.jsonc 对应环境的 vars.CREEM_PRODUCTS:')
  console.log(`\nCREEM_PRODUCTS='${JSON.stringify(mapping)}'\n`)
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
