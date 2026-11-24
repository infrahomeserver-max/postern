// Starter responses modelled on the documented response shapes of well-known systems.
// Field names, nesting, paging fields and ID formats follow the vendors' public API docs; every value is fictional.
// Used by Mocks -> "From a sample" -> "Start from a known system".

const j = (o) => JSON.stringify(o, null, 2);
const wid = (n) => String(n).padStart(32, '0').replace(/0/g, (c, i) => 'abcdef0123456789'[(i * 7 + n) % 16]);

const workdaySuppliers = `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wd="urn:com.workday/bsvc">
  <env:Body>
    <wd:Get_Suppliers_Response wd:version="v42.0">
      <wd:Request_Criteria>
        <wd:Transaction_Log_Criteria_Data/>
      </wd:Request_Criteria>
      <wd:Response_Filter>
        <wd:Page>1</wd:Page>
        <wd:Count>2</wd:Count>
      </wd:Response_Filter>
      <wd:Response_Results>
        <wd:Total_Results>2</wd:Total_Results>
        <wd:Total_Pages>1</wd:Total_Pages>
        <wd:Page_Results>2</wd:Page_Results>
        <wd:Page>1</wd:Page>
      </wd:Response_Results>
      <wd:Response_Data>
        <wd:Supplier>
          <wd:Supplier_Reference wd:Descriptor="Northwind Traders">
            <wd:ID wd:type="WID">${wid(11)}</wd:ID>
            <wd:ID wd:type="Supplier_ID">S-0079</wd:ID>
            <wd:ID wd:type="Supplier_Reference_ID">SUP-10045</wd:ID>
          </wd:Supplier_Reference>
          <wd:Supplier_Data>
            <wd:Supplier_ID>S-0079</wd:Supplier_ID>
            <wd:Supplier_Name>Northwind Traders</wd:Supplier_Name>
            <wd:Supplier_Category_Reference wd:Descriptor="Professional Services">
              <wd:ID wd:type="Supplier_Category_ID">PROFESSIONAL_SERVICES</wd:ID>
            </wd:Supplier_Category_Reference>
            <wd:Payment_Terms_Reference wd:Descriptor="Net 30">
              <wd:ID wd:type="Payment_Terms_ID">NET_30</wd:ID>
            </wd:Payment_Terms_Reference>
            <wd:Currency_Reference wd:Descriptor="USD">
              <wd:ID wd:type="Currency_ID">USD</wd:ID>
            </wd:Currency_Reference>
            <wd:Inactive>false</wd:Inactive>
          </wd:Supplier_Data>
        </wd:Supplier>
      </wd:Response_Data>
    </wd:Get_Suppliers_Response>
  </env:Body>
</env:Envelope>`;

const workdayRest = j({ total: 2, data: [
  { id: '3aa5550b7fe348b98d7b5741afc65534', descriptor: 'Olivia Martin', href: 'https://wd2-impl-services1.workday.com/ccx/api/v1/acme/workers/3aa5550b7fe348b98d7b5741afc65534' },
  { id: '5d0d5fbc4b5e41a0a1a7a3c4a5e0b6d1', descriptor: 'Arjun Patel', href: 'https://wd2-impl-services1.workday.com/ccx/api/v1/acme/workers/5d0d5fbc4b5e41a0a1a7a3c4a5e0b6d1' }] });

