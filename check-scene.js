const fs = require('fs');
const s = JSON.parse(fs.readFileSync('assets/1.scene', 'utf8'));

console.log('Array length:', s.length);

let badRefs = [];
s.forEach((el, i) => {
    const j = JSON.stringify(el);
    const matches = j.matchAll(/"__id__":\s*(\d+)/g);
    for (const m of matches) {
        const n = parseInt(m[1]);
        if (n >= s.length) {
            badRefs.push(`  idx ${i}: __id__ ${n} (max=${s.length - 1})`);
        }
    }
});

if (badRefs.length > 0) {
    console.log('BAD REFERENCES:');
    console.log(badRefs.join('\n'));
} else {
    console.log('All __id__ references are valid.');
}