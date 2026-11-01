import fs from 'node:fs/promises';
import {snapshot,snapshotBindings} from './policy.mjs';
export function validateSummaryLocal(input){try{const value=snapshot(input);if(Object.keys(value).sort().join(',')!=='bindings,schema_version'||value.schema_version!==1)throw Error();return snapshotBindings(value.bindings);}catch{throw new Error('SUMMARY_BINDING_REQUIRED');}}
export async function loadSummaryBindings(filename){try{return validateSummaryLocal(JSON.parse(await fs.readFile(filename,'utf8')));}catch{throw new Error('SUMMARY_BINDING_REQUIRED');}}