const sapBp = j({ d: { results: [
  { __metadata: { id: "https://my300000-api.s4hana.ondemand.com/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner('1000010')", uri: "https://my300000-api.s4hana.ondemand.com/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner('1000010')", type: 'API_BUSINESS_PARTNER.A_BusinessPartnerType' },
    BusinessPartner: '1000010', Customer: '1000010', Supplier: '', AcademicTitle: '', AuthorizationGroup: '', BusinessPartnerCategory: '2', BusinessPartnerFullName: 'Northwind Traders GmbH', BusinessPartnerGrouping: 'BP02', BusinessPartnerName: 'Northwind Traders GmbH', BusinessPartnerUUID: '00163e5e-1f2a-1eda-b9ab-3c0a1b6f2d4e', CorrespondenceLanguage: 'EN', CreatedByUser: 'CB9980000001', CreationDate: '/Date(1700006400000)/', CreationTime: 'PT09H15M30S', FirstName: '', FormOfAddress: '0003', Industry: '', LastName: '', OrganizationBPName1: 'Northwind Traders GmbH', OrganizationBPName2: '', IsMarkedForArchiving: false, BusinessPartnerIsBlocked: false, to_BusinessPartnerAddress: { __deferred: { uri: "https://my300000-api.s4hana.ondemand.com/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner('1000010')/to_BusinessPartnerAddress" } } }] } });

const sapSalesOrder = j({ d: { results: [
  { __metadata: { id: "https://my300000-api.s4hana.ondemand.com/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder('4500000123')", uri: "https://my300000-api.s4hana.ondemand.com/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder('4500000123')", type: 'API_SALES_ORDER_SRV.A_SalesOrderType' },
    SalesOrder: '4500000123', SalesOrderType: 'OR', SalesOrganization: '1010', DistributionChannel: '10', OrganizationDivision: '00', SoldToParty: '1000010', CreationDate: '/Date(1700006400000)/', TotalNetAmount: '12480.50', TransactionCurrency: 'EUR', OverallSDProcessStatus: 'A', RequestedDeliveryDate: '/Date(1701302400000)/', PurchaseOrderByCustomer: 'PO-77120' }] } });

const netsuiteList = j({ links: [{ rel: 'self', href: 'https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/customer' }], count: 2, hasMore: false,
  items: [{ links: [{ rel: 'self', href: 'https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/customer/107' }], id: '107' },
          { links: [{ rel: 'self', href: 'https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/customer/108' }], id: '108' }], offset: 0, totalResults: 2 });

const netsuiteCustomer = j({ links: [{ rel: 'self', href: 'https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/customer/107' }],
  id: '107', entityId: 'CUST-107', companyName: 'Northwind Traders', email: 'accounts@example.com', phone: '555-0142', isPerson: false, isInactive: false, balance: 2450.75, dateCreated: '2025-01-19T13:10:00Z',
  currency: { id: '1', refName: 'USD' }, subsidiary: { id: '1', refName: 'Parent Company', links: [{ rel: 'self', href: 'https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/subsidiary/1' }] },
  entityStatus: { id: '13', refName: 'CUSTOMER-Closed Won' }, terms: { id: '2', refName: 'Net 30' } });

const salesforce = j({ totalSize: 2, done: true, records: [
  { attributes: { type: 'Account', url: '/services/data/v62.0/sobjects/Account/001Wn00000AbCdEIAV' }, Id: '001Wn00000AbCdEIAV', Name: 'Northwind Traders', Industry: 'Retail', AnnualRevenue: 4200000, BillingCity: 'Seattle', BillingCountry: 'USA', OwnerId: '005Wn00000XyZaBIAZ', CreatedDate: '2025-03-14T09:21:45.000+0000' },
  { attributes: { type: 'Account', url: '/services/data/v62.0/sobjects/Account/001Wn00000AbCdFIAV' }, Id: '001Wn00000AbCdFIAV', Name: 'Contoso Ltd', Industry: 'Technology', AnnualRevenue: 9800000, BillingCity: 'London', BillingCountry: 'UK', OwnerId: '005Wn00000XyZaBIAZ', CreatedDate: '2025-04-02T14:05:10.000+0000' }] });

