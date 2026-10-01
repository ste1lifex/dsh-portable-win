/**
 * Dependency-free archive extraction for the two container formats the pinned
 * Tectonic release uses.
 *
 * Both readers refuse absolute or traversing member names, so a substituted
 * archive cannot write outside the runtime directory even if its SHA-256 were
 * somehow to match.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';

/**
 * @param {string} destinationRoot
 * @param {string} memberName
 * @returns {string}
 */
function safeTarget(destinationRoot, memberName) {
  const target = resolve(destinationRoot, memberName);
  if (target !== destinationRoot && !target.startsWith(destinationRoot + sep)) {
    throw new Error(`Unsafe archive member path: ${memberName}`);
  }
  return target;
}

/**
 * Extract a ZIP archive.
 * @param {Buffer} buffer
 * @param {string} destinationDirectory
 * @returns {string[]} extracted relative member names
 */
export function extractZip(buffer, destinationDirectory) {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 22 - 0xffff); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive: end-of-central-directory record not found.');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const destinationRoot = resolve(destinationDirectory);
  mkdirSync(destinationRoot, { recursive: true });
  const extracted = [];

  for (let entry = 0; entry < entryCount; entry += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Corrupt ZIP central directory.');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Corrupt ZIP local header for ${name}.`);
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    let content;
    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8) content = inflateRawSync(compressed);
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}.`);

    const target = safeTarget(destinationRoot, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    extracted.push(name);
  }
  return extracted;
}

/**
 * Read a NUL-terminated field from a tar header.
 * @param {Buffer} block
 * @param {number} start
 * @param {number} length
 * @returns {string}
 */
function tarString(block, start, length) {
  const end = block.indexOf(0, start);
  const stop = end === -1 || end > start + length ? start + length : end;
  return block.subarray(start, stop).toString('utf8');
}

/**
 * Parse an octal (or base-256) tar numeric field.
 * @param {Buffer} block
 * @param {number} start
 * @param {number} length
 * @returns {number}
 */
function tarNumber(block, start, length) {
  const first = block[start];
  if ((first & 0x80) !== 0) {
    // GNU base-256 encoding.
    let value = first & 0x7f;
    for (let index = start + 1; index < start + length; index += 1) {
      value = value * 256 + block[index];
    }
    return value;
  }
  const text = tarString(block, start, length).trim();
  return text === '' ? 0 : Number.parseInt(text, 8);
}

/**
 * Extract a `.tar.gz` archive (ustar, with GNU long-name and pax extensions).
 * @param {Buffer} buffer
 * @param {string} destinationDirectory
 * @returns {string[]} extracted relative member names
 */
export function extractTarGz(buffer, destinationDirectory) {
  const tar = gunzipSync(buffer);
  const destinationRoot = resolve(destinationDirectory);
  mkdirSync(destinationRoot, { recursive: true });
  const extracted = [];

  let offset = 0;
  let pendingLongName;
  let pendingPaxPath;
  while (offset + 512 <= tar.length) {
    const block = tar.subarray(offset, offset + 512);
    if (block.every(byte => byte === 0)) break;

    const headerName = tarString(block, 0, 100);
    const prefix = tarString(block, 345, 155);
    const size = tarNumber(block, 124, 12);
    const typeFlag = String.fromCharCode(block[156] === 0 ? 0x30 : block[156]);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    const padded = offset + 512 + Math.ceil(size / 512) * 512;
    const memberName = pendingPaxPath ?? pendingLongName ?? (prefix === '' ? headerName : `${prefix}/${headerName}`);
    pendingLongName = undefined;
    pendingPaxPath = undefined;

    if (typeFlag === 'L') {
      pendingLongName = tar.subarray(dataStart, dataEnd).toString('utf8').replace(/\0+$/, '');
      offset = padded;
      continue;
    }
    if (typeFlag === 'x' || typeFlag === 'g') {
      const records = tar.subarray(dataStart, dataEnd).toString('utf8');
      const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(records);
      if (match !== null) pendingPaxPath = match[1];
      offset = padded;
      continue;
    }
    if (typeFlag === '5') {
      mkdirSync(safeTarget(destinationRoot, memberName), { recursive: true });
      offset = padded;
      continue;
    }
    if (typeFlag === '0') {
      const target = safeTarget(destinationRoot, memberName);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, tar.subarray(dataStart, dataEnd));
      extracted.push(memberName);
      offset = padded;
      continue;
    }
    // Symlinks, devices and other exotic members do not appear in the pinned
    // archives; skipping them is safer than materializing them.
    offset = padded;
  }
  return extracted;
}

/**
 * Extract whichever container the asset uses.
 * @param {'zip' | 'tar.gz'} kind
 * @param {Buffer} buffer
 * @param {string} destinationDirectory
 * @returns {string[]}
 */
export function extractArchive(kind, buffer, destinationDirectory) {
  if (kind === 'zip') return extractZip(buffer, destinationDirectory);
  if (kind === 'tar.gz') return extractTarGz(buffer, destinationDirectory);
  throw new Error(`Unsupported archive kind: ${kind}`);
}
