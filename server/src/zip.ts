/** Minimal .zip writer (deflate, UTF-8 names), enough to hand a folder of papers over in one file. */
import { crc32, deflateRawSync } from "node:zlib";

export interface FichierZip { nom: string; contenu: Buffer }

export function zip(fichiers: FichierZip[], date = new Date()): Buffer {
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const locaux: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const f of fichiers) {
    const nom = Buffer.from(f.nom, "utf8");
    const comprime = deflateRawSync(f.contenu);
    const crc = crc32(f.contenu) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprime.length, 18); local.writeUInt32LE(f.contenu.length, 22); local.writeUInt16LE(nom.length, 26); local.writeUInt16LE(0, 28);
    locaux.push(local, nom, comprime);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comprime.length, 20);
    c.writeUInt32LE(f.contenu.length, 24); c.writeUInt16LE(nom.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nom);
    offset += 30 + nom.length + comprime.length;
  }
  const tailleCentral = central.reduce((s, b) => s + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(fichiers.length, 8); fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(tailleCentral, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locaux, ...central, fin]);
}
