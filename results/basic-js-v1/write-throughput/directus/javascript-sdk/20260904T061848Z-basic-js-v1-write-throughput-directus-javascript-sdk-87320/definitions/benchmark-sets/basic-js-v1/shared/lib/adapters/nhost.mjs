import { join } from 'node:path';

import { fixture, fixtureIndex, writeRecord } from '../fixtures.mjs';
import { readJson } from '../config.mjs';

const listQuery = `query BasicJsList {
  bb_basic_js_v1_guestbook(order_by: { created_at: desc }, limit: 20) {
    id
    author
    message
    created_at
  }
}`;
const itemQuery = `query BasicJsItem($id: uuid!) {
  bb_basic_js_v1_guestbook_by_pk(id: $id) {
    id
    author
    message
    created_at
  }
}`;
const writeMutation = `mutation BasicJsWrite($object: bb_basic_js_v1_guestbook_insert_input!) {
  insert_bb_basic_js_v1_guestbook_one(object: $object) {
    id
  }
}`;

function validRecord(record) {
  return record && Object.keys(record).sort().join(',') === 'author,created_at,id,message' &&
    typeof record.id === 'string' && record.id.length > 0 &&
    typeof record.author === 'string' && record.author.length > 0 && record.author.length <= 32 &&
    typeof record.message === 'string' && record.message.length > 0 && record.message.length <= 256 &&
    typeof record.created_at === 'string' && Number.isFinite(Date.parse(record.created_at));
}

function responseData(response) {
  const errors = response?.body?.errors;
  if (Array.isArray(errors) && errors.length > 0) throw new Error(errors[0]?.message || 'Nhost GraphQL request failed');
  if (!response?.body?.data) throw new Error('Nhost GraphQL response has no data');
  return response.body.data;
}

export function createNhostAdapter({ sdkCreateClient, ids, selectFixtureIndex = fixtureIndex }) {
  return {
    async createClient() {
      return sdkCreateClient({
        authUrl: 'http://local.auth.local.nhost.run/v1',
        graphqlUrl: 'http://local.graphql.local.nhost.run/v1/graphql',
        storageUrl: 'http://local.storage.local.nhost.run/v1',
        functionsUrl: 'http://local.functions.local.nhost.run/v1',
      });
    },

    async operation(client, context) {
      if (context.operation === 'list') {
        const data = responseData(await client.graphql.request({ query: listQuery }));
        return data.bb_basic_js_v1_guestbook;
      }
      if (context.operation === 'item') {
        const index = selectFixtureIndex(context.trial, context.vu, context.sequence);
        const id = ids[index];
        if (id === undefined) throw new Error(`missing Nhost fixture ID at index ${index}`);
        const data = responseData(await client.graphql.request({ query: itemQuery, variables: { id } }));
        return data.bb_basic_js_v1_guestbook_by_pk;
      }
      if (context.operation === 'write') {
        const data = responseData(await client.graphql.request({ query: writeMutation, variables: { object: writeRecord(context) } }));
        return { id: data.insert_bb_basic_js_v1_guestbook_one?.id };
      }
      throw new Error('invalid operation');
    },

    validate(result, context) {
      if (context.operation === 'list') return Array.isArray(result) && result.length === 20 && result.every(validRecord);
      if (context.operation === 'write') return result && typeof result.id === 'string' && result.id.length > 0;
      if (!validRecord(result)) return false;
      const index = selectFixtureIndex(context.trial, context.vu, context.sequence);
      const expected = fixture(index + 1);
      return result.id === ids[index] && result.author === expected.author && result.message === expected.message &&
        Date.parse(result.created_at) === Date.parse(expected.created_at);
    },
  };
}

let defaultAdapter;
async function getDefaultAdapter() {
  if (!defaultAdapter) {
    defaultAdapter = (async () => {
      const [{ createClient: sdkCreateClient }, ids] = await Promise.all([
        import('@nhost/nhost-js'),
        readJson(join(process.env.BAAS_BENCH_RUNTIME, 'state/nhost-ids.json')),
      ]);
      return createNhostAdapter({ sdkCreateClient, ids });
    })();
  }
  return defaultAdapter;
}

export async function createClient(context) { return (await getDefaultAdapter()).createClient(context); }
export async function operation(client, context) { return (await getDefaultAdapter()).operation(client, context); }
export async function validate(result, context) { return (await getDefaultAdapter()).validate(result, context); }
