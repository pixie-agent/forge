#!/usr/bin/env node
// 生产部署守卫(npm run deploy 的 predeploy 钩子):工作区有未提交改动就拒绝部署。
//
// 起因:2026-10-14 那次移动端适配是从工作区直接构建部署上线的,仓库里没有对应提交,
// 线上跑的东西和 git 对不上,事后无法 diff / 回滚。生产只允许从「已提交」的代码部署。
//
// staging 故意不挂这个守卫(npm run deploy:staging):测试环境存在的意义就是先验证还没提交的改动。
import { execSync } from 'node:child_process'

const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim()

if (dirty) {
  console.error('拒绝部署到生产:工作区存在未提交改动。\n')
  console.error(dirty)
  console.error('\n请先提交(或 git stash)再执行 npm run deploy;')
  console.error('只想验证未提交的改动,请用 npm run deploy:staging。')
  process.exit(1)
}

console.log('工作区干净,继续部署生产。')
