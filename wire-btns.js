const fs = require('fs');
const data = JSON.parse(fs.readFileSync('d:/COCOS项目/NewProject_2/assets/1.scene','utf8'));

// Find key indices
let canvasIdx = -1, newTurretPanelIdx = -1, btnOpenUpgradeIdx = -1, btnBuildTurretIdx = -1;
let turretPanelOldIdx = -1;
let turretBuildPanelUIIndex = -1; // component on Canvas
let turretBuildPanelUIOnOld = -1; // stale component on old TurretPanel

for (let i = 0; i < data.length; i++) {
    if (data[i]._name === 'Canvas') canvasIdx = i;
    if (data[i]._name === 'NewTurretPanel') newTurretPanelIdx = i;
    if (data[i]._name === 'Btn_OpenUpgrade') btnOpenUpgradeIdx = i;
    if (data[i]._name === 'Btn_BuildTurret') btnBuildTurretIdx = i;
    if (data[i]._name === 'TurretPanel') turretPanelOldIdx = i;
}

// Find TurretBuildPanelUI components
for (let i = 0; i < data.length; i++) {
    if (data[i].__type__ && data[i].__type__.includes('e52e8')) {
        if (data[i].node && data[i].node.__id__ === canvasIdx) {
            turretBuildPanelUIIndex = i;
        } else if (data[i].node && data[i].node.__id__ === turretPanelOldIdx) {
            turretBuildPanelUIOnOld = i;
        }
    }
}

console.log('Canvas:', canvasIdx);
console.log('NewTurretPanel:', newTurretPanelIdx);
console.log('Btn_OpenUpgrade:', btnOpenUpgradeIdx);
console.log('Btn_BuildTurret:', btnBuildTurretIdx);
console.log('TurretPanel(old):', turretPanelOldIdx);
console.log('TurretBuildPanelUI on Canvas:', turretBuildPanelUIIndex);
console.log('TurretBuildPanelUI on old TurretPanel:', turretBuildPanelUIOnOld);

// 1. Remove stale TurretBuildPanelUI from old TurretPanel
if (turretBuildPanelUIOnOld >= 0) {
    const oldPanel = data[turretPanelOldIdx];
    oldPanel._components = oldPanel._components.filter(c => c.__id__ !== turretBuildPanelUIOnOld);
    console.log('Removed stale component from old TurretPanel');
}

// 2. Ensure TurretBuildPanelUI is on Canvas with turretPanel -> NewTurretPanel
if (turretBuildPanelUIIndex >= 0) {
    data[turretBuildPanelUIIndex].turretPanel = { "__id__": newTurretPanelIdx };
    console.log('Set turretPanel -> NewTurretPanel');
} else {
    console.log('ERROR: No TurretBuildPanelUI on Canvas!');
}

// 3. Wire Btn_OpenUpgrade Button -> showPanel on TurretBuildPanelUI
for (let i = 0; i < data.length; i++) {
    if (data[i].__type__ === 'cc.Button' && data[i].node && data[i].node.__id__ === btnOpenUpgradeIdx) {
        data[i].clickEvents = [{
            "__type__": "cc.ClickEvent",
            "target": { "__id__": canvasIdx },
            "component": "TurretBuildPanelUI",
            "_componentId": "e52e8hsdLJJfaJp50sJqkPb",
            "handler": "showPanel",
            "customEventData": ""
        }];
        console.log('Btn_OpenUpgrade wired to showPanel');
    }
}

// 4. Wire Btn_BuildTurret Button -> onBuildButtonClick on TurretBuildPanelUI
for (let i = 0; i < data.length; i++) {
    if (data[i].__type__ === 'cc.Button' && data[i].node && data[i].node.__id__ === btnBuildTurretIdx) {
        data[i].clickEvents = [{
            "__type__": "cc.ClickEvent",
            "target": { "__id__": canvasIdx },
            "component": "TurretBuildPanelUI",
            "_componentId": "e52e8hsdLJJfaJp50sJqkPb",
            "handler": "onBuildButtonClick",
            "customEventData": ""
        }];
        console.log('Btn_BuildTurret wired to onBuildButtonClick');
    }
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