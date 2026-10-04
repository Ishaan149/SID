import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const cli = createRequire(require.resolve('firebase-tools/package.json'));

test('security overrides preserve the CLI archive, streaming CSV, UUID and FTP client contracts',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aete-dependencies-'));
  let archive;
  try {
    await writeFile(join(dir,'record.txt'),'synthetic archive compatibility');
    archive=await cli('./lib/archiveDirectory').archiveDirectory(dir);
    assert.deepEqual(archive.manifest,['record.txt']);
    const names=[];
    await cli('tar').list({file:archive.file,onReadEntry:entry=>names.push(entry.path)});
    assert.deepEqual(names,['record.txt']);

    // auth-import uses this CommonJS streaming API with no parser options.
    assert.ok(cli('./lib/commands/auth-import').command);
    const parser=cli('csv-parse').parse();
    parser.end('synthetic-uid,test@example.test,"قناة, quoted"\r\nnext,test2@example.test,"line one\nline two"\r\n');
    const records=[];
    for await (const row of parser) records.push(row);
    assert.deepEqual(records,[['synthetic-uid','test@example.test','قناة, quoted'],['next','test2@example.test','line one\nline two']]);

    for(const name of ['firebase-tools','gaxios','google-gax','teeny-request','universal-analytics']) {
      const caller=createRequire(require.resolve(`${name}/package.json`));
      assert.equal(caller('uuid').validate(caller('uuid').v4()),true);
    }
    const ftp=new (require('basic-ftp').Client)();
    try { for(const method of ['access','lastMod','list','downloadTo','close']) assert.equal(typeof ftp[method],'function'); }
    finally { ftp.close(); }
  } finally {
    if(archive) { archive.stream.destroy(); await rm(archive.file,{force:true}); }
    await rm(dir,{recursive:true,force:true});
  }
});
