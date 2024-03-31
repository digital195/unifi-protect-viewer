'use strict';

const fs = require('node:fs');

const packageJSON = JSON.parse(fs.readFileSync('package.json'));

const baseName = 'unifi-protect-viewer';
const version = packageJSON['version'];

console.log('rename', baseName, version);
console.log('=========================');

fs.readdirSync('builds').forEach((file) => {
    if (!fs.lstatSync('builds/' + file).isDirectory()) {
        console.log(`skip ${file}, only rename dirs`);
        return;
    }

    if (file.includes(version)) {
        console.log(`skip ${file}, version already in name`);
        return;
    }

    const portable = file.includes('portable');

    const arch = file.replace(`${baseName}${portable ? '-portable' : ''}-`, '');

    const oldName = `builds/${file}`;
    const newName = `builds/${baseName}-${arch}-${version}${portable ? '-portable': ''}`;
    console.log(`rename ${oldName} to ${newName}`);
    fs.renameSync(oldName, newName);
});

console.log('=========================');
console.log('rename finished');