'use strict';

/**
 * export-dynamodb.js
 *
 * One-time utility: exports all records from the pencil2-sync DynamoDB table
 * to a local JSON file for subsequent import into Firestore.
 *
 * Usage:
 *   node scripts/export-dynamodb.js [output-file]
 *
 * Env vars required:
 *   AWS_REGION            (default: eu-west-1)
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   DYNAMO_TABLE          (default: pencil2-sync)
 */

require('dotenv').config();
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');

const TABLE_NAME = process.env.DYNAMO_TABLE || 'pencil2-sync';
const OUTPUT_FILE = process.argv[2] || 'dynamo-export.json';
const REGION = process.env.AWS_REGION || 'eu-west-1';

async function exportAll() {
    console.log(`Connecting to DynamoDB table "${TABLE_NAME}" in region "${REGION}"...`);

    const client = DynamoDBDocumentClient.from(
        new DynamoDBClient({ region: REGION }),
        { marshallOptions: { removeUndefinedValues: true } }
    );

    const items = [];
    let lastKey;
    let page = 0;

    do {
        page++;
        const resp = await client.send(
            new ScanCommand({
                TableName: TABLE_NAME,
                ExclusiveStartKey: lastKey
            })
        );
        const pageItems = resp.Items || [];
        items.push(...pageItems);
        lastKey = resp.LastEvaluatedKey;
        console.log(`  Page ${page}: ${pageItems.length} items (total so far: ${items.length})`);
    } while (lastKey);

    const outputPath = path.resolve(OUTPUT_FILE);
    fs.writeFileSync(outputPath, JSON.stringify(items, null, 2), 'utf8');

    // Print a summary breakdown by entityType
    const byType = {};
    for (const item of items) {
        const et = item.entityType || item.entity_type || 'unknown';
        byType[et] = (byType[et] || 0) + 1;
    }

    console.log(`\nExported ${items.length} total items to: ${outputPath}`);
    console.log('\nBreakdown by entityType:');
    for (const [et, count] of Object.entries(byType).sort()) {
        console.log(`  ${et.padEnd(30)} ${count}`);
    }
}

exportAll().catch((err) => {
    console.error('Export failed:', err.message);
    process.exit(1);
});
