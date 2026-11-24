import test from 'node:test';
import assert from 'node:assert/strict';
import { anonymize } from '../web/src/modules/mock/anonymize.js';

const json = JSON.stringify({
  employees: [
    { id: 'E-100234', firstName: 'Priya', lastName: 'Ramanathan', email: 'priya.ramanathan@bigcustomer.com', phone: '+91 98765 43210',
      salary: 184500.75, hired: '2019-03-14T09:30:00Z', active: true, manager: null, status: 'ACTIVE', ssn: '123-45-6789',
      address: { street: '42 Gandhi Road', city: 'Chennai', zip: '600001' }, guid: '3f2b8c1e-9a44-4d1e-8c55-0a1b2c3d4e5f', site: 'https://hr.bigcustomer.com/p/9981' },
    { id: 'E-100235', firstName: 'Rahul', lastName: 'Menon', email: 'rahul@bigcustomer.com', salary: 99000, active: false, manager: 'E-100234', status: 'ACTIVE' },
    { id: 'E-100236', firstName: 'Meera', lastName: 'Iyer', email: 'meera@bigcustomer.com', salary: 71000, active: true, manager: 'E-100234', status: 'LEAVE' },
    { id: 'E-100237', firstName: 'Zed', lastName: 'Four', email: 'zed@bigcustomer.com', salary: 1, active: true, manager: 'E-100234', status: 'ACTIVE' },
  ], total: 4, note: 'Confidential payroll run for Acme Holdings Q3',
});

test('JSON: structure kept, values replaced, no leaks', () => {
  const r = anonymize(json, { keep: ['status'] });
  const o = JSON.parse(r.output), src = JSON.parse(json);
  assert.deepEqual(Object.keys(o), Object.keys(src)); // same top-level keys
  assert.equal(o.employees.length, 3);                 // maxItems 3
  assert.deepEqual(Object.keys(o.employees[0]), Object.keys(src.employees[0]));
  assert.equal(o.employees[0].status, 'ACTIVE');       // kept on request
  assert.equal(o.employees[0].active, true); assert.equal(o.employees[0].manager, null);
  assert.deepEqual(r.leaks, []);
  for (const bad of ['Priya', 'Ramanathan', 'bigcustomer', '98765', '184500', '123-45-6789', 'Gandhi', 'Chennai', '600001', '3f2b8c1e', 'Acme Holdings', 'E-100234'])
    assert.ok(!r.output.includes(bad), 'leaked: ' + bad);
  assert.match(o.employees[0].email, /^[\w.]+@example\.com$/);
  assert.match(o.employees[0].guid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(o.employees[0].hired, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(typeof o.employees[0].salary, 'number');
  assert.match(o.employees[0].site, /^https:\/\/example\.com\//);
  assert.match(o.employees[0].id, /^[A-Z]-\d{6}$/);   // shape kept
  // references stay consistent: manager of #2 equals id of #1
  assert.equal(o.employees[1].manager, o.employees[0].id);
});
test('JSON: deterministic and consistent', () => {
  assert.equal(anonymize(json).output, anonymize(json).output);
});
test('XML / SOAP: tags & namespaces kept, text and attributes replaced, comments dropped', () => {
  const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wd="urn:com.workday/bsvc">
 <!-- internal: customer Contoso Ltd -->
 <soapenv:Body><wd:Get_Workers_Response wd:version="v41.0"><wd:Worker id="W-778812" type="Employee">
   <wd:Name>Kavita Nair</wd:Name><wd:Email>kavita.nair@contoso.com</wd:Email><wd:Salary>120000.50</wd:Salary>
   <wd:Notes><![CDATA[Bank acct 9988776655 at Contoso Bank]]></wd:Notes><wd:Status>Active</wd:Status><wd:Dept>Finance &amp; Tax</wd:Dept>
 </wd:Worker></wd:Get_Workers_Response></soapenv:Body></soapenv:Envelope>`;
  const r = anonymize(xml, { keep: ['Status', 'type'] });
  assert.deepEqual(r.leaks, []);
  for (const bad of ['Kavita', 'Nair', 'contoso', 'Contoso', '778812', '120000', '9988776655', 'Finance'])
    assert.ok(!r.output.includes(bad), 'leaked: ' + bad);
  assert.ok(r.output.includes('xmlns:wd="urn:com.workday/bsvc"') && r.output.includes('<wd:Get_Workers_Response'));
  assert.ok(r.output.includes('<wd:Status>Active</wd:Status>') && r.output.includes('type="Employee"'));
  assert.ok(!r.output.includes('<!--'));
  assert.match(r.output, /<wd:Email>[\w.]+@example\.com<\/wd:Email>/);
  assert.match(r.output, /<wd:Salary>\d{6}\.\d\d<\/wd:Salary>/);
  assert.ok((r.output.match(/<wd:Worker /g) || []).length === 1);
  // output is still well-formed enough: tags balance
  assert.equal((r.output.match(/<[A-Za-z][^>]*[^/]>/g) || []).length, (r.output.match(/<\/[^>]+>/g) || []).length);
});
test('kept fields are excused, everything else is replaced', () => {
  const r = anonymize(JSON.stringify({ a: 'abcdef', b: 'abcdef' }), { keep: [] });
  assert.deepEqual(r.leaks, []);
  // keep list excuses values on purpose and they are not counted as leaks
  const k = anonymize(JSON.stringify({ code: 'KEEPME1', other: 'secret-value' }), { keep: ['code'] });
  assert.ok(k.output.includes('KEEPME1') && !k.output.includes('secret-value') && k.leaks.length === 0);
});
test('bad input', () => {
  assert.throws(() => anonymize('{oops'), /valid JSON/);
  assert.throws(() => anonymize('hello world'), /JSON or XML/);
});
test('dates stay valid', () => {
  for (const d of ['2019-03-14', '2019-03-14T09:30:00Z', '2019-03-14 23:59:59.123+05:30', '2019-03-14T09:30']) {
    const o = JSON.parse(anonymize(JSON.stringify({ d }), {}).output).d;
    assert.ok(!Number.isNaN(Date.parse(o.replace(' ', 'T'))), o);
    assert.equal(o.length, d.length);
  }
});

test('XML type/version attributes are kept; "keep" also matches exact values', () => {
  const x = '<a xmlns:wd="u"><wd:ID wd:type="Currency_ID" wd:version="v41.0">USD</wd:ID><wd:ID wd:type="WID">1234567890abcdef</wd:ID></a>';
  const r = anonymize(x, { keep: ['usd', 'wid'] });
  assert.match(r.output, /wd:type="Currency_ID"/); assert.match(r.output, /wd:version="v41\.0"/); assert.match(r.output, />USD</);
  assert.match(r.output, /wd:type="WID"/); assert.doesNotMatch(r.output, /1234567890abcdef/);
});
