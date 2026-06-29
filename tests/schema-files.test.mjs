import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

for (const schemaPath of ['schemas/task.schema.json', 'schemas/review.schema.json', 'schemas/crew-state.schema.json']) {
  test(`${schemaPath} has JSON schema identity`, async () => {
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(typeof schema.$id, 'string');
    assert.equal(schema.type, 'object');
  });
}