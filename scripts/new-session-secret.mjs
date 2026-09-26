#!/usr/bin/env node
// Prints a random value for SESSION_SECRET (signs the portal's login cookie).
//   npm run session-secret
import { randomBytes } from 'node:crypto';

console.log(`SESSION_SECRET=${randomBytes(32).toString('base64url')}`);
