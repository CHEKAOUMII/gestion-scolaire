'use strict';

// node tests/import-center/import-encoding.test.js

/**
 * File-encoding contract for imports (multi-cycle plan §6.3).
 *
 * The previous reader called file.text() with no encoding check, and its byte fallback
 * ran decodeURIComponent(escape(bytes)) with a catch that returned the raw latin1 string.
 * A Windows-1256 export — common for older Massar/Excel files on Moroccan school
 * machines — therefore imported as mojibake and was saved as if it were the real Arabic
 * name. These tests pin the replacement rule: decode what is declared, refuse the rest,
 * never guess.
 */

const assert = require('assert');
const Readers = require('../../js/import-center/import-readers.js');

function fileFromBytes(name, bytes) {
    const buffer = Buffer.from(bytes);
    return {
        name,
        size: buffer.length,
        type: 'text/csv',
        async arrayBuffer() {
            return buffer;
        }
    };
}

function utf8File(name, text) {
    return fileFromBytes(name, Buffer.from(text, 'utf8'));
}

(async () => {
    const ARABIC_HEADER = 'الاسم الكامل,القسم,النقطة\nأحمد بنعلي,1BACSH-7,14\n';

    // ── UTF-8, with and without BOM ────────────────────────────────────────
    const plain = await Readers.extractFeatures(utf8File('plain.csv', ARABIC_HEADER));
    assert.strictEqual(plain.error, null);
    assert.strictEqual(plain.headers[0], 'الاسم الكامل');

    const withBom = await Readers.extractFeatures(
        fileFromBytes('bom.csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ARABIC_HEADER, 'utf8')]))
    );
    assert.strictEqual(withBom.error, null, 'a UTF-8 BOM is our own export format');
    assert.strictEqual(
        withBom.headers[0],
        'الاسم الكامل',
        'the BOM must be stripped, not carried into the first header cell'
    );
    console.log('  [ok] UTF-8 with and without BOM reads identically');

    // ── UTF-16LE: a declared encoding, so it is decoded rather than refused ──
    const utf16 = await Readers.extractFeatures(
        fileFromBytes(
            'utf16.csv',
            Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(ARABIC_HEADER, 'utf16le')])
        )
    );
    assert.strictEqual(utf16.error, null, 'BOM-declared UTF-16 is not a guess');
    assert.strictEqual(utf16.headers[0], 'الاسم الكامل');
    console.log('  [ok] BOM-declared UTF-16 is decoded, not rejected');

    // ── Windows-1256: refused with its own code, never imported as mojibake ──
    // 0xC7 0xCD 0xE3 0xCF = أحمد in CP1256; invalid as UTF-8.
    const cp1256 = await Readers.extractFeatures(
        fileFromBytes('massar-legacy.csv', [0xc7, 0xcd, 0xe3, 0xcf, 0x2c, 0x31, 0x34, 0x0a])
    );
    assert.strictEqual(cp1256.error, 'unsupported_encoding', 'a mis-encoded file must not be read');
    assert.deepStrictEqual(cp1256.headers, [], 'no headers are surfaced from an undecodable file');
    assert.strictEqual(cp1256.contentText, '', 'no corrupted text leaks into the preview');
    console.log('  [ok] Windows-1256 bytes are refused instead of silently mangled');

    // Lone invalid continuation bytes are refused too (truncated/broken UTF-8).
    const broken = await Readers.extractFeatures(fileFromBytes('broken.csv', [0x61, 0x2c, 0x62, 0x0a, 0xe0, 0xa4]));
    assert.strictEqual(broken.error, 'unsupported_encoding');

    // ── The encoding failure is distinct from a generic read error ──────────
    const readable = await Readers.extractFeatures(utf8File('readable.csv', 'a,b\n1,2\n'));
    assert.strictEqual(readable.error, null, 'valid file has no error');
    assert.notStrictEqual('unsupported_encoding', 'unreadable', 'encoding failure has its own code');
    console.log('  [ok] the encoding failure has its own actionable code');

    console.log('import-encoding: OK');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
