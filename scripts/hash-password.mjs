#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Makes the value for ADMIN_PASSWORD_HASH.
//
//   npm run hash-password
//
// You type the password (hidden, twice); it prints one line to paste into
// Vercel → backend project → Settings → Environment Variables. The password is
// never written to disk, never passed on the command line (where it would land
// in your shell history), and never leaves this machine.
//
// Format: scrypt:N:r:p:<salt>:<hash>, base64url — mirrors src/lib/password.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes, scrypt } from 'node:crypto';
import readline from 'node:readline';

const N = 32768; // 2^15
const R = 8;
const P = 1;
const KEYLEN = 32;
const MIN_LENGTH = 10;

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    const write = rl._writeToOutput.bind(rl);
    // Echo the prompt, then nothing while typing.
    rl._writeToOutput = (text) => {
      if (!muted) write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

const password = await askHidden('New portal password: ');
if (password.length < MIN_LENGTH) {
  console.error(`Use at least ${MIN_LENGTH} characters. A short phrase is easiest to type on a phone.`);
  process.exit(1);
}
const again = await askHidden('Type it again: ');
if (again !== password) {
  console.error('The two entries didn’t match. Nothing was created.');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = await new Promise((resolve, reject) =>
  scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 256 * N * R }, (err, key) =>
    err ? reject(err) : resolve(key)
  )
);

console.log('\nAdd this to Vercel as ADMIN_PASSWORD_HASH (the value is everything after the =):\n');
console.log(`ADMIN_PASSWORD_HASH=scrypt:${N}:${R}:${P}:${salt.toString('base64url')}:${hash.toString('base64url')}`);
console.log('\nChanging this value later signs out every device that is logged in.\n');
