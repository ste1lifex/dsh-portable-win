import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { extractArchive, extractTarGz, extractZip } from '../../scripts/lib/archive.mjs';

/**
 * Build one ustar member. The extractor only reads name/size/typeflag, so the
 * rest of the header is filled with plausible constants.
 * @param {string} name
 * @param {Buffer} content
 * @param {string} [typeFlag]
 * @returns {Buffer}
 */
function tarMember(name, content, typeFlag = '0') {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'utf8');
  header.write('0000000\0', 108, 8, 'utf8');
  header.write('0000000\0', 116, 8, 'utf8');
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  header.write('00000000000\0', 136, 12, 'utf8');
  header.write('        ', 148, 8, 'utf8');
  header.write(typeFlag, 156, 1, 'utf8');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');

  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, padding]);
}

/**
 * Build a stored (uncompressed) ZIP with the given members.
 * @param {{ name: string, content: Buffer }[]} members
 * @returns {Buffer}
 */
function buildZip(members) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(member.content.length, 18);
    local.writeUInt32LE(member.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, member.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(member.content.length, 20);
    central.writeUInt32LE(member.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + member.content.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, eocd]);
}

/** @param {string} prefix */
function scratch(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('extractZip restores stored members and skips directory entries', () => {
  const directory = scratch('dsh-latex-zip-');
  try {
    const archive = buildZip([
      { name: 'bin/', content: Buffer.alloc(0) },
      { name: 'bin/tectonic', content: Buffer.from('binary-payload') }
    ]);
    const extracted = extractZip(archive, directory);
    assert.deepEqual(extracted, ['bin/tectonic']);
    assert.equal(readFileSync(join(directory, 'bin', 'tectonic'), 'utf8'), 'binary-payload');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('extractZip refuses a traversing member name', () => {
  const directory = scratch('dsh-latex-zip-escape-');
  try {
    const archive = buildZip([{ name: '../escaped.txt', content: Buffer.from('nope') }]);
    assert.throws(() => extractZip(archive, join(directory, 'inner')), /Unsafe archive member path/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('extractTarGz reads a gzipped ustar archive', () => {
  const directory = scratch('dsh-latex-tar-');
  try {
    const tar = Buffer.concat([
      tarMember('tectonic', Buffer.from('tar-payload')),
      Buffer.alloc(1024)
    ]);
    const extracted = extractTarGz(gzipSync(tar), directory);
    assert.deepEqual(extracted, ['tectonic']);
    assert.equal(readFileSync(join(directory, 'tectonic'), 'utf8'), 'tar-payload');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('extractTarGz handles a payload that is not a multiple of the block size', () => {
  const directory = scratch('dsh-latex-tar-pad-');
  try {
    const payload = Buffer.from('x'.repeat(1500));
    const tar = Buffer.concat([tarMember('tectonic', payload), Buffer.alloc(1024)]);
    extractTarGz(gzipSync(tar), directory);
    assert.equal(readFileSync(join(directory, 'tectonic')).length, 1500);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('extractTarGz refuses a traversing member name', () => {
  const directory = scratch('dsh-latex-tar-escape-');
  try {
    const tar = Buffer.concat([tarMember('../escaped.txt', Buffer.from('nope')), Buffer.alloc(1024)]);
    assert.throws(() => extractTarGz(gzipSync(tar), join(directory, 'inner')), /Unsafe archive member path/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('extractArchive routes by container kind', () => {
  const directory = scratch('dsh-latex-kind-');
  try {
    const zip = buildZip([{ name: 'tectonic', content: Buffer.from('z') }]);
    extractArchive('zip', zip, directory);
    assert.equal(readFileSync(join(directory, 'tectonic'), 'utf8'), 'z');
    assert.throws(() => extractArchive('rar', zip, directory), /Unsupported archive kind/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
