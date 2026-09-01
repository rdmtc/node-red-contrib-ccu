#!/usr/bin/env node
/* Usage: node .github/release-notes.js v4.0.0 > notes.md
   Prints the CHANGELOG.md section for the given tag plus the commits
   since the previous tag. Used by the github-release job in release.yml. */

const {execSync} = require('child_process');
const fs = require('fs');

const tag = process.argv[2];
if (!tag) {
    console.error('usage: release-notes.js <tag>');
    process.exit(1);
}

const version = tag.replace(/^v/, '');

const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const lines = changelog.split('\n');
const start = lines.findIndex((l) => l.startsWith('## ') && l.includes(version));
let section = '';
if (start !== -1) {
    const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
    section = lines
        .slice(start + 1, end === -1 ? lines.length : end)
        .join('\n')
        .trim();
}

let commits = '';
try {
    const previous = execSync(`git describe --tags --abbrev=0 ${tag}^`, {encoding: 'utf8'}).trim();
    commits = execSync(`git log --pretty=format:"- %s (%h)" ${previous}..${tag}`, {encoding: 'utf8'}).trim();
    if (commits) {
        commits = `\n\n### Commits since ${previous}\n\n${commits}`;
    }
} catch {}

process.stdout.write((section || `Release ${version}`) + commits + '\n');
