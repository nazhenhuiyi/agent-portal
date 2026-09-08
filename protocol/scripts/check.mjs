// Offline contract checks; no server requests, load tests or notification delivery.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examples = path.resolve(base, '../examples/protocol');
const read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const core = await read(path.join(base, 'schemas/core.schema.json'));
const template = await read(path.join(base, 'schemas/template.schema.json'));
const manifest = await read(path.join(examples, 'manifest.json'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(core, 'core');
ajv.addSchema(template, 'template');
const validate = type => ajv.compile({ $ref: type === 'Template' ? 'template' : `core#/$defs/${type}` });

// Conditions beyond JSON Schema. These are validation helpers, not a service implementation.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function checkData(value, depth = 1) {
  assert(depth <= 8, 'content exceeds depth 8');
  if (typeof value === 'number') {
    assert(Number.isFinite(value), 'non-finite number');
    if (Number.isInteger(value)) assert(Number.isSafeInteger(value), 'unsafe integer');
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) checkData(v, depth + 1);
  }
}
function checkContent(content) {
  const normalized = { body: '', data: {}, ...content };
  assert(Buffer.byteLength(JSON.stringify(normalized)) <= 16384, 'content exceeds 16 KiB');
  checkData(normalized);
  if (normalized.link) {
    const u = new URL(normalized.link.url);
    assert(['http:', 'https:'].includes(u.protocol) && u.hostname, 'invalid URL target');
    assert(!u.username && !u.password, 'URL credentials are not allowed');
  }
}
function checkTemplate(t) {
  assert(Buffer.byteLength(JSON.stringify(t)) <= 65536, 'template exceeds 64 KiB');
  const features = new Set(['layout.basic']);
  const assets = new Set();
  for (const tree of [t.widget, t.compact_widget].filter(Boolean)) {
    let count = 0;
    function walk(node, depth) {
      assert(++count <= 32, 'more than 32 nodes per layout');
      assert(depth <= 4, 'layout deeper than 4 nodes');
      if (node.type === 'text') features.add('text.bind');
      if (node.type === 'progress') features.add('progress.bind');
      if (node.type === 'image') { features.add('image.static'); assets.add(node.asset_id); }
      for (const child of node.children ?? []) walk(child, depth + 1);
    }
    walk(tree, 1);
  }
  assert.deepEqual([...features].sort(), [...t.requires].sort(), 'requires must match used capabilities');
  assert.deepEqual([...assets].sort(), [...t.asset_ids].sort(), 'asset_ids must match both layout trees');
}
function checkEvent(event) {
  if (event.item) {
    assert.equal(event.item.topic_id, event.topic_id);
    assert.equal(event.item.id, event.item_id);
    assert.equal(event.item.revision, event.revision);
    assert.equal(event.item.updated_at, event.recorded_at);
    checkContent(event.item.content);
  }
  if (event.notification) {
    assert.equal(event.notification.topic_id,event.topic_id);
    assert.equal(event.notification.id,event.notification_id);
    assert.equal(event.notification.revision,event.revision);
    assert.equal(event.notification.updated_at,event.recorded_at);
    checkContent(event.notification.content);
  }
  if (event.notification?.mode === 'alert') {
    const ttl = Date.parse(event.notification.expires_at) - Date.parse(event.recorded_at);
    assert(ttl > 0 && ttl <= 86400000, 'invalid alert expiry');
  }
}
function semantics(type, value) {
  if (type === 'PublishRequest') checkContent(value.content);
  if (type === 'NotificationRequest' || type === 'Notification') checkContent(value.content);
  if (type === 'PublicationRequest') {
    if (value.item) checkContent(value.item.content);
    if (value.notification) checkContent(value.notification.content);
  }
  if (type === 'Item') checkContent(value.content);
  if (type === 'Template') checkTemplate(value);
  if (type === 'Event') checkEvent(value);
  if (type === 'History') value.events.forEach(checkEvent);
  if (type === 'SyncResponse') {
    for (const item of value.items ?? []) {
      assert.equal(item.topic_id, value.topic_id);
      checkContent(item.content);
    }
    for (const n of value.notifications ?? []) {
      assert.equal(n.topic_id,value.topic_id);
      checkContent(n.content);
    }
    for (const e of value.events ?? []) {
      assert.equal(e.topic_id, value.topic_id);
      checkEvent(e);
    }
    if (value.mode === 'delta' && value.has_more) assert(value.events.length > 0, 'page must progress');
  }
}

const fixtures = {};
for (const [name, type] of Object.entries(manifest)) {
  const value = fixtures[name] = await read(path.join(examples, name));
  const check = validate(type);
  assert(check(value), `${name}: ${ajv.errorsText(check.errors)}`);
  semantics(type, value);
}
// Every public definition must compile, including types not present in the walkthrough.
for (const name of Object.keys(core.$defs)) validate(name);
for (const name of Object.keys(template.$defs)) ajv.compile({ $ref: `template#/$defs/${name}` });

