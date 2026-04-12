import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_INTERVAL_MS,
  shouldTriggerMaxIntervalSave
} from './autosaveConfig'

test('exports debounce and max-interval constants', () => {
  assert.equal(AUTOSAVE_DEBOUNCE_MS, 1000)
  assert.equal(AUTOSAVE_MAX_INTERVAL_MS, 12_000)
})

test('shouldTriggerMaxIntervalSave is false before interval elapses', () => {
  const now = 100_000
  assert.equal(shouldTriggerMaxIntervalSave(now - 5_000, now), false)
  assert.equal(shouldTriggerMaxIntervalSave(now - AUTOSAVE_MAX_INTERVAL_MS + 1, now), false)
})

test('shouldTriggerMaxIntervalSave is true once interval has elapsed', () => {
  const now = 100_000
  assert.equal(shouldTriggerMaxIntervalSave(now - AUTOSAVE_MAX_INTERVAL_MS, now), true)
  assert.equal(shouldTriggerMaxIntervalSave(now - AUTOSAVE_MAX_INTERVAL_MS - 1, now), true)
})
