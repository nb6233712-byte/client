/**
 * ============================================================================
 * TEST SUITE: FIRM & CLIENT MESSAGING INTEGRATION & FIREBASE SYNC
 * ============================================================================
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Firm & Client Messaging Integration & Firebase Sync', () => {
  const firmMessagesHtml = fs.readFileSync(path.join(rootDir, 'firm', 'messages.html'), 'utf8');
  const clientMessagesHtml = fs.readFileSync(path.join(rootDir, 'client', 'messages.html'), 'utf8');
  const firebaseJs = fs.readFileSync(path.join(rootDir, 'js', 'firebase.js'), 'utf8');

  it('firm/messages.html defines firm-thread-list with interactive client threads', () => {
    assert.ok(firmMessagesHtml.includes('id="firm-thread-list"'), 'Must have id="firm-thread-list"');
    assert.ok(firmMessagesHtml.includes('data-client-id="j11ZvNVZf7Q2FeTrCVNStRM8"'), 'Must contain Nandan thread item');
    assert.ok(firmMessagesHtml.includes('data-client-id="WLvwIL2KC1h0yqo8XGTk88KzjNw1"'), 'Must contain Nandan B thread item');
    assert.ok(firmMessagesHtml.includes('id="firm-thread-title"'), 'Must contain id="firm-thread-title"');
  });

  it('firm/messages.html declares all state switcher buttons and originalHtml', () => {
    assert.ok(firmMessagesHtml.includes('var originalHtml = contentArea ? contentArea.innerHTML :'), 'Must capture originalHtml');
    assert.ok(firmMessagesHtml.includes("var btnLive = document.getElementById('btn-state-live');"), 'Must declare btnLive');
    assert.ok(firmMessagesHtml.includes("var btnLoading = document.getElementById('btn-state-loading');"), 'Must declare btnLoading');
    assert.ok(firmMessagesHtml.includes("var btnEmpty = document.getElementById('btn-state-empty');"), 'Must declare btnEmpty');
    assert.ok(firmMessagesHtml.includes("var btnError = document.getElementById('btn-state-error');"), 'Must declare btnError');
  });

  it('firm/messages.html connects to FirebaseBridge with targetClientId', () => {
    assert.ok(firmMessagesHtml.includes('selectThread(clientId, clientName, engId)'), 'Must implement selectThread()');
    assert.ok(firmMessagesHtml.includes('bindThreadList()'), 'Must bind click listeners to thread list');
    assert.ok(firmMessagesHtml.includes('targetClientId'), 'Must pass targetClientId to subscribeMessages');
  });

  it('web app/js/firebase.js properly handles staff client scoping in subscribeMessages and getMessages', () => {
    assert.ok(firebaseJs.includes('subscribeMessages(callback, onError, engagementId, clientId)'), 'Must accept engagementId and clientId');
    assert.ok(firebaseJs.includes("usr_whitfield_4417"), 'Must resolve default Whitfield targetUid');
    assert.ok(firebaseJs.includes("usr_brennan_llc"), 'Must support Brennan LLC targetUid');
    assert.ok(firebaseJs.includes('_queryRestCollection'), 'Must utilize REST API query fallback');
  });

  it('client/messages.html connects to subscribeMessages with clientUid', () => {
    assert.ok(clientMessagesHtml.includes('clientUid'), 'client/messages.html must pass clientUid to bridge');
    assert.ok(clientMessagesHtml.includes('renderMessageBubbles'), 'Must render messages dynamically');
  });
});
