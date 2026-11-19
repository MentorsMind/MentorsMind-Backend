'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const app = require('../index.js');

test('app exports authentication', () => {
  assert.ok(app.authentication, 'authentication is required');
  assert.strictEqual(app.authentication.type, 'custom');
});

test('app exposes the expected triggers', () => {
  const expectedTriggers = [
    'new_booking',
    'payment_received',
    'dispute_opened',
    'session_completed',
    'booking_cancelled',
    'review_received',
    'payment_refunded',
    'milestone_achieved',
  ];

  for (const key of expectedTriggers) {
    assert.ok(app.triggers[key], `missing trigger: ${key}`);
    const trigger = app.triggers[key];
    assert.ok(trigger.key, `trigger ${key} needs a key`);
    assert.strictEqual(trigger.key, key);
    assert.ok(trigger.display, `trigger ${key} needs display`);
    assert.ok(trigger.operation && typeof trigger.operation.perform === 'function',
      `trigger ${key} needs an operation.perform function`);
  }
});

test('app exposes the expected creates', () => {
  const expectedCreates = [
    'create_user',
    'send_email',
    'update_payment_status',
    'reschedule_booking',
    'create_note',
  ];

  for (const key of expectedCreates) {
    assert.ok(app.creates[key], `missing create: ${key}`);
    const create = app.creates[key];
    assert.ok(create.key, `create ${key} needs a key`);
    assert.strictEqual(create.key, key);
    assert.ok(create.operation && typeof create.operation.perform === 'function',
      `create ${key} needs an operation.perform function`);
  }
});

test('each trigger/file is registered with a matching module file', async () => {
  const triggersDir = path.join(__dirname, '..', 'triggers');
  const fs = require('node:fs');
  const files = fs.readdirSync(triggersDir).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const def = require(path.join(triggersDir, file));
    assert.ok(Object.values(app.triggers).some((t) => t.key === def.key),
      `trigger file ${file} not registered in index.js`);
  }
});