const dynamics = j({ '@odata.context': 'https://contoso.crm.dynamics.com/api/data/v9.2/$metadata#accounts(name,revenue,accountnumber)', value: [
  { '@odata.etag': 'W/"81052965"', name: 'Northwind Traders', revenue: 4200000, accountnumber: 'ACC-1001', accountid: '78914942-34cb-ed11-b596-0022481d68cd', _transactioncurrencyid_value: '228f42f8-e646-e111-8eb7-78e7d162ced1', modifiedon: '2025-03-14T09:21:45Z' },
  { '@odata.etag': 'W/"81052970"', name: 'Contoso Ltd', revenue: 9800000, accountnumber: 'ACC-1002', accountid: '7c9d1e3a-34cb-ed11-b596-0022481d68cd', _transactioncurrencyid_value: '228f42f8-e646-e111-8eb7-78e7d162ced1', modifiedon: '2025-04-02T14:05:10Z' }] });

const fusion = j({ items: [
  { InvoiceId: 300100119154009, InvoiceNumber: 'INV-10045', InvoiceCurrency: 'USD', PaymentCurrency: 'USD', InvoiceAmount: 4820.5, InvoiceDate: '2025-06-26', BusinessUnit: 'US1 Business Unit', Supplier: 'Northwind Traders', SupplierNumber: '1004', ValidationStatus: 'Validated', PaymentStatus: 'Unpaid', links: [{ rel: 'self', href: 'https://servername.fa.us2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/invoices/300100119154009', name: 'invoices', kind: 'item' }] },
  { InvoiceId: 300100119154010, InvoiceNumber: 'INV-10046', InvoiceCurrency: 'USD', PaymentCurrency: 'USD', InvoiceAmount: 1250, InvoiceDate: '2025-06-27', BusinessUnit: 'US1 Business Unit', Supplier: 'Contoso Ltd', SupplierNumber: '1007', ValidationStatus: 'Needs revalidation', PaymentStatus: 'Unpaid', links: [{ rel: 'self', href: 'https://servername.fa.us2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/invoices/300100119154010', name: 'invoices', kind: 'item' }] }],
  count: 2, hasMore: false, limit: 25, offset: 0, links: [{ rel: 'self', href: 'https://servername.fa.us2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/invoices', name: 'invoices', kind: 'collection' }] });

const servicenow = j({ result: [
  { sys_id: '9de5069c5afe602b2d0f3a4d3c1a8f21', number: 'INC0010001', short_description: 'VPN connection drops every hour', state: '2', priority: '3', urgency: '2', impact: '2', category: 'network', opened_at: '2025-06-26 08:15:42', opened_by: { link: 'https://dev12345.service-now.com/api/now/table/sys_user/6816f79cc0a8016401c5a33be04be441', value: '6816f79cc0a8016401c5a33be04be441' }, assigned_to: '', sys_created_on: '2025-06-26 08:15:42', sys_updated_on: '2025-06-26 09:02:10' }] });

const stripe = j({ object: 'list', url: '/v1/customers', has_more: false, data: [
  { id: 'cus_Nf3kQ2xYzP0aBc', object: 'customer', created: 1750929600, email: 'billing@example.com', name: 'Northwind Traders', currency: 'usd', balance: 0, delinquent: false, livemode: false, metadata: {} }] });

const ebsOrder = j({ OutputParameters: { '@xmlns': 'http://xmlns.oracle.com/apps/ont/rest/OrderAPIs/process_order/', '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance', X_RETURN_STATUS: 'S', X_MSG_COUNT: 0, X_MSG_DATA: '',
  X_HEADER_REC: { ORDER_NUMBER: 71000123, HEADER_ID: 2048771, ORG_ID: 204, ORDER_TYPE_ID: 1001, SOLD_TO_ORG_ID: 1006, TRANSACTIONAL_CURR_CODE: 'USD', FLOW_STATUS_CODE: 'ENTERED', ORDERED_DATE: '2025-06-26T00:00:00.000-05:00', CUST_PO_NUMBER: 'PO-77120' },
  X_MESSAGES: { X_MESSAGES_ITEM: [{ MESSAGE_TEXT: 'Order 71000123 created successfully.' }] } } });
