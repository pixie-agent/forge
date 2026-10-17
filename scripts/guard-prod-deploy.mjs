#!/usr/bin/env node
// 生产部署前置守卫(`npm run deploy` 的 predeploy 钩子)。两条硬性要求,任一不满足即中止:
//
//   1) 当前分支必须是 main。
//      分支模型:staging 分支开发测试 → 验证通过合并到 main → 从 main 上线。
//      不允许从 feature/staging 分支把还没验收的代码直接推到生产。
//
//   2) 工作区必须干净(无未提交改动)。
//      起因:2026-10-14 那次移动端适配是从工作区直接构建部署上线的,仓库里没有对应提交,
//      线上跑的东西和 git 对不上,事后无法 diff / 回滚。生产只允许从「已提交」的代码部署。
//
// staging 环境部署(`npm run deploy:staging`)故意**不**走这个守卫:测试环境存在的意义
// 就是先验证还没合并的改动,所以任何分支都可以往 staging 部署。
//
// 想绕过?不要改这个文件。要么把改动合并到 main,要么用 `npm run deploy:staging` 发到测试环境。
import { execSync } from 'node:child_process'

const PROD_BRANCH = 'main'

const git = (cmd) => execSync(cmd, { encoding: 'utf8' })
const branch = git('git rev-parse --abbrev-ref HEAD').trim()
const dirty = git('git status --porcelain').trim()

const problems = []

if (branch !== PROD_BRANCH) {
  if (branch === 'HEAD') {
    problems.push(`当前处于 detached HEAD(不在任何分支上),要求分支为 "${PROD_BRANCH}"`)
  } else {
    problems.push(`当前分支是 "${branch}",要求分支为 "${PROD_BRANCH}"`)
  }
}

if (dirty) {
  problems.push(`工作区存在未提交改动(${dirty.split('\n').length} 处)`)
}

if (problems.length) {
  console.error('拒绝部署到生产:\n')
  for (const p of problems) console.error(`  · ${p}`)
  console.error('')
  if (dirty) {
    console.error('未提交改动:')
    console.error(dirty)
    console.error('')
  }
  console.error('分支模型:staging 分支开发测试 → 合并到 main → 从 main 上线。')
  console.error('想把当前改动上生产:先合并到 main 并提交;只想验证改动:用 npm run deploy:staging。')
  process.exit(1)
}

console.log(`生产部署前置检查通过:分支 ${branch}、工作区干净。`)
