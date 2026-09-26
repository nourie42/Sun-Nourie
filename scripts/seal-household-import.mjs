// Offline encryption only. This script never uploads data or reads private server keys.
// Usage: node scripts/seal-household-import.mjs public.pem payload.private.json update.enc.json
import fs from 'node:fs/promises';
import {randomBytes,createCipheriv,publicEncrypt,createPublicKey} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const [publicFile,inputFile,outputFile]=process.argv.slice(2);
if(!publicFile||!inputFile||!outputFile)throw Error('Supply a public key file, private input JSON, and encrypted output filename.');
const payload=JSON.parse(await fs.readFile(inputFile,'utf8'));
if(payload.version!==1||payload.kind!=='transactions'||!Array.isArray(payload.transactions))throw Error('Input must be a prepared transaction import, not a workbook, budget replacement, or raw account export.');
const publicKey=createPublicKey(await fs.readFile(publicFile));
if(publicKey.asymmetricKeyType!=='rsa'||publicKey.asymmetricKeyDetails.modulusLength<3072)throw Error('Use the verified household import public key.');
const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
cipher.setAAD(Buffer.from('private-household-pl:v1'));
const data=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload)))),cipher.final()]);
const enc=b=>b.toString('base64');
const envelope={v:1,iv:enc(iv),tag:enc(cipher.getAuthTag()),data:enc(data),alg:'RSA-OAEP-256+A256GCM+gzip',key:enc(publicEncrypt({key:publicKey,oaepHash:'sha256'},key))};
await fs.writeFile(outputFile,JSON.stringify(envelope),{mode:0o600});
console.log('Encrypted import prepared. Only the encrypted output may be committed.');