let negativeChecks = 0;
function rejects(type, original, edit) {
  const value = structuredClone(original);
  edit(value);
  const check = validate(type);
  let rejected = !check(value);
  if (!rejected) {
    try { semantics(type, value); } catch { rejected = true; }
  }
  assert(rejected, `expected invalid ${type} to be rejected`);
  negativeChecks++;
}
const publish = fixtures['publish-completed.json'];
rejects('PublishRequest', publish, x => x.content.title = '   ');
const notification = fixtures['notification-only.json'];
rejects('NotificationRequest', notification, x => x.mode = 'urgent');
rejects('NotificationRequest', notification, x => x.ttl_seconds = -1);
rejects('NotificationRequest', notification, x => x.ttl_seconds = 86401);
rejects('NotificationRequest', notification, x => x.content.data = {});
rejects('NotificationRequest', notification, x => x.content.body = '猫'.repeat(501));
rejects('PublishRequest', publish, x => x.notify = {mode:'alert'});
rejects('PublicationRequest', {}, x => {});
rejects('PublicationRequest', fixtures['publication-combined.json'], x => x.item.if_revision = -1);
rejects('PublishRequest', publish, x => x.content.link.url = 'javascript:alert(1)');
rejects('PublishRequest', publish, x => x.content.link.url = 'https://user:secret@example.com');
rejects('PublishRequest', publish, x => x.content.typo = true);
rejects('PublishRequest', publish, x => x.content.template.version = 0);
rejects('PublishRequest', publish, x => x.content.data.large = '猫'.repeat(6000));
rejects('PublishRequest', publish, x => { let v = x.content.data; for (let i=0;i<8;i++) v = v.n = {}; });
rejects('PublishRequest', publish, x => x.content.data.counter = 9007199254740992);
rejects('Event', fixtures['event-deleted.json'], x => x.item = fixtures['item-completed.json']);
rejects('Event', fixtures['event-completed.json'], x => x.item.revision++);
rejects('Event', fixtures['event-notification.json'], x => x.notification.expires_at = '2026-09-08T00:00:00Z');
rejects('Event', fixtures['event-notification.json'], x => x.notification.id = 'wrong');
rejects('SyncResponse', fixtures['snapshot.json'], x => x.has_more = true);
rejects('SyncResponse', fixtures['delta.json'], x => x.events[0].topic_id = 'another');
rejects('SyncResponse', fixtures['delta.json'], x => { x.events=[]; x.has_more=true; });
rejects('Template', fixtures['template.json'], x => x.widget.children[0].type = 'webview');
rejects('Template', fixtures['template.json'], x => x.widget.children[0].text = {value: 'x', bind: '/title'});
rejects('Template', fixtures['template.json'], x => x.widget.children[0].text.bind = '/bad~2escape');
rejects('Template', fixtures['template.json'], x => x.requires = ['layout.basic']);
rejects('Template', fixtures['template.json'], x => x.asset_ids = ['a'.repeat(64)]);
rejects('Template', fixtures['template.json'], x => { for(let i=0;i<4;i++) x.widget={type:'column',children:[x.widget]}; });
rejects('Template', fixtures['template.json'], x => x.widget={type:'column',children:Array.from({length:12},()=>({type:'column',children:Array.from({length:3},()=>({type:'text',text:{value:'x'}}))}))});
// Response readers permit added fields; write requests do not.
const future = structuredClone(fixtures['item-completed.json']);
future.future_field = true; future.content.future_field = true;
assert(validate('Item')(future));
const arbitrary = structuredClone(publish); arbitrary.content.data.new_business_field = { count: 2 };
assert(validate('PublishRequest')(arbitrary)); semantics('PublishRequest', arbitrary);

const api = await SwaggerParser.validate(path.join(base, 'openapi.yaml'));
const ids = new Set(); let operations = 0;
for (const [route, entry] of Object.entries(api.paths)) {
  for (const method of ['get','put','delete','post','patch']) {
    const op = entry[method]; if (!op) continue;
    assert(!ids.has(op.operationId), 'duplicate operationId'); ids.add(op.operationId); operations++;
    assert(op['x-permission'], `${route}: missing permission`);
    const params = [...(entry.parameters ?? []), ...(op.parameters ?? [])];
    for (const match of route.matchAll(/\{([^}]+)\}/g)) assert(params.some(p => p.in==='path' && p.name===match[1] && p.required));
    if (['put','delete'].includes(method) && route.endsWith('/items/{item}')) {
      assert(params.some(p => p.name==='Idempotency-Key' && p.required));
    }
    if (method==='get') assert(!own(op, 'requestBody'));
  }
}
assert.equal(operations, 17);
// Fixtures describe one consistent progression, without pretending to execute it.
assert.equal(fixtures['snapshot.json'].items[0].revision, 1);
assert.deepEqual(fixtures['delta.json'].events[0].item, fixtures['item-completed.json']);
assert.equal(fixtures['event-deleted.json'].revision, 3);
assert.equal(fixtures['history.json'].events[1].item.revision, 1);
console.log(`Validated OpenAPI (${operations} operations), both schemas, ${Object.keys(manifest).length} fixtures and ${negativeChecks} rejection cases.`);
console.log('Contract checks only; this command does not run server, device or performance tests.');
