/**
 * lib/decrypt 单元测试（零依赖，node test/decrypt.test.js 运行）
 *
 * 验证 decryptBuffer 与参考实现（Python CLI decrypt_video / 旧 worker.html
 * decryptVideo）的 XOR 逻辑字节级一致，覆盖大文件边界场景。
 */

const assert = require('assert');
const { KEYSTREAM_SIZE, decryptBuffer, assertMp4 } = require('../lib/decrypt');

let passed = 0;
function test(name, fn) {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
}

/**
 * 参考实现：等价于 Python CLI 的
 *   decrypt_len = min(len(keystream), len(encrypted))
 *   前 decrypt_len 字节做 XOR，其余原样
 */
function referenceDecrypt(encrypted, keystream) {
    const out = Buffer.alloc(encrypted.length);
    const n = Math.min(keystream.length, encrypted.length);
    for (let i = 0; i < n; i++) out[i] = encrypted[i] ^ keystream[i];
    for (let i = n; i < encrypted.length; i++) out[i] = encrypted[i];
    return out;
}

// 用固定种子的伪随机生成可复现数据（避免依赖 Math.random）
function pseudoBuffer(size, seed) {
    const buf = Buffer.alloc(size);
    let s = seed >>> 0;
    for (let i = 0; i < size; i++) {
        s = (s * 1664525 + 1013904223) >>> 0; // LCG
        buf[i] = s & 0xff;
    }
    return buf;
}

console.log('运行 lib/decrypt 测试...\n');

const keystream = pseudoBuffer(KEYSTREAM_SIZE, 12345);

test('小文件(<128KB)：仅前段加密，结果与参考实现一致', () => {
    const encrypted = pseudoBuffer(50 * 1024, 7);
    const got = decryptBuffer(encrypted, keystream);
    assert.deepStrictEqual(got, referenceDecrypt(encrypted, keystream));
});

test('恰好 128KB：全量加密，结果与参考实现一致', () => {
    const encrypted = pseudoBuffer(KEYSTREAM_SIZE, 99);
    const got = decryptBuffer(encrypted, keystream);
    assert.deepStrictEqual(got, referenceDecrypt(encrypted, keystream));
});

test('大文件(120MB > CDP 100MB 上限)：前 128KB 加密、其余明文保留', () => {
    const size = 120 * 1024 * 1024;
    const encrypted = pseudoBuffer(size, 2026);
    const got = decryptBuffer(encrypted, keystream);

    // 前 128KB 应被 XOR
    for (let i = 0; i < 1000; i++) {
        assert.strictEqual(got[i], encrypted[i] ^ keystream[i]);
    }
    // 128KB 之后应为明文（与原始一致）
    assert.strictEqual(got[KEYSTREAM_SIZE], encrypted[KEYSTREAM_SIZE]);
    assert.strictEqual(got[size - 1], encrypted[size - 1]);
    assert.strictEqual(got.length, size);
});

test('XOR 可逆：decrypt(encrypt(x)) === x', () => {
    const plain = pseudoBuffer(200 * 1024, 555);
    const encrypted = decryptBuffer(plain, keystream); // XOR 即加密
    const back = decryptBuffer(encrypted, keystream);  // 再 XOR 即解密
    assert.deepStrictEqual(back, plain);
});

test('decryptBuffer 不修改入参 encrypted', () => {
    const encrypted = pseudoBuffer(10 * 1024, 1);
    const copy = Buffer.from(encrypted);
    decryptBuffer(encrypted, keystream);
    assert.deepStrictEqual(encrypted, copy);
});

test('assertMp4：合法 ftyp 通过', () => {
    const buf = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('ftypisom')]);
    assert.doesNotThrow(() => assertMp4(buf));
});

test('assertMp4：缺失签名抛错', () => {
    const buf = Buffer.from('not a valid mp4 header here');
    assert.throws(() => assertMp4(buf), /ftyp/);
});

console.log(`\n✅ 全部 ${passed} 项测试通过`);
