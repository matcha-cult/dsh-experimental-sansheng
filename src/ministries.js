/**
 * Six-ministry role cards.
 *
 * These are *responsibility boundaries*, not a hard tool sandbox: DSH's host
 * tool registry is shared by every teammate, so an appointee can still call a
 * tool outside its ministry. The board, appointment record and evidence shape
 * make the intended domain explicit; true per-agent capability isolation needs
 * a host-level allowlist/gateway (documented in docs/architecture.md).
 *
 * @module dsh-experimental-sansheng/ministries
 */

/** Canonical 六部 role cards. */
export const MINISTRY_ROLES = Object.freeze({
  吏部: {
    label: '身份与权限',
    duty: 'Agent 注册、角色与权限、凭据生命周期、资源分配',
    forbidden: '不直接执行业务代码，不代替工具或数据部门行动',
  },
  户部: {
    label: '预算与资源',
    duty: 'token/API 成本、配额与计费、资源调度',
    forbidden: '不改动业务逻辑，不批准自身预算',
  },
  礼部: {
    label: '交互与格式',
    duty: '对外话术、格式规范、多语言、合规表达、用户沟通模板',
    forbidden: '不执行安全策略，不修改数据或代码',
  },
  兵部: {
    label: '安全与应急',
    duty: '异常检测与阻断、权限提升审批、应急降级与隔离',
    forbidden: '不处理常规业务交付，不自行解除隔离',
  },
  刑部: {
    label: '审计与惩戒',
    duty: '日志审计、违规判定、回滚、封禁、责任追踪、交付取证',
    forbidden: '不自审自己执行的任务，不替执行者补证据',
  },
  工部: {
    label: '工具与基础设施',
    duty: '工具调用、代码执行、检索、部署、工程任务',
    forbidden: '不审批自身高风险动作，不跨域改权限或预算',
  },
})

/**
 * @param {string} department 六部 name.
 * @returns {{label: string, duty: string, forbidden: string}|null} Role card or null.
 */
export function ministryRole(department) {
  return Object.hasOwn(MINISTRY_ROLES, department) ? MINISTRY_ROLES[department] : null
}

/** One-line role summary for prompts and README. */
export const MINISTRY_SUMMARY = Object.entries(MINISTRY_ROLES)
  .map(([name, role]) => `${name}=${role.label}`)
  .join('，')
