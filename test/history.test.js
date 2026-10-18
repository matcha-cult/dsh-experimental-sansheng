import test from 'node:test'
import assert from 'node:assert/strict'
import { createHistoryState, foldHistoryEvent, DETAIL_MAX_ENTRIES } from '../src/history.js'

const USER = (text, time = 1000) => ({ type: 'user/message', time, data: { content: [{ type: 'text', text }] } })
const ASSISTANT = (blocks, time = 2000) => ({ type: 'assistant/message', time, data: { message: { role: 'assistant', content: blocks } } })
const CALL = (name, args, callId, time = 3000) => ({ type: 'tool/call', time, data: { name, arguments: args, callId } })
const RESULT = (callId, text, time = 4000, isError = false) => ({
  type: 'tool/result', time, data: { message: { toolCallId: callId, isError, source: { kind: 'tool', callId }, content: [{ type: 'text', text }] } },
})

test('records messages and tool calls/results without reasoning', () => {
  let state = createHistoryState()
  state = foldHistoryEvent(state, USER('拟旨：验证详细历史'))
  state = foldHistoryEvent(state, ASSISTANT([{ type: 'reasoning', text: 'SECRET-REASONING' }, { type: 'text', text: '开始拟旨。' }]))
  state = foldHistoryEvent(state, CALL('sansheng_edict', '{"goal":"g"}', 'call-1'))
  state = foldHistoryEvent(state, RESULT('call-1', '{"sansheng":1,"op":"edict"}'))
  assert.equal(state.entries.length, 4)
  assert.deepEqual(state.entries.map((entry) => entry.kind), ['user', 'assistant', 'tool-call', 'tool-result'])
  assert.ok(state.entries.every((entry) => !entry.detail.includes('SECRET-REASONING')))
  assert.ok(state.entries.every((entry) => !entry.title.includes('SECRET-REASONING')))
  assert.equal(state.entries[2].tool, 'sansheng_edict')
  assert.equal(state.entries[3].tool, 'sansheng_edict')
})

test('deduplicates the same inbox/user delivery and marks errors', () => {
  let state = createHistoryState()
  state = foldHistoryEvent(state, {
    type: 'agent/inbox/spliced',
    time: 1000,
    data: { target: 'next-turn', inserted: [{ content: [{ type: 'text', text: '报告：计划门已通过' }] }] },
  })
  state = foldHistoryEvent(state, USER('报告：计划门已通过', 1001))
  assert.equal(state.entries.length, 1)
  state = foldHistoryEvent(state, CALL('sansheng_gate', '{}', 'call-2', 2000))
  state = foldHistoryEvent(state, RESULT('call-2', 'STALE_REVISION', 3000, true))
  assert.equal(state.entries.at(-1).isError, true)
  assert.equal(state.entries.at(-1).title, 'sansheng_gate 失败')
})

test('bounds entries and total characters while keeping the newest', () => {
  let state = createHistoryState()
  for (let index = 0; index < DETAIL_MAX_ENTRIES + 20; index += 1) {
    state = foldHistoryEvent(state, USER(`消息 ${index}`, 1000 + index))
  }
  assert.equal(state.entries.length, DETAIL_MAX_ENTRIES)
  assert.ok(state.dropped >= 20)
  assert.ok(state.entries.at(-1).detail.includes(String(DETAIL_MAX_ENTRIES + 19)))

  state = createHistoryState()
  for (let index = 0; index < 300; index += 1) {
    state = foldHistoryEvent(state, USER(`长消息 ${index} ${'x'.repeat(600)}`, 1000 + index))
  }
  assert.ok(state.totalChars <= 120000)
  assert.ok(state.entries.length < DETAIL_MAX_ENTRIES)
})

test('excludes harness-injected runtime context from user history', () => {
  let state = createHistoryState()
  state = foldHistoryEvent(state, USER('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.'))
  state = foldHistoryEvent(state, USER('Time sampled while preparing turn 3, step 1: 2026-10-19T00:00:00+08:00'))
  state = foldHistoryEvent(state, USER('<system-reminder>catalog</system-reminder>'))
  state = foldHistoryEvent(state, USER('真正的用户消息'))
  assert.equal(state.entries.length, 1)
  assert.equal(state.entries[0].detail, '真正的用户消息')
})

test('ignores unrelated events', () => {
  const state = createHistoryState()
  assert.equal(foldHistoryEvent(state, { type: 'turn/start', time: 1, data: {} }).entries.length, 0)
})
