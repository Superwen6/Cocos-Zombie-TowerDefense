const fs = require('fs');
const data = JSON.parse(fs.readFileSync('d:/COCOS项目/NewProject_2/assets/1.scene','utf8'));

// Find the TurretBuildPanelUI component (it's the one with type e52e8)
let compIdx = -1;
for (let i = 0; i < data.length; i++) {
    if (data[i].__type__ && data[i].__type__.includes('e52e8')) {
        compIdx = i;
        console.log('TurretBuildPanelUI at index:', i, 'node:', data[i].node, 'turretPanel:', data[i].turretPanel);
        break;
    }
}

if (compIdx >= 0) {
    // Change node to Canvas (index 2)
    data[compIdx].node = { "__id__": 2 };
    // Set turretPanel to NewTurretPanel (index 93)
    data[compIdx].turretPanel = { "__id__": 93 };

    // Add to Canvas's _components
    const canvas = data[2];
    console.log('Canvas _components before:', JSON.stringify(canvas._components));
    canvas._components.push({ "__id__": compIdx });
    console.log('Canvas _components after:', JSON.stringify(canvas._components));
}

fs.writeFileSync('d:/COCOS项目/NewProject_2/assets/1.scene', JSON.stringify(data, null, 2));
console.log('Written');

// Verify
const verify = JSON.parse(fs.readFileSync('d:/COCOS项目/NewProject_2/assets/1.scene','utf8'));
console.log('Valid JSON, length:', verify.length);
const bad = [];
function w(o) { if (Array.isArray(o)) o.forEach(w); else if (o && typeof o==='object') { if (o.__id__>=0 && (o.__id__>=verify.length||o.__id__<0)) bad.push(o.__id__); for (const k in o) w(o[k]); } }
w(verify);
console.log('Out-of-bounds:', bad.length===0?'None':bad);

// Verify the component
for (let i = 0; i < verify.length; i++) {
    if (verify[i].__type__ && verify[i].__type__.includes('e52e8')) {
        console.log('Fixed component:', 'node ->', verify[i].node, 'turretPanel ->', verify[i].turretPanel);
    }
}