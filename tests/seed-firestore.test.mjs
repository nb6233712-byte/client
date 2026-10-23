import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_DATA, seedFirestoreDatabase } from '../scripts/seed-firestore.mjs';

describe('Firestore NoSQL Seeding Architecture (scripts/seed-firestore.mjs)', () => {
  test('1. Engagement Schema: /engagements/eng_2026_whitfield', () => {
    const eng = SEED_DATA.engagement;
    assert.equal(eng.id, 'eng_2026_whitfield');
    assert.equal(eng.clientUid, 'usr_whitfield_4417');
    assert.equal(eng.taxYear, 2026);
    assert.equal(eng.filingStatus, 'Married Filing Jointly');
    assert.equal(eng.currentStage, 3);
    assert.equal(eng.overallProgress, 68);
    assert.equal(eng.federalRefund, 3418.00);
    assert.equal(eng.stateBalanceDue, 612.00);
    assert.deepEqual(eng.assignedCpa, {
      name: 'Denise Rosenthal, CPA',
      ptin: 'P01849201'
    });
  });

  test('2. Document Checklist Schema: /documentRequests', () => {
    const reqs = SEED_DATA.documentRequests;
    assert.equal(reqs.length, 4);

    const misc1099 = reqs.find(r => r.title.includes('1099-MISC'));
    assert.ok(misc1099, 'Must have 1099-MISC');
    assert.equal(misc1099.issuer, 'Keystone Property Group');
    assert.equal(misc1099.status, 'missing');

    const k1 = reqs.find(r => r.title.includes('Schedule K-1'));
    assert.ok(k1, 'Must have Schedule K-1');
    assert.equal(k1.issuer, 'Blue Ridge Tech Partners');
    assert.equal(k1.status, 'missing');

    const closing = reqs.find(r => r.title.includes('Closing Disclosure'));
    assert.ok(closing, 'Must have Closing Disclosure');
    assert.equal(closing.status, 'in_review');

    const w2 = reqs.find(r => r.title.includes('W-2'));
    assert.ok(w2, 'Must have W-2');
    assert.equal(w2.issuer, 'Halstead Medical Group');
    assert.equal(w2.status, 'accepted');
  });

  test('3. Signature Schema: /signatures/sig_8879_whitfield', () => {
    const sig = SEED_DATA.signature;
    assert.equal(sig.id, 'sig_8879_whitfield');
    assert.equal(sig.form, 'Form 8879');
    assert.equal(sig.taxYear, 2026);
    assert.equal(sig.clientUid, 'usr_whitfield_4417');

    assert.equal(sig.primarySigner.name, 'Michael Whitfield');
    assert.equal(sig.primarySigner.status, 'pending');
    assert.equal(sig.primarySigner.attemptsLeft, 3);

    assert.equal(sig.secondarySigner.name, 'Elena Whitfield');
    assert.equal(sig.secondarySigner.status, 'pending');
    assert.equal(sig.secondarySigner.attemptsLeft, 3);
  });

  test('4. Messages Thread: /messages', () => {
    const msgs = SEED_DATA.messages;
    assert.ok(msgs.length >= 4, 'Thread must contain conversation messages');

    const staffMsgs = msgs.filter(m => m.senderRole === 'staff');
    const clientMsgs = msgs.filter(m => m.senderRole === 'client');

    assert.ok(staffMsgs.length > 0, 'Must have staff messages');
    assert.ok(clientMsgs.length > 0, 'Must have client messages');
    assert.ok(staffMsgs[0].senderName.includes('Denise Rosenthal'));
    assert.ok(clientMsgs[0].senderName.includes('Michael Whitfield'));
    assert.ok(msgs.every(m => m.timestamp && m.text), 'All messages must have timestamps and text');
  });

  test('5. Invoicing Schema: /invoices/inv_2026_001', () => {
    const inv = SEED_DATA.invoice;
    assert.equal(inv.id, 'inv_2026_001');
    assert.equal(inv.clientUid, 'usr_whitfield_4417');
    assert.equal(inv.totalAmount, 1240.00);
    assert.equal(inv.status, 'unpaid');
    assert.ok(Array.isArray(inv.items) && inv.items.length === 4);
    assert.equal(inv.items.reduce((sum, item) => sum + item.amount, 0), 1240.00);
  });

  test('6. Atomic Batch Execution: seedFirestoreDatabase commits all collections', async () => {
    const writes = [];
    const mockBatch = {
      set: (ref, data, opts) => writes.push({ path: ref.path, data, opts }),
      commit: async () => ({ writeResults: writes.length })
    };

    const mockDb = {
      collection: (colName) => ({
        doc: (docId) => ({
          path: `${colName}/${docId}`,
          collection: (subColName) => ({
            doc: (subDocId) => ({ path: `${colName}/${docId}/${subColName}/${subDocId}` })
          })
        })
      }),
      batch: () => mockBatch
    };

    const mockAdmin = {
      firestore: {
        FieldValue: {
          serverTimestamp: () => 'MOCK_SERVER_TIMESTAMP'
        }
      }
    };

    const result = await seedFirestoreDatabase(mockDb, mockAdmin);
    assert.equal(result.success, true);
    assert.ok(result.committedCount >= 10, 'Must commit documents across all collections');
    assert.ok(writes.some(w => w.path === 'engagements/eng_2026_whitfield'));
    assert.ok(writes.some(w => w.path === 'signatures/sig_8879_whitfield'));
    assert.ok(writes.some(w => w.path === 'invoices/inv_2026_001'));
  });
});