const ebsOpenIface = `<?xml version="1.0" encoding="UTF-8"?>
<OutputParameters xmlns="http://xmlns.oracle.com/apps/ar/rest/autoinvoice/ra_interface_lines_all">
  <Summary>
    <SuccessCount>1</SuccessCount>
    <ErrorCount>0</ErrorCount>
  </Summary>
  <Result>
    <Output>
      <Index>0</Index>
      <Status>SUCCESS</Status>
    </Output>
  </Result>
</OutputParameters>`;
const oauth = j({ access_token: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJtb2NrIn0.', token_type: 'Bearer', expires_in: 3600, scope: 'read write', refresh_token: 'REDACTED-3f9a1c2b' });
const problem = j({ type: 'https://example.com/problems/validation-error', title: 'Validation failed', status: 422, detail: 'The field "amount" must be greater than zero.', instance: '/invoices/INV-10045', errors: [{ field: 'amount', message: 'must be greater than zero' }] });

export const FORMATS = [
  { group: 'Workday', items: [
    { id: 'wd-suppliers', name: 'SOAP: Get_Suppliers', kind: 'xml', method: 'POST', path: '/ccx/service/acme/Resource_Management/v42.0', status: 200, body: workdaySuppliers },
    { id: 'wd-workers', name: 'REST: workers list', kind: 'json', method: 'GET', path: '/ccx/api/v1/acme/workers', status: 200, body: workdayRest }] },
  { group: 'SAP S/4HANA (OData v2)', items: [
    { id: 'sap-bp', name: 'A_BusinessPartner', kind: 'json', method: 'GET', path: '/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner', status: 200, body: sapBp },
    { id: 'sap-so', name: 'A_SalesOrder', kind: 'json', method: 'GET', path: '/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder', status: 200, body: sapSalesOrder }] },
  { group: 'Oracle', items: [
    { id: 'ns-list', name: 'NetSuite REST: customer list', kind: 'json', method: 'GET', path: '/services/rest/record/v1/customer', status: 200, body: netsuiteList },
    { id: 'ns-cust', name: 'NetSuite REST: customer record', kind: 'json', method: 'GET', path: '/services/rest/record/v1/customer/107', status: 200, body: netsuiteCustomer },
    { id: 'fusion-inv', name: 'Fusion Financials: invoices', kind: 'json', method: 'GET', path: '/fscmRestApi/resources/11.13.18.05/invoices', status: 200, body: fusion }] },
  { group: 'Oracle E-Business Suite (EBS)', items: [
    { id: 'ebs-order', name: 'ISG REST (PL/SQL): process_order', kind: 'json', method: 'POST', path: '/webservices/rest/OrderAPIs/process_order/', status: 200, body: ebsOrder },
    { id: 'ebs-iface', name: 'ISG REST (open interface): AutoInvoice', kind: 'xml', method: 'POST', path: '/webservices/rest/autoinvoice/RA_INTERFACE_LINES_ALL/', status: 200, body: ebsOpenIface }] },
  { group: 'CRM and service', items: [
    { id: 'sf-acc', name: 'Salesforce: SOQL Account query', kind: 'json', method: 'GET', path: '/services/data/v62.0/query', status: 200, body: salesforce },
    { id: 'd365-acc', name: 'Dynamics 365: accounts', kind: 'json', method: 'GET', path: '/api/data/v9.2/accounts', status: 200, body: dynamics },
    { id: 'snow-inc', name: 'ServiceNow: incident table', kind: 'json', method: 'GET', path: '/api/now/table/incident', status: 200, body: servicenow }] },
  { group: 'General needs', items: [
    { id: 'stripe-list', name: 'Payments: Stripe-style list', kind: 'json', method: 'GET', path: '/v1/customers', status: 200, body: stripe },
    { id: 'oauth', name: 'OAuth 2 token response', kind: 'json', method: 'POST', path: '/oauth2/token', status: 200, body: oauth },
    { id: 'problem', name: 'Error: RFC 7807 problem+json', kind: 'json', method: 'POST', path: '/invoices', status: 422, body: problem }] },
];
